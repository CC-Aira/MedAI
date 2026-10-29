import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ok, toErrorResponse, unauthorized } from "@/lib/http";
import { buildMedicationReminder } from "@/lib/medications";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/medications/[id]/reminder
 *
 * 返回两段提醒文案：站内通知（≤30 字）与邮件正文（≤80 字）。
 * 连续漏服 ≥2 次时，邮件里会多一句关怀；文案里不出现任何用药建议。
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const reminder = await buildMedicationReminder(user.id, id);
    return ok(reminder);
  } catch (err) {
    return toErrorResponse(err);
  }
}
