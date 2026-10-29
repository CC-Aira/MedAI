/**
 * 科普库自检：条数、字段完整性、slug 唯一性、检索召回。
 * 用法：npx tsx scripts/knowledge-test.ts
 */
import { DISEASES, DISEASE_INDEX } from "../src/data/diseases";
import { DRUGS, DRUG_INDEX, DRUG_GROUPS } from "../src/data/drugs";
import { matchScore } from "../src/lib/knowledge-search";
import type { DiseaseIndex, DrugIndex } from "../src/data/knowledge-types";

let failed = 0;
function ok(cond: boolean, label: string) {
  if (!cond) {
    failed += 1;
    console.log(`  ✗ ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log(`\n疾病 ${DISEASES.length} 条 / 药品 ${DRUGS.length} 种 / 药品大类 ${DRUG_GROUPS.length} 个`);

console.log("\n[1] slug 唯一");
const dSlugs = new Set(DISEASES.map((d) => d.slug));
const gSlugs = new Set(DRUGS.map((d) => d.slug));
ok(dSlugs.size === DISEASES.length, `疾病 slug 无重复（${dSlugs.size}）`);
ok(gSlugs.size === DRUGS.length, `药品 slug 无重复（${gSlugs.size}）`);

console.log("\n[2] 必填字段");
const emptyDisease = DISEASES.filter(
  (d) =>
    !d.summary ||
    d.causes.length === 0 ||
    d.symptoms.length === 0 ||
    d.prevention.length === 0 ||
    d.treatment.length === 0 ||
    d.source.length === 0 ||
    !d.updatedAt,
);
ok(emptyDisease.length === 0, `疾病字段完整${emptyDisease.length ? `：缺 ${emptyDisease.map((d) => d.name).join("、")}` : ""}`);

const emptyDrug = DRUGS.filter(
  (d) =>
    !d.genericName ||
    d.indications.length === 0 ||
    d.dosage.length === 0 ||
    d.contraindications.length === 0 ||
    d.adverseReactions.length === 0 ||
    d.interactions.length === 0 ||
    d.specialPopulations.length === 0 ||
    d.source.length === 0 ||
    !d.updatedAt,
);
ok(emptyDrug.length === 0, `药品六项字段完整${emptyDrug.length ? `：缺 ${emptyDrug.map((d) => d.genericName).join("、")}` : ""}`);

console.log("\n[3] 来源与日期格式");
const badDate = [...DISEASES, ...DRUGS].filter((d) => !/^\d{4}-\d{2}$/.test(d.updatedAt));
ok(badDate.length === 0, `updatedAt 均为 YYYY-MM${badDate.length ? `：${badDate.length} 条异常` : ""}`);

const dFields = (d: DiseaseIndex) => [
  { text: d.name, weight: 100 },
  { text: d.alias.join(" "), weight: 60 },
  { text: d.keywords.join(" "), weight: 40 },
  { text: d.summary, weight: 16 },
  { text: d.symptoms.join(" "), weight: 14 },
];
const gFields = (d: DrugIndex) => [
  { text: d.genericName, weight: 100 },
  { text: d.brandNames.join(" "), weight: 70 },
  { text: d.ingredients, weight: 45 },
  { text: d.indications.join(" "), weight: 34 },
  { text: d.category, weight: 28 },
  { text: d.keywords.join(" "), weight: 26 },
];

function search<T extends DiseaseIndex | DrugIndex>(
  q: string,
  index: T[],
  fields: (d: T) => { text: string; weight: number }[],
  name: (d: T) => string,
) {
  return index
    .map((d) => ({ d, s: matchScore(q, fields(d)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => name(x.d));
}

console.log("\n[4] 疾病检索召回");
const diseaseCases: [string, string][] = [
  ["高血压", "高血压"],
  ["血压高", "高血压"],
  ["头晕", "良性阵发性位置性眩晕"],
  ["睡不着", "失眠障碍"],
  ["血糖高", "2 型糖尿病"],
  ["儿童发烧", "儿童发热"],
  ["胃痛", "慢性胃炎"],
  ["关节痛", "痛风"],
  ["血压高吃什么药", "高血压"],
  ["咳嗽 低热", "肺结核"],
];
for (const [q, expect] of diseaseCases) {
  const top = search(q, DISEASE_INDEX, dFields, (d) => d.name);
  ok(top.includes(expect), `「${q}」→ ${top.join(" / ") || "无结果"}${top.includes(expect) ? "" : `（期望含「${expect}」）`}`);
}

console.log("\n[5] 药品检索召回");
const drugCases: [string, string][] = [
  ["布洛芬", "布洛芬"],
  ["芬必得", "布洛芬"],
  ["对乙酰氨基酚", "对乙酰氨基酚"],
  ["退烧药", "布洛芬"],
  ["胃酸", "奥美拉唑"],
  ["他汀", "阿托伐他汀"],
  ["血糖", "二甲双胍"],
  ["消炎药", "阿莫西林"],
  ["尿酸", "非布司他"],
  ["胃胀 恶心", "多潘立酮"],
];
for (const [q, expect] of drugCases) {
  const top = search(q, DRUG_INDEX, gFields, (d) => d.genericName);
  ok(top.includes(expect), `「${q}」→ ${top.join(" / ") || "无结果"}${top.includes(expect) ? "" : `（期望含「${expect}」）`}`);
}

console.log("\n[6] 空查询与标点");
ok(matchScore("", dFields(DISEASE_INDEX[0])) === 1, "空查询返回 1（不做过滤）");
ok(matchScore("，。！", dFields(DISEASE_INDEX[0])) === 1, "纯标点视为空查询");
ok(matchScore("zzzzz", dFields(DISEASE_INDEX[0])) === 0, "无命中返回 0");

console.log(
  failed === 0 ? "\n全部通过 ✓\n" : `\n${failed} 项未通过 ✗\n`,
);
process.exit(failed === 0 ? 0 : 1);
