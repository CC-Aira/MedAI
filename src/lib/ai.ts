import { HttpError } from "./http";

export type ChatRole = "system" | "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };

export type AskOptions = {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 要求模型返回 JSON（response_format: json_object）。提示词里必须出现 "json" 字样 */
  json?: boolean;
  signal?: AbortSignal;
};

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-flash";

function baseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function model(): string {
  return process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
}

function apiKey(): string {
  return (process.env.DEEPSEEK_API_KEY || "").trim();
}

/** 配了 Key 才算真正可用 */
export function aiConfigured(): boolean {
  return apiKey().length > 0;
}

/** 没配 Key 时的本地模拟模式，只在显式开启时生效 */
export function aiDemoMode(): boolean {
  return process.env.MEDAI_DEMO_AI === "1";
}

/**
 * 路由的第三道门：配置检查。
 * 调用顺序必须是「校验输入 400 → 认门 404 → 查配置 503 → 干活」。
 */
export function assertAiReady(): void {
  if (aiConfigured() || aiDemoMode()) return;
  throw new HttpError(
    503,
    "还没有配置 DEEPSEEK_API_KEY，AI 能力暂不可用（在 .env 里填上即可）",
  );
}

/* ---------------------------------------------------------------- 调用 */

/** 等首包的上限：正常问诊 1~3 秒就来，90 秒还没动静基本就是网络断了 */
const FIRST_BYTE_TIMEOUT_MS = 90_000;

/**
 * 统一的上游请求：只给「建连 + 首包」设上限，拿到响应头就撤掉计时器。
 *
 * 为什么不能给整个请求设超时：流式回答本身可能持续几十秒，
 * 一个覆盖全程的 signal 会把正常但话多的回答从中间掐断。
 *
 * 调用方自己传了 signal（用户点了停止）时以调用方为准，不叠加 ——
 * 那时中止是我们的意图，应该原样抛出，不当成故障。
 */
async function postChat(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const guard = signal ? null : new AbortController();
  const timer = guard ? setTimeout(() => guard.abort(), FIRST_BYTE_TIMEOUT_MS) : null;

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify(payload),
      signal: signal ?? guard?.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      // guard 还在 = 超时把我们打断的；guard 为 null = 调用方主动中止
      if (guard) throw new HttpError(504, "AI 服务一直没有响应（等了 90 秒），请重试");
      throw err;
    }
    throw new HttpError(502, "连不上 DeepSeek，请检查网络或代理设置");
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    // 401/403 是 Key 的问题，别把上游原文整段回吐给前端
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(503, "DEEPSEEK_API_KEY 无效或已过期");
    }
    throw new HttpError(502, `DeepSeek 返回 ${res.status}${detail ? `：${detail}` : ""}`);
  }
  return res;
}

/**
 * 流式调用，直接把 Response 交给上层去读。
 * 演示模式下返回一条同协议的本地模拟流，方便无 Key 时跑通全链路。
 */
export async function askDeepSeek(options: AskOptions): Promise<Response> {
  const { messages, temperature = 0.6, maxTokens = 900, json = false, signal } = options;

  if (!aiConfigured()) {
    if (!aiDemoMode()) {
      throw new HttpError(503, "AI 服务未配置，请先设置 DEEPSEEK_API_KEY");
    }
    return demoStream(messages, json);
  }

  const payload: Record<string, unknown> = {
    model: model(),
    messages,
    stream: true,
    temperature,
    max_tokens: maxTokens,
    // 问诊不需要思维链，关掉更快更省
    thinking: { type: "disabled" },
  };
  if (json) payload.response_format = { type: "json_object" };

  return postChat(payload, signal);
}


/** 一次性调用（摘要、整理档案这类不需要逐字显示的活儿） */
export async function askDeepSeekOnce(options: AskOptions): Promise<string> {
  const { messages, temperature = 0.3, maxTokens = 900, json = false, signal } = options;

  if (!aiConfigured()) {
    if (!aiDemoMode()) {
      throw new HttpError(503, "AI 服务未配置，请先设置 DEEPSEEK_API_KEY");
    }
    return demoOnce(messages, json);
  }

  const payload: Record<string, unknown> = {
    model: model(),
    messages,
    stream: false,
    temperature,
    max_tokens: maxTokens,
    thinking: { type: "disabled" },
  };
  if (json) payload.response_format = { type: "json_object" };

  const res = await postChat(payload, signal);

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new HttpError(502, "DeepSeek 返回了空内容");
  }
  return content;
}

/* ------------------------------------------------------------ 解析流 */

/**
 * 解析 DeepSeek 的 SSE。
 * 关键点：chunk 边界会切在一行中间，必须用 buffer 兜住半截 JSON，
 * 否则每次都丢几个字（表现为回答里随机缺字）。
 */
export async function readDeepSeekStream(
  res: Response,
  onDelta: (text: string) => void,
): Promise<string> {
  if (!res.body) throw new HttpError(502, "DeepSeek 没有返回可读的流");

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // 最后一段可能是半行，留在 buffer 里等下一个 chunk
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(":")) continue;
      if (!line.startsWith("data:")) continue;

      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data) as {
          choices?: { delta?: { content?: string | null } }[];
        };
        const piece = parsed.choices?.[0]?.delta?.content;
        if (typeof piece === "string" && piece) {
          full += piece;
          onDelta(piece);
        }
      } catch {
        // 半截 JSON 或心跳帧，跳过即可，下一轮会补齐
      }
    }
  }

  // 收尾：缓冲区里如果还剩完整的一行，也要读掉
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    const data = tail.slice(5).trim();
    if (data && data !== "[DONE]") {
      try {
        const parsed = JSON.parse(data) as {
          choices?: { delta?: { content?: string | null } }[];
        };
        const piece = parsed.choices?.[0]?.delta?.content;
        if (typeof piece === "string" && piece) {
          full += piece;
          onDelta(piece);
        }
      } catch {
        /* ignore */
      }
    }
  }

  return full;
}

/* --------------------------------------------------------- JSON 兜底 */

/**
 * 模型经常把 JSON 包进 ```json 代码块，或者前后加一句解释。
 * 依次尝试：原样 → 剥代码块 → 取最外层花括号 / 方括号。
 */
export function parseJsonLoose<T = unknown>(raw: string): T | null {
  const text = (raw || "").trim();
  if (!text) return null;

  const direct = tryParse<T>(text);
  if (direct !== null) return direct;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) {
    const inner = tryParse<T>(fenced[1].trim());
    if (inner !== null) return inner;
  }

  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start >= 0 && end > start) {
      const slice = tryParse<T>(text.slice(start, end + 1));
      if (slice !== null) return slice;
    }
  }

  return null;
}

function tryParse<T>(text: string): T | null {
  try {
    const value = JSON.parse(text) as T;
    return value === null || value === undefined ? null : value;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------- 本地模拟（无 Key） */

function sseLine(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

/** 用与 DeepSeek 完全一致的 SSE 协议吐出模拟内容 */
function demoStream(messages: ChatMessage[], json: boolean): Response {
  const text = json ? demoJson(messages) : demoReply(messages);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const chunks = text.match(/[\s\S]{1,6}/g) ?? [];
      let i = 0;
      const timer = setInterval(() => {
        if (i >= chunks.length) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          clearInterval(timer);
          return;
        }
        controller.enqueue(encoder.encode(sseLine(chunks[i])));
        i += 1;
      }, 12);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "x-medai-demo": "1",
    },
  });
}

function demoOnce(messages: ChatMessage[], json: boolean): string {
  return json ? demoJson(messages) : demoReply(messages);
}

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}

function systemText(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
}

/** 模拟的 JSON：按 system 里的任务标记返回不同结构 */
function demoJson(messages: ChatMessage[]): string {
  const sys = systemText(messages);

  if (sys.includes("TASK:facts")) {
    return JSON.stringify(
      {
        fill: [
          {
            field: "bloodType",
            value: "O",
            reason: "问诊里提到过体检血型，档案里还空着",
          },
          {
            field: "habits",
            value: "每天两杯咖啡，凌晨一点左右睡，久坐少运动",
            reason: "对话中提到作息和咖啡习惯，可以补进生活习惯",
          },
        ],
        add: [
          {
            drugName: "布洛芬",
            dosage: "200mg",
            frequency: "疼痛时服用",
            reason: "提到偏头痛发作时会吃止痛药",
          },
        ],
      },
      null,
      2,
    );
  }

  if (sys.includes("TASK:visit_sheet")) {
    return JSON.stringify({
      chiefComplaint: "近两周反复头胀，多在下午出现，伴有入睡困难。",
      course: [
        "两周前开始，最初每周两三次，最近几乎每天下午都会出现。",
        "久坐、没喝水时更明显，休息十几分钟会缓一些。",
        "没有出现过视物模糊、肢体无力或说话不清。",
        "自行量过血压，在 130/85 到 145/92 之间波动。",
      ],
      ruledOut: ["没有胸痛、呼吸困难、意识不清这类信号"],
      advice: [
        "每天固定时间量一次血压，记下时间和数值，带来给医生看。",
        "下午每小时起身活动两分钟，别一直坐着。",
        "这两周先别熬夜，尽量在 23 点前睡。",
      ],
      whenToGo: "血压持续超过 180/110，或出现剧烈头痛、视物模糊、一侧肢体无力时，直接去急诊。",
      questions: [
        "这种波动需要现在就开始吃降压药吗？",
        "要不要做一个 24 小时动态血压？",
        "和最近作息、咖啡有没有关系？",
      ],
    });
  }

  if (sys.includes("TASK:summary")) {
    return JSON.stringify({
      summary:
        "本次主要围绕近期反复出现的不适展开：患者描述了发作时间、诱因与伴随感受，已排除需要立即急诊的红旗信号。给出的是就医前可自行调整的生活建议，并提示如果症状加重或出现发热、持续剧痛，应尽快线下就诊。未下诊断、未调整任何在服药物剂量。",
    });
  }

  return JSON.stringify({ ok: true });
}

/** 模拟的对话回复：有追问、有共情、有合规边界，够撑住演示 */
function demoReply(messages: ChatMessage[]): string {
  const last = lastUserText(messages).trim();
  const sys = systemText(messages);
  const firstTurn = messages.filter((m) => m.role === "user").length <= 1;

  const allergy = /过敏[：:]\s*([^\n]+)/.exec(sys)?.[1]?.trim();

  if (!last) {
    return "我在。你可以从最难受的那一处开始说，什么时候开始的、什么样的情况下会更明显，慢慢讲就好。";
  }

  if (/胸痛|胸闷|呼吸困难|喘不上|晕倒|昏迷|抽搐|吐血|便血/.test(last)) {
    return "先停一下——你提到的这个情况不适合在网上继续聊。请马上拨打 120，或者让身边的人送你去最近的急诊；如果你现在一个人，先把门打开，让邻居知道你的情况。这不是诊断，但这类信号需要医生当面看。";
  }

  if (firstTurn) {
    return `我听明白了，你提到「${last.slice(0, 40)}」。为了把范围缩小一点，我想先确认三件事：这种感觉是持续的还是阵发的？有没有什么动作、食物或时间点会让它更明显？另外，最近有没有伴随发热、乏力、体重变化这类全身的感觉？`;
  }

  const parts: string[] = [];
  parts.push("好，这条信息很关键，我记下了。");
  parts.push(
    "从你描述的组合看，更常见的方向是功能性的不适，也可能和最近的作息、饮食节奏有关；但具体是哪一种，需要医生结合查体来判断，我不能在这里给你下诊断。",
  );
  if (allergy) {
    parts.push(`另外提醒一句：你的档案里记录了对「${allergy}」过敏，之后无论看哪个科，开药前都要主动告诉医生这一条。`);
  }
  parts.push(
    "在见到医生之前，可以先做这几件事：把发作的时间、持续多久、什么情况下加重记下来；这几天别空腹、别熬夜；如果正在吃什么药，先不要自行加量或停药，处方药请遵医嘱。",
  );
  parts.push("如果出现疼痛突然加剧、发热寒战、意识不清这类情况，别等，直接去急诊。");
  return parts.join("");
}
