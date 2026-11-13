import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentAdmin } from "@/lib/auth";
import { HttpError, readJson, ok, created, toErrorResponse, unauthorized } from "@/lib/http";
import { writeAdminLog } from "@/lib/admin-log";

/** GET /api/admin/announcements —— 后台列表（含停用的） */
export async function GET() {
  try {
    const admin = await getCurrentAdmin();
    if (!admin) return unauthorized();

    const rows = await prisma.announcement.findMany({
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    });
    return ok({
      announcements: rows.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        pinned: a.pinned,
        enabled: a.enabled,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/admin/announcements —— 新建 */
export async function POST(req: NextRequest) {
  try {
    const admin = await getCurrentAdmin();
    if (!admin) return unauthorized();

    const body = await readJson(req);
    const title = text(body.title, "标题", 60);
    const content = text(body.body, "内容", 2000);

    const row = await prisma.announcement.create({
      data: {
        title,
        body: content,
        pinned: body.pinned === true,
        enabled: body.enabled !== false,
      },
    });

    await writeAdminLog({
      actorId: admin.id,
      actorEmail: admin.email,
      action: "announcement.create",
      target: `公告《${title}》`,
      detail: row.pinned ? "置顶" : undefined,
    });

    return created({ id: row.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function text(value: unknown, label: string, max: number): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) throw new HttpError(400, `${label}不能空着`);
  if (s.length > max) throw new HttpError(400, `${label}不能超过 ${max} 字`);
  return s;
}
