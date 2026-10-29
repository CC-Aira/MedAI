#!/usr/bin/env node
/**
 * SQLite 在线备份。
 *
 *   node scripts/backup-db.mjs              # 备份到 backups/
 *   node scripts/backup-db.mjs --keep 20    # 保留最近 20 份
 *   node scripts/backup-db.mjs --dir D:/bak # 换目录
 *
 * 为什么不用 cp：
 * 库现在是 **WAL 模式**，真实数据可能还在 `dev.db-wal` 里没落盘，直接拷 `dev.db`
 * 会拿到一个看起来完整、其实丢了最近写入的库。`VACUUM INTO` 由 SQLite 自己
 * 导出**一致性快照**，写事务进行中也能安全执行，产物是单个自包含文件。
 *
 * 为什么要手工跑：这是单机部署，没有一堆运维组件。答辩前、改 schema 前、
 * 演示账号数据整理完之后各跑一次，成本一次几百毫秒。
 */
import { readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/* ------------------------------------------------------------------ 参数 */

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const keep = Math.max(1, Number(arg("keep", 10)) || 10);
const outDir = path.resolve(arg("dir", "backups"));

/* --------------------------------------------------- 读 .env（不依赖 --env-file） */

if (!process.env.DATABASE_URL && existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    // 去掉可能的引号，注释行已经被正则排除（没有 = 或 key 不合法）
    process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("file:")) {
  console.error("只支持 SQLite（DATABASE_URL 需要以 file: 开头），当前：" + (url || "未设置"));
  process.exit(1);
}

/** file:./prisma/dev.db?connection_limit=1 → 去掉 query，只留路径 */
const cleanUrl = url.split("?")[0];
// Prisma 的相对路径是相对 schema.prisma 所在目录（prisma/）解析的
const dbRel = cleanUrl.replace(/^file:/, "");
const dbPath = path.isAbsolute(dbRel) ? dbRel : path.resolve("prisma", dbRel);

if (!existsSync(dbPath)) {
  console.error(`找不到数据库文件：${dbPath}`);
  process.exit(1);
}

/* ---------------------------------------------------------------- 备份 */

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const stamp = new Date()
  .toLocaleString("sv-SE") // YYYY-MM-DD HH:mm:ss，本地时区
  .replace(/[-: ]/g, "")
  .slice(0, 14);
const target = path.join(outDir, `medai-${stamp}.db`);

if (existsSync(target)) {
  console.error(`同名备份已存在，稍等一秒再跑：${target}`);
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  // VACUUM INTO 的路径要用正斜杠，Windows 反斜杠会被当成转义
  const safeTarget = target.replace(/\\/g, "/").replace(/'/g, "''");
  await prisma.$executeRawUnsafe(`VACUUM INTO '${safeTarget}'`);

  const { size } = statSync(target);
  console.log(`✅ 已备份 → ${target}  (${(size / 1024).toFixed(0)} KB)`);

  // 校验一下导出的库真的能打开、表都在
  const check = new PrismaClient({ datasources: { db: { url: `file:${safeTarget}` } } });
  try {
    const [users, patients, meds] = await Promise.all([
      check.user.count(),
      check.patient.count(),
      check.medication.count(),
    ]);
    console.log(`   校验通过：${users} 个账号 / ${patients} 份档案 / ${meds} 条用药`);
  } finally {
    await check.$disconnect();
  }
} catch (err) {
  console.error("❌ 备份失败：", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

/* ------------------------------------------------------- 只保留最近 N 份 */

const olds = readdirSync(outDir)
  .filter((f) => /^medai-\d{14}\.db$/.test(f))
  .sort() // 文件名里的时间戳是定长的，字典序就是时间序
  .reverse();

for (const f of olds.slice(keep)) {
  unlinkSync(path.join(outDir, f));
  console.log(`   清掉旧备份 ${f}`);
}

console.log(`   目录里现在有 ${Math.min(olds.length, keep)} 份备份（上限 ${keep}）`);
