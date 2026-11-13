import { prisma } from "./db";

/**
 * 后台操作日志。
 *
 * 原则：
 * 1. 只记"管理动作"，不做全量埋点 —— 日志要能被人读完才有审计价值。
 * 2. detail 里不放密码、不放用户对话原文、不放 API Key。写进来之前由调用方负责脱敏。
 * 3. 写日志失败不能影响主操作：这里自己吞掉异常，只打一条服务端错误。
 */

export type AdminAction =
  | "user.disable"
  | "user.enable"
  | "user.resetPassword"
  | "announcement.create"
  | "announcement.update"
  | "announcement.delete"
  | "settings.update"
  | "aiKey.update"
  | "feedback.handle";

export async function writeAdminLog(input: {
  actorId: string;
  actorEmail: string;
  action: AdminAction;
  target: string;
  detail?: string;
}): Promise<void> {
  try {
    await prisma.adminLog.create({
      data: {
        actorId: input.actorId,
        actorEmail: input.actorEmail,
        action: input.action,
        target: input.target.slice(0, 200),
        detail: input.detail ? input.detail.slice(0, 500) : null,
      },
    });
  } catch (err) {
    console.error("[medai] 写操作日志失败", err);
  }
}

/** 动作标识 → 中文说明（后台列表直接显示这个） */
export const ACTION_LABELS: Record<string, string> = {
  "user.disable": "停用账号",
  "user.enable": "启用账号",
  "user.resetPassword": "重置密码",
  "announcement.create": "发布公告",
  "announcement.update": "修改公告",
  "announcement.delete": "删除公告",
  "settings.update": "修改系统配置",
  "aiKey.update": "更新 AI 密钥",
  "feedback.handle": "处理用户反馈",
};

/** 危险程度：给日志列表上色用 */
export const ACTION_TONE: Record<string, "danger" | "ok" | "neutral"> = {
  "user.disable": "danger",
  "user.resetPassword": "danger",
  "announcement.delete": "danger",
  "user.enable": "ok",
  "announcement.create": "ok",
};
