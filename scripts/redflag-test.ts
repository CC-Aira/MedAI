/**
 * 红旗拦截的纯函数测试：不连数据库、不连模型，只验规则表和话术。
 * 用法：npx tsx scripts/redflag-test.ts
 */
import { buildRedFlagReply, detectRedFlags } from "../src/lib/red-flags";

let failed = 0;
function ok(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
}

function ids(text: string): string {
  return detectRedFlags(text)
    .map((h) => h.id)
    .join(",");
}

console.log("\n[1] 该拦的拦得住");
const cases: [string, string][] = [
  ["我胸口疼，还喘不上气", "chest,breath"],
  ["突然胸痛，出冷汗", "chest"],
  ["我妈刚晕倒了，叫不醒", "conscious"],
  ["说话不清，一边手脚没力气", "stroke"],
  ["昨晚吐了一口血", "bleeding"],
  ["喉咙发紧，脸上起疹子", "anaphylaxis"],
  ["我不想活了", "self_harm"],
  ["大便带血两天了", "stool_blood"],
  ["突然剧烈头痛", "headache"],
  ["胸口压得慌，喘不过气", "chest,breath"],
];
for (const [text, want] of cases) {
  const got = ids(text);
  ok(`「${text}」→ ${want}`, got === want, got);
}

console.log("\n[2] 否定不能误伤");
for (const text of [
  "没有胸痛，就是有点累",
  "我不头晕，也不喘不上气",
  "否认胸痛、呼吸困难",
  "没吐血，只是嗓子不舒服",
]) {
  ok(`「${text}」不拦`, ids(text) === "", ids(text));
}

console.log("\n[3] 假设、定义式提问不拦（否则一句反问就被按住）");
for (const text of [
  "如果胸痛该怎么办",
  "万一晕倒了要做什么",
  "我想知道什么时候算呼吸困难",
  "算不算胸痛",
]) {
  ok(`「${text}」不拦`, ids(text) === "", ids(text));
}

// 这两句是「偏要拦」的取舍：句子里已经有「胸痛」「胸闷」两个字，
// 宁可让人白跑一趟，也好过漏掉。写进测试，免得以后有人当成 bug 改掉。
ok("「我担心胸痛」照样拦", ids("我有点担心胸痛") === "chest", ids("我有点担心胸痛"));
ok("「有必要为胸闷去急诊吗」照样拦", ids("有必要为胸闷去急诊吗") === "chest_tight");

console.log("\n[4] 过去的事降一档，但不取消");
const past = detectRedFlags("上个月胸口疼过一次，现在没感觉了");
ok("命中胸痛", past.length > 0 && past[0].id === "chest", ids("上个月胸口疼过一次"));
ok("降到 urgent", past[0]?.level === "urgent", past[0]?.level);
const now = detectRedFlags("现在胸口疼");
ok("现在发生的仍是 emergency", now[0]?.level === "emergency", now[0]?.level);

console.log("\n[5] 口语里的狠话不算自伤");
ok("「疼得想死」不拦", ids("头疼得想死") === "", ids("头疼得想死"));
ok("「累得想死」不拦", ids("累得想死") === "", ids("累得想死"));

console.log("\n[6] 日常描述不误报");
for (const text of [
  "最近老是咳嗽，有点痰",
  "每次站起来就头晕",
  "睡不好，凌晨三点会醒",
  "肚子有点胀",
  "血压 135/85",
]) {
  ok(`「${text}」不拦`, ids(text) === "", ids(text));
}

console.log("\n[7] 话术");
const em = buildRedFlagReply("陈妍萱", detectRedFlags("胸痛、喘不上气"));
ok("急诊话术喊 120", em.content.includes("120"), em.headline);
ok("急诊话术不给诊断", !/你是|确诊|就是.*病/.test(em.content));
ok("急诊话术带病人名字", em.content.startsWith("陈妍萱"));
ok("急诊话术说清「不是诊断」", em.content.includes("不是诊断"));
ok("最多三条动作", (em.content.match(/^\d\. /gm) ?? []).length === 3);

const ur = buildRedFlagReply("陈妍萱", detectRedFlags("今天有点胸闷"));
ok("胸闷走 urgent 话术", ur.level === "urgent" && ur.content.includes("门诊"), ur.content.slice(0, 24));

const sh = buildRedFlagReply("陈妍萱", detectRedFlags("我不想活了"));
ok("自伤话术给热线", sh.content.includes("12356"), sh.headline);
ok("自伤话术不喊去挂号", !sh.content.includes("门诊"));

console.log("\n[8] 最多报三类，急诊优先");
const many = detectRedFlags("胸痛、喘不上气、晕倒、吐血、抽搐");
ok("封顶 3 条", many.length === 3, String(many.length));
ok("第一条是 emergency", many[0].level === "emergency", many[0].level);

console.log(`\n${failed === 0 ? "全部通过" : `${failed} 项失败`}\n`);
process.exit(failed === 0 ? 0 : 1);
