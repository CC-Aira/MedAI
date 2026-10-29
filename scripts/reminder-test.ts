/**
 * 用药提醒文案的自检（纯函数，不需要起服务）。
 *
 *   npx tsx scripts/reminder-test.ts
 *
 * 覆盖：两段文案的字数上限、必含信息、饭前饭后映射、
 * 连续漏服才追加关怀句、不出现任何医疗建议，以及几个边界（长药名、缺字段、疗程结束）。
 */

import {
  buildReminder,
  buildNotice,
  buildEmail,
  charCount,
  CARE_LINE,
  EMAIL_MAX,
  NOTICE_MAX,
  mealLabel,
} from "../src/lib/medication-reminder";

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? `  ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}  ${detail}`);
  }
}

const base = {
  drugName: "氨氯地平片",
  dosage: "5mg",
  timeOfDay: "08:00",
  mealTiming: "after",
  courseDay: 3,
  remainingDays: 12,
  missedStreak: 0,
};

/* ---------------- 1. 站内通知 ---------------- */
console.log("\n[1] 站内通知");
{
  const notice = buildNotice(base);
  console.log(`    ${notice}  (${charCount(notice)} 字)`);
  ok("不超过 30 字", charCount(notice) <= NOTICE_MAX, `${charCount(notice)} 字`);
  ok("带药名", notice.includes("氨氯地平片"));
  ok("带剂量", notice.includes("5mg"));
  ok("带饭前饭后", notice.includes("饭后"));
  ok("语气是提醒", notice.includes("该吃") || notice.includes("记得"));
}

console.log("\n[2] 站内通知的边界");
{
  const noDose = buildNotice({ ...base, dosage: null });
  ok("没有剂量也能生成", charCount(noDose) <= NOTICE_MAX && noDose.includes("氨氯地平片"), noDose);

  const noMeal = buildNotice({ ...base, mealTiming: "any" });
  ok("饭前饭后选「不限」就不提", !noMeal.includes("饭前") && !noMeal.includes("饭后"), noMeal);

  const longName = "复方甲氧那明胶囊（强力枇杷露复方制剂）";
  const longNotice = buildNotice({ ...base, drugName: longName });
  ok("超长药名也压到 30 字内", charCount(longNotice) <= NOTICE_MAX, `${charCount(longNotice)} 字 · ${longNotice}`);
}

/* ---------------- 2. 邮件正文 ---------------- */
console.log("\n[3] 邮件正文");
{
  const email = buildEmail(base);
  console.log(email.split("\n").map((l) => `    ${l}`).join("\n"));
  ok("不超过 80 字", charCount(email) <= EMAIL_MAX, `${charCount(email)} 字`);
  ok("有问候", email.startsWith("您好"));
  ok("写了疗程第几天", email.includes("第 3 天") || email.includes("第3天"));
  ok("写了还剩几天", email.includes("12"));
  ok("没有关怀句（漏服 < 2）", !email.includes(CARE_LINE));
  ok("有「如有不适请及时就医」", email.includes("如有不适请及时就医"));
}

console.log("\n[4] 连续漏服时追加关怀");
{
  const two = buildEmail({ ...base, missedStreak: 2 });
  console.log(two.split("\n").map((l) => `    ${l}`).join("\n"));
  ok("漏 2 次会追加那句关怀", two.includes(CARE_LINE), `${charCount(two)} 字`);
  ok("追加后仍然不超过 80 字", charCount(two) <= EMAIL_MAX, `${charCount(two)} 字`);

  const one = buildEmail({ ...base, missedStreak: 1 });
  ok("漏 1 次不追加", !one.includes(CARE_LINE));
  const five = buildEmail({ ...base, missedStreak: 5 });
  ok("漏很多次也只追加一次", five.split(CARE_LINE).length - 1 === 1);
}

console.log("\n[5] 边界");
{
  const lastDay = buildEmail({ ...base, courseDay: 14, remainingDays: 0 });
  ok("疗程最后一天写法不别扭", lastDay.includes("最后一天") || lastDay.includes("结束"), lastDay.split("\n")[2]);

  const noCourse = buildEmail({ drugName: "布洛芬", dosage: "200mg", mealTiming: "before" });
  ok("没有疗程信息也能生成", charCount(noCourse) <= EMAIL_MAX && noCourse.includes("布洛芬"), `${charCount(noCourse)} 字`);
  ok("没有起始日就不硬写第几天", !noCourse.includes("第 1 天"));

  const longAll = buildEmail({
    ...base,
    drugName: "复方甲氧那明胶囊（强力枇杷露复方制剂）",
    dosage: "一次两粒 0.25g",
    missedStreak: 3,
  });
  ok("超长信息仍压到 80 字内", charCount(longAll) <= EMAIL_MAX, `${charCount(longAll)} 字`);
}

/* ---------------- 3. 不该出现的内容 ---------------- */
console.log("\n[6] 不写医疗建议");
{
  const all = [
    buildReminder(base).notice,
    buildReminder(base).email,
    buildReminder({ ...base, missedStreak: 3 }).email,
    buildEmail({ ...base, courseDay: 14, remainingDays: 0 }),
  ].join("\n");
  const banned = ["停药", "停药观察", "加量", "减量", "换药", "诊断", "确诊", "建议服用", "推荐"];
  const hit = banned.filter((w) => all.includes(w));
  ok("没有停药/加量/换药/诊断这类说法", hit.length === 0, hit.join("、"));
  ok("没有出现「建议」开头的主观建议", !/建议[^，。]{0,4}(服|吃|停)/.test(all));
}

/* ---------------- 4. 汇总字段 ---------------- */
console.log("\n[7] 返回结构");
{
  const r = buildReminder({ ...base, missedStreak: 2 });
  ok("noticeChars 与实际一致", r.noticeChars === charCount(r.notice));
  ok("emailChars 与实际一致", r.emailChars === charCount(r.email));
  ok("careAdded 标记正确", r.careAdded === true);
  ok("没漏服时 careAdded 为 false", buildReminder(base).careAdded === false);
}

console.log("\n[8] 饭前饭后映射");
{
  ok("before → 饭前", mealLabel("before") === "饭前");
  ok("after → 饭后", mealLabel("after") === "饭后");
  ok("any → 不提", mealLabel("any") === "");
  ok("空值 → 不提", mealLabel(null) === "");
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) process.exitCode = 1;
