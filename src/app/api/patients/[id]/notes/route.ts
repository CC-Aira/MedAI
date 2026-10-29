import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { created, ok, toErrorResponse, unauthorized, readJson } from "@/lib/http";
import { createNote, listNotes } from "@/lib/notes";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/patients/[id]/notes —— 星标优先，其次新的在前 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    return ok({ notes: await listNotes(user.id, id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/patients/[id]/notes —— 患者亲手记下的结论
 * 这一层不做任何自动生成：AI 可以整理客观事实，但"哪句重要"只有患者知道。
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const body = await readJson(req);

    const note = await createNote(user.id, id, body);
    return created({ note, notes: await listNotes(user.id, id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
