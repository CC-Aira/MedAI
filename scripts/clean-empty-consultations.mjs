/**
 * 清理空问诊：一句话都没说过的 Consultation。
 *
 *   node scripts/clean-empty-consultations.mjs           # 只看，不删
 *   node scripts/clean-empty-consultations.mjs --apply   # 真的删
 *
 * 这批数据是旧逻辑留下的：以前每点开一次档案就 POST 一条新问诊，
 * 用户关掉面板就成了一条永远没有消息的空壳。实测一个档案堆了 264 条，
 * 把真正的问诊记录挤到看不见。
 *
 * 只删 messages 为空、也没有 notes（结论）和 visitSheet（就诊摘要）的 ——
 * 剩下的都是真有人写过东西的，一条都不能动。
 */
import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

async function main() {
  const all = await prisma.consultation.findMany({
    select: {
      id: true,
      patientId: true,
      status: true,
      createdAt: true,
      _count: { select: { messages: true, notes: true } },
      visitSheet: true,
      summary: true,
    },
  });

  const empty = all.filter(
    (c) =>
      c._count.messages === 0 &&
      c._count.notes === 0 &&
      !c.visitSheet &&
      !c.summary,
  );
  const keep = all.length - empty.length;

  console.log(`问诊总数 ${all.length}，其中空壳 ${empty.length}，有内容的 ${keep}`);

  const byPatient = new Map();
  for (const c of empty) byPatient.set(c.patientId, (byPatient.get(c.patientId) || 0) + 1);
  for (const [pid, n] of byPatient) console.log(`  档案 ${pid}: ${n} 条空壳`);

  if (!apply) {
    console.log("\n只统计，没有删。确认后加 --apply 再跑一次。");
    return;
  }
  if (empty.length === 0) {
    console.log("没有要删的。");
    return;
  }

  const res = await prisma.consultation.deleteMany({
    where: { id: { in: empty.map((c) => c.id) } },
  });
  console.log(`\n已删除 ${res.count} 条空问诊`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
