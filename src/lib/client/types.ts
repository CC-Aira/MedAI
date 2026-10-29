/* 前端用的 DTO 类型 —— 只放类型，不碰服务端代码，客户端组件可以放心 import */

export type Medication = {
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
  /** 每天几点吃，如 "08:00" */
  timeOfDay: string | null;
  /** before | after | any */
  mealTiming: string | null;
  /** 疗程总天数 */
  courseDays: number | null;
  /** 今天是疗程第几天 */
  courseDay: number | null;
  /** 还剩几天（含今天），没设疗程就是 null */
  remainingDays: number | null;
  /** 今天打卡没有 */
  todayTaken: boolean;
  /** 连续漏服几次 */
  missedStreak: number;
};

export type Patient = {
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
  medications: Medication[];
  counts: { consultations: number; notes: number };
};

export type Attachment = {
  id: string;
  filename: string;
  kind: string;
  sizeBytes: number;
  /** 有没有提取到正文；false 表示图片里没识别出字，需要用户补描述 */
  hasText: boolean;
  textLength: number;
  /** 上传接口返回的一句话说明 */
  note?: string;
};

export type Message = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  /** 非空表示这条不是模型回答：redflag.emergency / redflag.urgent / redflag.care */
  flag?: string | null;
  /** 改过的时间；没有就是没编辑过 */
  editedAt?: string | null;
  attachment?: Attachment | null;
};

export type Consultation = {
  id: string;
  patientId: string;
  title: string;
  status: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: string | null;
  /** 最后一条消息的时间；没有消息（或已过保留期）就是 null */
  lastMessageAt: string | null;
  /** 已经生成过就诊摘要 */
  hasSheet: boolean;
};

export type ConsultationDetail = Consultation & {
  messages: Message[];
  patient: { id: string; name: string; gender: string; age: number | null };
  /** 对话保留策略：聊天记录不永久保留，到期自动清除 */
  retention?: {
    days: number;
    oldestMessageAt: string | null;
    expiresAt: string | null;
  };
};

export type Note = {
  id: string;
  patientId: string;
  consultationId: string | null;
  title: string;
  content: string;
  tags: string | null;
  isFavorite: boolean;
  createdAt: string;
};

export type Growth = {
  patients: number;
  consultations: number;
  activeConsultations: number;
  messages: number;
  notes: number;
  favorites: number;
  activeDays: number;
  streak: number;
  weekly: { weekStart: string; count: number }[];
  firstActivityAt: string | null;
};

export type FactKind = "fill" | "add" | "conflict";

export type FactCandidate = {
  id: string;
  kind: FactKind;
  field?: string;
  label?: string;
  value?: string;
  current?: string | null;
  drug?: {
    drugName: string;
    dosage: string | null;
    frequency: string | null;
    medicationId?: string;
  };
  reason: string;
  defaultChecked: boolean;
};

/** 一颗药在今天的一个时间点 */
export type BoardDose = {
  medicationId: string;
  drugName: string;
  timeOfDay: string;
  done: boolean;
  /** 过了点还没吃 */
  overdue: boolean;
};

/** 木牌上的一行：一位档案今天的用药 */
export type BoardEntry = {
  patientId: string;
  patientName: string;
  total: number;
  done: number;
  overdue: number;
  nextTime: string | null;
  missedStreak: number;
  doses: BoardDose[];
};

/** 草地上的小木牌：全家今天吃了几次药 */
export type TodayBoard = {
  day: string;
  total: number;
  done: number;
  overdue: number;
  entries: BoardEntry[];
};

export type SessionUser = { id: string; email: string; createdAt: string };
