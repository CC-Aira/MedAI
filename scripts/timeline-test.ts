/**
 * 病程时间轴的纯函数测试：不连库、不连浏览器。
 * 用法：npx tsx scripts/timeline-test.ts
 *
 * 重点验四件事：
 *   1. 四类记录都在，且按时间倒序（新的在上）
 *   2. 归日用 lastMessageAt / startDate，而不是会被刷新刷脏的 updatedAt / createdAt
 *   3. 空档案不炸，统计是 0
 *   4. 同一天多条只写一次日期（组件靠 axisDay 判断，这里验它稳定）
 */
import { axisDay, axisTime, buildTimeline } from "../src/lib/timeline";
import type { Consultation, Medication, Note, Patient } from "../src/lib/client/types";

let failed = 0;
function ok(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const now = new Date("2026-10-26T20:00:00+08:00");

function med(over: Partial<Medication>): Medication {
  return {
    id: "m1",
    patientId: "p1",
    drugName: "氨氯地平片",
    dosage: "5mg",
    frequency: "每日一次",
    startDate: null,
    endDate: null,
    isActive: true,
    note: null,
    createdAt: "2026-10-01T08:00:00+08:00",
    timeOfDay: "08:00",
    mealTiming: "after",
    courseDays: 7,
    courseDay: 3,
    remainingDays: 5,
    todayTaken: false,
    missedStreak: 0,
    ...over,
  };
}

function note(over: Partial<Note>): Note {
  return {
    id: "n1",
    patientId: "p1",
    consultationId: null,
    title: "复查结论",
    content: "血压降到 128/82，医生让继续吃，一个月后再来。",
    tags: "血压, 复查",
    isFavorite: false,
    createdAt: "2026-10-20T10:00:00+08:00",
    ...over,
  };
}

function visit(over: Partial<Consultation>): Consultation {
  return {
    id: "v1",
    patientId: "p1",
    title: "晚上量血压有点高",
    status: "active",
    summary: null,
    createdAt: "2026-10-10T09:00:00+08:00",
    updatedAt: "2026-10-10T09:00:00+08:00",
    messageCount: 4,
    lastMessage: "先别紧张，安静坐五分钟再量一次。",
    lastMessageAt: "2026-10-10T09:40:00+08:00",
    hasSheet: false,
    ...over,
  };
}

const patient: Patient = {
  id: "p1",
  name: "林小满",
  gender: "female",
  avatarUrl: null,
  birthDate: null,
  age: 27,
  heightCm: 163,
  weightKg: 52,
  bloodType: "A",
  constitution: null,
  habits: null,
  allergies: "青霉素",
  chronicDisease: null,
  chiefComplaint: "下午头胀",
  createdAt: "2026-09-20T10:00:00+08:00",
  updatedAt: "2026-09-20T10:00:00+08:00",
  medications: [],
  counts: { consultations: 1, notes: 1 },
};

console.log("\n[1] 四类记录都在");
{
  const t = buildTimeline(
    {
      patient,
      medications: [med({})],
      notes: [note({})],
      consultations: [visit({})],
    },
    now,
  );
  const kinds = t.groups.flatMap((g) => g.events.map((e) => e.kind));
  ok("建档一条", kinds.includes("formed"), `${kinds.length} 条`);
  ok("用药一条", kinds.includes("med"));
  ok("问诊一条", kinds.includes("visit"));
  ok("结论一条", kinds.includes("note"));
  ok("总数 4", t.total === 4, String(t.total));
  ok("按时间倒序（最新的在最上）", t.groups[0].events[0].kind === "note", t.groups[0].events[0].title);
}

console.log("\n[2] 归日用的是「真发生时间」");
{
  const t = buildTimeline(
    {
      patient,
      medications: [
        // 记录是 10-01 建的，但医生让 10-08 开始吃 —— 应该落在 10-08
        med({ startDate: "2026-10-08T00:00:00+08:00", createdAt: "2026-10-01T08:00:00+08:00" }),
      ],
      notes: [],
      consultations: [
        // 上周聊的，今天点了「归档」，updatedAt 变成今天 —— 不能跳到今天
        visit({ updatedAt: "2026-10-26T19:00:00+08:00", lastMessageAt: "2026-10-10T09:40:00+08:00" }),
      ],
    },
    now,
  );
  const all = t.groups.flatMap((g) => g.events);
  const medEv = all.find((e) => e.kind === "med");
  const visitEv = all.find((e) => e.kind === "visit");
  ok("用药按 startDate 落在 10.08", Boolean(medEv?.at.startsWith("2026-10-08")), medEv?.at);
  ok("问诊按 lastMessageAt 落在 10.10", Boolean(visitEv?.at.startsWith("2026-10-10")), visitEv?.at);
  ok("归档不会让旧问诊跳到今天", !Boolean(visitEv?.at.startsWith("2026-10-26")));
}

console.log("\n[3] 详情与小标签");
{
  const t = buildTimeline(
    {
      patient,
      medications: [med({ isActive: false })],
      notes: [note({ isFavorite: true })],
      consultations: [visit({ summary: "聊了血压偏高，建议连续记录一周。", hasSheet: true })],
    },
    now,
  );
  const all = t.groups.flatMap((g) => g.events);
  const medEv = all.find((e) => e.kind === "med");
  const noteEv = all.find((e) => e.kind === "note");
  const visitEv = all.find((e) => e.kind === "visit");
  ok("停用的药标「已停用」", Boolean(medEv?.tags.includes("已停用")), medEv?.tags.join("/"));
  ok("剂量进标签", Boolean(medEv?.tags.includes("5mg")));
  ok("详情里有时间点", Boolean(medEv?.detail.includes("每天 08:00")), medEv?.detail);
  ok("星标结论排在最前", Boolean(noteEv?.tags[0] === "重要"), noteEv?.tags.join("/"));
  ok("结论的标签拆开了", Boolean(noteEv?.tags.includes("血压") && noteEv?.tags.includes("复查")));
  ok("有小结就问诊内容用小结", Boolean(visitEv?.detail.startsWith("聊了血压偏高")), visitEv?.detail);
  ok("问诊带上诊疗 id（能点原文）", visitEv?.consultationId === "v1");
  ok("有摘要会标出来", Boolean(visitEv?.tags.includes("有就诊摘要")));
}

console.log("\n[4] 长时间没聊、原文被清掉的问诊");
{
  const t = buildTimeline(
    {
      patient,
      medications: [],
      notes: [],
      consultations: [
        visit({
          messageCount: 0,
          lastMessage: null,
          lastMessageAt: null,
          createdAt: "2026-03-01T09:00:00+08:00",
          summary: null,
        }),
      ],
    },
    now,
  );
  const ev = t.groups.flatMap((g) => g.events).find((e) => e.kind === "visit");
  ok(
    "没有原文也不空着",
    Boolean(ev?.detail) && !(ev?.detail ?? "").includes("undefined"),
    ev?.detail,
  );
  ok("退回 createdAt", Boolean(ev?.at.startsWith("2026-03-01")), ev?.at);
}

console.log("\n[5] 空档案");
{
  const t = buildTimeline({ patient, medications: [], notes: [], consultations: [] }, now);
  ok("只有建档一条", t.total === 1, String(t.total));
  ok("统计不炸", t.stats.visits === 0 && t.stats.meds === 0 && t.stats.activeMeds === 0);
  ok("病程天数从建档算", t.stats.days >= 37, String(t.stats.days));
}

console.log("\n[6] 日期列");
{
  ok("10.26 这种格式", axisDay("2026-10-26T13:15:00+08:00") === "10.26", axisDay("2026-10-26T13:15:00+08:00"));
  ok("时间补零", axisTime("2026-10-26T09:05:00+08:00") === "09:05", axisTime("2026-10-26T09:05:00+08:00"));
}

console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项没通过`);
process.exit(failed === 0 ? 0 : 1);
