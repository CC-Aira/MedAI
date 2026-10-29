/**
 * 用药排程的自检（纯函数，不需要起服务）。
 *
 *   npx tsx scripts/schedule-test.ts
 *
 * 重点盯「连续漏服」这一项：它只用来决定要不要在提醒里加一句关心话，
 * 数大了没有任何好处 —— 所以封顶 7 天，而且绝不把陈年老账翻出来。
 */

import { computeSchedule, dayKey, shiftDays } from "../src/lib/medication-schedule";

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

const NOW = new Date(2026, 9, 26, 18, 30); // 2026-10-26 18:30 本地时间
const daysAgo = (n: number) => shiftDays(NOW, -n);

/** 药：n 天前开始，没有打卡记录 */
function medStartDaysAgo(n: number) {
  return {
    startDate: daysAgo(n),
    endDate: null,
    courseDays: null,
    createdAt: daysAgo(n),
  };
}

console.log("\n[1] 没有打卡记录的药");

const fresh = computeSchedule(medStartDaysAgo(0), [], NOW);
ok("今天刚加的药 → 不算漏服", fresh.missedStreak === 0, `missedStreak=${fresh.missedStreak}`);
ok("今天刚加的药 → 疗程第 1 天", fresh.courseDay === 1, `courseDay=${fresh.courseDay}`);

const threeDays = computeSchedule(medStartDaysAgo(3), [], NOW);
// 3 天前开始 = 那天算第 1 天，今天第 4 天；从昨天往回数到开始日，是 3 天
ok("3 天前开始、一直没打卡 → 漏 3 天", threeDays.missedStreak === 3, `missedStreak=${threeDays.missedStreak}`);

// 这条就是原来会把演示搞砸的情况：一个两个月前建的老药，从没打过卡
const old = computeSchedule(medStartDaysAgo(60), [], NOW);
ok("60 天前的老药 → 封顶 7，不报 59 次", old.missedStreak === 7, `missedStreak=${old.missedStreak}`);

console.log("\n[2] 有打卡记录的药");

/** 造一条打卡：n 天前那天吃了 */
function taken(n: number) {
  return { scheduledFor: daysAgo(n), takenAt: daysAgo(n), status: "taken" };
}

const broken = computeSchedule(medStartDaysAgo(10), [taken(4)], NOW);
ok("4 天前吃过一次 → 从那天往回只数 3 天", broken.missedStreak === 3, `missedStreak=${broken.missedStreak}`);

const today = computeSchedule(medStartDaysAgo(10), [taken(0)], NOW);
ok("今天打过卡 → todayTaken", today.todayTaken === true);
// 只有今天打了卡，前面 9 天全空 —— 这种是真漏，按上限报 7
ok("只有今天打卡 → 前面的空档按上限报 7", today.missedStreak === 7, `missedStreak=${today.missedStreak}`);

const skipped = computeSchedule(medStartDaysAgo(5), [taken(2)], NOW);
ok("「跳过」也算当天有交代，不当作漏服起点", skipped.missedStreak === 1, `missedStreak=${skipped.missedStreak}`);

console.log("\n[3] 疗程边界");

const done = computeSchedule(
  { startDate: daysAgo(10), endDate: null, courseDays: 7, createdAt: daysAgo(10) },
  [taken(9), taken(8), taken(7), taken(6), taken(5), taken(4), taken(3)],
  NOW,
);
ok("7 天疗程走完 → remainingDays 归零", done.remainingDays === 0, `remainingDays=${done.remainingDays}`);

const noCourse = computeSchedule(medStartDaysAgo(3), [], NOW);
ok("没写疗程 → remainingDays 是 null", noCourse.remainingDays === null);

console.log("\n[4] 日期键");

ok("dayKey 是本地日期", dayKey(new Date(2026, 0, 5, 23, 50)) === "2026-01-05", dayKey(new Date(2026, 0, 5, 23, 50)));

console.log(`\n通过 ${pass} 项，失败 ${fail} 项\n`);
process.exit(fail === 0 ? 0 : 1);
