import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { toErrorResponse, unauthorized } from "@/lib/http";
import { readAttachmentBytes } from "@/lib/attachment-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/attachments/[id]/raw
 *
 * 原始文件读取。附件放在 data/ 而不是 public/，就是为了让每次访问都过一遍登录校验：
 * 病历照片不该有一个"知道 URL 就能看"的静态地址。
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const { row, bytes } = await readAttachmentBytes(user.id, id);

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": row.mimeType || "application/octet-stream",
        "Content-Length": String(bytes.length),
        // 私有缓存：浏览器自己可以省一次请求，中间代理不许存
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
