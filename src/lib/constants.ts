/** 全局业务常量：提示词预算、字段上限、白名单 */

/* ----------------------------------------------------- 提示词的三个上限 */
/** 每次对话带多少条历史消息（≈ 10 轮） */
export const MAX_HISTORY_MESSAGES = 20;
/** 注入几条最近的问诊摘要 */
export const MAX_SUMMARY_COUNT = 3;
/** 注入几条结论（星标优先） */
export const MAX_NOTES_IN_PROMPT = 8;
/** 带附件的那一轮，历史里最多回放几个附件的正文（防止几十份报告把上下文撑爆） */
export const MAX_ATTACHMENTS_IN_PROMPT = 3;

/* ------------------------------------------------------- 对话保留策略 */
/**
 * 聊天记录不永久保留：超过这个天数的消息会被自动清除。
 * 注意只清消息，「小结」存在 Consultation.summary 上，属于结构化结论，不在清理范围内。
 */
export const CHAT_RETENTION_DAYS = Number(
  process.env.MEDAI_CHAT_RETENTION_DAYS || 30,
);

/* ----------------------------------------------------------- 字段上限 */
export const LIMITS = {
  email: 120,
  passwordMin: 8,
  passwordMax: 72,

  patientName: 20,
  bloodType: 12,
  constitution: 30,
  habits: 200,
  allergies: 200,
  chronicDisease: 200,
  chiefComplaint: 120,

  drugName: 50,
  dosage: 30,
  frequency: 30,
  medNote: 100,

  consultTitle: 60,
  message: 2000,
  summary: 1500,

  noteTitle: 40,
  noteContent: 1000,
  tags: 100,

  /** AI 整理档案单次最多应用多少条 */
  MAX_FACTS_APPLY: 20,
  /** 头像大小上限 2MB */
  avatarBytes: 2 * 1024 * 1024,
  /** 上传给 AI 看的资料上限 10MB */
  attachBytes: 10 * 1024 * 1024,
  /** 附件文件名 */
  attachName: 120,
  /** 提取出的正文最多留多少字（超了截断，避免撑爆提示词） */
  attachText: 12000,
  /** 一次消息最多带几个附件 */
  MAX_ATTACH_PER_MESSAGE: 3,
} as const;

/** 允许上传的附件类型：白名单，按魔数判定，不看客户端 MIME */
export const ATTACH_KINDS = ["image", "pdf", "docx", "text"] as const;
export type AttachKind = (typeof ATTACH_KINDS)[number];

/** PATCH 档案时允许改的字段（白名单，其余一律忽略） */
export const PATIENT_FIELDS = [
  "name",
  "gender",
  "birthDate",
  "age",
  "heightCm",
  "weightKg",
  "bloodType",
  "constitution",
  "habits",
  "allergies",
  "chronicDisease",
  "chiefComplaint",
  "avatarUrl",
] as const;

export type PatientField = (typeof PATIENT_FIELDS)[number];

/** AI 整理时允许 AI 碰的字段：含 avatarUrl 没有意义，单独排除 */
export const FACT_FIELDS: PatientField[] = PATIENT_FIELDS.filter(
  (f) => f !== "avatarUrl",
);

export const GENDERS = ["male", "female"] as const;
export const CONSULT_STATUS = ["active", "archived"] as const;

export const BLOOD_TYPES = ["A", "B", "AB", "O", "Rh-", "不详"] as const;

/** 提示词里对性别的说法 */
export function genderLabel(gender: string): string {
  if (gender === "male") return "男";
  if (gender === "female") return "女";
  return "未填";
}

/** 字段的中文名，AI 整理时用来跟模型对齐 */
export const FIELD_LABELS: Record<string, string> = {
  name: "姓名",
  gender: "性别",
  birthDate: "出生日期",
  age: "年龄",
  heightCm: "身高(cm)",
  weightKg: "体重(kg)",
  bloodType: "血型",
  constitution: "中医体质",
  habits: "生活习惯",
  allergies: "过敏史",
  chronicDisease: "既往病史",
  chiefComplaint: "主诉",
};
