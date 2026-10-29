import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ok, toErrorResponse, unauthorized, readJson } from "@/lib/http";
import {
  deleteMedication,
  parseMedicationInput,
  updateMedication,
} from "@/lib/medications";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/medications/[id]
 * 「停用」是主操作：传 { isActive: false } 即可，记录仍留在列表底部，可恢复。
 * 也支持顺手改药名/剂量/频次（同样只改出现过的字段）。
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const body = await readJson(req);
    const patch = parseMedicationInput(body, true);

    // 空 patch 由 updateMedication 抛 400，避免空写
    const medications = await updateMedication(user.id, id, patch);
    return ok({ medications });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE /api/medications/[id] —— 次要操作，真正移除这条记录 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const medications = await deleteMedication(user.id, id);
    return ok({ medications });
  } catch (err) {
    return toErrorResponse(err);
  }
}
