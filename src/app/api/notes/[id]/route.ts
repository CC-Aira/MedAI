import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ok, toErrorResponse, unauthorized, readJson } from "@/lib/http";
import { deleteNote, parseNotePatch, updateNote } from "@/lib/notes";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/notes/[id] —— 改内容或切换星标（星标决定它能不能进提示词前排） */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const body = await readJson(req);
    const patch = parseNotePatch(body);

    const notes = await updateNote(user.id, id, patch);
    return ok({ notes });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE /api/notes/[id] —— 幂等：第二次调用 404 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const notes = await deleteNote(user.id, id);
    return ok({ notes });
  } catch (err) {
    return toErrorResponse(err);
  }
}
