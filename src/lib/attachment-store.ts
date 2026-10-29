import { prisma } from "./db";
import { HttpError } from "./http";
import { LIMITS } from "./constants";
import {
  extractAttachmentText,
  readAttachmentFile,
  removeAttachmentFile,
  saveAttachmentFile,
  sniffAttachment,
} from "./attachments";

/**
 * 附件落库层：负责把上传的文件变成一行 Attachment + 一段可进提示词的正文。
 */

export type AttachmentDTO = {
  id: string;
  filename: string;
  kind: string;
  sizeBytes: number;
  /** 有没有提取到正文（前端据此提示"没读出字，请补描述"） */
  hasText: boolean;
  /** 提取后正文的字符数，给用户一个"读到了多少"的量感 */
  textLength: number;
  /** 一句话说明，例如"图片，已在本地识别出图中的文字" */
  note: string;
};

type AttachmentRow = {
  id: string;
  filename: string;
  kind: string;
  sizeBytes: number;
  text: string;
  createdAt: Date;
};

/** 只留文件名本身：去掉目录、控制字符，防止把路径或换行塞进界面 */
export function safeFilename(input: string): string {
  const base = input.split(/[\\/]/).pop() || "附件";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .trim();
  return (cleaned || "附件").slice(0, LIMITS.attachName);
}

export function serializeAttachment(row: AttachmentRow, note = ""): AttachmentDTO {
  return {
    id: row.id,
    filename: row.filename,
    kind: row.kind,
    sizeBytes: row.sizeBytes,
    hasText: row.text.trim().length > 0,
    textLength: row.text.length,
    note,
  };
}

export async function createAttachment(
  ownerId: string,
  rawName: string,
  buffer: Buffer,
): Promise<AttachmentDTO> {
  if (buffer.length === 0) throw new HttpError(400, "文件是空的");
  if (buffer.length > LIMITS.attachBytes) {
    throw new HttpError(413, "文件不能超过 10MB");
  }

  const sniffed = sniffAttachment(buffer);
  if (!sniffed) {
    throw new HttpError(
      400,
      "这个格式暂时读不了，请上传图片（JPG/PNG/WebP）、PDF、Word 或纯文本",
    );
  }

  const filename = safeFilename(rawName);
  const { storedName, sizeBytes } = await saveAttachmentFile(buffer, sniffed.ext);
  const { text, note } = await extractAttachmentText(buffer, sniffed.kind, filename);

  const row = await prisma.attachment.create({
    data: {
      ownerId,
      filename,
      mimeType: sniffed.mimeType,
      sizeBytes,
      kind: sniffed.kind,
      text,
      storedName,
    },
  });

  return serializeAttachment(row, note);
}

/** 附件按 owner 隔离：别人的附件一律当作不存在 */
export async function findOwnedAttachment(ownerId: string, id: string) {
  return prisma.attachment.findFirst({ where: { id, ownerId } });
}

export async function requireOwnedAttachment(ownerId: string, id: string) {
  const row = await findOwnedAttachment(ownerId, id);
  if (!row) throw new HttpError(404, "没有找到这个附件");
  return row;
}

export async function readAttachmentBytes(ownerId: string, id: string) {
  const row = await requireOwnedAttachment(ownerId, id);
  if (!row.storedName) throw new HttpError(404, "这个附件没有原始文件");
  const bytes = await readAttachmentFile(row.storedName);
  return { row, bytes };
}

/** 删附件记录时顺手删磁盘文件，避免 data/uploads 越堆越多 */
export async function deleteAttachmentRow(ownerId: string, id: string) {
  const row = await requireOwnedAttachment(ownerId, id);
  await prisma.attachment.delete({ where: { id } });
  await removeAttachmentFile(row.storedName);
}
