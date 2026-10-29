/**
 * 「今天此刻该提醒哪些药」——浏览器通知的数据源。
 *
 * 和提醒文案不同，这里要回答的是一个时间问题：**现在**该不该弹。
 * 判定三条：在服、设了时间点、今天还没打卡；再套一个宽限窗口，
 * 免得晚上十点还弹早上八点的药。
 *
 * 纯查询 + 纯计算，没有副作用，方便离线测。
 */
import { prisma } from "./db";
import { buildReminder } from "./medication-reminder";
import {
  computeSchedule,
  dayKey,
  startOfLocalDay,
} from "./medication-schedule";

/**
 * 时间点过去多久之内还算「该吃了」。
 * 3 小时够覆盖「忙着忘了、午休起来」的常见情况；
 * 再久就不该弹了 —— 一条迟到 8 小时的通知只会让人烦躁。
 */
export const GRACE_MINUTES = 180;

/** 提前多久把还没到点的药告诉前端（用来显示「下一个 14:30」这类提示） */
const UPCOMING_MINUTES = 12 * 60;

export interface DueMedication {
  medicationId: string;
  patientId: string;
  patientName: string;
  drugName: string;
  dosage: string | null;
  timeOfDay: string;
  mealTiming: string | null;
  /** 打磨好的站内通知文案（≤30 字），直接当通知正文用 */
  notice: string;
  /** 时间点已经过去几分钟 */
  minutesLate: number;
  courseDay: number | null;
  remainingDays: number | null;
}

export interface UpcomingMedication {
  medicationId: string;
  patientId: string;
  patientName: string;
  drugName: string;
  timeOfDay: string;
  /** 还有几分钟到点 */
  minutesUntil: number;
}

export interface TodayReminders {
  /** 服务器时间，前端用它校准本地时钟偏差 */
  now: string;
  /** 本地日期键 YYYY-MM-DD，用来做「今天已经提醒过」的去重 */
  day: string;
  graceMinutes: number;
  due: DueMedication[];
  upcoming: UpcomingMedication[];
}

/** "08:00" + 某一天 → 那一刻的本地时间 */
function atTimeOfDay(day: Date, timeOfDay: string): Date {
  const [hour, minute] = timeOfDay.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
}

export async function listTodayReminders(
  ownerId: string,
  now: Date = new Date(),
): Promise<TodayReminders> {
  const rows = await prisma.medication.findMany({
    where: {
      isActive: true,
      timeOfDay: { not: null },
      patient: { ownerId },
    },
    include: {
      patient: { select: { id: true, name: true } },
      logs: { orderBy: { scheduledFor: "desc" }, take: 60 },
    },
  });

  const today = startOfLocalDay(now);
  const due: DueMedication[] = [];
  const upcoming: UpcomingMedication[] = [];

  for (const med of rows) {
    const timeOfDay = med.timeOfDay;
    if (!timeOfDay) continue;

    const schedule = computeSchedule(med, med.logs, now);
    // 今天已经打过卡
    if (schedule.todayTaken) continue;
    // remainingDays === 0 表示疗程已经走完，今天不该再吃
    if (schedule.remainingDays === 0) continue;

    const at = atTimeOfDay(today, timeOfDay);
    const minutesLate = Math.round((now.getTime() - at.getTime()) / 60_000);

    if (minutesLate < 0) {
      const minutesUntil = -minutesLate;
      if (minutesUntil <= UPCOMING_MINUTES) {
        upcoming.push({
          medicationId: med.id,
          patientId: med.patient.id,
          patientName: med.patient.name,
          drugName: med.drugName,
          timeOfDay,
          minutesUntil,
        });
      }
      continue;
    }

    // 迟到太久，今天不再提醒（但卡片上仍然显示未打卡）
    if (minutesLate > GRACE_MINUTES) continue;

    const { notice } = buildReminder({
      drugName: med.drugName,
      dosage: med.dosage,
      timeOfDay,
      mealTiming: med.mealTiming,
      courseDay: schedule.courseDay,
      remainingDays: schedule.remainingDays,
      missedStreak: schedule.missedStreak,
    });

    due.push({
      medicationId: med.id,
      patientId: med.patient.id,
      patientName: med.patient.name,
      drugName: med.drugName,
      dosage: med.dosage,
      timeOfDay,
      mealTiming: med.mealTiming,
      notice,
      minutesLate,
      courseDay: schedule.courseDay,
      remainingDays: schedule.remainingDays,
    });
  }

  due.sort((a, b) => a.timeOfDay.localeCompare(b.timeOfDay));
  upcoming.sort((a, b) => a.timeOfDay.localeCompare(b.timeOfDay));

  return {
    now: now.toISOString(),
    day: dayKey(today),
    graceMinutes: GRACE_MINUTES,
    due,
    upcoming,
  };
}
