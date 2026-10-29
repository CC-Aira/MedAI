/**
 * 用药排程与依从性（纯函数）。
 *
 * 这里只做一件简单的事：一天一次。`frequency` 是自由文本（"每日一次""每晚一次"都有人写），
 * 与其去解析它，不如按「一天一次 + timeOfDay 时间点」处理 —— 对提醒文案来说已经够用，
 * 也不会因为写了个奇怪的频次就整条记录算不出进度。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 连续漏服最多往回数几天。
 *
 * 原来是 30 天，结果一条两个月前建档、从来没打过卡的药会被算成
 * 「连续漏服 24 次」—— 数字吓人，而且对提醒毫无指导意义：
 * 一周以前的漏服已经改不了了，该说的是「这几天」。
 */
const MISS_LOOKBACK_DAYS = 7;

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 本地日期键 YYYY-MM-DD，用来跨时区比较「哪一天」 */
export function dayKey(d: Date): string {
  const x = startOfLocalDay(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(
    x.getDate(),
  ).padStart(2, "0")}`;
}

export function shiftDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

function diffDays(from: Date, to: Date): number {
  return Math.round((startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime()) / DAY_MS);
}

export interface MedScheduleInput {
  startDate: Date | null;
  endDate: Date | null;
  courseDays: number | null;
  createdAt: Date;
}

export interface MedLogLike {
  scheduledFor: Date;
  takenAt: Date | null;
  status: string;
}

export interface MedSchedule {
  /** 今天是疗程第几天；完全不知道起始日就是 null */
  courseDay: number | null;
  /** 还剩几天（含今天）；没设结束就是 null */
  remainingDays: number | null;
  /** 今天打过卡没有 */
  todayTaken: boolean;
  /** 连续漏服几次（只数已经过去的日期，最多往回数 30 天） */
  missedStreak: number;
}

/**
 * 起始日：优先 startDate，没填就用创建那天 —— 否则一个"今天刚加的"药会立刻被判成漏服。
 */
function anchorDay(med: MedScheduleInput): Date {
  return startOfLocalDay(med.startDate ?? med.createdAt);
}

export function computeSchedule(
  med: MedScheduleInput,
  logs: MedLogLike[],
  now: Date = new Date(),
): MedSchedule {
  const today = startOfLocalDay(now);
  const anchor = anchorDay(med);

  const takenDays = new Set<string>();
  for (const log of logs) {
    if (log.status === "taken" || log.status === "skipped") {
      takenDays.add(dayKey(log.scheduledFor));
    }
  }

  // 疗程第几天：从起始日算，最小 1
  const courseDay = Math.max(1, diffDays(anchor, today) + 1);

  // 总天数：优先手填的 courseDays，其次 startDate ~ endDate
  let totalDays: number | null = null;
  if (med.courseDays && med.courseDays > 0) totalDays = med.courseDays;
  else if (med.startDate && med.endDate) totalDays = diffDays(med.startDate, med.endDate) + 1;

  const remainingDays = totalDays === null ? null : Math.max(0, totalDays - courseDay + 1);

  // 今天
  const todayTaken = takenDays.has(dayKey(today));

  // 连续漏服：从昨天往回走，遇到打卡过的一天就停。
  // 封顶 MISS_LOOKBACK_DAYS 天 —— 只数"最近这段"，不把陈年老账翻出来。
  let missedStreak = 0;
  for (let i = 1; i <= MISS_LOOKBACK_DAYS; i++) {
    const day = shiftDays(today, -i);
    if (day.getTime() < anchor.getTime()) break;
    if (takenDays.has(dayKey(day))) break;
    missedStreak += 1;
  }

  return { courseDay, remainingDays, todayTaken, missedStreak };
}

/* ------------------------------------------------------------- 展示用的时间 */

/** "08:00" → "08:00"；不合法返回 null */
export function normalizeTimeOfDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/** 时间点 + 饭前饭后，拼成一行给界面看 */
export function scheduleLabel(timeOfDay: string | null, meal: string | null): string {
  const parts: string[] = [];
  if (timeOfDay) parts.push(timeOfDay);
  if (meal === "before") parts.push("饭前");
  if (meal === "after") parts.push("饭后");
  return parts.join(" · ");
}
