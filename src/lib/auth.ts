import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";

export { hashPassword, verifyPassword } from "./password";

/** Cookie 名与有效期：7 天 */
export const SESSION_COOKIE = "medai_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type SessionUser = {
  id: string;
  email: string;
  createdAt: Date;
};

/* ------------------------------------------------------------- 会话 token */

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (value && value.length >= 16) return value;
  if (process.env.NODE_ENV === "production") {
    // 生产环境没配密钥就签名，等于把会话钥匙交给所有人 —— 直接拒绝启动逻辑
    throw new Error("SESSION_SECRET 未配置或过短（至少 16 字符），生产环境必须设置");
  }
  // 开发环境给一个固定兜底，保证热重载不会把所有人踢下线
  return "medai-dev-secret-do-not-use-in-production";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

type TokenPayload = { uid: string; exp: number };

/** token = base64url(JSON).HMAC-SHA256，7 天过期 */
export function createSessionToken(userId: string, now = Date.now()): string {
  const payload: TokenPayload = {
    uid: userId,
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readSessionToken(token: string | undefined | null): TokenPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(body);

  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  const { uid, exp } = payload as Partial<TokenPayload>;
  if (typeof uid !== "string" || !uid) return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  if (exp * 1000 <= Date.now()) return null;

  return { uid, exp };
}

/* ------------------------------------------------------------ Cookie 读写 */

export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

/* --------------------------------------------------------------- 取用户 */

/**
 * 接口用：未登录返回 null，由调用方回 401。
 * 这里顺带查一次库，账号被删掉时旧 token 立刻失效。
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const payload = readSessionToken(store.get(SESSION_COOKIE)?.value);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.uid },
    select: { id: true, email: true, createdAt: true },
  });
  return user ?? null;
}

/**
 * 页面用：未登录直接跳登录页。
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
