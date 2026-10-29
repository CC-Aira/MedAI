import { getCurrentUser } from "@/lib/auth";
import { ok, toErrorResponse, unauthorized } from "@/lib/http";
import { listTodayBoard } from "@/lib/medication-board";

/**
 * GET /api/medications/board
 *
 * 木牌上那份「全家今天」的快照。首屏由服务端直接算好塞进 props，
 * 这个接口给**打卡之后**用：点完一次就重新拉一遍，数字、遗漏、排序才是新的。
 *
 * 和 /api/medications/today 的区别：那个只回答「此刻该不该弹通知」，
 * 这个是给眼睛看的全表 —— 谁今天几次、哪次过点了。
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    return ok(await listTodayBoard(user.id));
  } catch (err) {
    return toErrorResponse(err);
  }
}
