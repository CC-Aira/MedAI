import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ok, toErrorResponse, unauthorized, readJson } from "@/lib/http";
import {
  deleteConsultation,
  getConsultationDetail,
  updateConsultationStatus,
} from "@/lib/consultations";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/consultations/[id] —— 详情 + 全部消息 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    return ok({ consultation: await getConsultationDetail(user.id, id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/consultations/[id] —— 目前只用于归档 / 取消归档。
 * 归档不删除任何消息，摘要和历史仍然参与后续问诊的长期记忆。
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const body = await readJson(req);
    const consultation = await updateConsultationStatus(user.id, id, body.status);
    return ok({ consultation });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE /api/consultations/[id] —— 幂等：第二次调用 404 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const consultations = await deleteConsultation(user.id, id);
    return ok({ consultations });
  } catch (err) {
    return toErrorResponse(err);
  }
}
