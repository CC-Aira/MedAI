import { prisma } from "./db";
import { HttpError } from "./http";

/**
 * 用户反馈：用户在「我的」页面提交的问题、建议、内容纠错。
 *
 * 隐私边界：这里只存**用户主动敲的字**与可选的联系方式，
 * 不夹带档案、不夹带对话原文 —— 所以管理员可以读全文，这与问诊记录
 * 「只给摘要不给原文」的口径是两件事。
 */

export const FEEDBACK_KINDS = {
  bug: "用不了 / 出错",
  suggest: "功能建议",
  content: "内容有误",
  other: "其他",
} as const;

export type FeedbackKind = keyof typeof FEEDBACK_KINDS;

export const FEEDBACK_STATUS = {
  open: "待处理",
  read: "已查看",
  done: "已处理",
} as const;

export type FeedbackStatus = keyof typeof FEEDBACK_STATUS;

export function toKind(raw: unknown): FeedbackKind {
  return typeof raw === "string" && raw in FEEDBACK_KINDS ? (raw as FeedbackKind) : "suggest";
}

export function toStatus(raw: unknown): FeedbackStatus {
  return typeof raw === "string" && raw in FEEDBACK_STATUS ? (raw as FeedbackStatus) : "open";
}

/** 给前端用的形状（时间统一转 ISO，避免 Server/Client 序列化差异） */
export type FeedbackRow = {
  id: string;
  kind: string;
  content: string;
  contact: string | null;
  rating: number | null;
  page: string | null;
  status: string;
  reply: string | null;
  createdAt: string;
  handledAt: string | null;
  /** 仅管理员列表里有 */
  userEmail?: string;
};

type RawFeedback = {
  id: string;
  kind: string;
  content: string;
  contact: string | null;
  rating: number | null;
  page: string | null;
  status: string;
  reply: string | null;
  createdAt: Date;
  handledAt: Date | null;
  user?: { email: string } | null;
};

export function toFeedbackRow(f: RawFeedback): FeedbackRow {
  return {
    id: f.id,
    kind: f.kind,
    content: f.content,
    contact: f.contact,
    rating: f.rating,
    page: f.page,
    status: f.status,
    reply: f.reply,
    createdAt: f.createdAt.toISOString(),
    handledAt: f.handledAt ? f.handledAt.toISOString() : null,
    ...(f.user ? { userEmail: f.user.email } : {}),
  };
}

const MAX_CONTENT = 2000;
const MAX_CONTACT = 120;

/**
 * 提交一条反馈。
 *
 * 校验放在服务层而不是只放路由：将来如果多一个入口（比如对话里的“这答案不对”），
 * 规则不会因为漏抄一份而漂移。
 */
export async function createFeedback(
  userId: string,
  input: Record<string, unknown>,
): Promise<FeedbackRow> {
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (content.length < 4) throw new HttpError(400, "多写几个字吧，至少 4 个字");
  if (content.length > MAX_CONTENT) {
    throw new HttpError(400, `内容太长了，控制在 ${MAX_CONTENT} 字以内`);
  }

  const contact = typeof input.contact === "string" ? input.contact.trim() : "";
  if (contact.length > MAX_CONTACT) throw new HttpError(400, "联系方式太长了");

  const page = typeof input.page === "string" ? input.page.trim().slice(0, 160) : null;

  let rating: number | null = null;
  if (typeof input.rating === "number" && Number.isFinite(input.rating)) {
    rating = Math.min(5, Math.max(1, Math.round(input.rating)));
  } else if (typeof input.rating === "string" && input.rating.trim() !== "") {
    const n = Number(input.rating);
    if (Number.isFinite(n)) rating = Math.min(5, Math.max(1, Math.round(n)));
  }

  const row = await prisma.feedback.create({
    data: {
      userId,
      kind: toKind(input.kind),
      content,
      contact: contact || null,
      rating,
      page: page || null,
    },
  });

  return toFeedbackRow(row);
}

/** 当前用户自己的反馈（新的在前） */
export async function listMyFeedback(userId: string, take = 50): Promise<FeedbackRow[]> {
  const rows = await prisma.feedback.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(200, Math.max(1, take)),
  });
  return rows.map(toFeedbackRow);
}

/** 管理员视角：全部反馈，可按状态筛选 */
export async function listAllFeedback(options: {
  status?: string;
  take?: number;
}): Promise<{ rows: FeedbackRow[]; counts: Record<string, number>; total: number }> {
  const take = Math.min(200, Math.max(1, options.take ?? 100));
  const status = options.status && options.status in FEEDBACK_STATUS ? options.status : undefined;

  const [rows, groups, total] = await Promise.all([
    prisma.feedback.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ createdAt: "desc" }],
      take,
      include: { user: { select: { email: true } } },
    }),
    prisma.feedback.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.feedback.count(),
  ]);

  const counts: Record<string, number> = { open: 0, read: 0, done: 0 };
  for (const g of groups) {
    counts[g.status] = g._count._all;
  }

  return { rows: rows.map(toFeedbackRow), counts, total };
}

/** 处理一条反馈：改状态、写回复。回复为空时不动原回复。 */
export async function handleFeedback(
  id: string,
  input: Record<string, unknown>,
): Promise<FeedbackRow> {
  const existing = await prisma.feedback.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "这条反馈不存在");

  const data: Record<string, unknown> = {};

  if ("status" in input) {
    const status = toStatus(input.status);
    data.status = status;
    data.handledAt = status === "done" ? new Date() : null;
  }

  if ("reply" in input) {
    const reply = typeof input.reply === "string" ? input.reply.trim().slice(0, MAX_CONTENT) : "";
    data.reply = reply || null;
  }

  if (Object.keys(data).length === 0) throw new HttpError(400, "没有要保存的内容");

  const row = await prisma.feedback.update({
    where: { id },
    data,
    include: { user: { select: { email: true } } },
  });

  return toFeedbackRow(row);
}
