import { prisma } from "./db";
import { HttpError } from "./http";
import { requireOwnedPatient } from "./patients";
import { readAttachmentBytes } from "./attachment-store";
import { extractLabReport } from "./lab-extract";
import {
  buildLabReport,
  composeSummary,
  countAbnormal,
  type LabReportDTO,
} from "./lab-report";

/**
 * 化验单的数据访问层：抽取、落库、按时间倒序取回并带上「较上次」。
 *
 * 对比不存库。存下来的只能是"当时怎么比的"，而患者补传一张更早的单子，
 * 后面那几张的对比对象就都变了 —— 每次读取时现算，才不会出现两张卡片
 * 各自声称"上次是 5 月"的矛盾。
 */

const MAX_REPORTS = 40;

/** 模型偶尔把日期读成 202 年或明年，一律收回到合理区间 */
function saneTakenAt(input: Date | null): Date {
  const now = new Date();
  if (!input) return now;
  const t = input.getTime();
  const floor = new Date("2000-01-01").getTime();
  const ceil = now.getTime() + 24 * 3600 * 1000;
  if (Number.isNaN(t) || t < floor || t > ceil) return now;
  return input;
}

export async function listLabReports(
  ownerId: string,
  patientId: string,
): Promise<LabReportDTO[]> {
  await requireOwnedPatient(ownerId, patientId);

  const rows = await prisma.labReport.findMany({
    where: { ownerId, patientId },
    orderBy: [{ takenAt: "desc" }, { createdAt: "desc" }],
    take: MAX_REPORTS,
  });

  // 第 i 份的对比对象是第 i+1 份（更早的那份）
  return rows.map((row, i) => buildLabReport(row, rows[i + 1] ?? null));
}

export async function createLabReportFromAttachment(
  ownerId: string,
  patientId: string,
  attachmentId: string,
): Promise<LabReportDTO> {
  await requireOwnedPatient(ownerId, patientId);
  const { row: attachment, bytes } = await readAttachmentBytes(ownerId, attachmentId);

  const parsed = await extractLabReport({
    bytes,
    mimeType: attachment.mimeType,
    text: attachment.text || attachment.visionText || "",
  });

  if (parsed.items.length === 0) {
    throw new HttpError(
      422,
      "没能从这份单据里读出指标。换一张更清晰、正着拍的图，或确认这是一张化验单",
    );
  }

  const takenAt = saneTakenAt(parsed.takenAt);

  const row = await prisma.labReport.create({
    data: {
      ownerId,
      patientId,
      attachmentId,
      takenAt,
      hospital: parsed.hospital,
      kind: parsed.kind,
      items: JSON.stringify(parsed.items),
      // 小结按抽出来的指标算，不用模型那句（它会数错）
      summary: composeSummary(parsed.items),
      abnormalCount: countAbnormal(parsed.items),
    },
  });

  const prev = await prisma.labReport.findFirst({
    where: {
      ownerId,
      patientId,
      id: { not: row.id },
      takenAt: { lt: takenAt },
    },
    orderBy: { takenAt: "desc" },
  });

  return buildLabReport(row, prev);
}

export async function deleteLabReport(ownerId: string, id: string): Promise<void> {
  // 别人的单据一律当作不存在：先按 owner 查，查不到就是 404
  const row = await prisma.labReport.findFirst({ where: { id, ownerId } });
  if (!row) throw new HttpError(404, "没有找到这份化验单");
  await prisma.labReport.delete({ where: { id } });
}
