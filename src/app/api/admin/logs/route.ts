import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentAdmin } from "@/lib/auth";
import { ok, toErrorResponse, unauthorized } from "@/lib/http";

/**
 * GET /api/admin/logs?take=100&action=user.disable
 * 操作日志的分页读取。只读 —— 日志不允许从后台删除或改写。
 */
export async function GET(req: NextRequest) {
  try {
    const admin = await getCurrentAdmin();
    if (!admin) return unauthorized();

    const url = new URL(req.url);
    const take = Math.min(200, Math.max(10, Number(url.searchParams.get("take")) || 80));
    const action = url.searchParams.get("action") || "";

    const rows = await prisma.adminLog.findMany({
      where: action ? { action } : undefined,
      orderBy: { createdAt: "desc" },
      take,
    });

    const total = await prisma.adminLog.count();
    return ok({
      total,
      logs: rows.map((r) => ({
        id: r.id,
        actorEmail: r.actorEmail,
        action: r.action,
        target: r.target,
        detail: r.detail,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
