import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ok, toErrorResponse, unauthorized } from "@/lib/http";
import { deleteLabReport } from "@/lib/lab-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/lab-reports/[id] —— 抽错了就删掉重传，结构化数据一起清 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    await deleteLabReport(user.id, id);
    return ok({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
