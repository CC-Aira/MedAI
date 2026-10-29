/**
 * 进程内滑动窗口限流。
 *
 * 为什么要它：登录密码是 scrypt 慢哈希（单次要几十毫秒），但没有次数上限的话，
 * 攻击者可以慢慢试，而每一次尝试都在吃服务器的 CPU。档案照片、化验单这些东西
 * 一旦被撞开，代价比「多打一个补丁」大得多。
 *
 * 为什么不用 Redis：本项目是**单进程单机**部署（`next start` 或一个容器），
 * 进程内一张表就够，还省一个要运维的组件。**如果哪天起了多实例**，
 * 这张表会变成「每个实例各算各的」，那时必须换成 Redis 或库表计数。
 */

type Bucket = {
  /** 窗口内已经用掉几次 */
  used: number;
  /** 窗口什么时候归零 */
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

/** 顺手清掉过期桶，避免 Map 无限增长（攻击者换 IP 刷 key 时尤其重要） */
function sweep(now: number): void {
  if (buckets.size < 512) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  /** 还剩几次，用于给用户提示 */
  remaining: number;
  /** 还要等多少秒才能再试 */
  retryAfter: number;
};

/**
 * 记一次尝试并判断是否放行。
 *
 * @param key      限流维度，例如 `login:ip:1.2.3.4`
 * @param limit    窗口内最多几次
 * @param windowMs 窗口长度
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { used: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }

  bucket.used += 1;
  const remaining = Math.max(0, limit - bucket.used);
  return {
    allowed: bucket.used <= limit,
    remaining,
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/** 成功之后清掉计数：密码输对了，之前的失败不该继续压着他 */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * 取客户端地址。
 *
 * 反向代理后面（Nginx / Caddy）必须用 `X-Forwarded-For` 的第一段，
 * 否则所有人共享一个 127.0.0.1，一个人输错三次就把全家锁死。
 * 直连时这个头可以被伪造 —— 但它只是限流维度，伪造的代价是「换个 key 重来」，
 * 跟没有限流相比仍然好得多（真正的强约束靠密码本身和 scrypt）。
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "local";
}
