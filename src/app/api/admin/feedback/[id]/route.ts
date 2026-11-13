import type { NextRequest } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { ok, readJson, toErrorResponse, unauthorized } from "@/lib/http";
import { writeAdminLog } from "@/lib/admin-log";
import { FEEDBACK_STATUS, handleFeedback, toStatus } from "@/lib/feedback";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/admin/feedback/[id] —— 改处理状态 / 写回复 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await getCurrentAdmin();
    if (!admin) return unauthorized();

    const { id } = await ctx.params;
    const body = await readJson(req);
    const row = await handleFeedback(id, body);

    const bits: string[] = [];
    if ("status" in body) bits.push(FEEDBACK_STATUS[toStatus(body.status)]);
    // 回复内容不进日志：日志是审计用的，不是内容仓库
    if ("reply" in body) bits.push(body.reply ? "写了回复" : "清除回复");

    await writeAdminLog({
      actorId: admin.id,
      actorEmail: admin.email,
      action: "feedback.handle",
      target: `用户反馈（${row.userEmail ?? "未知用户"}）`,
      detail: bits.length ? bits.join("、") : undefined,
    });

    return ok({ feedback: row });
  } catch (err) {
    return toErrorResponse(err);
  }
}
