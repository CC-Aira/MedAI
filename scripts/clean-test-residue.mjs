/**
 * 清掉 e2e 测试留在库里的残渣（只认明确的：空问诊 + 测试用药 + 指定 id）。
 *   node scripts/clean-test-residue.mjs          # 只看
 *   node scripts/clean-test-residue.mjs --apply  # 真删
 *
 * 为什么单独一个脚本：check-consult-fixes 会真的聊一段、真的把药写进档案，
 * 收尾没清干净就成了用户眼里的"脏数据"。留个可复现的清理入口，
 * 也方便以后任何一次测试失误后收拾。
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

// 只清「确定是测试产生」的三类，别碰用户自己聊的
const EMPTY = await prisma.consultation.findMany({
  where: { messages: { none: {} } },
  select: { id: true, title: true, createdAt: true },
});

// 测试里那句固定的话：命中的问诊一定不是用户自己聊的
const FAKE = await prisma.consultation.findMany({
  where: { messages: { some: { content: { contains: "二甲双胍，一次一片，一天两次" } } } },
  select: { id: true, title: true, createdAt: true },
});

const TEST_DRUG = await prisma.medication.findMany({
  where: { drugName: { in: ["二甲双胍", "二甲双胍片", "端到端提醒测试药", "诊断用提醒药"] } },
  select: { id: true, drugName: true, createdAt: true },
});

console.log(`空问诊 ${EMPTY.length} 条`);
for (const c of EMPTY) console.log(`  ${c.createdAt.toISOString()} ${c.title}`);
console.log(`测试话术问诊 ${FAKE.length} 条`);
for (const c of FAKE) console.log(`  ${c.createdAt.toISOString()} ${c.title}`);
console.log(`测试用药 ${TEST_DRUG.length} 条`);
for (const m of TEST_DRUG) console.log(`  ${m.createdAt.toISOString()} ${m.drugName}`);

if (!apply) {
  console.log("\n（只是看看。要真删就加 --apply）");
} else {
  const ids = [...new Set([...EMPTY.map((c) => c.id), ...FAKE.map((c) => c.id)])];
  const a = await prisma.consultation.deleteMany({ where: { id: { in: ids } } });
  const b = await prisma.medication.deleteMany({ where: { id: { in: TEST_DRUG.map((m) => m.id) } } });
  console.log(`\n删除：问诊 ${a.count} 条，用药 ${b.count} 条`);
}
await prisma.$disconnect();
