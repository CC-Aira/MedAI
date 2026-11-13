import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { created, ok, readJson, toErrorResponse, unauthorized } from "@/lib/http";
import { createFeedback, listMyFeedback } from "@/lib/feedback";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * /api/feedback —— 用户自己提交与查看反馈。
 *
 * 只认当前登录用户：userId 从会话里取，绝不由请求体传入，
 * 否则谁都能顶着别人的名字提交。
 */

/** GET：我提交过的反馈（新的在前） */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const rows = await listMyFeedback(user.id);
    return ok({ feedback: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST：提交一条反馈 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    // 防刷：同一个人十分钟最多 10 条，够正常用，又能挡住脚本灌水
    const limit = rateLimit(`feedback:${user.id}:${clientIp(req)}`, 10, 10 * 60 * 1000);
    if (!limit.allowed) {
      return ok(
        { error: `提交太频繁了，请 ${limit.retryAfter} 秒后再试` },
        { status: 429 },
      );
    }

    const body = await readJson(req);
    const row = await createFeedback(user.id, body);
    return created({ feedback: row });
  } catch (err) {
    return toErrorResponse(err);
  }
}
