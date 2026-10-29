import { PrismaClient } from "@prisma/client";

/**
 * SQLite 的两个默认值在单机多人场景下都不合适，装配客户端时先校正：
 *
 * 1) **连接池**：Prisma 默认按 CPU 核数开一堆连接，而 SQLite 的写入是整库串行的。
 *    连接越多越容易撞上 `SQLITE_BUSY` —— 全家几台手机同时打卡就是这个场景。
 *    单文件库压到 1 条连接，写入在进程内排队，反而更快，也不会报 busy。
 * 2) **journal_mode**：默认的 DELETE 模式下一个写事务会锁住整个库，读只能干等。
 *    换成 WAL 后读走自己的快照、写不再阻塞读，打卡和翻档案可以同时进行。
 *
 * 换 Postgres 时这两段都会被跳过（URL 不是 `file:` 开头），不用改代码。
 */
function tuneSqliteUrl(url: string): string {
  if (!url.startsWith("file:")) return url;
  if (url.includes("connection_limit=")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=1`;
}

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = tuneSqliteUrl(process.env.DATABASE_URL);
}

/**
 * Next 的开发模式会热重载模块，每次都 new PrismaClient 会把 SQLite 连接耗光。
 * 挂到 globalThis 上复用同一个实例。
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaTuned?: Promise<void>;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/* --------------------------------------------------------- 连接级校准 */

const isSqlite = (process.env.DATABASE_URL ?? "").startsWith("file:");

/**
 * 这些 PRAGMA 只需要成功一次：
 * - `journal_mode` 写在库文件头里，是**持久**设置，库换成 WAL 以后一直就是 WAL；
 * - `busy_timeout` / `synchronous` 是连接级，但我们只留了一条连接，设一次就够。
 *
 * 故意不 await：模块顶层阻塞会拖慢冷启动，而第一条查询撞上没校准的状态
 * 最多只是慢一点，不会出错。结果缓存进 Promise，热重载不会重复执行。
 */
const ensureTuned: Promise<void> =
  globalForPrisma.prismaTuned ??
  (async () => {
    if (!isSqlite) return;
    try {
      await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL");
      // 写锁被别人占着时最多等 5 秒再报错；默认是 0，一撞就抛
      await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000");
      // WAL 下 NORMAL 已经足够安全（断电最多丢最后一个事务），比 FULL 快很多
      await prisma.$executeRawUnsafe("PRAGMA synchronous = NORMAL");
      // 外键约束 Prisma 自己会开，这里显式声明一次，直连库调试时也一致
      await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    } catch (err) {
      // 只读文件系统 / 库被别的进程锁着时不该让整个应用起不来
      console.warn("[medai] SQLite 校准失败，按默认参数继续：", err);
    }
  })();

globalForPrisma.prismaTuned = ensureTuned;

/** 自检脚本用：等校准跑完，确认 WAL 真的生效了 */
export const dbReady = ensureTuned;
