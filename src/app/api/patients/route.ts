import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { created, ok, toErrorResponse, unauthorized, readJson } from "@/lib/http";
import {
  createPatient,
  listPatients,
  parsePatientInput,
} from "@/lib/patients";

/** GET /api/patients —— 只返回当前账号的档案 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    return ok({ patients: await listPatients(user.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/patients —— 建档
 * 请求体里的 ownerId 一律忽略：归属只由会话里的 user.id 决定。
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const body = await readJson(req);
    const input = parsePatientInput(body, { partial: false });
    const patient = await createPatient(user.id, input);

    // 写操作返回改完之后的完整列表，前端整体覆盖
    return created({ patient, patients: await listPatients(user.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
