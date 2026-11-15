import { HttpError } from "./http";

export type ChatRole = "system" | "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };

/** 多模态消息：content 可以是纯文本，也可以是 图 + 文 的数组 */
export type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
export type VisionMessage = { role: ChatRole; content: string | VisionContentPart[] };

export type AskOptions = {
  /** 纯文本消息，或带 tool_calls / tool 回执的 Agent 消息，原样透传给上游 */
  messages: unknown[];
  temperature?: number;
  maxTokens?: number;
  /** 覆盖模型名（后台「AI 模型配置」里填了就用它，留空走 .env） */
  model?: string | null;
  /** 要求模型返回 JSON（response_format: json_object）。提示词里必须出现 "json" 字样 */
  json?: boolean;
  signal?: AbortSignal;
};

const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_MODEL = "glm-4-flash";

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

/* ------------------------------------------------------------ 视觉模型 */

const DEFAULT_VISION_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_VISION_MODEL = "glm-4v-flash";

function visionBaseUrl(): string {
  return (process.env.VISION_BASE_URL || DEFAULT_VISION_BASE_URL).replace(/\/+$/, "");
}

function visionModel(): string {
  return process.env.VISION_MODEL || DEFAULT_VISION_MODEL;
}

function visionApiKey(): string {
  return (process.env.VISION_API_KEY || "").trim();
}

/** 视觉模型是否可用（配了 VISION_API_KEY 才算） */
export function visionConfigured(): boolean {
  return visionApiKey().length > 0;
}

/** 视觉模型单次调用的整体超时：图片 + 多模态，比纯文本慢一些 */
const VISION_TIMEOUT_MS = 30_000;

/**
 * 视觉模型的 max_tokens 上限。
 * glm-4v-flash 只接受 [1,1024]，填 1800 会被上游 400 掉。
 * 放在这里而不是散在各个调用点：换个视觉模型时只改这一个数。
 */
const VISION_MAX_TOKENS = 1024;

/**
 * 让视觉模型客观描述一张图片，把结果交给文本模型当"眼睛"。
 *
 * 边界：这里只做客观描述（图里有什么、什么颜色、什么形态、有没有文字），
 * 绝不下诊断、不做医学判断、不给建议 —— 那些交给文本模型按红线约束去做。
 *
 * 失败静默降级：视觉模型没配、超时、报错，一律返回空串，
 * 图片仍走 OCR 文字提取这条老路，整条链路不会因此 500。
 */
export async function describeImage(buffer: Buffer, mimeType: string): Promise<string> {
  if (!visionConfigured()) {
    if (aiDemoMode()) return demoVision(mimeType);
    return "";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

  try {
    const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
    const res = await fetch(`${visionBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${visionApiKey()}`,
      },
      body: JSON.stringify({
        model: visionModel(),
        messages: [
          {
            role: "system",
            content:
              "你是医疗场景下的图像描述助手。请用中文客观、克制地描述图片里能看到的内容：主体、颜色、形态、大小关系、以及图中出现的任何文字。只描述事实，不要下诊断，不要做医学判断，不要给任何建议。",
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl } },
              { type: "text", text: "请客观描述这张图片里有什么。" },
            ],
          },
        ],
        stream: false,
        max_tokens: 600,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.error(`[medai] 视觉模型返回 ${res.status}${detail ? `：${detail}` : ""}`);
      return "";
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") return "";
    return content.trim();
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      console.error("[medai] 视觉模型超时，降级为纯 OCR");
    } else {
      console.error("[medai] 视觉模型调用失败", err);
    }
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/** 无 Key 时的视觉占位描述：让"看图"这条链路也能在演示模式下走通 */
function demoVision(mimeType: string): string {
  return `（演示模式）这是一张 ${mimeType} 图片，尚未配置视觉模型（VISION_API_KEY），无法真正看图。正式使用时，这里会是对图片内容的客观描述。`;
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
async function postChatTo(
  endpoint: string,
  key: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const guard = signal ? null : new AbortController();
  const timer = guard ? setTimeout(() => guard.abort(), FIRST_BYTE_TIMEOUT_MS) : null;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
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
    throw new HttpError(502, "连不上 AI 服务，请检查网络或代理设置");
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    // 401/403 是 Key 的问题，别把上游原文整段回吐给前端
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(503, "API Key 无效或已过期");
    }
    throw new HttpError(502, `上游返回 ${res.status}${detail ? `：${detail}` : ""}`);
  }
  return res;
}

async function postChat(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  return postChatTo(`${baseUrl()}/chat/completions`, apiKey(), payload, signal);
}

/**
 * 流式调用，直接把 Response 交给上层去读。
 * 演示模式下返回一条同协议的本地模拟流，方便无 Key 时跑通全链路。
 */
export async function askDeepSeek(options: AskOptions): Promise<Response> {
  const { messages, temperature = 0.6, maxTokens = 900, json = false, signal, model: modelOverride } = options;

  if (!aiConfigured()) {
    if (!aiDemoMode()) {
      throw new HttpError(503, "AI 服务未配置，请先设置 DEEPSEEK_API_KEY");
    }
    return demoStream(messages as ChatMessage[], json);
  }

  const payload: Record<string, unknown> = {
    model: (modelOverride || model()).trim(),
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
  const {
    messages,
    temperature = 0.3,
    maxTokens = 900,
    json = false,
    signal,
    model: modelOverride,
  } = options;

  if (!aiConfigured()) {
    if (!aiDemoMode()) {
      throw new HttpError(503, "AI 服务未配置，请先设置 DEEPSEEK_API_KEY");
    }
    return demoOnce(messages as ChatMessage[], json);
  }

  const payload: Record<string, unknown> = {
    model: (modelOverride || model()).trim(),
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

/**
 * 带图片的对话：把原图直接交给视觉模型（glm-4v-flash 这类），
 * 流式返回，协议和文本模型一致，readDeepSeekStream 可以直接复用。
 *
 * 为什么不让文本模型读注入的图片描述：glm-4-flash 对"图片"二字有很强的
 * 条件反射，哪怕描述就写在提示词里，它也会答"我看不到图片"。
 * 所以本轮带了图片附件时，整轮对话切到视觉模型。
 */
export async function askVision(options: {
  messages: VisionMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<Response> {
  const { messages, temperature = 0.6, maxTokens = 900 } = options;

  if (!visionConfigured()) {
    throw new HttpError(503, "视觉模型未配置（VISION_API_KEY），无法看图回答");
  }

  const payload: Record<string, unknown> = {
    model: visionModel(),
    messages,
    stream: true,
    temperature,
    max_tokens: Math.min(maxTokens, VISION_MAX_TOKENS),
  };
  return postChatTo(
    `${visionBaseUrl()}/chat/completions`,
    visionApiKey(),
    payload,
  );
}

/**
 * 视觉模型的一次性调用：只要结论，不要流。
 *
 * 化验单抽取属于"看一眼、吐一份结构化结果"的活，逐字显示没有意义 ——
 * 用户要的是下面那张对比表，不是模型一边想一边打字。
 * 温度压到 0.1：同一张单子抽两次应该得到同一份指标，别让它自由发挥。
 */
export async function askVisionOnce(options: {
  messages: VisionMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const { messages, temperature = 0.1, maxTokens = 900 } = options;

  if (!visionConfigured()) {
    throw new HttpError(503, "视觉模型未配置（VISION_API_KEY），无法识别化验单");
  }

  const payload: Record<string, unknown> = {
    model: visionModel(),
    messages,
    stream: false,
    temperature,
    // glm-4v-flash 的 max_tokens 只接受 [1,1024]，超了直接 400。
    // 视觉模型的输出本来就短（一段描述或一份 JSON），夹紧不会伤到谁。
    max_tokens: Math.min(maxTokens, VISION_MAX_TOKENS),
  };
  const res = await postChatTo(
    `${visionBaseUrl()}/chat/completions`,
    visionApiKey(),
    payload,
  );

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new HttpError(502, "视觉模型返回了空内容");
  }
  return content;
}

/* ------------------------------------------------------- 工具调用 */

export type AssistantToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** 带工具的一轮消息：助手可以只回 tool_calls，工具结果以 role=tool 回填 */
export type AgentMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string | null;
      tool_calls?: AssistantToolCall[];
    }
  | { role: "tool"; content: string; tool_call_id: string };

/**
 * 让模型决定「这一轮要不要查东西」。
 *
 * 刻意不开流式：这一轮只产出工具名和参数，通常几十个 token，等它的收益是
 * 能提前知道要查什么、并把「正在查用药」这种状态推给前端。
 * 真正的回答仍然走流式（askDeepSeek），用户看到的是一个字一个字出来的。
 *
 * 模型不支持 function calling 时上游会返回 4xx，这里原样抛出，由调用方降级成
 * 普通问答 —— 换模型不该把问诊搞挂。
 */
export async function askWithTools(options: {
  messages: AgentMessage[];
  tools: unknown[];
  temperature?: number;
  maxTokens?: number;
  model?: string | null;
  signal?: AbortSignal;
}): Promise<{ content: string; toolCalls: AssistantToolCall[] }> {
  const { messages, tools, temperature = 0.2, maxTokens = 400, signal, model: modelOverride } = options;

  if (!aiConfigured()) {
    if (!aiDemoMode()) {
      throw new HttpError(503, "AI 服务未配置，请先设置 DEEPSEEK_API_KEY");
    }
    return { content: "", toolCalls: [] };
  }

  const res = await postChat(
    {
      model: (modelOverride || model()).trim(),
      messages,
      tools,
      tool_choice: "auto",
      stream: false,
      temperature,
      max_tokens: maxTokens,
      thinking: { type: "disabled" },
    },
    signal,
  );

  const data = (await res.json()) as {
    choices?: {
      message?: { content?: string | null; tool_calls?: AssistantToolCall[] };
    }[];
  };

  const message = data.choices?.[0]?.message;
  const rawCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const content = typeof message?.content === "string" ? message.content : "";

  // 不同厂商给的字段有细微差别（有的不给 type、id 也可能缺），
  // 这里统一补齐，否则回填 role=tool 时对不上号，上游会 400。
  const toolCalls: AssistantToolCall[] = rawCalls
    .filter((call) => call && typeof call.function?.name === "string")
    .map((call, i) => ({
      id: call.id || `call_${Date.now()}_${i}`,
      type: "function",
      function: {
        name: call.function.name,
        arguments:
          typeof call.function.arguments === "string"
            ? call.function.arguments
            : JSON.stringify(call.function.arguments ?? {}),
      },
    }));

  return { content, toolCalls };
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
