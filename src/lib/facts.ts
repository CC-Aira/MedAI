import { prisma } from "./db";
import { HttpError } from "./http";
import {
  FIELD_LABELS,
  FACT_FIELDS,
  GENDERS,
  LIMITS,
  type PatientField,
} from "./constants";
import {
  oneOf,
  optionalDate,
  optionalNumber,
  optionalText,
  asArray,
} from "./validate";
import {
  requireOwnedPatient,
  serializePatient,
  type PatientDTO,
  type PatientWithRelations,
} from "./patients";

export type FactKind = "fill" | "add" | "conflict";

export type FactCandidate = {
  /** 稳定的 key，前端用它做勾选状态 */
  id: string;
  kind: FactKind;
  field?: string;
  label?: string;
  /** 建议写入的完整内容 */
  value?: string;
  /** 档案里现在是什么（conflict 才有对比意义） */
  current?: string | null;
  /** add 类型 */
  drug?: {
    drugName: string;
    dosage: string | null;
    frequency: string | null;
    medicationId?: string;
  };
  reason: string;
  /** fill/add 默认勾选，conflict 默认不勾（必须患者亲手确认） */
  defaultChecked: boolean;
};

/* ------------------------------------------------------- 药名归一 */

const DOSE_FORMS = [
  "缓释胶囊",
  "缓释片",
  "分散片",
  "口腔崩解片",
  "口服液",
  "注射液",
  "混悬液",
  "喷雾剂",
  "滴眼液",
  "颗粒",
  "胶囊",
  "糖浆",
  "软膏",
  "乳膏",
  "滴剂",
  "贴剂",
  "气雾剂",
  "片",
  "丸",
  "散",
  "栓",
];

/**
 * 比较药名时剥掉剂型后缀：「布洛芬缓释片」和「布洛芬」算同一种药。
 * 先长后短，否则「缓释片」会被「片」先削成「缓释」。
 */
export function normalizeDrugName(raw: string): string {
  let name = (raw || "").trim().replace(/\s+/g, "");
  for (const form of DOSE_FORMS) {
    if (name.length > form.length && name.endsWith(form)) {
      name = name.slice(0, -form.length);
      break;
    }
  }
  return name.toLowerCase();
}

/* --------------------------------------------------- 字段值归一比较 */

function isNumericField(field: string): boolean {
  return field === "age" || field === "heightCm" || field === "weightKg";
}

function isDateField(field: string): boolean {
  return field === "birthDate";
}

/** 当前值 → 展示文本 */
export function displayValue(
  patient: PatientWithRelations,
  field: string,
): string {
  const raw = (patient as unknown as Record<string, unknown>)[field];
  if (raw === null || raw === undefined) return "";
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return String(raw).trim();
}

/** 用来判等的归一形式：数字取数字，日期取 YYYY-MM-DD，文本去空白小写 */
function comparable(field: string, value: string): string {
  const text = value.trim();
  if (!text) return "";
  if (isNumericField(field)) {
    const m = /-?\d+(\.\d+)?/.exec(text);
    return m ? String(Number(m[0])) : text.toLowerCase();
  }
  if (isDateField(field)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : text.toLowerCase();
  }
  return text.replace(/\s+/g, " ").toLowerCase();
}

/** 字段长度上限查表 */
function maxLengthFor(field: PatientField): number {
  switch (field) {
    case "name":
      return LIMITS.patientName;
    case "bloodType":
      return LIMITS.bloodType;
    case "constitution":
      return LIMITS.constitution;
    case "habits":
      return LIMITS.habits;
    case "allergies":
      return LIMITS.allergies;
    case "chronicDisease":
      return LIMITS.chronicDisease;
    case "chiefComplaint":
      return LIMITS.chiefComplaint;
    default:
      return 30;
  }
}

function isFactField(field: string): field is PatientField {
  return (FACT_FIELDS as string[]).includes(field);
}

/* --------------------------------------------------------- diffFacts */

type AiUpdate = { field?: unknown; value?: unknown; reason?: unknown };
type AiAdd = {
  drugName?: unknown;
  dosage?: unknown;
  frequency?: unknown;
  /** 明确在长期吃 → true；过去吃过 / 偶尔吃 / 记不清 → false */
  longTerm?: unknown;
  reason?: unknown;
};

/**
 * 冲突判定完全交给代码，不交给模型：
 * 空字段 → fill（默认勾）；有值且不一致 → conflict（默认不勾，红色高亮）。
 * 模型返回的 value 一律当"该字段更新后应显示的完整内容"处理。
 */
export function diffFacts(
  patient: PatientWithRelations,
  updates: AiUpdate[],
): { candidates: FactCandidate[]; skipped: string[] } {
  const candidates: FactCandidate[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const item of updates) {
    const field = typeof item.field === "string" ? item.field.trim() : "";
    if (!isFactField(field)) {
      skipped.push(`字段 ${field || "(空)"} 不在白名单里`);
      continue;
    }
    if (seen.has(field)) continue;

    const rawValue = item.value;
    const suggested =
      rawValue === null || rawValue === undefined
        ? ""
        : typeof rawValue === "string"
          ? rawValue.trim()
          : String(rawValue);

    if (!suggested) {
      skipped.push(`${FIELD_LABELS[field] ?? field} 的建议值是空的`);
      continue;
    }
    if (suggested.length > maxLengthFor(field)) {
      skipped.push(`${FIELD_LABELS[field] ?? field} 的建议值太长`);
      continue;
    }

    const current = displayValue(patient, field);
    if (comparable(field, current) === comparable(field, suggested)) {
      // 已经一致，不需要患者再确认一次
      continue;
    }

    const reason =
      typeof item.reason === "string" && item.reason.trim()
        ? item.reason.trim().slice(0, 120)
        : "来自这次对话";

    seen.add(field);
    const empty = !current;
    candidates.push({
      id: `${empty ? "fill" : "conflict"}:${field}`,
      kind: empty ? "fill" : "conflict",
      field,
      label: FIELD_LABELS[field] ?? field,
      value: suggested,
      current: empty ? null : current,
      reason,
      defaultChecked: empty,
    });
  }

  return { candidates, skipped };
}

/** 把 AI 的原始 JSON 变成候选列表（不写库） */
export function buildFactCandidates(
  patient: PatientWithRelations,
  raw: unknown,
): { candidates: FactCandidate[]; skipped: string[]; empty: boolean } {
  const payload = (raw ?? {}) as Record<string, unknown>;

  // 模型可能用 updates / fill / conflicts 任意一个 key，全都收进来再统一判定
  const rawUpdates: AiUpdate[] = [];
  for (const key of ["updates", "fill", "conflicts"]) {
    const list = payload[key];
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item && typeof item === "object") rawUpdates.push(item as AiUpdate);
      }
    }
  }

  const { candidates, skipped } = diffFacts(patient, rawUpdates);

  // ---- 新增用药
  const existing = new Set(patient.medications.map((m) => normalizeDrugName(m.drugName)));
  const adds = Array.isArray(payload.add) ? (payload.add as AiAdd[]) : [];
  for (const item of adds) {
    if (!item || typeof item !== "object") continue;
    const drugName =
      typeof item.drugName === "string" ? item.drugName.trim().slice(0, LIMITS.drugName) : "";
    if (!drugName) {
      skipped.push("新增用药没有药名");
      continue;
    }
    const key = normalizeDrugName(drugName);
    if (existing.has(key)) continue; // 已经在吃了，不重复加
    existing.add(key);

    const dosage =
      typeof item.dosage === "string" && item.dosage.trim()
        ? item.dosage.trim().slice(0, LIMITS.dosage)
        : null;
    const frequency =
      typeof item.frequency === "string" && item.frequency.trim()
        ? item.frequency.trim().slice(0, LIMITS.frequency)
        : null;

    // 长期吃的药默认勾上；"以前吃过 / 偶尔吃"的也列出来，但默认不勾 ——
    // 之前是直接不列，结果患者说过药名却在档案里找不到，比多一条待确认更糟。
    const longTerm = item.longTerm !== false;

    candidates.push({
      id: `add:${key}`,
      kind: "add",
      drug: { drugName, dosage, frequency },
      reason:
        typeof item.reason === "string" && item.reason.trim()
          ? item.reason.trim().slice(0, 120)
          : "来自这次对话",
      defaultChecked: longTerm,
    });
  }

  return { candidates, skipped, empty: candidates.length === 0 };
}

/* -------------------------------------------------------- applyFacts */

type ApplyItem = {
  kind?: unknown;
  field?: unknown;
  value?: unknown;
  drug?: unknown;
  medicationId?: unknown;
};

/** 单字段的严格校验：白名单 + 类型 + 长度，AI 输出一律不可信 */
function parseFactValue(
  field: PatientField,
  value: unknown,
): string | number | Date | null {
  if (value === null || value === undefined) {
    throw new HttpError(400, `${FIELD_LABELS[field] ?? field} 缺少值`);
  }
  const text = typeof value === "string" ? value.trim() : String(value);

  switch (field) {
    case "name":
      if (!text) throw new HttpError(400, "姓名不能为空");
      if (text.length > LIMITS.patientName)
        throw new HttpError(400, `姓名最多 ${LIMITS.patientName} 个字`);
      return text;

    case "gender":
      return oneOf(text, "性别", GENDERS);

    case "age": {
      const n = optionalNumber(text, "年龄", 0, 130, true);
      if (n === null) throw new HttpError(400, "年龄不能为空");
      return n;
    }
    case "heightCm": {
      const n = optionalNumber(text, "身高", 30, 250);
      if (n === null) throw new HttpError(400, "身高不能为空");
      return n;
    }
    case "weightKg": {
      const n = optionalNumber(text, "体重", 2, 400);
      if (n === null) throw new HttpError(400, "体重不能为空");
      return n;
    }
    case "birthDate": {
      const d = optionalDate(text, "出生日期");
      if (!d) throw new HttpError(400, "出生日期不能为空");
      return d;
    }

    case "bloodType":
      return optionalText(text, "血型", LIMITS.bloodType);
    case "constitution":
      return optionalText(text, "中医体质", LIMITS.constitution);
    case "habits":
      return optionalText(text, "生活习惯", LIMITS.habits);
    case "allergies":
      return optionalText(text, "过敏史", LIMITS.allergies);
    case "chronicDisease":
      return optionalText(text, "既往病史", LIMITS.chronicDisease);
    case "chiefComplaint":
      return optionalText(text, "主诉", LIMITS.chiefComplaint);

    default:
      throw new HttpError(400, `不支持的字段 ${field}`);
  }
}

/**
 * 把患者确认过的候选写进档案。
 * 每条都当不可信输入重新校验：白名单、类型、长度、单次 ≤20 条、medicationId 按 ownerId 重查。
 */
export async function applyFacts(
  ownerId: string,
  patientId: string,
  body: Record<string, unknown>,
): Promise<PatientDTO> {
  const patient = await requireOwnedPatient(ownerId, patientId);

  const items = asArray(body.items ?? body.candidates, "items") as ApplyItem[];
  const picked = items.filter((item) => {
    // 显式传 checked:false 的一律跳过，前端未勾选的项即使传了也不生效
    if (!item || typeof item !== "object") return false;
    const flag = (item as { checked?: unknown }).checked;
    return flag !== false;
  });

  if (picked.length === 0) throw new HttpError(400, "没有选中任何要应用的条目");
  if (picked.length > LIMITS.MAX_FACTS_APPLY) {
    throw new HttpError(400, `一次最多应用 ${LIMITS.MAX_FACTS_APPLY} 条`);
  }

  const patch: Record<string, string | number | Date | null> = {};
  const newMeds: { drugName: string; dosage: string | null; frequency: string | null }[] = [];
  const medToggles: { id: string; isActive: boolean }[] = [];

  for (const item of picked) {
    const kind = typeof item.kind === "string" ? item.kind : "";

    if (kind === "fill" || kind === "conflict" || (item.field && !item.drug)) {
      const field = typeof item.field === "string" ? item.field.trim() : "";
      if (!isFactField(field)) throw new HttpError(400, `字段 ${field} 不在白名单里`);
      patch[field] = parseFactValue(field, item.value);
      continue;
    }

    if (kind === "add") {
      const drug = (item.drug ?? {}) as Record<string, unknown>;
      const drugName = optionalText(drug.drugName ?? item.value, "药名", LIMITS.drugName);
      if (!drugName) throw new HttpError(400, "药名不能为空");
      newMeds.push({
        drugName,
        dosage: optionalText(drug.dosage, "剂量", LIMITS.dosage),
        frequency: optionalText(drug.frequency, "频率", LIMITS.frequency),
      });
      continue;
    }

    if (kind === "medication" && item.medicationId) {
      const rawId = String(item.medicationId);
      // 归属再查一次，防止拿别人的用药 id 来改
      const med = await prisma.medication.findFirst({
        where: { id: rawId, patient: { ownerId } },
        select: { id: true, patientId: true },
      });
      if (!med || med.patientId !== patientId) {
        throw new HttpError(404, "没有找到这条用药记录");
      }
      medToggles.push({ id: med.id, isActive: Boolean(item.value ?? true) });
      continue;
    }

    throw new HttpError(400, `不认识的条目类型：${kind || "(空)"}`);
  }

  if (Object.keys(patch).length === 0 && newMeds.length === 0 && medToggles.length === 0) {
    throw new HttpError(400, "没有需要应用的改动");
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(patch).length > 0) {
      await tx.patient.update({ where: { id: patientId }, data: patch });
    }
    for (const med of newMeds) {
      await tx.medication.create({
        data: { patientId, ...med, isActive: true },
      });
    }
    for (const toggle of medToggles) {
      await tx.medication.update({
        where: { id: toggle.id },
        data: { isActive: toggle.isActive, endDate: toggle.isActive ? null : new Date() },
      });
    }
  });

  // 返回改完之后的完整档案，前端整体覆盖
  const fresh = await requireOwnedPatient(ownerId, patientId);
  return serializePatient(fresh);
}
