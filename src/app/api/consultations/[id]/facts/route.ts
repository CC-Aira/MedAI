import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ok, toErrorResponse, unauthorized, readJson } from "@/lib/http";
import { scanFacts } from "@/lib/consult-flow";
import { applyFacts } from "@/lib/facts";
import { requireOwnedConsultation } from "@/lib/consultations";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/consultations/[id]/facts
 * 只扫描、只返回候选 —— 一个字都不写库。
 * 患者必须在前端一条条勾选，再走 PATCH 才算同意。
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const { candidates, skipped } = await scanFacts(user.id, id);
    return ok({ candidates, skipped });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/consultations/[id]/facts
 * 应用患者确认过的条目：fill / conflict 写档案字段，add 新增用药。
 * 每条重新校验（白名单 + 类型 + 长度），单次 ≤ 20 条。
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const body = await readJson(req);

    // 认门：问诊必须属于自己，再由它定位到患者
    const consultation = await requireOwnedConsultation(user.id, id);
    const patient = await applyFacts(user.id, consultation.patientId, body);

    // 返回改完之后的完整档案，前端整体覆盖
    return ok({ patient });
  } catch (err) {
    return toErrorResponse(err);
  }
}
