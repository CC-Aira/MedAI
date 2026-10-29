/**
 * 就诊摘要 —— 一次问诊的"可带走"形态。
 *
 * 为什么要有它：对话再详细，也只是留在屏幕上。患者真正要拿给医生的，
 * 是一张能读懂、能打印、能带进诊室的纸。这张纸同时也是整个系统
 * "AI 到底帮到了什么"的唯一证据链。
 *
 * 两条规矩：
 * 1. 结构固定，字段有限，不随模型心情变化 —— 医生扫一眼就知道该看哪儿；
 * 2. 模型只写"描述性内容"，药物清单、过敏史、红旗记录全部由代码从库里取，
 *    绝不交给模型复述（复述就有编错的可能）。
 */

export type VisitSheet = {
  version: 1;
  /** ai = 模型整理；local = 本地模板（没配 Key 或模型失败时） */
  source: "ai" | "local";
  generatedAt: string;
  /** 主诉：一句话 */
  chiefComplaint: string;
  /** 病程要点：什么时候开始、怎么变化、什么情况下更明显 */
  course: string[];
  /** 对话里明确排除或没有出现的危险信号 */
  ruledOut: string[];
  /** 这次给出的、可以自己做的建议 */
  advice: string[];
  /** 什么情况必须马上去医院 */
  whenToGo: string;
  /** 患者下次可以直接问医生的问题 */
  questions: string[];
  /** 这次问诊里触发过红旗拦截 —— 服务端记的，不经过模型 */
  flags: { labels: string[]; count: number; at: string } | null;
};

/** 各字段的长度上限：纸就一页，写长了医生也不看 */
const MAX = {
  chiefComplaint: 60,
  courseItem: 80,
  course: 5,
  ruledOutItem: 40,
  ruledOut: 3,
  adviceItem: 80,
  advice: 4,
  whenToGo: 120,
  questionsItem: 60,
  questions: 3,
} as const;

/** 本地模板兜底时给的问题：不针对具体病情，但每一句都能当面问出口 */
const DEFAULT_QUESTIONS = [
  "这次的这些表现，可能和哪些因素有关？",
  "需要做哪些检查，大概要多久出结果？",
  "目前在吃的药需要调整吗？会不会互相影响？",
];

function clip(text: unknown, max: number): string {
  if (typeof text !== "string") return "";
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function list(value: unknown, max: number, itemMax: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = clip(item, itemMax);
    // 去重：「多喝温水」写两遍没有意义
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** 压成便于比较的形状：去掉「自述：」这类前缀和所有标点空白 */
function bare(text: string): string {
  return text
    .replace(/^(?:患者|病人)?(?:自述|主诉|说)[：:]\s*/, "")
    .replace(/[\s，。、；：！？,.;:!?"'“”‘’（）()【】]/g, "");
}

/**
 * 两句话是不是在说同一件事。
 *
 * 不能只比全等：模型写主诉「胸口疼，喘不上气」，病程那条常常是
 * 「自述：我胸口疼，喘不上气」—— 多一个「我」，差一个字。
 * 所以短的被长的完整包含、且长度差不太多，就当成同一句。
 */
function sameSaying(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // 太短的话（「头痛」）包含关系太容易撞上，宁可留着
  if (short.length < 4) return false;
  return long.includes(short) && short.length / long.length >= 0.6;
}

/**
 * 病程里跟主诉重复的那条扔出去。
 *
 * 医生扫一眼会以为这纸是凑数的 —— 纸就一页，每行都得有信息。
 */
function dropRepeatOfChief(chief: string, course: string[]): string[] {
  const key = bare(chief);
  if (!key) return course;
  return course.filter((line) => !sameSaying(bare(line), key));
}

/**
 * 把模型吐出来的 JSON 洗成定长结构。
 * 模型多写、少写、写错类型都不会让接口 500 —— 缺的字段按本地模板补齐。
 */
export function normalizeSheet(
  raw: unknown,
  fallback: VisitSheet,
  generatedAt: string,
): VisitSheet {
  if (!raw || typeof raw !== "object") return fallback;
  const v = raw as Record<string, unknown>;

  // 模型什么都没写出来（空对象、全是空数组），就别假装是它整理的 ——
  // 一张标着「AI 整理」却全是默认值的纸，比一张老实说「本地模板」的纸更糟
  const contributed =
    clip(v.chiefComplaint, MAX.chiefComplaint).length > 0 ||
    clip(v.whenToGo, MAX.whenToGo).length > 0 ||
    list(v.course, MAX.course, MAX.courseItem).length > 0 ||
    list(v.ruledOut, MAX.ruledOut, MAX.ruledOutItem).length > 0 ||
    list(v.advice, MAX.advice, MAX.adviceItem).length > 0 ||
    list(v.questions, MAX.questions, MAX.questionsItem).length > 0;
  if (!contributed) return fallback;

  const merged: VisitSheet = {
    version: 1,
    source: "ai",
    generatedAt,
    chiefComplaint: clip(v.chiefComplaint, MAX.chiefComplaint) || fallback.chiefComplaint,
    course: list(v.course, MAX.course, MAX.courseItem),
    ruledOut: list(v.ruledOut, MAX.ruledOut, MAX.ruledOutItem),
    advice: list(v.advice, MAX.advice, MAX.adviceItem),
    whenToGo: clip(v.whenToGo, MAX.whenToGo),
    questions: list(v.questions, MAX.questions, MAX.questionsItem),
    flags: fallback.flags,
  };

  // 模型漏写的部分用本地模板补齐，保证每个区块都有东西可看
  if (merged.course.length === 0) merged.course = fallback.course;
  if (merged.questions.length === 0) merged.questions = fallback.questions;

  // 补齐之后再去重：补进来的那条也可能就是主诉
  merged.course = dropRepeatOfChief(merged.chiefComplaint, merged.course);

  return merged;
}

/** 本地模板：不调模型，只把已经存在的东西排好 */
export function buildLocalSheet(input: {
  patient: {
    name: string;
    chiefComplaint: string | null;
    allergies: string | null;
  };
  title: string;
  /** 用户自己说过的话，按时间先后 */
  userSays: string[];
  flags: VisitSheet["flags"];
  generatedAt: string;
}): VisitSheet {
  const chief =
    clip(input.patient.chiefComplaint, MAX.chiefComplaint) ||
    clip(input.title, MAX.chiefComplaint) ||
    "（还没填主诉）";

  // 主诉常常就是用户的第一句话，所以病程里那句要剔掉，不然一张纸说两遍
  const said = dropRepeatOfChief(
    chief,
    input.userSays.map((s) => clip(s, MAX.courseItem - 3)).filter(Boolean),
  ).slice(0, MAX.course);

  return {
    version: 1,
    source: "local",
    generatedAt: input.generatedAt,
    chiefComplaint: chief,
    course: said.map((s) => `自述：${s}`),
    ruledOut: input.flags
      ? []
      : ["对话里没有出现胸痛、呼吸困难、意识不清、大出血这类信号"],
    advice: [],
    whenToGo: "",
    questions: [...DEFAULT_QUESTIONS].slice(0, MAX.questions),
    flags: input.flags,
  };
}

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

/** 2026.10.26（周一）19:15 */
export function sheetTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}（周${
    WEEK[d.getDay()]
  }）${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 纯文本版：复制到微信、备忘录、挂号 App 的备注里都能看。
 * 顺序和纸上一致，读的人不用来回跳。
 */
export function sheetText(
  sheet: VisitSheet,
  patient: {
    name: string;
    gender: string;
    age: number | null;
    allergies?: string | null;
    chronicDisease?: string | null;
  },
  meds: { drugName: string; dosage: string | null; frequency: string | null }[],
): string {
  const lines: string[] = [];
  const age = patient.age != null ? `${patient.age} 岁` : "";
  const gender = patient.gender === "male" ? "男" : patient.gender === "female" ? "女" : "";

  lines.push(`就诊摘要 · ${patient.name}`);
  lines.push([gender, age, sheetTime(sheet.generatedAt)].filter(Boolean).join(" · "));
  lines.push("");

  lines.push("【主诉】");
  lines.push(sheet.chiefComplaint);
  lines.push("");

  if (sheet.course.length) {
    lines.push("【病程】");
    sheet.course.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push("");
  }

  if (sheet.flags) {
    lines.push("【需要立即就医的信号】");
    lines.push(
      `问诊中出现过：${sheet.flags.labels.join("、")}（${sheetTime(sheet.flags.at)} 已提示就医）`,
    );
    lines.push("");
  } else if (sheet.ruledOut.length) {
    lines.push("【已排除】");
    sheet.ruledOut.forEach((s) => lines.push(`· ${s}`));
    lines.push("");
  }

  const active = meds.filter((m) => m.drugName.trim());
  if (active.length) {
    lines.push("【在服药物】");
    active.forEach((m) => {
      const bits = [m.dosage, m.frequency].filter(Boolean).join(" ");
      lines.push(`· ${m.drugName}${bits ? ` ${bits}` : ""}`);
    });
    lines.push("");
  }

  // 过敏史不能只留在屏幕上。复制到微信 / 挂号备注之后医生同样要看到，
  // 否则这份文字版反而比不写更危险 —— 读的人会以为「没提到就是没有」。
  lines.push(`【过敏史】${patient.allergies?.trim() || "未记录"}`);
  if (patient.chronicDisease?.trim()) {
    lines.push(`【既往病史】${patient.chronicDisease.trim()}`);
  }
  lines.push("");

  if (sheet.advice.length) {
    lines.push("【这次可以先做的】");
    sheet.advice.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push("");
  }

  if (sheet.whenToGo) {
    lines.push("【什么时候必须去医院】");
    lines.push(sheet.whenToGo);
    lines.push("");
  }

  if (sheet.questions.length) {
    lines.push("【想问医生】");
    sheet.questions.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push("");
  }

  lines.push(
    sheet.source === "ai"
      ? "—— 由 MedAI 根据这次问诊整理，患者已核对。不是诊断，不含处方建议。"
      : "—— 由 MedAI 按档案和对话原文整理（未使用模型）。不是诊断，不含处方建议。",
  );
  return lines.join("\n");
}
