import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  created,
  ok,
  toErrorResponse,
  unauthorized,
  HttpError,
} from "@/lib/http";
import { createConsultation, listConsultations } from "@/lib/consultations";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/patients/[id]/consultations */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    return ok({ consultations: await listConsultations(user.id, id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/patients/[id]/consultations —— 开一次新问诊 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;

    // 允许空 body（标题自动用主诉）
    let body: Record<string, unknown> = {};
    const text = await req.text();
    if (text.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new HttpError(400, "请求体不是合法的 JSON");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new HttpError(400, "请求体必须是 JSON 对象");
      }
      body = parsed as Record<string, unknown>;
    }

    const consultation = await createConsultation(user.id, id, body);
    return created({ consultation });
  } catch (err) {
    return toErrorResponse(err);
  }
}
