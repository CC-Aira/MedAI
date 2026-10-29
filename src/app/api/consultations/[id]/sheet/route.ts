import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ok, readJson, toErrorResponse, unauthorized } from "@/lib/http";
import {
  generateVisitSheet,
  getVisitSheet,
} from "@/lib/consult-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/consultations/[id]/sheet
 * 读已经生成过的那张纸。没生成过返回 { sheet: null }，
 * 前端据此决定是直接展示还是先点一下"整理"。
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const sheet = await getVisitSheet(user.id, id);
    return ok({ sheet });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/consultations/[id]/sheet
 * 生成（或重新生成）就诊摘要。
 *
 * body.local === true 时不碰模型，只用档案和对话原文排一张 —— 
 * 演示现场网络不稳，这条路保证纸一定打得出来。
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    const sheet = await generateVisitSheet(user.id, id, {
      local: body.local === true,
    });
    return ok({ sheet });
  } catch (err) {
    return toErrorResponse(err);
  }
}
