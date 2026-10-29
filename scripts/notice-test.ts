/**
 * 站内提醒「接兔子」的纯逻辑测试：不连库、不连浏览器。
 * 用法：npx tsx scripts/notice-test.ts
 *
 * 要验的是三个容易写错的地方：
 *   1. 文案里该有的都有（药名、时间点、谁的）；
 *   2. 没有气泡在听时说的话不能丢，气泡挂上来要补发一次、且只补一次；
 *   3. 提醒要让兔子蹦一下，否则没人注意到。
 */
import {
  onRabbitSpeech,
  rabbitMedReminder,
  rabbitSay,
  type RabbitLine,
} from "../src/lib/rabbit-speech";

let failed = 0;
function ok(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
}

console.log("\n[1] 到点提醒的文案");
{
  const line = rabbitMedReminder({
    drugName: "氨氯地平片",
    timeOfDay: "08:00",
    patientName: "林小满",
  });
  ok("带名字", line.text.includes("林小满"), line.text);
  ok("带药名", line.text.includes("氨氯地平片"), line.text);
  ok("带时间点", line.text.includes("08:00"), line.text);
  ok("语气是关心不是告警", line.tone === "care", line.tone);
  ok("会让兔子蹦一下", line.hop === true);
  ok("停留够久（24 秒）", line.duration === 24_000, String(line.duration));
  ok("有第二句引导", Boolean(line.tail), line.tail);
}

console.log("\n[2] 没有名字时不说「的」");
{
  const line = rabbitMedReminder({ drugName: "布洛芬", timeOfDay: "12:30" });
  ok("不出现空名字", !line.text.includes("undefined"), line.text);
  ok("仍然带药名和时间", line.text.includes("布洛芬") && line.text.includes("12:30"), line.text);
}

console.log("\n[3] 没人在听 → 挂上来补发一次");
{
  const first = rabbitSay("这句没人听");
  const heard: RabbitLine[] = [];
  const off = onRabbitSpeech((l) => heard.push(l));
  ok("补发了刚才那句", heard.length === 1 && heard[0].text === "这句没人听", `${heard.length} 条`);
  ok("补发的是同一条（id 一致）", heard[0]?.id === first.id);

  // 再挂一个监听者不该重复补发
  const heard2: RabbitLine[] = [];
  onRabbitSpeech((l) => heard2.push(l));
  ok("第二个监听者不会重复收到旧话", heard2.length === 0, `${heard2.length} 条`);

  // 正常广播
  rabbitSay("现在有人听了");
  ok("补发之后的正常消息能收到", heard.length === 2 && heard[1].text === "现在有人听了", `${heard.length} 条`);
  off();
}

console.log("\n[4] 没有监听者时不会抛错");
{
  let threw = false;
  try {
    rabbitMedReminder({ drugName: "二甲双胍", timeOfDay: "19:00" });
  } catch {
    threw = true;
  }
  ok("安静地存成 pending，不炸", !threw);
}

console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项没通过`);
process.exit(failed === 0 ? 0 : 1);
