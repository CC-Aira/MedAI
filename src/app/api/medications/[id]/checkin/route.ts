import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ok, readJson, toErrorResponse, unauthorized } from "@/lib/http";
import { checkinMedication, undoCheckin } from "@/lib/medications";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/medications/[id]/checkin
 * 打卡吃药，body 可选 { date: "2026-10-24" }，默认今天。
 * 漏服是「过去的日子没有打卡」算出来的，所以打卡只补今天/过去某天即可。
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    let body: Record<string, unknown> = {};
    try {
      body = await readJson(req);
    } catch {
      // 允许空 body：那就是"今天"
    }

    const medications = await checkinMedication(user.id, id, body.date);
    return ok({ medications });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE /api/medications/[id]/checkin?date=2026-10-24 —— 点错了，撤销 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const date = new URL(req.url).searchParams.get("date") ?? undefined;
    const medications = await undoCheckin(user.id, id, date);
    return ok({ medications });
  } catch (err) {
    return toErrorResponse(err);
  }
}
