/**
 * 就诊摘要的纯函数测试：不连库、不连模型。
 * 用法：npx tsx scripts/sheet-test.ts
 */
import {
  buildLocalSheet,
  normalizeSheet,
  sheetText,
  sheetTime,
  type VisitSheet,
} from "../src/lib/visit-sheet";

let failed = 0;
function ok(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const at = "2026-10-26T11:15:00.000Z";

const fallback = buildLocalSheet({
  patient: { name: "陈妍萱", chiefComplaint: "下午头胀", allergies: "青霉素" },
  title: "一次新的问诊",
  userSays: ["最近下午老是头胀", "睡不太好，凌晨三点会醒"],
  flags: null,
  generatedAt: at,
});

console.log("\n[1] 本地模板");
ok("主诉取档案里的", fallback.chiefComplaint === "下午头胀", fallback.chiefComplaint);
ok("病程按原话排", fallback.course.length === 2 && fallback.course[0].startsWith("自述："), fallback.course[0]);
ok("没有问题清单时给三条通用的", fallback.questions.length === 3);
ok("没触发红旗就写上已排除", fallback.ruledOut.length === 1, fallback.ruledOut.join(""));
ok("来源标成本地", fallback.source === "local");

const flagged = buildLocalSheet({
  patient: { name: "陈妍萱", chiefComplaint: null, allergies: null },
  title: "胸痛那次",
  userSays: ["胸口疼得厉害"],
  flags: { labels: ["胸痛 / 胸口压榨感"], count: 1, at },
  generatedAt: at,
});
ok("触发过红旗就不再写「已排除」", flagged.ruledOut.length === 0);
ok("触发过红旗会带上标记", flagged.flags?.labels[0] === "胸痛 / 胸口压榨感");
ok("没有主诉就退回问诊标题", flagged.chiefComplaint === "胸痛那次", flagged.chiefComplaint);

console.log("\n[1b] 主诉和病程不能是同一句（一张纸说两遍最伤信任）");
const repeated = buildLocalSheet({
  // 标题常常就是用户的第一句话 —— 主诉取它，病程里那句就得让开
  patient: { name: "林小满", chiefComplaint: null, allergies: null },
  title: "我胸口疼，喘不上气，出冷汗",
  userSays: ["我胸口疼，喘不上气，出冷汗", "昨天开始，走快点更明显"],
  flags: null,
  generatedAt: at,
});
ok(
  "与主诉重复的那条被剔掉",
  repeated.course.length === 1 && !repeated.course[0].includes("出冷汗"),
  repeated.course.join(" / "),
);
ok("其余原话照旧保留", repeated.course[0] === "自述：昨天开始，走快点更明显", repeated.course[0]);

// 模型很爱把主诉原句抄进病程，标点还多一个句号
const aiRepeat = normalizeSheet(
  {
    chiefComplaint: "我胸口疼，喘不上气",
    course: ["自述：我胸口疼，喘不上气。", "昨天开始，走快点更明显"],
  },
  fallback,
  at,
);
ok("模型抄的那条也剔掉", aiRepeat.course.length === 1, aiRepeat.course.join(" / "));

// 多一个「我」也算同一句 —— 这是实际遇到过的写法，光比全等拦不住
const aiExtraWord = normalizeSheet(
  {
    chiefComplaint: "胸口疼，喘不上气，出冷汗",
    course: ["自述：我胸口疼，喘不上气，出冷汗", "昨天下午开始的"],
  },
  fallback,
  at,
);
ok("多一个「我」也认成重复", aiExtraWord.course.length === 1, aiExtraWord.course.join(" / "));

// 反过来不能误删：说法不一样的两句都得留着
const aiDistinct = normalizeSheet(
  {
    chiefComplaint: "胸口疼",
    course: ["胸口疼的时候会出冷汗", "走快了更明显"],
  },
  fallback,
  at,
);
ok("只是沾边的话不删", aiDistinct.course.length === 2, aiDistinct.course.join(" / "));

console.log("\n[2] 模型返回的结果要洗干净");
const messy = normalizeSheet(
  {
    chiefComplaint: "  近两周下午头胀，伴入睡困难  ",
    course: ["两周前开始", "两周前开始", "", "久坐后更明显", 42, "没喝水时更明显"],
    ruledOut: ["没有胸痛"],
    advice: "多喝水", // 类型错了：这里要数组
    whenToGo: "出现剧烈头痛时去急诊",
    questions: ["需要做动态血压吗？"],
  },
  fallback,
  at,
);
ok("去掉首尾空白", messy.chiefComplaint === "近两周下午头胀，伴入睡困难", messy.chiefComplaint);
ok("重复的病程只留一条", messy.course.filter((s) => s === "两周前开始").length === 1);
ok("非字符串项被丢掉", !messy.course.includes("42"), messy.course.join("|"));
ok("空串被丢掉", messy.course.length === 3, String(messy.course.length));
ok("类型错的 advice 不会炸，退回空数组", Array.isArray(messy.advice) && messy.advice.length === 0);
ok("来源标成 ai", messy.source === "ai");
ok("红旗标记沿用代码里那份，不信模型", messy.flags === null);

const long = normalizeSheet(
  {
    chiefComplaint: "啊".repeat(200),
    course: Array.from({ length: 9 }, (_, i) => `第 ${i + 1} 条`),
    questions: Array.from({ length: 6 }, (_, i) => `问题 ${i + 1}`),
  },
  fallback,
  at,
);
ok("主诉截断", long.chiefComplaint.length <= 60, String(long.chiefComplaint.length));
ok("病程最多 5 条", long.course.length === 5, String(long.course.length));
ok("问题最多 3 条", long.questions.length === 3, String(long.questions.length));

console.log("\n[3] 模型胡说的时候退回本地模板");
for (const bad of [null, undefined, "一段话", 42, {}, { chiefComplaint: "", course: [], advice: [] }]) {
  const got = normalizeSheet(bad, fallback, at);
  ok(`${JSON.stringify(bad)} → 本地模板`, got.source === "local" && got.chiefComplaint === "下午头胀", got.source);
}

console.log("\n[4] 纯文本版（复制到微信里也能读）");
const text = sheetText(
  normalizeSheet({ chiefComplaint: "下午头胀", course: ["两周前开始"] }, fallback, at),
  { name: "陈妍萱", gender: "female", age: 20, allergies: "青霉素", chronicDisease: "慢性胃炎" },
  [
    { drugName: "二甲双胍片", dosage: "0.5g", frequency: "每日两次" },
    { drugName: "", dosage: null, frequency: null },
  ],
);
ok("有标题和姓名", text.includes("就诊摘要 · 陈妍萱"));
ok("有主诉", text.includes("【主诉】") && text.includes("下午头胀"));
ok("有药物清单", text.includes("二甲双胍片 0.5g 每日两次"));
ok("空药名不会出现", !text.includes("·   "));
ok("带免责声明", text.includes("不是诊断"));
ok("没有 undefined / null 字样", !/undefined|null/.test(text));
// 过敏史只在屏幕上有、复制出去没有的话，读的人会当成「没有过敏」——必须跟着文字走
ok("纯文本里带过敏史", text.includes("【过敏史】青霉素"), text.split("\n").find((l) => l.includes("过敏")));
ok("纯文本里带既往病史", text.includes("【既往病史】慢性胃炎"));

const noAllergy = sheetText(
  normalizeSheet({ chiefComplaint: "下午头胀" }, fallback, at),
  { name: "陈妍萱", gender: "female", age: 20, allergies: null, chronicDisease: null },
  [],
);
ok("没记过敏史时写「未记录」而不是留空", noAllergy.includes("【过敏史】未记录"));
ok("没记既往病史就不出这一行", !noAllergy.includes("【既往病史】"));

console.log("\n[5] 时间格式");
const shown = sheetTime(at);
ok("年月日 + 星期 + 时分", /^\d{4}\.\d{2}\.\d{2}（周.）\d{2}:\d{2}$/.test(shown), shown);
ok("坏时间不炸", sheetTime("not-a-date") === "");

console.log(`\n${failed === 0 ? "全部通过" : `${failed} 项失败`}\n`);
process.exit(failed === 0 ? 0 : 1);
