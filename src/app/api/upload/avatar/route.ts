import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  HttpError,
  created,
  toErrorResponse,
  unauthorized,
} from "@/lib/http";
import { LIMITS } from "@/lib/constants";
import { removeAvatarFile, saveAvatar } from "@/lib/avatar";
import {
  requireOwnedPatient,
  updatePatient,
} from "@/lib/patients";

export const runtime = "nodejs";

/**
 * POST /api/upload/avatar
 * - 只信文件头的魔数，不信客户端给的 MIME / 文件名
 * - 文件名由服务器生成（randomUUID + 魔数推出的后缀）
 * - 上限 2MB
 * 可选 patientId：传了就把新头像写进该档案，并清掉旧文件。
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    // 先用 Content-Length 挡掉明显超限的请求，别把几十兆读进内存
    const declared = Number(req.headers.get("content-length") || "0");
    if (Number.isFinite(declared) && declared > LIMITS.avatarBytes + 64 * 1024) {
      throw new HttpError(400, "头像不能超过 2MB");
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new HttpError(400, "请用 multipart/form-data 上传文件");
    }

    const file = form.get("file");
    if (!file || typeof file === "string") {
      throw new HttpError(400, "没有收到图片文件");
    }
    if (file.size === 0) throw new HttpError(400, "文件是空的");
    if (file.size > LIMITS.avatarBytes) throw new HttpError(400, "头像不能超过 2MB");

    const buffer = Buffer.from(await file.arrayBuffer());
    const { url } = await saveAvatar(buffer);

    const patientId = form.get("patientId");
    if (typeof patientId === "string" && patientId.trim()) {
      const id = patientId.trim();
      const existing = await requireOwnedPatient(user.id, id);
      const patient = await updatePatient(user.id, id, { avatarUrl: url });

      if (existing.avatarUrl && existing.avatarUrl !== url) {
        await removeAvatarFile(existing.avatarUrl);
      }
      return created({ avatarUrl: url, patient });
    }

    // 不绑档案时也要让前端拿到序列化形状，省得两种返回结构
    return created({ avatarUrl: url, patient: null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** 顺便给一个 GET，方便前端判断接口是否在线（不返回文件列表） */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    return Response.json({ ok: true, maxBytes: LIMITS.avatarBytes });
  } catch (err) {
    return toErrorResponse(err);
  }
}
