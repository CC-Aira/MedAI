import { getCurrentUser } from "@/lib/auth";
import { ok, toErrorResponse, unauthorized } from "@/lib/http";
import { getGrowth } from "@/lib/growth";

/** GET /api/growth —— 当前账号的成长数据（只聚合自己的患者） */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    return ok({ growth: await getGrowth(user.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
