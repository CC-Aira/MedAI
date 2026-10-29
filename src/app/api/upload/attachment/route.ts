import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { HttpError, created, toErrorResponse, unauthorized } from "@/lib/http";
import { LIMITS } from "@/lib/constants";
import { createAttachment } from "@/lib/attachment-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OCR 是 CPU 活，给足时间，别让默认超时把上传掐断 */
export const maxDuration = 60;

/**
 * POST /api/upload/attachment
 *
 * 上传一份给 AI 看的资料（病历照片 / 化验单 / PDF / Word / 文本）。
 * 解析（图片走本地 OCR）在这里同步做完，返回一段可读正文的摘要信息。
 *
 * 二进制本身不进提示词 —— 模型是纯文本的，只吃这里提取出来的文字。
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    // 先按 Content-Length 挡掉超大请求，别把它读进内存
    const declared = Number(req.headers.get("content-length") || "0");
    if (Number.isFinite(declared) && declared > LIMITS.attachBytes + 256 * 1024) {
      throw new HttpError(413, "文件不能超过 10MB");
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new HttpError(400, "请用 multipart/form-data 上传文件");
    }

    const file = form.get("file");
    if (!file || typeof file === "string") {
      throw new HttpError(400, "没有收到文件");
    }
    if (file.size === 0) throw new HttpError(400, "文件是空的");
    if (file.size > LIMITS.attachBytes) throw new HttpError(413, "文件不能超过 10MB");

    const buffer = Buffer.from(await file.arrayBuffer());
    const attachment = await createAttachment(user.id, file.name || "附件", buffer);

    return created({ attachment });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** 探活：前端可以据此判断附件功能是否可用 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    return Response.json({ ok: true, maxBytes: LIMITS.attachBytes });
  } catch (err) {
    return toErrorResponse(err);
  }
}
