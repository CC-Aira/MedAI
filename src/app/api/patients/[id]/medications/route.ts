import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { created, ok, toErrorResponse, unauthorized, readJson } from "@/lib/http";
import {
  createMedication,
  listMedications,
  parseMedicationInput,
} from "@/lib/medications";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/patients/[id]/medications */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    return ok({ medications: await listMedications(user.id, id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/patients/[id]/medications —— 新增用药，返回完整列表 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const body = await readJson(req);
    const input = parseMedicationInput(body, false);

    const medications = await createMedication(user.id, id, input);
    return created({ medications });
  } catch (err) {
    return toErrorResponse(err);
  }
}
