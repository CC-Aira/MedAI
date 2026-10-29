/**
 * 病程时间轴 —— 把「建档 / 用药 / 问诊 / 结论」四类记录摞到同一条纵轴上。
 *
 * 为什么要这么一张图：
 *   档案页原本是四个互相独立的 tab，用药在用药页、问诊在日历里、结论在另一个 tab。
 *   想知道「什么时候开始吃的这个药、吃到第几天去复诊了、复诊完加了什么」，
 *   得来回切三次。时间轴就是把这三次切换省掉：一条线往下读，就是这段病程。
 *
 * 为什么是纯函数：
 *   输入就是档案页手上已有的四份数据（patient / meds / notes / visits），
 *   不查库、不碰 prisma，既能被客户端直接调用、也能拿真实数据离线测。
 *
 * 归日规则（和问诊日历保持一致，别让同一件事在两个视图里算成两天）：
 *   - 问诊：lastMessageAt ?? createdAt —— updatedAt 会被归档、生成摘要刷新，不能用
 *   - 用药：startDate ?? createdAt —— 医生说的「从今天开始吃」比建这条记录的时刻准
 *   - 结论：createdAt
 */

import type { Consultation, Medication, Note, Patient } from "./client/types";

export type TimelineKind = "formed" | "med" | "visit" | "note";

export type TimelineEvent = {
  id: string;
  kind: TimelineKind;
  /** ISO 时间 */
  at: string;
  title: string;
  /** 一行说明，可能为空 */
  detail: string;
  /** 右侧小标签：剂量、疗程、已停用、星标… */
  tags: string[];
  /** 问诊事件带上，点一下能看原文 */
  consultationId?: string;
  /** 有摘要的问诊：详情里有 AI 小结 */
  hasSummary?: boolean;
};

export type TimelineGroup = {
  /** 2026-10 */
  key: string;
  /** 2026 年 10 月 */
  label: string;
  events: TimelineEvent[];
};

export type TimelineStats = {
  /** 建档至今多少天 */
  days: number;
  visits: number;
  notes: number;
  /** 出现过的药（含已停用） */
  meds: number;
  activeMeds: number;
  /** 第一条 / 最新一条记录的时间 */
  firstAt: string | null;
  lastAt: string | null;
};

export type Timeline = {
  groups: TimelineGroup[];
  stats: TimelineStats;
  /** 总事件数，tab 上的角标用 */
  total: number;
};

const MAX_DETAIL = 130;

function clip(text: string, max = MAX_DETAIL): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}

function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}

/** 用药那一条的副标题：剂量 · 频率 · 时间点 · 疗程 */
function medDetail(m: Medication): string {
  const parts: string[] = [];
  if (m.dosage) parts.push(m.dosage);
  if (m.frequency) parts.push(m.frequency);
  if (m.timeOfDay) parts.push(`每天 ${m.timeOfDay}`);
  if (m.courseDays) parts.push(`${m.courseDays} 天疗程`);
  if (m.note) parts.push(m.note);
  return parts.join(" · ");
}

export function buildTimeline(
  input: {
    patient: Patient;
    medications: Medication[];
    notes: Note[];
    consultations: Consultation[];
  },
  now: Date = new Date(),
): Timeline {
  const events: TimelineEvent[] = [];
  const { patient, medications, notes, consultations } = input;

  /* ---------------------------------------------------------------- 建档 */

  const chief = patient.chiefComplaint?.trim();
  events.push({
    id: `formed-${patient.id}`,
    kind: "formed",
    at: patient.createdAt,
    title: "建立这份档案",
    detail: chief
      ? `主诉：${clip(chief, 60)}`
      : [patient.gender === "male" ? "男" : "女", patient.age ? `${patient.age} 岁` : ""]
          .filter(Boolean)
          .join(" · "),
    tags: [patient.allergies?.trim() ? "已登记过敏史" : ""].filter(Boolean),
  });

  /* ---------------------------------------------------------------- 用药 */

  for (const m of medications) {
    const at = m.startDate || m.createdAt;
    const tags: string[] = [];
    if (m.dosage) tags.push(m.dosage);
    if (m.courseDays) tags.push(`${m.courseDays} 天`);
    if (!m.isActive) tags.push("已停用");
    // 疗程走完了也算结束，和「手动停用」分开说
    else if (m.remainingDays === 0) tags.push("疗程已满");

    events.push({
      id: `med-${m.id}`,
      kind: "med",
      at,
      title: `开始服用 ${m.drugName}`,
      detail: medDetail(m),
      tags,
    });
  }

  /* ---------------------------------------------------------------- 问诊 */

  for (const v of consultations) {
    const at = v.lastMessageAt || v.createdAt;
    const tags: string[] = [`${v.messageCount} 句`];
    if (v.hasSheet) tags.push("有就诊摘要");
    if (v.status === "archived") tags.push("已归档");

    events.push({
      id: `visit-${v.id}`,
      kind: "visit",
      at,
      title: v.title,
      // 有小结就用小结 —— 摘要本来就是「这次聊出了什么」的浓缩
      detail: clip(v.summary || v.lastMessage || "（这次没有留下文字记录）"),
      tags,
      consultationId: v.id,
      hasSummary: Boolean(v.summary),
    });
  }

  /* ---------------------------------------------------------------- 结论 */

  for (const n of notes) {
    const tags = (n.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (n.isFavorite) tags.unshift("重要");
    events.push({
      id: `note-${n.id}`,
      kind: "note",
      at: n.createdAt,
      title: n.title,
      detail: clip(n.content),
      tags,
    });
  }

  /* ------------------------------------------------------------ 分组排序 */

  // 新的在上面：打开就看见「最近怎么了」，往下翻才是旧病程
  events.sort((a, b) => {
    const d = new Date(b.at).getTime() - new Date(a.at).getTime();
    if (d !== 0) return d;
    // 同一时刻：问诊优先于结论，结论优先于用药，建档垫底
    const rank: Record<TimelineKind, number> = { visit: 0, note: 1, med: 2, formed: 3 };
    return rank[a.kind] - rank[b.kind];
  });

  const groups: TimelineGroup[] = [];
  for (const ev of events) {
    const key = dayKeyOf(ev.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(ev);
    else groups.push({ key, label: monthLabel(ev.at), events: [ev] });
  }

  const times = events.map((e) => new Date(e.at).getTime());
  const oldest = times.length ? Math.min(...times) : null;
  const newest = times.length ? Math.max(...times) : null;

  return {
    groups,
    total: events.length,
    stats: {
      days:
        oldest === null
          ? 0
          : Math.max(1, Math.floor((now.getTime() - oldest) / 86_400_000) + 1),
      visits: consultations.length,
      notes: notes.length,
      meds: medications.length,
      activeMeds: medications.filter((m) => m.isActive).length,
      firstAt: oldest === null ? null : new Date(oldest).toISOString(),
      lastAt: newest === null ? null : new Date(newest).toISOString(),
    },
  };
}

/** 时间轴左侧的日期列：10.26 */
export function axisDay(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

/** 同一天第二条起不重复写日期 */
export function axisTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
