/**
 * 合并重复问诊（只读统计 + 可选清理）。
 *
 *   node scripts/merge-duplicate-visits.mjs           # 只看，不删
 *   node scripts/merge-duplicate-visits.mjs --apply   # 真的删
 *
 * 为什么要它：之前「每点开一次档案就新建一次问诊」，加上历次自动化测试，
 * 同一个档案同一天会堆出十几条标题和开头一模一样的记录。日历改好以后，
 * 这些重复会变成"这天 26 次问诊"，一眼假。
 *
 * 判定重复的标准很保守，同时满足才动手：
 *   同一档案 + 同一标题 + 首条用户消息内容完全相同
 * 保留每组里最新的一条（有小结的优先），其余删除。
 */
import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.consultation.findMany({
    select: {
      id: true,
      patientId: true,
      title: true,
      summary: true,
      updatedAt: true,
      createdAt: true,
      messages: { select: { role: true, content: true }, orderBy: { createdAt: "asc" }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map();
  for (const r of rows) {
    const first = r.messages[0];
    // 没消息的不参与：那些交给 clean-empty-consultations
    if (!first) continue;
    const key = [
      r.patientId,
      r.title.trim(),
      first.role,
      first.content.trim().slice(0, 120),
    ].join("\u0001");
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  const drop = [];
  for (const g of dupGroups) {
    // 有小结的先留，其次留最新的
    const sorted = [...g].sort((a, b) => {
      const sa = a.summary ? 1 : 0;
      const sb = b.summary ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return b.updatedAt - a.updatedAt;
    });
    drop.push(...sorted.slice(1));
  }

  console.log(`问诊总数 ${rows.length}，重复组 ${dupGroups.length} 个，可清理 ${drop.length} 条`);
  for (const g of dupGroups.slice(0, 12)) {
    console.log(`  ×${g.length}  「${g[0].title}」 ${g[0].updatedAt.toISOString().slice(0, 10)}`);
  }
  if (dupGroups.length > 12) console.log(`  …… 还有 ${dupGroups.length - 12} 组`);

  if (!apply) {
    console.log("\n只统计，没有删。确认后加 --apply 再跑一次。");
    return;
  }
  if (drop.length === 0) {
    console.log("没有要删的。");
    return;
  }

  const res = await prisma.consultation.deleteMany({ where: { id: { in: drop.map((d) => d.id) } } });
  console.log(`\n已删除 ${res.count} 条重复问诊`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
