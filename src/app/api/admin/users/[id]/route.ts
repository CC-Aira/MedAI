import { randomInt } from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentAdmin, hashPassword } from "@/lib/auth";
import { HttpError, readJson, ok, toErrorResponse, unauthorized } from "@/lib/http";
import { writeAdminLog } from "@/lib/admin-log";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/users/[id]
 *
 * 三种操作，都用同一条路径：
 *   { action: "disable" }       停用账号（不能停用管理员自己）
 *   { action: "enable" }        恢复账号
 *   { action: "resetPassword" } 生成一个随机临时密码并返回一次性明文
 *
 * 为什么不接受"管理员自己指定密码"：临时密码由服务端生成、只回显一次、
 * 用户登录后再自己改，能避免管理员知道用户长期密码。
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await getCurrentAdmin();
    if (!admin) return unauthorized();

    const { id } = await ctx.params;
    const body = await readJson(req);
    const action = typeof body.action === "string" ? body.action : "";

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, disabled: true },
    });
    if (!target) throw new HttpError(404, "没有找到这个账号");

    // 管理员账号只能由数据库/运维处理，后台里不允许互相停用或改密
    if (target.role === "admin") {
      throw new HttpError(403, "管理员账号不能在后台被停用或重置密码");
    }

    if (action === "disable" || action === "enable") {
      const disabled = action === "disable";
      await prisma.user.update({ where: { id }, data: { disabled } });
      await writeAdminLog({
        actorId: admin.id,
        actorEmail: admin.email,
        action: disabled ? "user.disable" : "user.enable",
        target: `${target.email}`,
        detail: disabled ? "停止登录，数据保留" : "恢复登录",
      });
      return ok({ user: { id, disabled } });
    }

    if (action === "resetPassword") {
      const temp = generateTempPassword();
      await prisma.user.update({
        where: { id },
        data: { passwordHash: await hashPassword(temp) },
      });
      await writeAdminLog({
        actorId: admin.id,
        actorEmail: admin.email,
        action: "user.resetPassword",
        target: target.email,
        detail: "生成临时密码，仅本次返回明文",
      });
      // 明文只在这里返回一次，不入库、不进日志
      return ok({ user: { id }, tempPassword: temp });
    }

    throw new HttpError(400, "不支持的操作");
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * 临时密码：读起来不歧义的字符集（去掉 0/O/1/l/I），
 * 12 位，约 60 bit 熵 —— 足够撑到用户首次登录改密。
 */
function generateTempPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 12; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}
