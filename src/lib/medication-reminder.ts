/**
 * 用药提醒的两段文案（纯函数，不碰数据库、不调模型）。
 *
 * 生成规则完全按需求里的模板来，语气温和、不出现任何医疗建议或诊断：
 *  1. 站内通知 ≤ 30 字，一句话说清「吃什么、吃多少、饭前还是饭后」
 *  2. 邮件正文 ≤ 80 字，多一行问候 + 疗程进度
 *  3. 连续漏服 ≥ 2 次时，邮件里追加一句关怀（不进站内通知）
 *
 * 长度统一按「字符数」算（`Array.from`，emoji 只算一个），换行不算。
 */

export type MealTiming = "before" | "after" | "any";

export interface ReminderFacts {
  drugName: string;
  dosage?: string | null;
  /** 24 小时制 "08:00"，只在站内通知里可选地带上 */
  timeOfDay?: string | null;
  mealTiming?: string | null;
  /** 今天是疗程第几天（从 1 开始）；不知道就传 null */
  courseDay?: number | null;
  /** 还剩几天（含今天）；不知道就传 null */
  remainingDays?: number | null;
  /** 连续漏服几次（只数已经过去的日期） */
  missedStreak?: number;
}

export const NOTICE_MAX = 30;
export const EMAIL_MAX = 80;
export const MISSED_THRESHOLD = 2;

/** 连续漏服时追加的那句，需求里给的原文 */
export const CARE_LINE = "最近两次未打卡，记得按时服药哦，身体最重要～";

/** 「如有不适」这句是需求模板自带的提醒，不属于医疗建议 */
const SAFETY_LINE = "如有不适请及时就医。";

/* ------------------------------------------------------------------ 工具 */

export function charCount(text: string): number {
  // 换行不计入字数：排版用的，不是内容
  return Array.from(text.replace(/\n/g, "")).length;
}

function clean(text: string | null | undefined): string {
  return (text ?? "").trim();
}

/** 饭前 / 饭后 / 不限（不限就不提，别硬写"记得服用"以外的词） */
export function mealLabel(mealTiming: string | null | undefined): string {
  if (mealTiming === "before") return "饭前";
  if (mealTiming === "after") return "饭后";
  return "";
}

/* -------------------------------------------------------------- 站内通知 */

/**
 * ≤30 字，简洁直接。按信息量从多到少准备几档，取第一档放得下的：
 * 「药名 + 剂量 + 饭前饭后」→「药名 + 饭前饭后」→「药名」。
 */
export function buildNotice(facts: ReminderFacts): string {
  const name = clean(facts.drugName) || "药";
  const dose = clean(facts.dosage);
  const meal = mealLabel(facts.mealTiming);

  const options: string[] = [];
  if (dose && meal) options.push(`💊 该吃${name}了，${dose}，记得${meal}服用～`);
  if (meal) options.push(`💊 该吃${name}了，记得${meal}服用～`);
  if (dose) options.push(`💊 该吃${name}了，${dose}～`);
  options.push(`💊 该吃${name}了～`);

  for (const text of options) {
    if (charCount(text) <= NOTICE_MAX) return text;
  }
  return clip(options[options.length - 1], NOTICE_MAX);
}

/* -------------------------------------------------------------- 邮件正文 */

/**
 * ≤80 字，多行、温和。语气上是「提醒」不是「催促」，
 * 不写任何剂量调整、停药、诊断之类的内容。
 */
export function buildEmail(facts: ReminderFacts): string {
  const name = clean(facts.drugName) || "药";
  const dose = clean(facts.dosage);
  const meal = mealLabel(facts.mealTiming);
  const dosePart = [dose, meal].filter(Boolean).join("，");

  const greeting = "您好，";
  const core = dosePart
    ? `提醒您该服用${name}了（${dosePart}）。`
    : `提醒您该服用${name}了。`;

  const day = facts.courseDay ?? null;
  const left = facts.remainingDays ?? null;

  const progressVariants: string[] = [];
  if (day !== null && left !== null && left > 0) {
    progressVariants.push(`今天是疗程第${day}天，还剩${left}天，请按时服药。`);
    progressVariants.push(`疗程第${day}天，还剩${left}天。`);
  } else if (day !== null && left !== null && left <= 0) {
    progressVariants.push(`今天是疗程第${day}天，疗程到今天结束。`);
    progressVariants.push(`今天是疗程最后一天。`);
  } else if (day !== null && day > 1) {
    progressVariants.push(`今天是疗程第${day}天，请按时服药。`);
    progressVariants.push(`疗程第${day}天。`);
  } else {
    progressVariants.push(`请按时服药。`);
  }

  const care = (facts.missedStreak ?? 0) >= MISSED_THRESHOLD ? CARE_LINE : "";

  // 依次尝试：进度写全 → 进度精简 → 不要进度；每档都保证 问候+核心+安全 在里面
  const attempts: string[][] = [];
  for (const progress of progressVariants) {
    attempts.push([greeting, core, progress, care, SAFETY_LINE]);
    attempts.push([greeting, core, progress, SAFETY_LINE, care]);
  }
  attempts.push([greeting, core, care, SAFETY_LINE]);
  attempts.push([greeting, core, SAFETY_LINE]);

  let best = "";
  for (const lines of attempts) {
    const text = lines.map(clean).filter(Boolean).join("\n");
    if (charCount(text) <= EMAIL_MAX) return text;
    if (!best) best = text;
  }
  return clip(best, EMAIL_MAX);
}

/** 超长时按字符截断并加省略号（正常情况走不到） */
function clip(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max - 1).join("")}…`;
}

/* ------------------------------------------------------------ 一起生成 */

export interface ReminderTexts {
  notice: string;
  email: string;
  noticeChars: number;
  emailChars: number;
  /** 是否追加了「连续漏服」的关怀句 */
  careAdded: boolean;
}

export function buildReminder(facts: ReminderFacts): ReminderTexts {
  const notice = buildNotice(facts);
  const email = buildEmail(facts);
  return {
    notice,
    email,
    noticeChars: charCount(notice),
    emailChars: charCount(email),
    careAdded: (facts.missedStreak ?? 0) >= MISSED_THRESHOLD,
  };
}
