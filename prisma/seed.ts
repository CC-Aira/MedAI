/**
 * 演示数据。跑 `npm run db:seed` 即可重置。
 * 直接构造 PrismaClient 而不依赖 Next 的 env 加载，所以这里手动读 .env。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

function loadEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    if (process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const prisma = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number, hour = 10) => {
  const d = new Date(Date.now() - days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};

const DEMO_EMAIL = "demo@medai.local";
const OTHER_EMAIL = "other@medai.local";
const PASSWORD = "Medai@2026";

async function main() {
  const passwordHash = await hashPassword(PASSWORD);

  for (const email of [DEMO_EMAIL, OTHER_EMAIL]) {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!existing) {
      await prisma.user.create({ data: { email, passwordHash } });
    } else {
      // 密码固定，方便反复重置
      await prisma.user.update({ where: { email }, data: { passwordHash } });
    }
  }

  const demo = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAIL } });
  const other = await prisma.user.findUniqueOrThrow({ where: { email: OTHER_EMAIL } });

  // 清空旧数据，保证 seed 可重复执行
  await prisma.patient.deleteMany({ where: { ownerId: { in: [demo.id, other.id] } } });

  const patients = [
    {
      name: "林小满",
      gender: "female",
      age: 27,
      birthDate: new Date("1999-03-11T00:00:00.000Z"),
      heightCm: 165,
      weightKg: 52,
      bloodType: "A",
      constitution: "气虚质",
      habits: "久坐，晚上常常十二点后睡，早饭经常不吃",
      allergies: "青霉素过敏（曾出现皮疹）",
      chronicDisease: "慢性胃炎",
      chiefComplaint: "右上腹隐痛三天，饭后加重",
    },
    {
      name: "陈立",
      gender: "male",
      age: 54,
      birthDate: new Date("1972-08-02T00:00:00.000Z"),
      heightCm: 172,
      weightKg: 78,
      bloodType: "O",
      constitution: "痰湿质",
      habits: "吸烟二十年，每天约半包；应酬多，饮酒偏多",
      allergies: "未发现药物过敏",
      chronicDisease: "高血压五年，服降压药",
      chiefComplaint: "夜间干咳两周，爬楼气短",
    },
    {
      name: "周慕青",
      gender: "female",
      age: 33,
      birthDate: new Date("1993-01-19T00:00:00.000Z"),
      heightCm: 168,
      weightKg: 55,
      bloodType: "AB",
      constitution: "气郁质",
      habits: "每天对着屏幕十小时以上，睡眠六小时左右",
      allergies: "磺胺类药物过敏",
      chronicDisease: null,
      chiefComplaint: "反复偏头痛，伴畏光",
    },
    {
      name: "何嘉禾",
      gender: "male",
      age: 8,
      birthDate: new Date("2018-05-30T00:00:00.000Z"),
      heightCm: 128,
      weightKg: 26,
      bloodType: "B",
      constitution: null,
      habits: "挑食，爱吃甜食，晚上九点半睡",
      allergies: "尘螨过敏，春秋容易打喷嚏",
      chronicDisease: "过敏性鼻炎",
      chiefComplaint: "发热 38.6℃，咽痛一天",
    },
    {
      name: "苏洋",
      gender: "male",
      age: 41,
      birthDate: new Date("1985-11-07T00:00:00.000Z"),
      heightCm: 176,
      weightKg: 82,
      bloodType: "O",
      constitution: "湿热质",
      habits: "每天坐十小时，几乎不运动，喜欢冰饮",
      allergies: null,
      chronicDisease: null,
      chiefComplaint: "腰背酸痛，久坐后明显",
    },
    {
      name: "徐清",
      gender: "female",
      age: 65,
      birthDate: new Date("1961-02-14T00:00:00.000Z"),
      heightCm: 158,
      weightKg: 58,
      bloodType: "A",
      constitution: "阳虚质",
      habits: "早起散步四十分钟，饮食清淡",
      allergies: "无",
      chronicDisease: "类风湿关节炎八年",
      chiefComplaint: "晨起手指僵硬，双侧对称",
    },
  ];

  const created = [];
  for (let i = 0; i < patients.length; i += 1) {
    const row = await prisma.patient.create({
      data: {
        ...patients[i],
        ownerId: demo.id,
        createdAt: ago(30 - i * 3),
        updatedAt: ago(i),
      },
    });
    created.push(row);
  }

  const [lin, chen, zhou, , , xu] = created;

  /* ---------------------------------------------------------- 用药 */
  await prisma.medication.createMany({
    data: [
      {
        patientId: lin.id,
        drugName: "布洛芬缓释胶囊",
        dosage: "300mg",
        frequency: "每日两次",
        startDate: ago(20),
        isActive: true,
        note: "胃不舒服时饭后吃",
      },
      {
        patientId: chen.id,
        drugName: "氨氯地平片",
        dosage: "5mg",
        frequency: "每日一次",
        startDate: ago(400),
        isActive: true,
        note: "早饭后",
      },
      {
        patientId: chen.id,
        drugName: "氨溴索口服液",
        dosage: "10ml",
        frequency: "每日三次",
        startDate: ago(10),
        endDate: ago(2),
        isActive: false,
        note: "咳嗽缓解后停用",
      },
      {
        patientId: xu.id,
        drugName: "甲氨蝶呤片",
        dosage: "10mg",
        frequency: "每周一次",
        startDate: ago(700),
        isActive: true,
        note: "处方药，需定期查肝肾功能",
      },
    ],
  });

  /* ------------------------------------------------------ 历史问诊 */
  const chenConsult = await prisma.consultation.create({
    data: {
      patientId: chen.id,
      title: "夜间干咳两周",
      status: "archived",
      summary:
        "患者主诉夜间干咳两周、爬楼气短，有二十年吸烟史。对话中确认无咳血、无夜间憋醒、无发热，静息状态下不气短。已建议记录咳嗽频率与诱因、减少吸烟、避免二手烟，并提示若出现静息气短、咳血或夜间憋醒应尽快就诊呼吸科。未下诊断，未调整任何在服药物。",
      createdAt: ago(9, 21),
      updatedAt: ago(9, 21),
    },
  });

  const chenMessages = [
    {
      role: "user",
      content: "夜里咳了两周了，最近爬三楼就有点喘。",
      createdAt: ago(9, 20),
    },
    {
      role: "assistant",
      content:
        "夜里咳、活动后气短，这个组合我不太希望你拖着。先确认两件事：咳的时候有痰吗，痰里有没有血丝？另外夜里会不会被憋醒、必须坐起来才能喘？",
      createdAt: ago(9, 20),
    },
    {
      role: "user",
      content: "痰不多，没有血。没有被憋醒，就是躺下之后咳得更厉害。",
      createdAt: ago(9, 21),
    },
    {
      role: "assistant",
      content:
        "好，没有咳血、没有夜间憋醒，这两条先放下一半的心。你有二十年吸烟史，咳嗽加活动后气短，还是建议这周去呼吸内科做个肺功能，别只靠止咳药压着。这几天先记一下夜里几点咳得最重、有没有诱因；烟尽量停一停。如果出现静息状态下也气短、或痰里带血，别等门诊，直接去医院。需要提醒的是，你档案里在服氨氯地平，任何处方药调整都请遵医嘱，不要自行加减。",
      createdAt: ago(9, 21),
    },
  ];
  for (const m of chenMessages) {
    await prisma.message.create({ data: { ...m, consultationId: chenConsult.id } });
  }

  const zhouConsult = await prisma.consultation.create({
    data: {
      patientId: zhou.id,
      title: "偏头痛又犯了",
      status: "active",
      createdAt: ago(2, 22),
      updatedAt: ago(2, 22),
    },
  });
  await prisma.message.createMany({
    data: [
      {
        consultationId: zhouConsult.id,
        role: "user",
        content: "这几天右边太阳穴一跳一跳地痛，看到光就想吐。",
        createdAt: ago(2, 21),
      },
      {
        consultationId: zhouConsult.id,
        role: "assistant",
        content:
          "一侧跳痛、怕光、还恶心想吐，这是偏头痛比较典型的样子。想再确认两点：这次痛了多久，之前有没有类似发作？另外最近睡眠和用眼有没有明显变化？",
        createdAt: ago(2, 22),
      },
    ],
  });

  /* ------------------------------------------------------ 结论卡片 */
  await prisma.note.createMany({
    data: [
      {
        patientId: lin.id,
        consultationId: null,
        title: "饭后右上腹痛要先排除胆囊",
        content:
          "连续三天饭后右上腹隐痛，吃油腻后更明显。下次门诊直接跟医生说这个规律，问一下要不要做腹部超声。",
        tags: "右上腹,胆囊,待就诊",
        isFavorite: true,
        createdAt: ago(3),
      },
      {
        patientId: lin.id,
        title: "青霉素过敏要每次都说",
        content: "开药前主动说一遍：青霉素过敏，曾出现皮疹。包括拔牙、做检查用的预防性抗生素。",
        tags: "过敏,用药安全",
        isFavorite: false,
        createdAt: ago(12),
      },
      {
        patientId: chen.id,
        title: "咳嗽日记记这三项",
        content: "夜里几点最重、有没有诱因、痰的颜色和量。坚持一周，门诊时给医生看。",
        tags: "咳嗽,记录",
        isFavorite: true,
        createdAt: ago(8),
      },
      {
        patientId: xu.id,
        title: "甲氨蝶呤是处方药，不能自己停",
        content:
          "每周一次 10mg，已经在吃七年。任何调整都要风湿科医生决定；感冒发烧或需要吃其他药时，先问医生会不会冲突。",
        tags: "处方药,类风湿",
        isFavorite: true,
        createdAt: ago(5),
      },
    ],
  });

  /* ------------------------------------------- 另一个账号（越权测试用） */
  await prisma.patient.create({
    data: {
      ownerId: other.id,
      name: "外部测试患者",
      gender: "male",
      age: 30,
      chiefComplaint: "用于验证跨账号访问返回 404",
      allergies: "无",
    },
  });

  console.log("seed 完成：");
  console.log(`  主账号   ${DEMO_EMAIL} / ${PASSWORD}（6 份档案）`);
  console.log(`  对照账号 ${OTHER_EMAIL} / ${PASSWORD}（1 份档案，用于越权测试）`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
