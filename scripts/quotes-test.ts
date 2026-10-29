/**
 * 语录库自检：分类是否齐全、随机是否真的覆盖四类、句子长度是否放得进气泡。
 *   npx tsx scripts/quotes-test.ts
 */
import {
  CATEGORY_NAMES,
  categoryStats,
  cheerLine,
  lineFrom,
  randomLine,
  welcomeLine,
  type RabbitCategory,
} from "../src/data/rabbit-quotes";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? `  ← ${extra}` : ""}`);
  }
}

const CATS: RabbitCategory[] = ["welcome", "comfort", "health", "medical"];

console.log("分类规模");
const stats = categoryStats();
for (const c of CATS) {
  ok(`${CATEGORY_NAMES[c]}（${c}）至少 8 句`, stats[c] >= 8, `${stats[c]} 句`);
}
const total = CATS.reduce((n, c) => n + stats[c], 0);
ok("总数 >= 40", total >= 40, `${total} 句`);

console.log("\n文案质量");
const all = CATS.flatMap((c) => {
  const out: string[] = [];
  for (let i = 0; i < 200; i++) out.push(lineFrom(c).text);
  return out;
});
const unique = new Set(all);
ok("四类都能抽到句子", unique.size >= 20, `${unique.size} 种`);
const tooLong = [...unique].filter((t) => t.length > 34);
ok("每句不超过 34 字（气泡放得下）", tooLong.length === 0, tooLong.slice(0, 3).join(" / "));

// 同一批文案不重复（用固定分类抽样去查重）
const perCat = CATS.map((c) => {
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) seen.add(lineFrom(c).text);
  return seen;
});
const dupAcross = new Set<string>();
let dupHit = 0;
const union = new Set<string>();
for (const set of perCat) {
  for (const t of set) {
    if (union.has(t)) dupHit++;
    union.add(t);
  }
}
ok("四个分类之间没有重复文案", dupHit === 0, `${dupHit} 条重复`);
ok("所有句子都被抽到过（分类内部没有死条目）", union.size === total, `${union.size}/${total}`);

console.log("\n欢迎语只出欢迎类");
let badWelcome = 0;
for (let i = 0; i < 200; i++) {
  const l = welcomeLine();
  if (l.category !== "welcome" || l.tone !== "greet") badWelcome++;
}
ok("200 次欢迎语都在 welcome 分类", badWelcome === 0, `${badWelcome} 次异常`);

console.log("\n点击随机覆盖四类");
const hits: Record<string, number> = {};
for (let i = 0; i < 600; i++) {
  const l = randomLine();
  hits[l.category] = (hits[l.category] ?? 0) + 1;
}
for (const c of CATS) {
  ok(`随机抽取覆盖到 ${CATEGORY_NAMES[c]}`, (hits[c] ?? 0) > 0, `${hits[c] ?? 0} 次`);
}
console.log(`    分布：${CATS.map((c) => `${CATEGORY_NAMES[c]} ${hits[c] ?? 0}`).join(" · ")}`);

console.log("\n鼓励尾句");
const cheers = new Set<string>();
for (let i = 0; i < 200; i++) cheers.add(cheerLine());
ok("鼓励语至少 8 种", cheers.size >= 8, `${cheers.size} 种`);
ok("鼓励语都不超过 30 字", [...cheers].every((c) => c.length <= 30));

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) process.exit(1);
