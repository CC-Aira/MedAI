import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { HttpError, created, ok, readJson, toErrorResponse, unauthorized } from "@/lib/http";
import { createLabReportFromAttachment, listLabReports } from "@/lib/lab-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 视觉模型读一张化验单要好幾秒，别让默认超时把请求掐断 */
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/patients/[id]/lab-reports —— 时间倒序，每份都带「较上次」 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    return ok({ reports: await listLabReports(user.id, id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/patients/[id]/lab-reports
 *
 * body: { attachmentId } —— 附件得先用 /api/upload/attachment 传上来。
 * 为什么不在这里直接收 multipart：上传接口已经处理过类型嗅探、OCR 与大小限制，
 * 抽取只关心"这份附件里有什么"，两件事分开，抽取失败也不会丢文件。
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const body = await readJson(req);
    const attachmentId = typeof body.attachmentId === "string" ? body.attachmentId : "";
    if (!attachmentId) throw new HttpError(400, "缺少 attachmentId");

    const report = await createLabReportFromAttachment(user.id, id, attachmentId);
    return created({ report, reports: await listLabReports(user.id, id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
