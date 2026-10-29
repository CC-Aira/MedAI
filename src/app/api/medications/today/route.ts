import { getCurrentUser } from "@/lib/auth";
import { ok, toErrorResponse, unauthorized } from "@/lib/http";
import { listTodayReminders } from "@/lib/medication-today";

/**
 * GET /api/medications/today
 *
 * 浏览器通知轮询这个接口：返回「此刻该吃、今天还没打卡」的药，
 * 以及今天稍晚要吃的几条（用来显示「下一个 14:30」）。
 *
 * 前端每 25 秒左右调一次，所以这里只做一次索引查询 + 纯计算，不写库。
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    return ok(await listTodayReminders(user.id));
  } catch (err) {
    return toErrorResponse(err);
  }
}
