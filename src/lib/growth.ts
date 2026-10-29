import { prisma } from "./db";

export type GrowthDTO = {
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

const DAY = 24 * 60 * 60 * 1000;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 周一作为一周的起点（UTC，避免服务器时区把日期算错一天） */
function startOfWeek(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const offset = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - offset);
  return x;
}

/**
 * 成长数据：全部基于该账号自己的患者，不跨账号聚合。
 * 这里不做缓存，数据量小（一个人几十条记录），实时算更简单也更准。
 */
export async function getGrowth(ownerId: string): Promise<GrowthDTO> {
  const patients = await prisma.patient.findMany({
    where: { ownerId },
    select: { id: true },
  });
  const patientIds = patients.map((p) => p.id);
  const scope = { patientId: { in: patientIds } };

  if (patientIds.length === 0) {
    return {
      patients: 0,
      consultations: 0,
      activeConsultations: 0,
      messages: 0,
      notes: 0,
      favorites: 0,
      activeDays: 0,
      streak: 0,
      weekly: buildWeekly([]),
      firstActivityAt: null,
    };
  }

  const [consultations, activeConsultations, messages, notes, favorites, cRows, nRows, mRows] =
    await Promise.all([
      prisma.consultation.count({ where: scope }),
      prisma.consultation.count({ where: { ...scope, status: "active" } }),
      prisma.message.count({ where: { consultation: scope } }),
      prisma.note.count({ where: scope }),
      prisma.note.count({ where: { ...scope, isFavorite: true } }),
      prisma.consultation.findMany({
        where: scope,
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.note.findMany({
        where: scope,
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.message.findMany({
        where: { consultation: scope },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

  const allTimes = [
    ...cRows.map((r) => r.createdAt),
    ...nRows.map((r) => r.createdAt),
    ...mRows.map((r) => r.createdAt),
  ].sort((a, b) => a.getTime() - b.getTime());

  const days = new Set(allTimes.map(dayKey));

  // 连续天数：今天有记录就从今天数，今天没有就从昨天数（允许"今天还没来"）
  let streak = 0;
  const cursor = new Date();
  if (!days.has(dayKey(cursor))) cursor.setTime(cursor.getTime() - DAY);
  for (;;) {
    if (!days.has(dayKey(cursor))) break;
    streak += 1;
    cursor.setTime(cursor.getTime() - DAY);
  }

  return {
    patients: patientIds.length,
    consultations,
    activeConsultations,
    messages,
    notes,
    favorites,
    activeDays: days.size,
    streak,
    weekly: buildWeekly(cRows.map((r) => r.createdAt)),
    firstActivityAt: allTimes.length ? allTimes[0].toISOString() : null,
  };
}

/** 近 8 周（含本周）的问诊次数 */
function buildWeekly(times: Date[]): { weekStart: string; count: number }[] {
  const thisWeek = startOfWeek(new Date());
  const buckets: { weekStart: string; count: number }[] = [];

  for (let i = 7; i >= 0; i -= 1) {
    const start = new Date(thisWeek.getTime() - i * 7 * DAY);
    const end = new Date(start.getTime() + 7 * DAY);
    const count = times.filter((t) => t >= start && t < end).length;
    buckets.push({ weekStart: dayKey(start), count });
  }
  return buckets;
}
