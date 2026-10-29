import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { readJson, created, fail, toErrorResponse, HttpError } from "@/lib/http";
import { LIMITS } from "@/lib/constants";
import { requireText } from "@/lib/validate";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** 一个 IP 一小时最多建 5 个账号：注册也要跑 scrypt，批量刷同样是 CPU 攻击 */
const REGISTER_LIMIT = 5;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;

/**
 * 注册。归属只能由服务器决定：新建的 User 和自己写的 Patient 天然只有自己能看到。
 * 顺序：限流 429 → 校验输入 400 → 唯一性 409 → 写库。
 */
export async function POST(req: NextRequest) {
  try {
    const gate = rateLimit(
      `register:ip:${clientIp(req)}`,
      REGISTER_LIMIT,
      REGISTER_WINDOW_MS,
    );
    if (!gate.allowed) {
      throw new HttpError(429, `创建太频繁了，${gate.retryAfter} 秒后再试`, {
        retryAfter: gate.retryAfter,
      });
    }

    const body = await readJson(req);
    const email = requireText(body.email, "邮箱", LIMITS.email).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "邮箱格式不太对");

    const password = requireText(
      body.password,
      "密码",
      LIMITS.passwordMax,
      LIMITS.passwordMin,
    );

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new HttpError(409, "这个邮箱已经注册过了");

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash },
      select: { id: true, email: true, createdAt: true },
    });

    await setSessionCookie(user.id);
    return created({ user });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function GET() {
  return fail(405, "请用 POST 注册");
}
