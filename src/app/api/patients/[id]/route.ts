import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ok, toErrorResponse, unauthorized, readJson } from "@/lib/http";
import {
  deletePatient,
  findOwnedPatient,
  listPatients,
  parsePatientInput,
  requireOwnedPatient,
  serializePatient,
  updatePatient,
} from "@/lib/patients";
import { removeAvatarFile } from "@/lib/avatar";
import { hasOwn } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/patients/[id] */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const patient = await requireOwnedPatient(user.id, id);
    return ok({ patient: serializePatient(patient) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/patients/[id]
 * 只改请求里出现过的字段：用 hasOwnProperty 判断，没传的字段原样保留。
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const body = await readJson(req);

    // 归属先确认，再解析字段（顺序：认门 404 在写之前）
    const existing = await requireOwnedPatient(user.id, id);
    const patch = parsePatientInput(body, { partial: true });

    if (Object.keys(patch).length === 0) {
      return ok({ patient: serializePatient(existing), patients: await listPatients(user.id) });
    }

    const patient = await updatePatient(user.id, id, patch);

    // 换了头像就把旧文件清掉（旧文件在 public 里，不清理会越堆越多）
    if (
      hasOwn(body, "avatarUrl") &&
      existing.avatarUrl &&
      existing.avatarUrl !== patient.avatarUrl
    ) {
      await removeAvatarFile(existing.avatarUrl);
    }

    return ok({ patient, patients: await listPatients(user.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/patients/[id]
 * 幂等：第一次 200 返回剩余列表，第二次 404。
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;

    const patient = await findOwnedPatient(user.id, id);
    const avatarUrl = patient?.avatarUrl ?? null;

    const patients = await deletePatient(user.id, id);
    await removeAvatarFile(avatarUrl);

    return ok({ patients });
  } catch (err) {
    return toErrorResponse(err);
  }
}
