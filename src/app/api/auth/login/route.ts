import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { setSessionCookie, verifyPassword } from "@/lib/auth";
import { readJson, ok, fail, toErrorResponse, HttpError } from "@/lib/http";
import { LIMITS } from "@/lib/constants";
import { requireText } from "@/lib/validate";
import { clientIp, rateLimit, resetRateLimit } from "@/lib/rate-limit";

/** 同一 IP 15 分钟内最多错 8 次；再错就等窗口过去 */
const IP_LIMIT = 8;
/** 同一个账号单独再数一遍，换 IP 也绕不过 */
const ACCOUNT_LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * 登录。邮箱不存在和密码错误返回同一句话，不让攻击者用它探测账号是否存在。
 *
 * 限流分两层：按 IP（挡「一台机器撞一堆账号」）和按账号（挡「一堆机器撞一个账号」）。
 * scrypt 校验本身要几十毫秒，没有上限的话每一发都在烧 CPU。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readJson(req);
    const email = requireText(body.email, "邮箱", LIMITS.email).toLowerCase();
    const password = requireText(body.password, "密码", LIMITS.passwordMax, 1);

    const ipKey = `login:ip:${clientIp(req)}`;
    const accountKey = `login:acct:${email}`;

    // 先看 IP 额度：已经被打满就直接回 429，连密码都不用校验
    const ipGate = rateLimit(ipKey, IP_LIMIT, WINDOW_MS);
    if (!ipGate.allowed) {
      throw new HttpError(429, `试太多次了，${ipGate.retryAfter} 秒后再试`, {
        retryAfter: ipGate.retryAfter,
      });
    }

    const accountGate = rateLimit(accountKey, ACCOUNT_LIMIT, WINDOW_MS);
    if (!accountGate.allowed) {
      throw new HttpError(
        429,
        `这个账号被连续试错太多次，${accountGate.retryAfter} 秒后再试`,
        { retryAfter: accountGate.retryAfter },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, createdAt: true },
    });

    const valid = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !valid) throw new HttpError(401, "邮箱或密码不对");

    // 输对了：两个计数一起清空，之前的失败不该继续压着他
    resetRateLimit(ipKey);
    resetRateLimit(accountKey);

    await setSessionCookie(user.id);
    return ok({
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function GET() {
  return fail(405, "请用 POST 登录");
}
