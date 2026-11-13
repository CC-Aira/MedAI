import { prisma } from "./db";

/**
 * 管理员后台的统计聚合。
 *
 * 隐私边界（这是本文件最重要的约束）：
 * 这里**只做聚合和元数据**，绝不返回任何对话原文、附件正文、病历细节。
 * 管理员能看到的用户健康内容上限是"AI 生成的问诊小结标题 + 摘要"，
 * 站内聊天消息只统计条数，不统计内容。
 */

const DAY = 24 * 60 * 60 * 1000;

export type AdminOverview = {
  /** 平台注册的普通用户数（不含管理员） */
  users: number;
  /** 近 7 天新注册 */
  newUsers7d: number;
  patients: number;
  consultations: number;
  activeConsultations: number;
  archivedConsultations: number;
  messages: number;
  attachments: number;
  notes: number;
  /** 触发过红旗拦截的问诊数 */
  redFlagConsultations: number;
  /** 红旗拦截总次数 */
  redFlagCount: number;
  /** 有在服药物的患者数 */
  patientsOnMedication: number;
  /** 今日打卡完成率（0~1），没有可打卡项时为 null */
  adherenceToday: number | null;
  /** 近 30 天问诊次数 */
  consultations30d: number;
  /** 平台首次有数据的时间 */
  since: string | null;
};

export type TrendPoint = { date: string; consultations: number; messages: number };

export type UserRow = {
  id: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
  /** 账号是否被停用 */
  disabled: boolean;
  patients: number;
  consultations: number;
  messages: number;
  notes: number;
  /** 最近一次问诊的时间 */
  lastConsultationAt: string | null;
  /** 最近一次问诊的标题（不含正文） */
  lastConsultationTitle: string | null;
};

export type ConsultationRow = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  patientName: string;
  ownerEmail: string;
  /** 患者档案里的主诉（症状输入） */
  chiefComplaint: string | null;
  /** 推断科室 */
  department: string;
  /** AI 生成的小结；没有就是 null。不含对话原文。 */
  summary: string | null;
  /** 触发过的红旗类型标签 */
  redFlagLabels: string[];
  redFlagCount: number;
};

export type DepartmentSlice = { name: string; count: number };

/** AI 效果指标：全部是可从数据里算出来的比例，不做主观打分 */
export type AiMetrics = {
  /** 有 AI 回复的对话占比 = 至少一条 assistant 消息的会话 / 全部会话 */
  answerRate: number;
  /** 生成了小结的会话占比（小结 = 用户认可这次对话值得留下） */
  summaryRate: number;
  /** 资料识别成功率 = 读出正文或视觉描述的附件 / 全部附件 */
  attachExtractRate: number;
  /** 用户主动编辑过提问的会话占比 —— 编辑通常意味着 AI 没听懂 */
  editRate: number;
  /** 平均每个会话的往返轮数 */
  avgTurns: number;
  /** 红旗拦截次数（每次都意味着模型之外的安全兜底生效） */
  redFlagCount: number;
  /** 分诊归类的覆盖率：能分到科室的会话占比 */
  triageCoverage: number;
  /** 用户沉淀结论卡片的会话占比（追问"采纳"的可观测代理） */
  noteRate: number;
};

export type AdminStats = {
  overview: AdminOverview;
  trend: TrendPoint[];
  users: UserRow[];
  consultations: ConsultationRow[];
  /** 各类型附件数量：image / pdf / docx / text */
  attachmentKinds: { kind: string; count: number }[];
  /** 最近 30 天每日活跃用户数（当天有过消息的用户） */
  activeUsers: { date: string; count: number }[];
  /** 分科分布（按问诊标题/主诉关键词推断） */
  departments: DepartmentSlice[];
  ai: AiMetrics;
};

function dayKey(d: Date): string {
  // 后台按北京时间的"天"看统计，否则凌晨的数据会算到前一天
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

function startOfDayLocal(d: Date): Date {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  return t;
}

/** 解析 Consultation.redFlag 里存的红旗日志，失败就当没有 */
function readRedFlag(raw: string | null): { labels: string[]; count: number } {
  if (!raw) return { labels: [], count: 0 };
  try {
    const v = JSON.parse(raw) as { labels?: unknown; count?: unknown };
    return {
      labels: Array.isArray(v.labels)
        ? v.labels.filter((x): x is string => typeof x === "string")
        : [],
      count: typeof v.count === "number" ? v.count : 0,
    };
  } catch {
    return { labels: [], count: 0 };
  }
}

/**
 * 按标题 / 主诉 / 年龄粗分科室。
 *
 * 这是**推断**，不是模型分诊：平台没有让用户选科室，也没有把分诊结果落库。
 * 后台要知道"大家主要在问哪类问题"，关键词归类足够用；页面上会标明口径，
 * 不能让人误以为这是精确的科室统计。
 */
const DEPT_RULES: { name: string; words: string[] }[] = [
  { name: "儿科", words: ["儿童", "小孩", "孩子", "宝宝", "婴儿", "幼儿"] },
  { name: "妇科", words: ["月经", "经期", "痛经", "白带", "孕", "产检", "乳腺"] },
  { name: "皮肤科", words: ["皮疹", "瘙痒", "湿疹", "荨麻疹", "痘", "斑", "脱发", "皮肤"] },
  { name: "骨科", words: ["膝", "腰", "颈", "肩", "关节", "扭伤", "骨折", "腿", "脚", "背"] },
  { name: "呼吸科", words: ["咳", "喘", "咽", "鼻", "痰", "发热", "感冒", "气短"] },
  { name: "消化科", words: ["腹", "胃", "恶心", "呕", "腹泻", "便秘", "胆", "肝", "反酸"] },
  { name: "心血管科", words: ["血压", "心悸", "胸", "血脂", "心率", "冠"] },
  { name: "神经内科", words: ["头痛", "头晕", "失眠", "麻", "偏头痛", "记忆"] },
  { name: "内分泌科", words: ["血糖", "甲状腺", "糖尿", "激素", "体重"] },
];

function guessDepartment(
  title: string,
  complaint: string | null | undefined,
  age: number | null | undefined,
): string {
  // 14 岁以下直接归儿科：比关键词更可靠
  if (typeof age === "number" && age > 0 && age <= 14) return "儿科";

  const text = `${title} ${complaint ?? ""}`;
  for (const rule of DEPT_RULES) {
    if (rule.words.some((w) => text.includes(w))) return rule.name;
  }
  return "其他";
}

/**
 * 一次把后台要用的都算出来。
 *
 * 数据量是"一个演示/小规模平台"的量级，全部实时算，不做缓存 ——
 * 管理层要看到的数字必须是最新的，缓存的收益抵不上"数字对不上"的代价。
 */
export async function getAdminStats(): Promise<AdminStats> {
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since7 = new Date(now.getTime() - 7 * DAY);

  const [
    usersRaw,
    patientRows,
    consultationRows,
    messageCount,
    attachmentRows,
    noteCount,
    medicationRows,
    logRows,
    sinceRow,
    roleGroups,
    editedGroups,
    noteGroups,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: ["user"] } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        lastLoginAt: true,
        disabled: true,
      },
    }),
    prisma.patient.findMany({
      select: { id: true, ownerId: true, age: true, chiefComplaint: true },
    }),
    prisma.consultation.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        summary: true,
        redFlag: true,
        createdAt: true,
        updatedAt: true,
        patientId: true,
        patient: {
          select: {
            name: true,
            age: true,
            chiefComplaint: true,
            ownerId: true,
            owner: { select: { email: true } },
          },
        },
        _count: { select: { messages: true } },
      },
    }),
    prisma.message.count(),
    prisma.attachment.findMany({ select: { kind: true, createdAt: true, text: true, visionText: true } }),
    prisma.note.count(),
    prisma.medication.findMany({
      where: { isActive: true, patient: { owner: { role: "user" } } },
      select: { id: true, patientId: true },
    }),
    prisma.medicationLog.findMany({
      where: { scheduledFor: { gte: startOfDayLocal(now) } },
      select: { status: true },
    }),
    prisma.patient.findFirst({
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    // AI 效果指标要按会话拆开看用户/助手各自的条数
    prisma.message.groupBy({
      by: ["consultationId", "role"],
      _count: { _all: true },
    }),
    prisma.message.groupBy({
      by: ["consultationId"],
      where: { editedAt: { not: null } },
      _count: { _all: true },
    }),
    prisma.note.groupBy({
      by: ["consultationId"],
      where: { consultationId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  /* ---------------------------------------------------------- 总览 */

  const patientIdsByOwner = new Map<string, string[]>();
  for (const p of patientRows) {
    const list = patientIdsByOwner.get(p.ownerId) ?? [];
    list.push(p.id);
    patientIdsByOwner.set(p.ownerId, list);
  }

  const ownerIdByPatient = new Map(patientRows.map((p) => [p.id, p.ownerId]));
  const consultationsByOwner = new Map<string, number>();
  for (const c of consultationRows) {
    const ownerId = ownerIdByPatient.get(c.patientId);
    if (!ownerId) continue;
    consultationsByOwner.set(ownerId, (consultationsByOwner.get(ownerId) ?? 0) + 1);
  }

  // 每个账号的消息条数：按 consultation → patient → owner 汇总
  const messagesByConsultation = new Map(
    consultationRows.map((c) => [c.id, c._count.messages]),
  );
  const messagesByOwner = new Map<string, number>();
  for (const c of consultationRows) {
    const ownerId = ownerIdByPatient.get(c.patientId);
    if (!ownerId) continue;
    messagesByOwner.set(
      ownerId,
      (messagesByOwner.get(ownerId) ?? 0) + (messagesByConsultation.get(c.id) ?? 0),
    );
  }

  let redFlagConsultations = 0;
  let redFlagCount = 0;
  for (const c of consultationRows) {
    const flag = readRedFlag(c.redFlag);
    if (flag.count > 0) {
      redFlagConsultations += 1;
      redFlagCount += flag.count;
    }
  }

  const patientsOnMedication = new Set(medicationRows.map((m) => m.patientId)).size;

  // 今日依从率：已打卡 / 今日应打卡。没有在服药物时为 null，不是 0 ——
  // 0 会被误读成"所有人都漏服了"
  const takenToday = logRows.filter((r) => r.status === "taken").length;
  const adherenceToday =
    logRows.length > 0 ? Math.round((takenToday / logRows.length) * 100) / 100 : null;

  /* ---------------------------------------------------------- 趋势 */

  const trendMap = new Map<string, { consultations: number; messages: number }>();
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * DAY);
    trendMap.set(dayKey(d), { consultations: 0, messages: 0 });
  }
  for (const c of consultationRows) {
    const key = dayKey(c.createdAt);
    const bucket = trendMap.get(key);
    if (bucket) bucket.consultations += 1;
  }
  const recentConsultIds = new Set(
    consultationRows.filter((c) => c.createdAt >= since30).map((c) => c.id),
  );
  // 消息按天分布要单独查一次（上面只拿到总数）
  const recentMessages = recentConsultIds.size
    ? await prisma.message.findMany({
        where: { consultationId: { in: [...recentConsultIds] }, createdAt: { gte: since30 } },
        select: { createdAt: true, consultationId: true },
      })
    : [];
  for (const m of recentMessages) {
    const bucket = trendMap.get(dayKey(m.createdAt));
    if (bucket) bucket.messages += 1;
  }
  const trend: TrendPoint[] = [...trendMap.entries()].map(([date, v]) => ({ date, ...v }));

  /* ------------------------------------------------ 活跃用户（30 天） */

  const ownerByConsultation = new Map(
    consultationRows.map((c) => [c.id, ownerIdByPatient.get(c.patientId) ?? ""]),
  );
  const activeByDay = new Map<string, Set<string>>();
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * DAY);
    activeByDay.set(dayKey(d), new Set());
  }
  for (const m of recentMessages) {
    const ownerId = ownerByConsultation.get(m.consultationId);
    if (!ownerId) continue;
    activeByDay.get(dayKey(m.createdAt))?.add(ownerId);
  }
  const activeUsers = [...activeByDay.entries()].map(([date, set]) => ({
    date,
    count: set.size,
  }));

  /* ------------------------------------------------------ 用户列表 */

  const notesByOwner = await prisma.note.groupBy({
    by: ["patientId"],
    _count: { _all: true },
  });
  const noteCountByPatient = new Map(notesByOwner.map((n) => [n.patientId, n._count._all]));
  const notesByOwnerMap = new Map<string, number>();
  for (const [patientId, count] of noteCountByPatient) {
    const ownerId = ownerIdByPatient.get(patientId);
    if (!ownerId) continue;
    notesByOwnerMap.set(ownerId, (notesByOwnerMap.get(ownerId) ?? 0) + count);
  }

  // 每个账号最近一次问诊（按 updatedAt，已经 desc 排好，第一次遇到的就是最近的）
  const lastConsultByOwner = new Map<string, (typeof consultationRows)[number]>();
  for (const c of consultationRows) {
    const ownerId = ownerIdByPatient.get(c.patientId);
    if (!ownerId || lastConsultByOwner.has(ownerId)) continue;
    lastConsultByOwner.set(ownerId, c);
  }

  const users: UserRow[] = usersRaw.map((u) => {
    const last = lastConsultByOwner.get(u.id);
    return {
      id: u.id,
      email: u.email,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      disabled: u.disabled,
      patients: patientIdsByOwner.get(u.id)?.length ?? 0,
      consultations: consultationsByOwner.get(u.id) ?? 0,
      messages: messagesByOwner.get(u.id) ?? 0,
      notes: notesByOwnerMap.get(u.id) ?? 0,
      lastConsultationAt: last ? last.updatedAt.toISOString() : null,
      lastConsultationTitle: last ? last.title : null,
    };
  });

  /* ---------------------------------------------------- 问诊记录列表 */

  const consultations: ConsultationRow[] = consultationRows.map((c) => {
    const flag = readRedFlag(c.redFlag);
    return {
      id: c.id,
      title: c.title,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      messageCount: c._count.messages,
      patientName: c.patient.name,
      ownerEmail: c.patient.owner.email,
      chiefComplaint: c.patient.chiefComplaint,
      department: guessDepartment(c.title, c.patient.chiefComplaint, c.patient.age),
      summary: c.summary,
      redFlagLabels: flag.labels,
      redFlagCount: flag.count,
    };
  });

  /* -------------------------------------------------------- 附件画像 */

  const kindMap = new Map<string, number>();
  for (const a of attachmentRows) {
    kindMap.set(a.kind, (kindMap.get(a.kind) ?? 0) + 1);
  }
  const attachmentKinds = [...kindMap.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);

  /* ---------------------------------------------------------- 分科分布 */

  const deptMap = new Map<string, number>();
  for (const c of consultationRows) {
    const dept = guessDepartment(c.title, c.patient.chiefComplaint, c.patient.age);
    deptMap.set(dept, (deptMap.get(dept) ?? 0) + 1);
  }
  const departments: DepartmentSlice[] = [...deptMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  /* ------------------------------------------------------- AI 效果指标 */

  const userMsgs = new Map<string, number>();
  const assistantMsgs = new Map<string, number>();
  for (const g of roleGroups) {
    const target = g.role === "assistant" ? assistantMsgs : userMsgs;
    target.set(g.consultationId, g._count._all);
  }
  const editedConsults = new Set(editedGroups.map((g) => g.consultationId));
  const consultWithNotes = new Set(noteGroups.map((g) => g.consultationId));

  const total = Math.max(1, consultationRows.length);
  const withAnswer = consultationRows.filter((c) => (assistantMsgs.get(c.id) ?? 0) > 0).length;
  const withSummary = consultationRows.filter((c) => (c.summary ?? "").trim().length > 0).length;
  const edited = consultationRows.filter((c) => editedConsults.has(c.id)).length;
  const withNotes = consultationRows.filter((c) => consultWithNotes.has(c.id)).length;
  const triaged = consultationRows.filter(
    (c) => guessDepartment(c.title, c.patient.chiefComplaint, c.patient.age) !== "其他",
  ).length;
  const turns = consultationRows.reduce((sum, c) => sum + (userMsgs.get(c.id) ?? 0), 0);
  const attachOk = attachmentRows.filter(
    (a) => (a.text ?? "").trim().length > 0 || (a.visionText ?? "").trim().length > 0,
  ).length;

  const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : 0);

  const ai: AiMetrics = {
    answerRate: rate(withAnswer, consultationRows.length),
    summaryRate: rate(withSummary, consultationRows.length),
    attachExtractRate: rate(attachOk, attachmentRows.length),
    editRate: rate(edited, consultationRows.length),
    avgTurns: Math.round((turns / total) * 10) / 10,
    redFlagCount,
    triageCoverage: rate(triaged, consultationRows.length),
    noteRate: rate(withNotes, consultationRows.length),
  };

  return {
    overview: {
      users: usersRaw.length,
      newUsers7d: usersRaw.filter((u) => u.createdAt >= since7).length,
      patients: patientRows.length,
      consultations: consultationRows.length,
      activeConsultations: consultationRows.filter((c) => c.status === "active").length,
      archivedConsultations: consultationRows.filter((c) => c.status === "archived").length,
      messages: messageCount,
      attachments: attachmentRows.length,
      notes: noteCount,
      redFlagConsultations,
      redFlagCount,
      patientsOnMedication,
      adherenceToday,
      consultations30d: consultationRows.filter((c) => c.createdAt >= since30).length,
      since: sinceRow ? sinceRow.createdAt.toISOString() : null,
    },
    trend,
    users,
    consultations,
    attachmentKinds,
    activeUsers,
    departments,
    ai,
  };
}
