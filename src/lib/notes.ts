import { prisma } from "./db";
import { HttpError } from "./http";
import { LIMITS } from "./constants";
import {
  hasOwn,
  optionalBool,
  optionalText,
  requireText,
} from "./validate";
import { requireOwnedPatient } from "./patients";

export type NoteDTO = {
  id: string;
  patientId: string;
  consultationId: string | null;
  title: string;
  content: string;
  tags: string | null;
  isFavorite: boolean;
  createdAt: string;
};

export function serializeNote(n: {
  id: string;
  patientId: string;
  consultationId: string | null;
  title: string;
  content: string;
  tags: string | null;
  isFavorite: boolean;
  createdAt: Date;
}): NoteDTO {
  return {
    id: n.id,
    patientId: n.patientId,
    consultationId: n.consultationId,
    title: n.title,
    content: n.content,
    tags: n.tags,
    isFavorite: n.isFavorite,
    createdAt: n.createdAt.toISOString(),
  };
}

/** 结论列表：星标优先，其次新的在前 —— 和注入提示词的排序保持一致 */
export async function listNotes(ownerId: string, patientId: string): Promise<NoteDTO[]> {
  await requireOwnedPatient(ownerId, patientId);
  const rows = await prisma.note.findMany({
    where: { patientId },
    orderBy: [{ isFavorite: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(serializeNote);
}

export async function findOwnedNote(ownerId: string, noteId: string) {
  return prisma.note.findFirst({
    where: { id: noteId, patient: { ownerId } },
  });
}

export async function createNote(
  ownerId: string,
  patientId: string,
  body: Record<string, unknown>,
): Promise<NoteDTO> {
  await requireOwnedPatient(ownerId, patientId);

  const title = requireText(body.title, "标题", LIMITS.noteTitle);
  const content = requireText(body.content, "内容", LIMITS.noteContent);
  const tags = optionalText(body.tags, "标签", LIMITS.tags);
  const isFavorite = optionalBool(body.isFavorite, "星标") ?? false;

  let consultationId: string | null = null;
  if (hasOwn(body, "consultationId") && body.consultationId !== null && body.consultationId !== "") {
    const raw = String(body.consultationId);
    // 必须属于同一位患者，防止把结论挂到别人的问诊上
    const consultation = await prisma.consultation.findFirst({
      where: { id: raw, patientId },
      select: { id: true },
    });
    if (!consultation) throw new HttpError(404, "没有找到这次问诊");
    consultationId = consultation.id;
  }

  const row = await prisma.note.create({
    data: { patientId, consultationId, title, content, tags, isFavorite },
  });
  return serializeNote(row);
}

export type NotePatch = {
  title?: string;
  content?: string;
  tags?: string | null;
  isFavorite?: boolean;
};

export function parseNotePatch(body: Record<string, unknown>): NotePatch {
  const patch: NotePatch = {};
  if (hasOwn(body, "title")) patch.title = requireText(body.title, "标题", LIMITS.noteTitle);
  if (hasOwn(body, "content"))
    patch.content = requireText(body.content, "内容", LIMITS.noteContent);
  if (hasOwn(body, "tags")) patch.tags = optionalText(body.tags, "标签", LIMITS.tags);
  if (hasOwn(body, "isFavorite")) {
    const v = optionalBool(body.isFavorite, "星标");
    if (v !== null) patch.isFavorite = v;
  }
  if (Object.keys(patch).length === 0) throw new HttpError(400, "没有需要修改的内容");
  return patch;
}

export async function updateNote(
  ownerId: string,
  noteId: string,
  patch: NotePatch,
): Promise<NoteDTO[]> {
  const note = await findOwnedNote(ownerId, noteId);
  if (!note) throw new HttpError(404, "没有找到这条结论");

  await prisma.note.update({ where: { id: noteId }, data: patch });
  return listNotes(ownerId, note.patientId);
}

export async function deleteNote(
  ownerId: string,
  noteId: string,
): Promise<NoteDTO[]> {
  const note = await findOwnedNote(ownerId, noteId);
  if (!note) throw new HttpError(404, "没有找到这条结论");

  await prisma.note.delete({ where: { id: noteId } });
  return listNotes(ownerId, note.patientId);
}
