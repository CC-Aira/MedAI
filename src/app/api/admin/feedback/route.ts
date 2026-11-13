import type { NextRequest } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { ok, toErrorResponse, unauthorized } from "@/lib/http";
import { listAllFeedback } from "@/lib/feedback";

/**
 * GET /api/admin/feedback?status=open&take=100
 *
 * 全部用户反馈 + 各状态计数（侧栏上的小红点直接用 counts.open）。
 * 内容由用户主动写给平台看，这里返回全文是预期行为。
 */
export async function GET(req: NextRequest) {
  try {
    const admin = await getCurrentAdmin();
    if (!admin) return unauthorized();

    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? undefined;
    const takeRaw = Number(url.searchParams.get("take") ?? "100");

    const result = await listAllFeedback({
      status,
      take: Number.isFinite(takeRaw) ? takeRaw : 100,
    });

    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
