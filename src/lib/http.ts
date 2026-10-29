import { NextResponse } from "next/server";

/** 带 HTTP 状态码的业务异常，由路由的 catch 统一转成响应 */
export class HttpError extends Error {
  readonly status: number;
  readonly extra?: Record<string, unknown>;

  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.extra = extra;
  }
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as unknown, { status: 200, ...init });
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json(data as unknown, { status: 201 });
}

export function fail(
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export const badRequest = (message: string, extra?: Record<string, unknown>) =>
  fail(400, message, extra);
export const unauthorized = () => fail(401, "请先登录");
export const notFound = (message = "没有找到这份资料") => fail(404, message);
export const serviceUnavailable = (message: string) => fail(503, message);

/** 把任意异常收敛成响应：HttpError 按声明的状态码，其余一律 500 且不外泄栈 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return fail(err.status, err.message, err.extra);
  }
  console.error("[medai] unhandled route error:", err);
  return fail(500, "服务器开小差了，请稍后再试");
}

/** 读取 JSON body，要求必须是对象；空 body 视为非法 */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "请求体不是合法的 JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "请求体必须是 JSON 对象");
  }
  return raw as Record<string, unknown>;
}
