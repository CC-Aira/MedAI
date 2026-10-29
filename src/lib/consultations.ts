import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./http";
import { LIMITS, CONSULT_STATUS, CHAT_RETENTION_DAYS } from "./constants";
import { hasOwn, oneOf, requireText } from "./validate";
import { requireOwnedPatient } from "./patients";
import { retentionCutoff } from "./retention";

export type MessageDTO = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  /** null = 模型回答；"redflag" = 本地红旗拦截生成的，界面要换成红卡片 */
  flag?: string | null;
  /** 改过的时间；null / 不存在表示没编辑过 */
  editedAt?: string | null;
  /** 这条消息带的附件（图片/PDF/文档），没有则不出现 */
  attachment?: {
    id: string;
    filename: string;
    kind: string;
    sizeBytes: number;
    hasText: boolean;
    textLength: number;
  } | null;
};

export type ConsultationDTO = {
  id: string;
  patientId: string;
  title: string;
  status: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: string | null;
  /**
   * 最后一条消息的时间。
   * 日历靠它决定「这条算哪天聊的」—— updatedAt 会被归档、生成摘要这类操作刷新，
   * 拿它归日会让一次上周的问诊跳到今天。
   */
  lastMessageAt: string | null;
  /** 已经生成过就诊摘要（档案页可以直接打开，不用重算） */
  hasSheet: boolean;
};

export type ConsultationDetailDTO = ConsultationDTO & {
  messages: MessageDTO[];
  patient: { id: string; name: string; gender: string; age: number | null };
  /** 对话保留策略：聊天记录不永久保留，到期自动清除 */
  retention: {
    days: number;
    oldestMessageAt: string | null;
    expiresAt: string | null;
  };
};

export function serializeMessage(m: {
  id: string;
  role: string;
  content: string;
  /** null = 模型回答；"redflag" = 本地红旗拦截 */
  flag?: string | null;
  createdAt: Date;
  editedAt?: Date | null;
  attachment?: {
    id: string;
    filename: string;
    kind: string;
    sizeBytes: number;
    text: string;
  } | null;
}): MessageDTO {
  const dto: MessageDTO = {
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  };
  if (m.flag) dto.flag = m.flag;
  if (m.editedAt) dto.editedAt = m.editedAt.toISOString();
  if (m.attachment) {
    dto.attachment = {
      id: m.attachment.id,
      filename: m.attachment.filename,
      kind: m.attachment.kind,
      sizeBytes: m.attachment.sizeBytes,
      hasText: m.attachment.text.trim().length > 0,
      textLength: m.attachment.text.length,
    };
  }
  return dto;
}

type ConsultationRow = {
  id: string;
  patientId: string;
  title: string;
  status: string;
  summary: string | null;
  /** 只用来判断「生成过没有」，内容不进列表 */
  visitSheet?: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { messages: number };
  messages: { content: string; createdAt?: Date }[];
};

export function serializeConsultation(row: ConsultationRow): ConsultationDTO {
  const last = row.messages[0] ?? null;
  return {
    id: row.id,
    patientId: row.patientId,
    title: row.title,
    status: row.status,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messageCount: row._count.messages,
    lastMessage: last?.content ?? null,
    lastMessageAt: last?.createdAt ? last.createdAt.toISOString() : null,
    hasSheet: Boolean(row.visitSheet),
  };
}

/**
 * 列表用的 include。
 * 注意 lastMessage 必须走保留窗口 —— 它是要显示在界面上的正文，
 * 过期的对话一句话都不能漏出来；计数也跟着一起过滤，避免"6 条消息但只能看到 0 条"。
 */
function listInclude(): Prisma.ConsultationInclude {
  const cutoff = retentionCutoff();
  return {
    _count: { select: { messages: { where: { createdAt: { gte: cutoff } } } } },
    messages: {
      where: { createdAt: { gte: cutoff } },
      select: { content: true, createdAt: true },
      take: 1,
      orderBy: { createdAt: "desc" },
    },
  };
}

export async function listConsultations(
  ownerId: string,
  patientId: string,
): Promise<ConsultationDTO[]> {
  await requireOwnedPatient(ownerId, patientId);
  const rows = await prisma.consultation.findMany({
    // 一句话都没说过的空问诊不进列表：早先每点开一次档案就建一条，库里堆了几百条，
    // 把真正的对话挤到看不见。
    // 但「消息被保留策略清空」的记录要留着 —— 那些是超过 30 天、只剩小结的老问诊，
    // 光看 messages 会把它们一并藏掉，用户就再也翻不到以前聊过什么了。
    where: {
      patientId,
      OR: [
        { messages: { some: {} } },
        { summary: { not: null } },
        { visitSheet: { not: null } },
      ],
    },
    include: listInclude(),
    orderBy: { updatedAt: "desc" },
  });
  // 排序跟着「最后一条消息」走，和日历的归日保持一致。
  // 只按 updatedAt 排会出现「最新那条排在 22 号、日历上却点不到 22 号」的错位：
  // 归档、生成摘要都会刷新 updatedAt，但它并不代表哪天聊过。
  return rows
    .map((row) => serializeConsultation(row))
    .sort((a, b) =>
      (b.lastMessageAt ?? b.updatedAt).localeCompare(a.lastMessageAt ?? a.updatedAt),
    );
}

/** 问诊的归属同样顺着 patient 查，一条语句完成，不做「先查再比」 */
export async function findOwnedConsultation(ownerId: string, id: string) {
  return prisma.consultation.findFirst({
    where: { id, patient: { ownerId } },
    include: {
      patient: {
        include: {
          medications: { orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] },
        },
      },
    },
  });
}

export async function requireOwnedConsultation(ownerId: string, id: string) {
  const row = await findOwnedConsultation(ownerId, id);
  if (!row) throw new HttpError(404, "没有找到这次问诊");
  return row;
}

export async function createConsultation(
  ownerId: string,
  patientId: string,
  body: Record<string, unknown>,
): Promise<ConsultationDTO> {
  const patient = await requireOwnedPatient(ownerId, patientId);

  const hasTitle = hasOwn(body, "title");
  const title = hasTitle
    ? requireText(body.title, "问诊标题", LIMITS.consultTitle)
    : (patient.chiefComplaint || "一次新的问诊").slice(0, LIMITS.consultTitle);

  const row = await prisma.consultation.create({
    data: { patientId, title, status: "active" },
    include: listInclude(),
  });
  return serializeConsultation(row);
}

export async function updateConsultationStatus(
  ownerId: string,
  id: string,
  status: unknown,
): Promise<ConsultationDTO> {
  await requireOwnedConsultation(ownerId, id);
  const next = oneOf(status, "问诊状态", CONSULT_STATUS);
  const row = await prisma.consultation.update({
    where: { id },
    data: { status: next },
    include: listInclude(),
  });
  return serializeConsultation(row);
}

/** 删除问诊：连消息一起走（schema 上是 Cascade），第二次调用返回 404 */
export async function deleteConsultation(
  ownerId: string,
  id: string,
): Promise<ConsultationDTO[]> {
  const row = await findOwnedConsultation(ownerId, id);
  if (!row) throw new HttpError(404, "没有找到这次问诊");

  await prisma.consultation.delete({ where: { id } });
  return listConsultations(ownerId, row.patientId);
}

export async function getConsultationDetail(
  ownerId: string,
  id: string,
): Promise<ConsultationDetailDTO> {
  const cutoff = retentionCutoff();
  const row = await prisma.consultation.findFirst({
    where: { id, patient: { ownerId } },
    include: {
      messages: {
        where: { createdAt: { gte: cutoff } },
        orderBy: { createdAt: "asc" },
        include: {
          attachment: {
            select: {
              id: true,
              filename: true,
              kind: true,
              sizeBytes: true,
              text: true,
            },
          },
        },
      },
      patient: { select: { id: true, name: true, gender: true, age: true } },
    },
  });
  if (!row) throw new HttpError(404, "没有找到这次问诊");

  const last = row.messages[row.messages.length - 1] ?? null;
  const oldest = row.messages[0] ?? null;
  return {
    id: row.id,
    patientId: row.patientId,
    title: row.title,
    status: row.status,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messageCount: row.messages.length,
    lastMessage: last?.content ?? null,
    lastMessageAt: last ? last.createdAt.toISOString() : null,
    hasSheet: Boolean(row.visitSheet),
    messages: row.messages.map(serializeMessage),
    patient: row.patient,
    retention: {
      days: CHAT_RETENTION_DAYS,
      // 最早那条什么时候消失，前端可以提示"这段对话还能留几天"
      oldestMessageAt: oldest ? oldest.createdAt.toISOString() : null,
      expiresAt: oldest
        ? new Date(oldest.createdAt.getTime() + CHAT_RETENTION_DAYS * 86400_000).toISOString()
        : null,
    },
  };
}
