/**
 * 科普库的中文检索：没有分词器，用「归一化 + 多词 AND + 字段权重」就够了。
 * 数据量只有几十条，纯函数在客户端跑，输入即时出结果，不需要接口。
 */

/**
 * 同一件事的几种说法，统一成一个词再比对。
 * 索引端和查询端都走 normalize，所以两边会自动对齐。
 */
const SYNONYMS: [RegExp, string][] = [
  [/发烧/g, "发热"],
  [/拉肚子/g, "腹泻"],
  [/心慌/g, "心悸"],
  [/睡不着/g, "失眠"],
  [/睡不好/g, "失眠"],
  [/痘痘/g, "痤疮"],
  [/脚气/g, "足癣"],
  [/中风/g, "卒中"],
  [/血压高/g, "高血压"],
  [/血糖高/g, "血糖"],
  [/血脂高/g, "血脂"],
  [/止疼/g, "止痛"],
  [/喘不上气/g, "气短"],
];

/** 全角转半角、去空白、去标点、统一小写、同义词归一 */
export function normalize(input: string): string {
  const flat = input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[·•・,，。.、；;：:!！?？/\\|+~\-—_"'“”‘’()（）【】[\]{}<>《》]/g, "");

  let out = flat;
  for (const [re, to] of SYNONYMS) out = out.replace(re, to);
  return out;
}

const SEPARATOR = /[\s\u3000,，。.、；;：:!！?？/\\|+~\-—_()（）【】[\]{}<>《》]+/;

/** 把查询拆成词：按空白和标点切，单个词再归一化 */
export function splitTerms(query: string): string[] {
  return query
    .split(SEPARATOR)
    .map(normalize)
    .filter((t) => t.length > 0);
}

export type SearchField = {
  text: string;
  /** 命中这个词段的基准分，名字给最高，正文给最低 */
  weight: number;
};

/**
 * 一条记录对某个查询的得分。
 * 多个词之间是 AND：任何一个词完全找不到，整条就不返回。
 *
 * 字段里可能塞了多个词（别名、关键词、症状数组），用空白分隔，
 * 这里逐段比较 —— 否则「血压高 原发性高血压」拼成长串，永远匹配不上短词。
 */
export function matchScore(query: string, fields: SearchField[]): number {
  const terms = splitTerms(query);
  if (terms.length === 0) return 1;

  let total = 0;
  for (const term of terms) {
    let best = 0;
    for (const field of fields) {
      const segments = field.text
        .split(/[\s\u3000/、；;]+/)
        .map(normalize)
        .filter(Boolean);

      for (const hay of segments) {
        let score = 0;
        if (hay === term) score = field.weight * 1.6;
        else if (hay.startsWith(term)) score = field.weight * 1.25;
        else if (hay.includes(term)) score = field.weight;
        // 反向包含：「高血压吃什么药」里能捞出「高血压」
        else if (
          hay.length >= 2 &&
          hay.length <= 12 &&
          term.length <= hay.length + 8 &&
          term.includes(hay)
        ) {
          score = field.weight * 0.6;
        }

        if (score > best) best = score;
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  return Math.round(total * 10) / 10;
}

/** 在长文本里截出关键词附近的一小段，用作搜索结果的「命中摘要」 */
export function excerpt(text: string, query: string, max = 62): string {
  const terms = splitTerms(query);
  if (terms.length === 0) return text.slice(0, max);

  // 归一化会删掉标点，长度和原文对不上，所以要记一份「扁平下标 → 原文下标」的映射
  let flat = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = normalize(text[i]);
    if (!c) continue;
    flat += c;
    map.push(i);
  }

  let at = -1;
  for (const term of terms) {
    const i = flat.indexOf(term);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return text.slice(0, max);

  const hit = map[at] ?? 0;
  const start = Math.max(0, hit - Math.floor(max / 3));
  const slice = text.slice(start, start + max);
  return `${start > 0 ? "…" : ""}${slice}${start + max < text.length ? "…" : ""}`;
}
