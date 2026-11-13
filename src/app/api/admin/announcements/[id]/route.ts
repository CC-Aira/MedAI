import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentAdmin } from "@/lib/auth";
import { HttpError, readJson, ok, toErrorResponse, unauthorized } from "@/lib/http";
import { writeAdminLog } from "@/lib/admin-log";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/admin/announcements/[id] —— 改内容 / 置顶 / 启用停用 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await getCurrentAdmin();
    if (!admin) return unauthorized();

    const { id } = await ctx.params;
    const existing = await prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "没有找到这条公告");

    const body = await readJson(req);
    const data: {
      title?: string;
      body?: string;
      pinned?: boolean;
      enabled?: boolean;
    } = {};

    if (typeof body.title === "string") {
      const v = body.title.trim();
      if (!v) throw new HttpError(400, "标题不能空着");
      data.title = v.slice(0, 60);
    }
    if (typeof body.body === "string") {
      const v = body.body.trim();
      if (!v) throw new HttpError(400, "内容不能空着");
      data.body = v.slice(0, 2000);
    }
    if (typeof body.pinned === "boolean") data.pinned = body.pinned;
    if (typeof body.enabled === "boolean") data.enabled = body.enabled;

    if (Object.keys(data).length === 0) throw new HttpError(400, "没有要修改的内容");

    await prisma.announcement.update({ where: { id }, data });

    await writeAdminLog({
      actorId: admin.id,
      actorEmail: admin.email,
      action: "announcement.update",
      target: `公告《${data.title ?? existing.title}》`,
      detail: describeChange(data),
    });

    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE /api/admin/announcements/[id] */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const admin = await getCurrentAdmin();
    if (!admin) return unauthorized();

    const { id } = await ctx.params;
    const existing = await prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "没有找到这条公告");

    await prisma.announcement.delete({ where: { id } });
    await writeAdminLog({
      actorId: admin.id,
      actorEmail: admin.email,
      action: "announcement.delete",
      target: `公告《${existing.title}》`,
    });

    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function describeChange(data: Record<string, unknown>): string | undefined {
  const bits: string[] = [];
  if ("title" in data) bits.push("改标题");
  if ("body" in data) bits.push("改内容");
  if (data.pinned === true) bits.push("置顶");
  if (data.pinned === false) bits.push("取消置顶");
  if (data.enabled === true) bits.push("启用");
  if (data.enabled === false) bits.push("停用");
  return bits.length ? bits.join("、") : undefined;
}
