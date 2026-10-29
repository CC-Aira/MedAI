/* 浏览器端访问自己后端的薄封装：统一解析错误文案、统一 JSON 处理 */

import type {
  Attachment,
  Consultation,
  ConsultationDetail,
  FactCandidate,
  Growth,
  Medication,
  Message,
  Note,
  Patient,
  SessionUser,
  TodayBoard,
} from "./types";
// 就诊摘要的结构定义在 lib 里，那一份文件只放类型和纯函数，浏览器侧可以直接用
import type { VisitSheet } from "../visit-sheet";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json();
    if (data && typeof data === "object" && "error" in data) {
      const text = (data as { error?: unknown }).error;
      if (typeof text === "string" && text) return text;
    }
  } catch {
    /* 非 JSON 响应，走默认文案 */
  }
  if (res.status === 401) return "请先登录";
  if (res.status === 404) return "没有找到这份资料";
  return `请求失败（${res.status}）`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    credentials: "same-origin",
  });

  if (!res.ok) throw new ApiError(res.status, await readError(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ 账号 */

export const login = (email: string, password: string) =>
  api<{ user: SessionUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

export const register = (email: string, password: string) =>
  api<{ user: SessionUser }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

export const logout = () => api<{ ok: boolean }>("/api/auth/logout", { method: "POST" });

/* ------------------------------------------------------------------ 档案 */

export const listPatients = () => api<{ patients: Patient[] }>("/api/patients");

export const getPatient = (id: string) =>
  api<{ patient: Patient }>(`/api/patients/${id}`);

export const createPatient = (body: Record<string, unknown>) =>
  api<{ patient: Patient; patients: Patient[] }>("/api/patients", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const patchPatient = (id: string, body: Record<string, unknown>) =>
  api<{ patient: Patient; patients: Patient[] }>(`/api/patients/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deletePatient = (id: string) =>
  api<{ patients: Patient[] }>(`/api/patients/${id}`, { method: "DELETE" });

/* ------------------------------------------------------------------ 用药 */

export const listMedications = (patientId: string) =>
  api<{ medications: Medication[] }>(`/api/patients/${patientId}/medications`);

export const createMedication = (patientId: string, body: Record<string, unknown>) =>
  api<{ medications: Medication[] }>(`/api/patients/${patientId}/medications`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const patchMedication = (id: string, body: Record<string, unknown>) =>
  api<{ medications: Medication[] }>(`/api/medications/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteMedication = (id: string) =>
  api<{ medications: Medication[] }>(`/api/medications/${id}`, { method: "DELETE" });

/** 打卡吃药（不传 date 就是今天） */
export const checkinMedication = (id: string, date?: string) =>
  api<{ medications: Medication[] }>(`/api/medications/${id}/checkin`, {
    method: "POST",
    body: JSON.stringify(date ? { date } : {}),
  });

/** 撤销打卡 */
export const undoMedicationCheckin = (id: string, date?: string) =>
  api<{ medications: Medication[] }>(
    `/api/medications/${id}/checkin${date ? `?date=${encodeURIComponent(date)}` : ""}`,
    { method: "DELETE" },
  );

/** 木牌上那份「全家今天」：打卡之后重新拉一遍，数字和排序才是新的 */
export const getTodayBoard = () => api<TodayBoard>("/api/medications/board");

export type MedicationReminder = {
  medication: Medication;
  /** 站内通知，≤30 字 */
  notice: string;
  /** 邮件正文，≤80 字（连续漏服时会多一句关怀） */
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
};

/** 生成这条用药的提醒文案（站内通知 + 邮件正文） */
export const getMedicationReminder = (id: string) =>
  api<MedicationReminder>(`/api/medications/${id}/reminder`);

/* ------------------------------------------------------------------ 问诊 */

export const listConsultations = (patientId: string) =>
  api<{ consultations: Consultation[] }>(`/api/patients/${patientId}/consultations`);

export const createConsultation = (patientId: string, title?: string) =>
  api<{ consultation: Consultation }>(`/api/patients/${patientId}/consultations`, {
    method: "POST",
    body: JSON.stringify(title ? { title } : {}),
  });

export const getConsultation = (id: string) =>
  api<{ consultation: ConsultationDetail }>(`/api/consultations/${id}`);

export const deleteConsultation = (id: string) =>
  api<{ consultations: Consultation[] }>(`/api/consultations/${id}`, {
    method: "DELETE",
  });

/** 归档 = 这次聊完了。归档不会删消息，只是让下次打开档案时开新的一次。 */
export const archiveConsultation = (id: string) =>
  api<{ consultation: Consultation }>(`/api/consultations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "archived" }),
  });

/** 小结落库后的完整记录；文字在 .summary 里，别把整个对象当字符串用 */
export type GeneratedSummary = {
  id: string;
  summary: string;
  updatedAt: string;
};

export const generateSummary = (id: string) =>
  api<GeneratedSummary>(`/api/consultations/${id}/summary`, { method: "POST" });

/* ---------------------------------------------------------- 就诊摘要 */

export const getVisitSheet = (id: string) =>
  api<{ sheet: VisitSheet | null }>(`/api/consultations/${id}/sheet`);

/** local=true 时完全不碰模型，用档案和对话原文排一张 */
export const generateVisitSheet = (id: string, local = false) =>
  api<{ sheet: VisitSheet }>(`/api/consultations/${id}/sheet`, {
    method: "POST",
    body: JSON.stringify({ local }),
  });

export const scanFacts = (id: string) =>
  api<{ candidates: FactCandidate[]; skipped: number }>(
    `/api/consultations/${id}/facts`,
    { method: "POST" },
  );

export const applyFacts = (id: string, items: FactCandidate[]) =>
  api<{ patient: Patient }>(`/api/consultations/${id}/facts`, {
    method: "PATCH",
    body: JSON.stringify({ items }),
  });

/* ------------------------------------------------------------------ 结论 */

export const listNotes = (patientId: string) =>
  api<{ notes: Note[] }>(`/api/patients/${patientId}/notes`);

export const createNote = (patientId: string, body: Record<string, unknown>) =>
  api<{ note: Note; notes: Note[] }>(`/api/patients/${patientId}/notes`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const patchNote = (id: string, body: Record<string, unknown>) =>
  api<{ notes: Note[] }>(`/api/notes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteNote = (id: string) =>
  api<{ notes: Note[] }>(`/api/notes/${id}`, { method: "DELETE" });

/* ------------------------------------------------------------------ 其他 */

export const getGrowth = () => api<{ growth: Growth }>("/api/growth");

export const uploadAvatar = async (file: File, patientId?: string) => {
  const form = new FormData();
  form.append("file", file);
  if (patientId) form.append("patientId", patientId);

  const res = await fetch("/api/upload/avatar", { method: "POST", body: form });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return (await res.json()) as { avatarUrl: string; patient: Patient | null };
};

/* ------------------------------------------------------- 附件（给 AI 看） */

/**
 * 上传一份资料（病历照片 / 化验单 / PDF / Word / 文本）。
 * 服务端在上传时就完成解析（图片走本地 OCR），返回里带 hasText 说明有没有读出内容。
 */
export const uploadAttachment = async (file: File) => {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch("/api/upload/attachment", { method: "POST", body: form });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return (await res.json()) as { attachment: Attachment };
};

/* ------------------------------------------------------------- 流式问诊 */

export type StreamHandlers = {
  onDelta: (text: string) => void;
  onDone: (payload: {
    userMessage: Message | null;
    assistantMessage: Message | null;
    /** 整段对话的最新版本，前端直接替换即可（编辑会删掉后续消息） */
    messages: Message[];
  }) => void;
  onError: (message: string) => void;
};

export type StreamOptions = {
  /** 带一份资料一起发 */
  attachmentId?: string;
  /** 改一句话重发：服务端会更新这句话、删掉它之后的问答，再重新回答 */
  editMessageId?: string;
};

/**
 * POST 一条消息并解析 SSE。
 * 服务端只在整段回复读完后才落库，所以 onDone 里的 messages 就是最终版本。
 */
export async function streamMessage(
  consultationId: string,
  content: string,
  handlers: StreamHandlers,
  options: StreamOptions = {},
): Promise<void> {
  const res = await fetch(`/api/consultations/${consultationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      ...(options.attachmentId ? { attachmentId: options.attachmentId } : {}),
      ...(options.editMessageId ? { editMessageId: options.editMessageId } : {}),
    }),
    credentials: "same-origin",
  });

  if (!res.ok || !res.body) {
    handlers.onError(await readError(res));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // 半截行要留着，否则最后一段 JSON 会被截断
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const body = line.slice(5).trim();
      if (!body) continue;

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(body) as Record<string, unknown>;
      } catch {
        continue;
      }

      const type = payload.type;
      if (type === "delta" && typeof payload.text === "string") {
        handlers.onDelta(payload.text);
      } else if (type === "done") {
        handlers.onDone({
          userMessage: (payload.userMessage as Message | null) ?? null,
          assistantMessage: (payload.assistantMessage as Message | null) ?? null,
          messages: Array.isArray(payload.messages) ? (payload.messages as Message[]) : [],
        });
      } else if (type === "error") {
        handlers.onError(
          typeof payload.message === "string" ? payload.message : "回答中断了，请再试一次",
        );
      }
    }
  }
}
