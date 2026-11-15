import { DISEASES } from "@/data/diseases";
import { DRUGS } from "@/data/drugs";
import { normalize } from "./knowledge-search";

/**
 * 科普库的检索增强（RAG）。
 *
 * 为什么不上向量库：库里只有 163 条人工整理的内容，每条都带名字、别名、
 * 关键词这类结构化字段。中文短查询用 BM25 已经能排得很准，而向量检索要多
 * 一个 embedding 服务和一份索引文件，召回还不一定更好。真正的难点不在"召回
 * 算法"，在"让模型知道自己引用了哪一条" —— 所以每条结果都带编号，
 * 回答里必须标 [1] [2]，前端能看到出处。
 *
 * 检索是纯函数、只在服务端跑：语料在模块加载时建一次索引，之后每次查询
 * 都是内存里的几百次浮点运算。
 */

export type KnowledgeKind = "disease" | "drug";

export type KnowledgeDoc = {
  /** 稳定 id：disease:hypertension / drug:amlodipine */
  id: string;
  kind: KnowledgeKind;
  title: string;
  /** 科室 / 药理分类 */
  subtitle: string;
  aliases: string[];
  keywords: string[];
  /** 检索用全文（不直接进提示词） */
  body: string;
  /** 进提示词的要点，每条一行 */
  points: string[];
  source: string[];
  updatedAt: string;
};

function clean(list: (string | null | undefined)[]): string[] {
  return list.map((v) => (v ?? "").trim()).filter((v) => v.length > 0);
}

function toDiseaseDoc(d: (typeof DISEASES)[number]): KnowledgeDoc {
  const points = clean([
    `概述：${d.summary}`,
    d.symptoms.length ? `常见表现：${d.symptoms.join("；")}` : "",
    d.redFlags.length ? `需要尽快就医：${d.redFlags.join("；")}` : "",
    d.causes.length ? `常见诱因：${d.causes.join("；")}` : "",
    d.prevention.length ? `预防：${d.prevention.join("；")}` : "",
    d.care.length ? `日常照护：${d.care.join("；")}` : "",
    d.checks?.length ? `就医常做的检查：${d.checks.join("；")}` : "",
    d.myths?.length ? `常见误区：${d.myths.join("；")}` : "",
    d.treatment.length ? `治疗思路：${d.treatment.join("；")}` : "",
  ]).slice(0, 8);

  return {
    id: `disease:${d.slug}`,
    kind: "disease",
    title: d.name,
    subtitle: `${d.department} · ${d.tag}`,
    aliases: d.alias,
    keywords: d.keywords,
    body: clean([d.summary, ...d.causes, ...d.symptoms, ...d.redFlags, ...d.prevention, ...d.treatment, ...d.care, ...(d.checks ?? []), ...(d.myths ?? [])]).join(" "),
    points,
    source: d.source,
    updatedAt: d.updatedAt,
  };
}

function toDrugDoc(d: (typeof DRUGS)[number]): KnowledgeDoc {
  const points = clean([
    `分类与成分：${d.category}${d.ingredients ? `；主要成分 ${d.ingredients}` : ""}`,
    d.indications.length ? `适应症：${d.indications.join("；")}` : "",
    d.dosage.length ? `用法用量（科普范围）：${d.dosage.map((x) => `${x.group}：${x.detail}`).join("；")}` : "",
    d.contraindications.length ? `禁忌：${d.contraindications.join("；")}` : "",
    d.adverseReactions.length ? `常见不良反应：${d.adverseReactions.join("；")}` : "",
    d.interactions.length ? `相互作用：${d.interactions.join("；")}` : "",
    d.specialPopulations.length ? `特殊人群：${d.specialPopulations.map((x) => `${x.group}：${x.detail}`).join("；")}` : "",
    d.warnings.length ? `风险提示：${d.warnings.join("；")}` : "",
    d.onset ? `起效时间：${d.onset}` : "",
    d.missedDose ? `漏服处理：${d.missedDose}` : "",
    d.storage ? `储存：${d.storage}` : "",
  ]).slice(0, 10);

  return {
    id: `drug:${d.slug}`,
    kind: "drug",
    title: d.genericName,
    subtitle: `${d.category}${d.otc ? " · OTC" : " · 处方药"}`,
    aliases: d.brandNames,
    keywords: d.keywords,
    body: clean([
      d.category,
      d.ingredients,
      ...d.brandNames,
      ...d.indications,
      ...d.contraindications,
      ...d.interactions,
      ...d.warnings,
      ...d.adverseReactions,
      ...d.keywords,
    ]).join(" "),
    points,
    source: d.source,
    updatedAt: d.updatedAt,
  };
}

/* ------------------------------------------------------------- 分词 */

const HAN = /[\u4e00-\u9fa5]/;

/**
 * 查询里的功能词二元组。这些词在语料里到处都是（「怎么办」「今天」「可以」），
 * 却和医学内容无关 —— 不过滤的话，「今天天气怎么样」能被排出一屏疾病。
 * 只作用于查询端：文档端保留原样，避免把正文里的「可以」也抹掉。
 */
const STOP_BIGRAMS = new Set([
  "怎么", "么样", "什么", "为什", "么办", "该怎", "有没", "可以", "能不",
  "是不", "这个", "那个", "一下", "今天", "明天", "最近", "老是", "总是",
  "帮我", "一首", "请问", "是否", "需要", "一个", "现在", "还是", "然后",
  "但是", "因为", "所以", "如果", "已经", "没有", "有点", "一些", "这么",
]);

function queryTokens(query: string): string[] {
  return [...new Set(tokenize(query))].filter((t) => !STOP_BIGRAMS.has(t));
}


/**
 * 中文没有空格，用「字二元组 + 英文/数字整词」当 token。
 * 「高血压」→ 高血 / 血压，查「血压高」也能命中 血压。
 * 这比单字精确（单字「血」会把血液科、血糖全捞出来），比整句粗粒度召回好。
 */
export function tokenize(text: string): string[] {
  const flat = normalize(text).replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
  const tokens: string[] = [];

  for (let i = 0; i < flat.length - 1; i += 1) {
    const pair = flat.slice(i, i + 2);
    if (HAN.test(pair[0]) && HAN.test(pair[1])) tokens.push(pair);
  }

  for (const word of flat.match(/[a-z0-9]{2,}/g) ?? []) tokens.push(word);
  return tokens;
}

/* ------------------------------------------------------------- 索引 */

type IndexedDoc = {
  doc: KnowledgeDoc;
  /** 字段加权后的词频表：标题 ×3、别名 ×3、关键词 ×2、正文 ×1 */
  tf: Map<string, number>;
  len: number;
  /** 归一化后的标题与别名，用于直接命中加分 */
  exact: string[];
};

const K1 = 1.2;
const B = 0.75;

let INDEX: { docs: IndexedDoc[]; df: Map<string, number>; avgLen: number } | null = null;

function buildIndex() {
  const docs = [
    ...DISEASES.map(toDiseaseDoc),
    ...DRUGS.map(toDrugDoc),
  ];

  const df = new Map<string, number>();
  const indexed: IndexedDoc[] = [];

  for (const doc of docs) {
    const tf = new Map<string, number>();
    const bump = (text: string, times: number) => {
      for (const token of tokenize(text)) {
        tf.set(token, (tf.get(token) ?? 0) + times);
      }
    };

    bump(doc.title, 3);
    doc.aliases.forEach((a) => bump(a, 3));
    doc.keywords.forEach((k) => bump(k, 2));
    bump(doc.body, 1);

    let len = 0;
    for (const n of tf.values()) len += n;

    for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);

    indexed.push({
      doc,
      tf,
      len,
      exact: [doc.title, ...doc.aliases].map((t) => normalize(t)),
    });
  }

  const avgLen =
    indexed.reduce((sum, d) => sum + d.len, 0) / Math.max(1, indexed.length);

  INDEX = { docs: indexed, df, avgLen };
}

function index() {
  if (!INDEX) buildIndex();
  return INDEX as NonNullable<typeof INDEX>;
}

/* ------------------------------------------------------------- 检索 */

export type RetrieveOptions = {
  kind?: KnowledgeKind | "all";
  topK?: number;
  /** 低于这个分就不要了，避免把不相关的内容硬塞给模型 */
  minScore?: number;
};

export type RetrievedDoc = { doc: KnowledgeDoc; score: number };

export function retrieveKnowledge(
  query: string,
  options: RetrieveOptions = {},
): RetrievedDoc[] {
  const { kind = "all", topK = 3, minScore = 3 } = options;
  const q = normalize(query);
  if (q.length < 2) return [];

  const qTokens = queryTokens(query);
  if (qTokens.length === 0) return [];

  const { docs, df, avgLen } = index();
  const total = docs.length;
  const hits: RetrievedDoc[] = [];

  for (const entry of docs) {
    if (kind !== "all" && entry.doc.kind !== kind) continue;

    let score = 0;
    for (const token of qTokens) {
      const freq = entry.tf.get(token);
      if (!freq) continue;
      const docFreq = df.get(token) ?? 0;
      const idf = Math.log(1 + (total - docFreq + 0.5) / (docFreq + 0.5));
      score += idf * ((freq * (K1 + 1)) / (freq + K1 * (1 - B + (B * entry.len) / avgLen)));
    }

    // 名字/别名整串命中，说明用户问的就是它，给一个决定性的加分
    if (entry.exact.some((name) => name.includes(q) || q.includes(name))) {
      score += 4;
    }

    if (score > 0 && score >= minScore) hits.push({ doc: entry.doc, score });
  }

  hits.sort((a, b) => b.score - a.score);

  // 相对截断：只留和第一名同一量级的结果。
  // 没有这一步，"血压高"会把一堆只沾了一个词的心血管条目一起塞给模型。
  const top = hits[0]?.score ?? 0;
  return hits.filter((h) => h.score >= top * 0.35).slice(0, topK);
}

/** 编号列表：提示词里的引用锚点，和回答里的 [1] [2] 一一对应 */
export type Citation = { index: number; doc: KnowledgeDoc };

export function withCitations(list: RetrievedDoc[], offset = 0): Citation[] {
  return list.map((hit, i) => ({ index: offset + i + 1, doc: hit.doc }));
}

/** 注入 system 的检索结果块 */
export function formatRagBlock(docs: KnowledgeDoc[]): string {
  if (docs.length === 0) return "";

  const body = docs
    .map((doc, i) => {
      const kind = doc.kind === "disease" ? "疾病" : "药品";
      return `[${i + 1}] ${doc.title}（${kind} · ${doc.subtitle}，整理于 ${doc.updatedAt}）\n${doc.points
        .map((p) => `　- ${p}`)
        .join("\n")}`;
    })
    .join("\n\n");

  return `【科普库检索结果】
以下是从本站科普库检索到的 ${
    docs.length
  } 条内容，按相关度排序。用到哪条就在那句话后面标上编号（例如 [1]）；没用到就不要标，也不要编造编号。

${body}

注意：这些是面向普通人的科普整理，不是诊断依据。可以引用其中的事实，但不要据此下诊断。`;
}

/**
 * 回答末尾的出处脚注。
 * 只列回答里真的用到的条目：检索到了不等于用了，把没用的也列上去是虚报。
 */
export function citationFooter(refs: Citation[]): string {
  if (refs.length === 0) return "";
  const names = refs.map((r) => `[${r.index}] ${r.doc.title}（${r.doc.subtitle}）`).join("　");
  return `\n\n参考资料：${names}\n以上为平台科普库整理内容，仅供参考，不替代医生诊断。`;
}

/** 回答里标了 [n]，或直接提到了条目标题，才算「用到了」 */
export function usedRefs(docs: KnowledgeDoc[], answer: string): Citation[] {
  return docs
    .map((doc, i) => ({ index: i + 1, doc }))
    .filter(
      (ref) =>
        answer.includes(`[${ref.index}]`) ||
        answer.includes(`【${ref.index}】`) ||
        answer.includes(ref.doc.title),
    );
}

/** 去重（同一份文档可能既被预检索命中，又被工具检索命中） */
export function dedupeDocs(list: KnowledgeDoc[]): KnowledgeDoc[] {
  const seen = new Set<string>();
  const out: KnowledgeDoc[] = [];
  for (const doc of list) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    out.push(doc);
  }
  return out;
}
