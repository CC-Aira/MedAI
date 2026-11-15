import { prisma } from "./db";
import { retrieveKnowledge, type KnowledgeDoc } from "./rag";
import { dayKey, startOfLocalDay } from "./medication-schedule";

/**
 * 模型的工具箱。
 *
 * 五个工具的分工是刻意的：档案正文已经在 system 里，模型不需要"再读一遍"；
 * 所以这里只放**对话当时拿不到、必须现查**的东西 —— 今天的服药状态、
 * 最近几天的依从率、科普库检索、药物安全核对、历史问诊回顾。
 *
 * 所有执行器都只读、都带 patientId 限定，越权在这里就从 SQL 层挡掉。
 * 出任何错都返回一段 JSON 说明，绝不抛异常：一次工具失败不该让整轮问诊挂掉。
 */

export type ToolContext = {
  ownerId: string;
  patientId: string;
};

export type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/** 前端显示用的人话标签 */
export const TOOL_LABELS: Record<string, string> = {
  search_knowledge: "检索科普库",
  get_today_medications: "查询今日用药",
  get_medication_adherence: "核对服药记录",
  check_drug_safety: "核对药物安全",
  get_consult_history: "回顾历史问诊",
};

export const CONSULT_TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description:
        "在平台自建的科普库里检索疾病或药品说明（共 163 条，人工整理、带出处）。当用户问到某个病的表现、注意事项、检查项目，或某个药怎么吃、有什么禁忌、漏服怎么办时调用。回答里引用检索结果要标上编号。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "检索词，用用户说的病名、药名或症状，例如「偏头痛 恶心」「阿莫西林 过敏」",
          },
          kind: {
            type: "string",
            enum: ["disease", "drug", "all"],
            description: "只查疾病、只查药品，或都查。不确定就填 all",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_today_medications",
      description:
        "查询这位患者今天的用药安排和打卡状态：几点该吃、吃了没有、有没有已经过点的。用户问「今天吃药了吗」「现在该吃什么」时调用。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_medication_adherence",
      description:
        "统计最近几天的服药依从情况：每种药吃了几天、漏了几天、有没有连续漏服。用户问「我最近有没有按时吃药」「漏了几次」时调用。",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "往回看几天，1~14，默认 7" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_drug_safety",
      description:
        "核对一个药和这位患者的关系：是否与过敏史冲突、是否与正在吃的药有相互作用、有哪些禁忌和风险提示、漏服怎么处理。用户提到任何一个具体药名（在吃、想吃、别人推荐）时都应调用。",
      parameters: {
        type: "object",
        properties: {
          drug_name: { type: "string", description: "药名，通用名或商品名都行" },
        },
        required: ["drug_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_consult_history",
      description:
        "调出这位患者以往几次问诊的小结和结论卡片。用户问「上次说的什么」「之前是不是聊过这个」时调用。",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "取几条，默认 3，最多 6" },
        },
      },
    },
  },
];

/* --------------------------------------------------------- 执行器 */

export type ToolRunResult = {
  /** 回填给模型的 tool 消息内容（JSON 字符串） */
  content: string;
  /** 这次检索到的科普条目，用于回答末尾的出处脚注 */
  docs?: KnowledgeDoc[];
  /** 给前端工具条用的一句话结果摘要 */
  detail?: string;
};

function pack(value: unknown): string {
  return JSON.stringify(value);
}

async function searchKnowledge(
  args: { query?: unknown; kind?: unknown },
  _ctx: ToolContext,
): Promise<ToolRunResult> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const kind =
    args.kind === "disease" || args.kind === "drug" ? args.kind : "all";
  if (!query) return { content: pack({ error: "检索词是空的" }) };

  const hits = retrieveKnowledge(query, { kind, topK: 4, minScore: 2.5 });
  if (hits.length === 0) {
    return {
      content: pack({
        query,
        results: [],
        note: "科普库里没有直接匹配的条目，请基于通用常识回答，并说明这不在科普库覆盖范围内。",
      }),
      detail: "未命中",
    };
  }

  return {
    content: pack({
      query,
      results: hits.map((h) => ({
        title: h.doc.title,
        type: h.doc.kind === "disease" ? "疾病" : "药品",
        subtitle: h.doc.subtitle,
        updatedAt: h.doc.updatedAt,
        points: h.doc.points,
        source: h.doc.source,
      })),
    }),
    docs: hits.map((h) => h.doc),
    detail: `${hits.length} 条`,
  };
}

async function getTodayMedications(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolRunResult> {
  const today = startOfLocalDay(new Date());
  const meds = await prisma.medication.findMany({
    where: { patientId: ctx.patientId, isActive: true },
    select: {
      id: true,
      drugName: true,
      dosage: true,
      frequency: true,
      timeOfDay: true,
      mealTiming: true,
      logs: {
        where: { scheduledFor: today },
        select: { status: true, takenAt: true },
      },
    },
    orderBy: { timeOfDay: "asc" },
  });

  if (meds.length === 0) {
    return {
      content: pack({ today: dayKey(today), medications: [], note: "这位患者目前没有登记在服药物。" }),
      detail: "无在服药物",
    };
  }

  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const list = meds.map((m) => {
    const log = m.logs[0];
    const status = log?.status === "taken" ? "已服" : log?.status === "skipped" ? "已跳过" : "未打卡";
    let overdue = false;
    if (!log && m.timeOfDay) {
      const [h, mi] = m.timeOfDay.split(":").map(Number);
      overdue = (h || 0) * 60 + (mi || 0) < nowMinutes;
    }
    return {
      drugName: m.drugName,
      dosage: m.dosage ?? "",
      frequency: m.frequency ?? "",
      time: m.timeOfDay ?? "未设时间",
      mealTiming: m.mealTiming ?? "",
      status,
      overdue,
    };
  });

  const pending = list.filter((m) => m.status === "未打卡" && m.overdue).length;
  return {
    content: pack({ today: dayKey(today), medications: list, overdueCount: pending }),
    detail: pending > 0 ? `${pending} 项待服` : "都已记录",
  };
}

async function getMedicationAdherence(
  args: { days?: unknown },
  ctx: ToolContext,
): Promise<ToolRunResult> {
  const raw = typeof args.days === "number" ? args.days : 7;
  const days = Math.min(14, Math.max(1, Math.round(raw)));
  const since = new Date(startOfLocalDay(new Date()));
  since.setDate(since.getDate() - (days - 1));

  const meds = await prisma.medication.findMany({
    where: { patientId: ctx.patientId, isActive: true },
    select: {
      drugName: true,
      dosage: true,
      frequency: true,
      startDate: true,
      createdAt: true,
      logs: {
        where: { scheduledFor: { gte: since } },
        select: { scheduledFor: true, status: true },
      },
    },
  });

  if (meds.length === 0) {
    return { content: pack({ days, medications: [], note: "没有在服药物，无法统计依从性。" }) };
  }

  const list = meds.map((m) => {
    const taken = m.logs.filter((l) => l.status === "taken").length;
    const skipped = m.logs.filter((l) => l.status === "skipped").length;
    // 登记在服的每一天都算"应服日"，能算出发病式的漏服数
    const anchor = startOfLocalDay(m.startDate ?? m.createdAt);
    const from = anchor > since ? anchor : since;
    const spanDays = Math.max(1, Math.floor((startOfLocalDay(new Date()).getTime() - from.getTime()) / 86_400_000) + 1);
    const expected = Math.min(days, spanDays);
    return {
      drugName: m.drugName,
      dosage: m.dosage ?? "",
      frequency: m.frequency ?? "",
      expectedDays: expected,
      taken,
      skipped,
      missed: Math.max(0, expected - taken - skipped),
    };
  });

  const totalExpected = list.reduce((s, m) => s + m.expectedDays, 0);
  const totalTaken = list.reduce((s, m) => s + m.taken, 0);
  const rate = totalExpected === 0 ? null : Math.round((totalTaken / totalExpected) * 100);

  return {
    content: pack({ days, overallRate: rate === null ? "无法计算" : `${rate}%`, medications: list }),
    detail: rate === null ? "无记录" : `依从率 ${rate}%`,
  };
}

async function checkDrugSafety(
  args: { drug_name?: unknown },
  ctx: ToolContext,
): Promise<ToolRunResult> {
  const name = typeof args.drug_name === "string" ? args.drug_name.trim() : "";
  if (!name) return { content: pack({ error: "药名是空的" }) };

  const hits = retrieveKnowledge(name, { kind: "drug", topK: 2, minScore: 2 });
  if (hits.length === 0) {
    return {
      content: pack({
        drug: name,
        found: false,
        note: "科普库里没有收录这个药。不要编造说明书内容，只提示用户看实物说明书并咨询医生或药师。",
      }),
      detail: "未收录",
    };
  }

  const [patient, activeMeds] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: ctx.patientId, ownerId: ctx.ownerId },
      select: { allergies: true, chronicDisease: true, age: true },
    }),
    prisma.medication.findMany({
      where: { patientId: ctx.patientId, isActive: true },
      select: { drugName: true, dosage: true },
    }),
  ]);

  const drug = hits[0].doc;
  const allergy = (patient?.allergies ?? "").trim();
  const combined = `${drug.body} ${drug.points.join(" ")}`;

  // 过敏冲突：把过敏史拆成单个过敏原，看药名或说明书正文里有没有出现
  const allergyWarn = allergy.length
    ? splitAllergens(allergy).filter(
        (a) => a.length >= 2 && (combined.includes(a) || name.includes(a)),
      )
    : [];

  // 与在服药物的相互作用：说明书 interactions 里提到对方的通用名就算命中。
  // 先排掉"同一个药"：在服药物往往写成「布洛芬缓释胶囊」，和查的「布洛芬」是两回事。
  const interactionWarn = activeMeds
    .filter((m) => {
      const name2 = m.drugName.trim();
      if (!name2) return false;
      return !(name2.includes(name) || name.includes(name2));
    })
    .filter((m) => combined.includes(m.drugName))
    .map((m) => `${m.drugName}${m.dosage ? `（${m.dosage}）` : ""}`);

  return {
    content: pack({
      drug: {
        name: drug.title,
        subtitle: drug.subtitle,
        contraindications: pickPoints(drug.points, "禁忌"),
        interactions: pickPoints(drug.points, "相互作用"),
        warnings: pickPoints(drug.points, "风险提示"),
        onset: pickPoints(drug.points, "起效时间"),
        missedDose: pickPoints(drug.points, "漏服处理"),
        storage: pickPoints(drug.points, "储存"),
        source: drug.source,
        updatedAt: drug.updatedAt,
      },
      patient: {
        allergies: allergy || "未记录",
        chronicDisease: patient?.chronicDisease ?? "未记录",
        activeMedications: activeMeds.map((m) => `${m.drugName}${m.dosage ? ` ${m.dosage}` : ""}`),
      },
      flags: {
        allergyConflict: allergyWarn,
        interactionCandidates: interactionWarn,
      },
      note:
        "flags 是根据档案做字符串比对得到的「可疑项」，不是诊断结论。有可疑项时必须提示患者找医生或药师确认，不要下判断。",
    }),
    docs: [drug],
    detail: allergyWarn.length || interactionWarn.length ? "发现可疑项" : "未见冲突",
  };
}

async function getConsultHistory(
  args: { limit?: unknown },
  ctx: ToolContext,
): Promise<ToolRunResult> {
  const raw = typeof args.limit === "number" ? args.limit : 3;
  const limit = Math.min(6, Math.max(1, Math.round(raw)));

  const [consultations, notes] = await Promise.all([
    prisma.consultation.findMany({
      where: { patientId: ctx.patientId, summary: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { title: true, summary: true, updatedAt: true },
    }),
    prisma.note.findMany({
      where: { patientId: ctx.patientId },
      orderBy: [{ isFavorite: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: { title: true, content: true, isFavorite: true },
    }),
  ]);

  if (consultations.length === 0 && notes.length === 0) {
    return { content: pack({ consultations: [], notes: [], note: "这位患者还没有历史问诊小结。" }) };
  }

  return {
    content: pack({
      consultations: consultations.map((c) => ({
        title: c.title,
        date: c.updatedAt.toISOString().slice(0, 10),
        summary: c.summary ?? "",
      })),
      notes: notes.map((n) => ({
        title: n.title,
        content: n.content,
        starred: n.isFavorite,
      })),
    }),
    detail: `${consultations.length} 次问诊`,
  };
}

/** 过敏史是用户随手写的：「青霉素过敏（曾出现皮疹）、海鲜」这种都要能拆开 */
function splitAllergens(text: string): string[] {
  return text
    // 括号里一般是补充说明（"曾出现皮疹"），不参与比对
    .replace(/[（(][^）)]*[）)]/g, " ")
    .split(/[、,，;；/\\\s]+|和|及|以及/)
    .map((s) => s.replace(/(过敏史?|不耐受|类药物?)$/g, "").trim())
    .filter((s) => s.length >= 1);
}

function pickPoints(points: string[], prefix: string): string {
  const hit = points.find((p) => p.startsWith(prefix));
  return hit ? hit.slice(prefix.length).replace(/^：/, "") : "";
}

/* --------------------------------------------------------- 调度 */

const EXECUTORS: Record<
  string,
  (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolRunResult>
> = {
  search_knowledge: searchKnowledge as never,
  get_today_medications: getTodayMedications,
  get_medication_adherence: getMedicationAdherence as never,
  check_drug_safety: checkDrugSafety as never,
  get_consult_history: getConsultHistory as never,
};

export async function runTool(
  name: string,
  rawArguments: string,
  ctx: ToolContext,
): Promise<ToolRunResult> {
  const executor = EXECUTORS[name];
  if (!executor) {
    return { content: pack({ error: `没有这个工具：${name}` }) };
  }

  let args: Record<string, unknown> = {};
  if (rawArguments && rawArguments.trim()) {
    try {
      const parsed = JSON.parse(rawArguments) as unknown;
      if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
    } catch {
      // 模型偶尔会给出截断的 JSON：当成空参数继续跑，比整轮失败好
      return { content: pack({ error: "工具参数不是合法 JSON，请用更简单的参数重试" }) };
    }
  }

  try {
    return await executor(args, ctx);
  } catch (err) {
    console.error(`[medai] 工具 ${name} 执行失败`, err);
    return { content: pack({ error: "这个查询暂时没有成功，请基于已有信息回答，并说明这一项没查到" }) };
  }
}
