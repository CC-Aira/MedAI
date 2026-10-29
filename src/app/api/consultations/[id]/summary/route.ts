import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ok, toErrorResponse, unauthorized } from "@/lib/http";
import { generateSummary } from "@/lib/consult-flow";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/consultations/[id]/summary
 * AI 把这次问诊压成一段客观摘要，写进 Consultation.summary，
 * 之后每次开新问诊都会带上最近 3 条摘要当长期记忆。
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    // 内部顺序：认门 404 → 有内容可总结 400 → 查配置 503 → 调 AI
    const saved = await generateSummary(user.id, id);
    // 直接把 { id, summary, updatedAt } 交出去。之前外面又包了一层 { summary }，
    // 前端拿到的「summary」其实是个对象，拼进字符串就成了 [object Object]。
    return ok(saved);
  } catch (err) {
    return toErrorResponse(err);
  }
}
