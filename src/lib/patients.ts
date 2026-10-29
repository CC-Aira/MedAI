import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { computeSchedule } from "./medication-schedule";
import { HttpError } from "./http";
import { LIMITS, PATIENT_FIELDS, GENDERS } from "./constants";
import {
  hasOwn,
  oneOf,
  optionalDate,
  optionalNumber,
  optionalText,
  requireText,
} from "./validate";

/** 列表 / 详情统一带上这些，前端一次拿全，写操作也返回同一形状 */
export const PATIENT_INCLUDE = {
  medications: {
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    // 算疗程进度和「连续漏服几次」要用，档案页与列表页保持一致
    include: { logs: { orderBy: { scheduledFor: "desc" }, take: 60 } },
  },
  _count: {
    select: { consultations: true, notes: true },
  },
} satisfies Prisma.PatientInclude;

export type PatientWithRelations = Prisma.PatientGetPayload<{
  include: typeof PATIENT_INCLUDE;
}>;

/** 头像只允许指向本地上传目录，避免有人在 avatarUrl 里塞外链 */
const AVATAR_RE = /^\/uploads\/avatars\/[A-Za-z0-9_-]+\.(png|jpe?g|gif|webp)$/;

export function assertAvatarUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!text) return null;
  if (!AVATAR_RE.test(text)) throw new HttpError(400, "头像地址不合法");
  return text;
}

export type PatientWriteInput = {
  name?: string;
  gender?: string;
  birthDate?: Date | null;
  age?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  bloodType?: string | null;
  constitution?: string | null;
  habits?: string | null;
  allergies?: string | null;
  chronicDisease?: string | null;
  chiefComplaint?: string | null;
  avatarUrl?: string | null;
};

/** 建档时 name / gender 必填，改档时都可以不传 */
export type PatientCreateInput = PatientWriteInput & {
  name: string;
  gender: string;
};

/**
 * 解析档案输入。
 * partial=true 时只处理请求里真实出现过的 key —— 绝不会把没传的字段擦成 null。
 */
export function parsePatientInput(
  body: Record<string, unknown>,
  options: { partial: false },
): PatientCreateInput;
export function parsePatientInput(
  body: Record<string, unknown>,
  options: { partial: true },
): PatientWriteInput;
export function parsePatientInput(
  body: Record<string, unknown>,
  options: { partial: boolean },
): PatientWriteInput {
  const out: PatientWriteInput = {};
  const partial = options.partial;

  const take = (key: (typeof PATIENT_FIELDS)[number]) => hasOwn(body, key);

  if (!partial || take("name")) {
    out.name = requireText(body.name, "姓名", LIMITS.patientName);
  }
  if (!partial || take("gender")) {
    out.gender = oneOf(body.gender, "性别", GENDERS);
  }
  if (take("birthDate")) out.birthDate = optionalDate(body.birthDate, "出生日期");
  if (take("age")) out.age = optionalNumber(body.age, "年龄", 0, 130, true);
  if (take("heightCm")) out.heightCm = optionalNumber(body.heightCm, "身高", 30, 250);
  if (take("weightKg")) out.weightKg = optionalNumber(body.weightKg, "体重", 2, 400);
  if (take("bloodType")) out.bloodType = optionalText(body.bloodType, "血型", LIMITS.bloodType);
  if (take("constitution"))
    out.constitution = optionalText(body.constitution, "中医体质", LIMITS.constitution);
  if (take("habits")) out.habits = optionalText(body.habits, "生活习惯", LIMITS.habits);
  if (take("allergies"))
    out.allergies = optionalText(body.allergies, "过敏史", LIMITS.allergies);
  if (take("chronicDisease"))
    out.chronicDisease = optionalText(body.chronicDisease, "既往病史", LIMITS.chronicDisease);
  if (take("chiefComplaint"))
    out.chiefComplaint = optionalText(body.chiefComplaint, "主诉", LIMITS.chiefComplaint);
  if (take("avatarUrl")) out.avatarUrl = assertAvatarUrl(body.avatarUrl);

  return out;
}

/* ------------------------------------------------------------ 序列化 */

export type PatientDTO = {
  id: string;
  name: string;
  gender: string;
  avatarUrl: string | null;
  birthDate: string | null;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  bloodType: string | null;
  constitution: string | null;
  habits: string | null;
  allergies: string | null;
  chronicDisease: string | null;
  chiefComplaint: string | null;
  createdAt: string;
  updatedAt: string;
  medications: MedicationDTO[];
  counts: { consultations: number; notes: number };
};

export type MedicationDTO = {
  id: string;
  patientId: string;
  drugName: string;
  dosage: string | null;
  frequency: string | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  note: string | null;
  createdAt: string;

  /** 每天几点吃（"08:00"），用来生成提醒 */
  timeOfDay: string | null;
  /** before | after | any */
  mealTiming: string | null;
  /** 疗程总天数；留空就用 startDate~endDate 推 */
  courseDays: number | null;

  /* --- 由打卡记录算出来的进度，列表里直接给前端用 --- */
  /** 今天是疗程第几天 */
  courseDay: number | null;
  /** 还剩几天（含今天） */
  remainingDays: number | null;
  /** 今天打卡没有 */
  todayTaken: boolean;
  /** 连续漏服几次 */
  missedStreak: number;
};

export function serializeMedication(
  m: {
    id: string;
    patientId: string;
    drugName: string;
    dosage: string | null;
    frequency: string | null;
    startDate: Date | null;
    endDate: Date | null;
    isActive: boolean;
    note: string | null;
    createdAt: Date;
    timeOfDay?: string | null;
    mealTiming?: string | null;
    courseDays?: number | null;
    logs?: { scheduledFor: Date; takenAt: Date | null; status: string }[];
  },
  schedule?: {
    courseDay: number | null;
    remainingDays: number | null;
    todayTaken: boolean;
    missedStreak: number;
  },
): MedicationDTO {
  return {
    id: m.id,
    patientId: m.patientId,
    drugName: m.drugName,
    dosage: m.dosage,
    frequency: m.frequency,
    startDate: m.startDate ? m.startDate.toISOString() : null,
    endDate: m.endDate ? m.endDate.toISOString() : null,
    isActive: m.isActive,
    note: m.note,
    createdAt: m.createdAt.toISOString(),
    timeOfDay: m.timeOfDay ?? null,
    mealTiming: m.mealTiming ?? null,
    courseDays: m.courseDays ?? null,
    courseDay: schedule?.courseDay ?? null,
    remainingDays: schedule?.remainingDays ?? null,
    todayTaken: schedule?.todayTaken ?? false,
    missedStreak: schedule?.missedStreak ?? 0,
  };
}

export function serializePatient(p: PatientWithRelations): PatientDTO {
  return {
    id: p.id,
    name: p.name,
    gender: p.gender,
    avatarUrl: p.avatarUrl,
    birthDate: p.birthDate ? p.birthDate.toISOString() : null,
    age: p.age,
    heightCm: p.heightCm,
    weightKg: p.weightKg,
    bloodType: p.bloodType,
    constitution: p.constitution,
    habits: p.habits,
    allergies: p.allergies,
    chronicDisease: p.chronicDisease,
    chiefComplaint: p.chiefComplaint,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    // 不能直接 .map(serializeMedication)：第二个参数是 index，会被当成 schedule 传进去
    medications: p.medications.map((m) => {
      const logs = (m as { logs?: { scheduledFor: Date; takenAt: Date | null; status: string }[] }).logs ?? [];
      return serializeMedication(m, computeSchedule(m, logs));
    }),
    counts: {
      consultations: p._count.consultations,
      notes: p._count.notes,
    },
  };
}

/* --------------------------------------------------------------- 查询 */

/** 任何查询患者数据的地方都走这里：where 一定带 ownerId */
export async function listPatients(ownerId: string): Promise<PatientDTO[]> {
  const rows = await prisma.patient.findMany({
    where: { ownerId },
    include: PATIENT_INCLUDE,
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(serializePatient);
}

/**
 * 越权防护：findFirst + ownerId，一条语句搞定。
 * 不用「先按 id 查再比对 ownerId」，那会让攻击者从响应差异里确认 id 是否存在。
 */
export async function findOwnedPatient(
  ownerId: string,
  patientId: string,
): Promise<PatientWithRelations | null> {
  return prisma.patient.findFirst({
    where: { id: patientId, ownerId },
    include: PATIENT_INCLUDE,
  });
}

export async function requireOwnedPatient(
  ownerId: string,
  patientId: string,
): Promise<PatientWithRelations> {
  const patient = await findOwnedPatient(ownerId, patientId);
  if (!patient) throw new HttpError(404, "没有找到这份档案");
  return patient;
}

/* --------------------------------------------------------------- 写 */

export async function createPatient(
  ownerId: string,
  input: PatientCreateInput,
): Promise<PatientDTO> {
  // ownerId 只能来自会话，绝不从请求体里取
  const row = await prisma.patient.create({
    data: { ...input, owner: { connect: { id: ownerId } } },
    include: PATIENT_INCLUDE,
  });
  return serializePatient(row);
}

export async function updatePatient(
  ownerId: string,
  patientId: string,
  patch: PatientWriteInput,
): Promise<PatientDTO> {
  // 先确认归属（找不到就是 404），再写
  await requireOwnedPatient(ownerId, patientId);
  const row = await prisma.patient.update({
    where: { id: patientId },
    data: patch,
    include: PATIENT_INCLUDE,
  });
  return serializePatient(row);
}

/** 删除是幂等的：第一次 200 返回剩余列表，第二次 404 */
export async function deletePatient(
  ownerId: string,
  patientId: string,
): Promise<PatientDTO[]> {
  const patient = await findOwnedPatient(ownerId, patientId);
  if (!patient) throw new HttpError(404, "没有找到这份档案");

  await prisma.patient.delete({ where: { id: patientId } });
  return listPatients(ownerId);
}
