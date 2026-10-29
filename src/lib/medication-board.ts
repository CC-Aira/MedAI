/**
 * 「今天的小木牌」——草地上一块插在地里的木牌，写清每个档案今天吃了几次药。
 *
 * 和 `listTodayReminders` 的区别：
 *   - 通知只关心「此刻该不该弹」，一次只要一件事；
 *   - 木牌是给眼睛扫的，要一次看完全家：谁今天几缺几、谁的已经过点了。
 *
 * 只有**真的设了用药跟踪**（在服 + 有吃药时间点 + 疗程没走完）的档案才上榜。
 * 一个药都没设，木牌根本不出现 —— 不拿空牌子占地方。
 *
 * 纯查询 + 纯计算，没有副作用，方便离线测。
 */
import { prisma } from "./db";
import { computeSchedule, dayKey, startOfLocalDay } from "./medication-schedule";
import type { BoardEntry, TodayBoard } from "./client/types";

export type { BoardDose, BoardEntry, TodayBoard } from "./client/types";

/** 空牌子：没设跟踪 */
export const EMPTY_BOARD: TodayBoard = {
  day: "",
  total: 0,
  done: 0,
  overdue: 0,
  entries: [],
};

function minutesOf(timeOfDay: string): number {
  const [h, m] = timeOfDay.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export async function listTodayBoard(
  ownerId: string,
  now: Date = new Date(),
): Promise<TodayBoard> {
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
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // patientId → 聚合
  const byPatient = new Map<string, BoardEntry>();

  for (const med of rows) {
    const timeOfDay = med.timeOfDay;
    if (!timeOfDay) continue;

    const schedule = computeSchedule(med, med.logs, now);
    // 疗程走完的药今天不该再吃，不上榜
    if (schedule.remainingDays === 0) continue;

    const key = med.patient.id;
    let entry = byPatient.get(key);
    if (!entry) {
      entry = {
        patientId: key,
        patientName: med.patient.name,
        total: 0,
        done: 0,
        overdue: 0,
        nextTime: null,
        missedStreak: 0,
        doses: [],
      };
      byPatient.set(key, entry);
    }

    const isOverdue = !schedule.todayTaken && minutesOf(timeOfDay) < nowMinutes;
    entry.total += 1;
    if (schedule.todayTaken) {
      entry.done += 1;
    } else if (isOverdue) {
      entry.overdue += 1;
    } else if (entry.nextTime === null || minutesOf(timeOfDay) < minutesOf(entry.nextTime)) {
      entry.nextTime = timeOfDay;
    }
    entry.doses.push({
      medicationId: med.id,
      drugName: med.drugName,
      timeOfDay,
      done: schedule.todayTaken,
      overdue: isOverdue,
    });
    if (schedule.missedStreak > entry.missedStreak) {
      entry.missedStreak = schedule.missedStreak;
    }
  }

  for (const entry of byPatient.values()) {
    entry.doses.sort((a, b) => a.timeOfDay.localeCompare(b.timeOfDay));
  }

  const entries = [...byPatient.values()].sort((a, b) => {
    // 1. 已经过点的先摆出来（这才是真需要动手的）
    if (a.overdue !== b.overdue) return b.overdue - a.overdue;
    // 2. 都没过点，就看谁还没完成
    const aLeft = a.total - a.done;
    const bLeft = b.total - b.done;
    if (aLeft !== bLeft) return bLeft - aLeft;
    // 3. 最后按名字，保证每次刷新顺序一致，不会自己跳来跳去
    return a.patientName.localeCompare(b.patientName, "zh-Hans-CN");
  });

  return {
    day: dayKey(today),
    total: entries.reduce((sum, e) => sum + e.total, 0),
    done: entries.reduce((sum, e) => sum + e.done, 0),
    overdue: entries.reduce((sum, e) => sum + e.overdue, 0),
    entries,
  };
}
