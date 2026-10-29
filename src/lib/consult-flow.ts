import { prisma } from "./db";
import { HttpError } from "./http";
import { askDeepSeekOnce, assertAiReady, parseJsonLoose } from "./ai";
import {
  buildFactsPrompt,
  buildSummaryPrompt,
  buildSystemPrompt,
  buildVisitSheetPrompt,
  transcriptText,
  type PromptAttachment,
} from "./medical-prompt";
import {
  buildLocalSheet,
  normalizeSheet,
  type VisitSheet,
} from "./visit-sheet";
import { buildFactCandidates, type FactCandidate } from "./facts";
import { requireOwnedPatient } from "./patients";
import { buildRedFlagReply, redFlagMark, type RedFlagHit } from "./red-flags";
import { serializeMessage } from "./consultations";
import { requireOwnedConsultation } from "./consultations";
import { liveMessageWhere, purgeExpiredMessages, retentionCutoff } from "./retention";
import {
  LIMITS,
  MAX_ATTACHMENTS_IN_PROMPT,
  MAX_HISTORY_MESSAGES,
  MAX_NOTES_IN_PROMPT,
  MAX_SUMMARY_COUNT,
} from "./constants";

/**
 * 每次发消息前现场装配上下文：
 * 档案 + 在服药物 + 近 3 条摘要 + 星标优先的 8 条结论 + 最近 20 条历史 + 上传的资料。
 *
 * 历史只取保留窗口内的（超过 CHAT_RETENTION_DAYS 的消息既不显示、也不进提示词）。
 * 附件正文放进 system，不放 user —— 用户上传的报告里若写着"忽略以上要求"，
 * 它始终只是资料，不会被当成对话指令。
 */
export async function buildChatContext(
  ownerId: string,
  consultationId: string,
  userText: string,
  options: { attachmentId?: string; excludeMessageId?: string } = {},
) {
  const consultation = await requireOwnedConsultation(ownerId, consultationId);
  const patient = await requireOwnedPatient(ownerId, consultation.patientId);

  const [summaries, notes, history] = await Promise.all([
    prisma.consultation.findMany({
      where: {
        patientId: patient.id,
        summary: { not: null },
        // 不把自己算进"历史记忆"
        id: { not: consultationId },
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_SUMMARY_COUNT,
      select: { title: true, summary: true, createdAt: true },
    }),
    prisma.note.findMany({
      where: { patientId: patient.id },
      orderBy: [{ isFavorite: "desc" }, { createdAt: "desc" }],
      take: MAX_NOTES_IN_PROMPT,
      select: { title: true, content: true, tags: true, isFavorite: true },
    }),
    prisma.message.findMany({
      where: {
        ...liveMessageWhere(consultationId),
        // 编辑的场景：这句话本身要排除，否则历史里会同时出现旧版本和本轮新版本
        ...(options.excludeMessageId ? { id: { not: options.excludeMessageId } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: MAX_HISTORY_MESSAGES,
      select: { role: true, content: true },
    }),
  ]);

  // 这一轮带的附件 + 历史里最近带过的附件，一起去重后交给提示词
  const attachments = await collectPromptAttachments(
    ownerId,
    consultationId,
    options.attachmentId ? [options.attachmentId] : [],
  );

  const system = buildSystemPrompt({
    patient,
    medications: patient.medications.filter((m) => m.isActive),
    summaries: summaries.map((s) => ({
      title: s.title,
      summary: s.summary ?? "",
      createdAt: s.createdAt,
    })),
    notes,
    attachments,
  });

  // 只传了附件、没打字时也要有一句"人话"当这一轮的落点
  const fallback = attachments.length
    ? "这是我上传的资料，请帮我看看有没有需要注意的地方。"
    : "";
  const turn = userText.trim() || fallback;

  const messages = [
    ...history.reverse().map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    })),
    ...(turn ? [{ role: "user" as const, content: turn }] : []),
  ];

  return { consultation, patient, system, messages, attachments };
}

/** 单个附件进提示词的正文上限（防止一份长 PDF 把上下文吃光） */
const PROMPT_ATTACH_CHARS = 4000;

/**
 * 收集要注入提示词的附件正文。
 * 优先级：本轮上传的 → 历史里最近的。
 */
async function collectPromptAttachments(
  ownerId: string,
  consultationId: string,
  currentIds: string[],
): Promise<PromptAttachment[]> {
  const picked: PromptAttachment[] = [];
  const seen = new Set<string>();

  const push = (row: {
    id: string;
    filename: string;
    kind: string;
    text: string;
  }) => {
    if (seen.has(row.id) || picked.length >= MAX_ATTACHMENTS_IN_PROMPT) return;
    const text = row.text.trim();
    if (!text) return; // 没读出字的附件不进提示词，避免模型凭空猜
    seen.add(row.id);
    picked.push({
      filename: row.filename,
      kind: row.kind,
      text: text.slice(0, PROMPT_ATTACH_CHARS),
    });
  };

  if (currentIds.length > 0) {
    const rows = await prisma.attachment.findMany({
      where: { id: { in: currentIds }, ownerId },
      select: { id: true, filename: true, kind: true, text: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    rows.forEach(push);
  }

  if (picked.length < MAX_ATTACHMENTS_IN_PROMPT) {
    const recent = await prisma.message.findMany({
      where: {
        ...liveMessageWhere(consultationId),
        attachmentId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_ATTACHMENTS_IN_PROMPT,
      select: {
        attachment: {
          select: { id: true, filename: true, kind: true, text: true },
        },
      },
    });
    for (const m of recent) {
      if (m.attachment) push(m.attachment);
    }
  }

  return picked;
}

/** 消息带的附件字段，和路由里的保持一致 */
const TURN_ATTACHMENT = {
  select: { id: true, filename: true, kind: true, sizeBytes: true, text: true },
} as const;

/**
 * 红旗拦截的落库：存提问 + 一条标记为 redflag 的回答。
 *
 * 全程不调模型。这不是偷懒：真出事的时候，回答必须是"立刻就有"的，
 * 而且每次都要一模一样，不能受采样温度影响。
 * 回答带 flag，前端据此换成红卡片；刷新之后照样是红卡片，不会退化成普通气泡。
 */
export async function saveRedFlagTurn(input: {
  consultationId: string;
  patientName: string;
  content: string;
  attachmentId: string | null;
  /** 改错字重发的场景：用户那句话已经更新过了，这里只补回答 */
  editingId: string | null;
  editedAtMs: number;
  hits: RedFlagHit[];
  /** 这次问诊已有的红旗记录（JSON 字符串），没有就是 null */
  previousRedFlag: string | null;
}) {
  const reply = buildRedFlagReply(input.patientName, input.hits);
  const assistantCreatedAt = input.editingId
    ? new Date(Math.max(Date.now(), input.editedAtMs + 1))
    : new Date();

  const ops = [];
  if (!input.editingId) {
    ops.push(
      prisma.message.create({
        data: {
          consultationId: input.consultationId,
          role: "user",
          content: input.content || "（上传了一份资料）",
          attachmentId: input.attachmentId,
          createdAt: new Date(assistantCreatedAt.getTime() - 1),
        },
        include: { attachment: TURN_ATTACHMENT },
      }),
    );
  }
  ops.push(
    prisma.message.create({
      data: {
        consultationId: input.consultationId,
        role: "assistant",
        content: reply.content,
        flag: redFlagMark(reply.kind),
        createdAt: assistantCreatedAt,
      },
      include: { attachment: TURN_ATTACHMENT },
    }),
  );

  const saved = await prisma.$transaction(ops);
  const assistantMessage = saved[saved.length - 1];

  // 记在 Consultation 上：就诊摘要要写"这次问诊里出现过需要立即就医的信号"
  const prev = parseRedFlagLog(input.previousRedFlag);
  await prisma.consultation.update({
    where: { id: input.consultationId },
    data: {
      updatedAt: new Date(),
      redFlag: JSON.stringify({
        firstAt: prev?.firstAt ?? assistantCreatedAt.toISOString(),
        count: (prev?.count ?? 0) + 1,
        ids: unique([...(prev?.ids ?? []), ...input.hits.map((h) => h.id)]),
        labels: unique([...(prev?.labels ?? []), ...input.hits.map((h) => h.label)]),
      }),
    },
  });

  const userMessage = input.editingId
    ? await prisma.message.findUnique({
        where: { id: input.editingId },
        include: { attachment: TURN_ATTACHMENT },
      })
    : saved[0];

  const all = await prisma.message.findMany({
    where: { consultationId: input.consultationId, createdAt: { gte: retentionCutoff() } },
    orderBy: { createdAt: "asc" },
    include: { attachment: TURN_ATTACHMENT },
  });

  return {
    reply,
    userMessage: userMessage ? serializeMessage(userMessage) : null,
    assistantMessage: serializeMessage(assistantMessage),
    messages: all.map(serializeMessage),
  };
}

export type RedFlagLog = {
  firstAt: string;
  count: number;
  ids: string[];
  labels: string[];
};

/** 存的是自己写的 JSON，解析失败就当没有，不让历史脏数据把问诊卡死 */
export function parseRedFlagLog(raw: string | null | undefined): RedFlagLog | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<RedFlagLog>;
    if (!v || typeof v !== "object" || !Array.isArray(v.labels)) return null;
    return {
      firstAt: typeof v.firstAt === "string" ? v.firstAt : "",
      count: typeof v.count === "number" ? v.count : 0,
      ids: Array.isArray(v.ids) ? v.ids.filter((x) => typeof x === "string") : [],
      labels: v.labels.filter((x): x is string => typeof x === "string"),
    };
  } catch {
    return null;
  }
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

/** 生成这次问诊的摘要，写进 Consultation.summary 当长期记忆 */export async function generateSummary(ownerId: string, consultationId: string) {
  const consultation = await requireOwnedConsultation(ownerId, consultationId);
  await purgeExpiredMessages();
  const messages = await prisma.message.findMany({
    where: liveMessageWhere(consultationId),
    orderBy: { createdAt: "asc" },
    take: 60,
    select: { role: true, content: true },
  });

  if (messages.length < 2) {
    throw new HttpError(400, "这次问诊还没有内容可以总结");
  }

  // 404 已由上面的 requireOwnedConsultation 挡掉，这里才轮到查配置（503）
  assertAiReady();

  const raw = await askDeepSeekOnce({
    messages: buildSummaryPrompt({
      patientName: consultation.patient.name,
      title: consultation.title,
      transcript: transcriptText(messages),
    }),
    json: true,
    temperature: 0.2,
    maxTokens: 600,
  });

  const parsed = parseJsonLoose<{ summary?: unknown }>(raw);
  const candidate =
    parsed && typeof parsed.summary === "string" ? parsed.summary : raw;
  const summary = candidate.trim().slice(0, LIMITS.summary);
  if (!summary) throw new HttpError(502, "AI 没有返回可用的摘要");

  const updated = await prisma.consultation.update({
    where: { id: consultationId },
    data: { summary },
    select: { id: true, summary: true, updatedAt: true },
  });

  return {
    id: updated.id,
    summary: updated.summary ?? summary,
    updatedAt: updated.updatedAt.toISOString(),
  };
}

/**
 * 扫描档案：只返回候选，一个字都不写库。
 * 写库必须由患者点过之后再走 PATCH /facts。
 */
export async function scanFacts(
  ownerId: string,
  consultationId: string,
): Promise<{ candidates: FactCandidate[]; skipped: string[] }> {
  const consultation = await requireOwnedConsultation(ownerId, consultationId);
  const patient = await requireOwnedPatient(ownerId, consultation.patientId);

  const messages = await prisma.message.findMany({
    where: liveMessageWhere(consultationId),
    orderBy: { createdAt: "asc" },
    take: 60,
    select: { role: true, content: true },
  });
  if (messages.length === 0) {
    throw new HttpError(400, "这次问诊还没有对话，没什么可整理的");
  }

  assertAiReady();

  const raw = await askDeepSeekOnce({
    messages: buildFactsPrompt({
      patient,
      medications: patient.medications,
      transcript: transcriptText(messages),
    }),
    json: true,
    temperature: 0.2,
    maxTokens: 800,
  });

  const parsed = parseJsonLoose(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new HttpError(502, "AI 返回的内容不是合法 json");
  }

  const { candidates, skipped } = buildFactCandidates(patient, parsed);
  return { candidates, skipped };
}

/* ------------------------------------------------------- 就诊摘要 */

/**
 * 生成一张就诊摘要并落库。
 *
 * 两条路：
 * - local=true  完全不碰模型，按档案 + 对话原文排一张；
 * - 默认        先让模型整理，模型没接上（没配 Key、超时、返回的 json 不像话）
 *               就自动退回本地模板 —— 宁可出一张朴素点的纸，也不能空手。
 */
export async function generateVisitSheet(
  ownerId: string,
  consultationId: string,
  options: { local?: boolean } = {},
): Promise<VisitSheet> {
  const consultation = await requireOwnedConsultation(ownerId, consultationId);
  const patient = consultation.patient;

  await purgeExpiredMessages();
  const messages = await prisma.message.findMany({
    where: liveMessageWhere(consultationId),
    orderBy: { createdAt: "asc" },
    take: 60,
    select: { role: true, content: true },
  });
  if (messages.length === 0) {
    throw new HttpError(400, "这次问诊还没有内容，先聊几句再来整理");
  }

  const generatedAt = new Date().toISOString();
  const fallback = buildLocalSheet({
    patient,
    title: consultation.title,
    userSays: messages.filter((m) => m.role === "user").map((m) => m.content),
    flags: toSheetFlags(parseRedFlagLog(consultation.redFlag)),
    generatedAt,
  });

  let sheet = fallback;
  if (!options.local) {
    try {
      const raw = await askDeepSeekOnce({
        messages: buildVisitSheetPrompt({
          patient,
          medications: patient.medications.filter((m) => m.isActive),
          title: consultation.title,
          summary: consultation.summary,
          transcript: transcriptText(messages),
        }),
        json: true,
        temperature: 0.2,
        maxTokens: 900,
      });
      sheet = normalizeSheet(parseJsonLoose(raw), fallback, generatedAt);
    } catch {
      // 这里刻意不往上抛：摘要生成失败不该让用户拿不到纸
      sheet = fallback;
    }
  }

  await prisma.consultation.update({
    where: { id: consultationId },
    data: { visitSheet: JSON.stringify(sheet) },
  });

  return sheet;
}

/** 读已经存下来的那张纸；没生成过就是 null */
export async function getVisitSheet(
  ownerId: string,
  consultationId: string,
): Promise<VisitSheet | null> {
  const consultation = await requireOwnedConsultation(ownerId, consultationId);
  if (!consultation.visitSheet) return null;
  try {
    return JSON.parse(consultation.visitSheet) as VisitSheet;
  } catch {
    return null;
  }
}

function toSheetFlags(
  log: ReturnType<typeof parseRedFlagLog>,
): VisitSheet["flags"] {
  if (!log) return null;
  return { labels: log.labels, count: log.count, at: log.firstAt };
}
