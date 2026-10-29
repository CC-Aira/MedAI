import { clearSessionCookie } from "@/lib/auth";
import { ok, toErrorResponse } from "@/lib/http";

/** 登出：幂等，没登录也能调 */
export async function POST() {
  try {
    await clearSessionCookie();
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
