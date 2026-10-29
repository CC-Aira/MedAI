import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./http";
import { LIMITS } from "./constants";
import { hasOwn, optionalBool, optionalDate, optionalText, requireText } from "./validate";
import {
  requireOwnedPatient,
  serializeMedication,
  type MedicationDTO,
} from "./patients";
import {
  computeSchedule,
  normalizeTimeOfDay,
  startOfLocalDay,
} from "./medication-schedule";
import { buildReminder, type ReminderFacts } from "./medication-reminder";

/**
 * 用药只有次要的 id，归属要顺着 patient 查：
 * findFirst({ where: { id, patient: { ownerId } } }) —— 同样是一条语句，不先查再比。
 */
export async function findOwnedMedication(ownerId: string, medicationId: string) {
  return prisma.medication.findFirst({
    where: { id: medicationId, patient: { ownerId } },
    include: { patient: { select: { id: true, ownerId: true } } },
  });
}

/** 列表带上打卡记录，顺手算出疗程进度与连续漏服次数 */
export async function listMedications(
  ownerId: string,
  patientId: string,
): Promise<MedicationDTO[]> {
  await requireOwnedPatient(ownerId, patientId);
  const rows = await prisma.medication.findMany({
    where: { patientId },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    include: { logs: { orderBy: { scheduledFor: "desc" }, take: 60 } },
  });
  const now = new Date();
  return rows.map((row) => serializeMedication(row, computeSchedule(row, row.logs, now)));
}

export type MedicationInput = {
  drugName?: string;
  dosage?: string | null;
  frequency?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  isActive?: boolean;
  note?: string | null;
  timeOfDay?: string | null;
  mealTiming?: string | null;
  courseDays?: number | null;
};

const MEAL_TIMINGS = ["before", "after", "any"] as const;

export function parseMedicationInput(
  body: Record<string, unknown>,
  partial: boolean,
): MedicationInput {
  const out: MedicationInput = {};
  const take = (k: string) => hasOwn(body, k);

  if (!partial || take("drugName")) {
    out.drugName = requireText(body.drugName, "药名", LIMITS.drugName);
  }
  if (take("dosage")) out.dosage = optionalText(body.dosage, "剂量", LIMITS.dosage);
  if (take("frequency"))
    out.frequency = optionalText(body.frequency, "频率", LIMITS.frequency);
  if (take("startDate")) out.startDate = optionalDate(body.startDate, "开始日期");
  if (take("endDate")) out.endDate = optionalDate(body.endDate, "结束日期");
  if (take("isActive")) {
    const value = optionalBool(body.isActive, "在服状态");
    if (value !== null) out.isActive = value;
  }
  if (take("note")) out.note = optionalText(body.note, "备注", LIMITS.medNote);

  // 时间点：空串当作没填，写了就必须是 HH:MM
  if (take("timeOfDay")) {
    const raw = typeof body.timeOfDay === "string" ? body.timeOfDay.trim() : "";
    if (!raw) out.timeOfDay = null;
    else {
      const normalized = normalizeTimeOfDay(raw);
      if (!normalized) throw new HttpError(400, "时间点写成 08:00 这种格式");
      out.timeOfDay = normalized;
    }
  }

  if (take("mealTiming")) {
    const raw = typeof body.mealTiming === "string" ? body.mealTiming.trim() : "";
    if (!raw) out.mealTiming = null;
    else if (!(MEAL_TIMINGS as readonly string[]).includes(raw)) {
      throw new HttpError(400, "饭前饭后只能填 before / after / any");
    } else out.mealTiming = raw;
  }

  if (take("courseDays")) {
    const raw = body.courseDays;
    if (raw === null || raw === undefined || raw === "") out.courseDays = null;
    else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        throw new HttpError(400, "疗程天数要在 1~365 之间");
      }
      out.courseDays = n;
    }
  }

  if (out.startDate && out.endDate && out.endDate < out.startDate) {
    throw new HttpError(400, "结束日期不能早于开始日期");
  }
  return out;
}

export async function createMedication(
  ownerId: string,
  patientId: string,
  input: MedicationInput,
): Promise<MedicationDTO[]> {
  await requireOwnedPatient(ownerId, patientId);
  await prisma.medication.create({
    data: {
      patientId,
      drugName: input.drugName as string,
      dosage: input.dosage ?? null,
      frequency: input.frequency ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      isActive: input.isActive ?? true,
      note: input.note ?? null,
      timeOfDay: input.timeOfDay ?? null,
      mealTiming: input.mealTiming ?? null,
      courseDays: input.courseDays ?? null,
    },
  });
  // 写操作统一返回「改完之后的完整列表」，前端整体覆盖
  return listMedications(ownerId, patientId);
}

export async function updateMedication(
  ownerId: string,
  medicationId: string,
  patch: MedicationInput,
): Promise<MedicationDTO[]> {
  const med = await findOwnedMedication(ownerId, medicationId);
  if (!med) throw new HttpError(404, "没有找到这条用药记录");

  const data: Prisma.MedicationUpdateInput = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      (data as Record<string, unknown>)[key] = value;
    }
  }
  if (Object.keys(data).length === 0) {
    throw new HttpError(400, "没有需要修改的内容");
  }

  await prisma.medication.update({ where: { id: medicationId }, data });
  return listMedications(ownerId, med.patientId);
}

export async function deleteMedication(
  ownerId: string,
  medicationId: string,
): Promise<MedicationDTO[]> {
  const med = await findOwnedMedication(ownerId, medicationId);
  if (!med) throw new HttpError(404, "没有找到这条用药记录");

  await prisma.medication.delete({ where: { id: medicationId } });
  return listMedications(ownerId, med.patientId);
}

/* ------------------------------------------------------------ 打卡（依从性） */

/** "2026-10-24" → 当地 00:00；不合法就 400 */
function parseDayKey(value: unknown, label = "日期"): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new HttpError(400, `${label}写成 2026-10-24 这种格式`);
  }
  const [y, m, d] = value.trim().split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${label}不太对`);
  return startOfLocalDay(date);
}

/** 打卡：默认今天；同一天再打一次是覆盖，不会多出一行 */
export async function checkinMedication(
  ownerId: string,
  medicationId: string,
  dayText?: unknown,
): Promise<MedicationDTO[]> {
  const med = await findOwnedMedication(ownerId, medicationId);
  if (!med) throw new HttpError(404, "没有找到这条用药记录");

  const day = dayText ? parseDayKey(dayText) : startOfLocalDay(new Date());
  await prisma.medicationLog.upsert({
    where: { medicationId_scheduledFor: { medicationId, scheduledFor: day } },
    create: {
      medicationId,
      scheduledFor: day,
      takenAt: new Date(),
      status: "taken",
    },
    update: { takenAt: new Date(), status: "taken" },
  });
  return listMedications(ownerId, med.patientId);
}

/** 撤销打卡（点错了） */
export async function undoCheckin(
  ownerId: string,
  medicationId: string,
  dayText?: unknown,
): Promise<MedicationDTO[]> {
  const med = await findOwnedMedication(ownerId, medicationId);
  if (!med) throw new HttpError(404, "没有找到这条用药记录");

  const day = dayText ? parseDayKey(dayText) : startOfLocalDay(new Date());
  await prisma.medicationLog.deleteMany({
    where: { medicationId, scheduledFor: day },
  });
  return listMedications(ownerId, med.patientId);
}

/* ---------------------------------------------------------- 生成提醒文案 */

export interface MedicationReminder {
  medication: MedicationDTO;
  notice: string;
  email: string;
  noticeChars: number;
  emailChars: number;
  careAdded: boolean;
  facts: {
    drugName: string;
    dosage: string | null;
    timeOfDay: string | null;
    mealTiming: string | null;
    courseDay: number | null;
    remainingDays: number | null;
    missedStreak: number;
  };
}

/**
 * 按「药品名 + 剂量 + 时间点 + 饭前饭后 + 剩余疗程 + 连续漏服」生成两段文案。
 * 只是文案拼装，不调模型，也不会给出任何用药建议。
 */
export async function buildMedicationReminder(
  ownerId: string,
  medicationId: string,
): Promise<MedicationReminder> {
  const med = await prisma.medication.findFirst({
    where: { id: medicationId, patient: { ownerId } },
    include: { logs: { orderBy: { scheduledFor: "desc" }, take: 60 } },
  });
  if (!med) throw new HttpError(404, "没有找到这条用药记录");

  const schedule = computeSchedule(med, med.logs);
  const facts: ReminderFacts = {
    drugName: med.drugName,
    dosage: med.dosage,
    timeOfDay: med.timeOfDay,
    mealTiming: med.mealTiming,
    courseDay: schedule.courseDay,
    remainingDays: schedule.remainingDays,
    missedStreak: schedule.missedStreak,
  };

  const texts = buildReminder(facts);
  return {
    medication: serializeMedication(med, schedule),
    notice: texts.notice,
    email: texts.email,
    noticeChars: texts.noticeChars,
    emailChars: texts.emailChars,
    careAdded: texts.careAdded,
    facts: {
      drugName: med.drugName,
      dosage: med.dosage,
      timeOfDay: med.timeOfDay,
      mealTiming: med.mealTiming,
      courseDay: schedule.courseDay,
      remainingDays: schedule.remainingDays,
      missedStreak: schedule.missedStreak,
    },
  };
}
