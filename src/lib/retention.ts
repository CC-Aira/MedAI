import { prisma } from "./db";
import { CHAT_RETENTION_DAYS } from "./constants";
import { removeAttachmentFile } from "./attachments";

/**
 * 对话保留策略
 *
 * 聊天记录不永久留在库里：超过 CHAT_RETENTION_DAYS 天的消息，
 * 读取时一律看不到，并会被惰性清理真正删除。
 *
 * 只清 Message。Consultation.summary（这次问诊的小结）、Note（结论）、
 * Patient 档案都不受影响 —— 那些是用户主动整理的结构化结论，不是原始对话。
 */

export const CHAT_RETENTION_LABEL = `${CHAT_RETENTION_DAYS} 天`;

/** 早于这个时间的消息算过期 */
export function retentionCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/** 读消息时统一带上这个条件，保证过期的既查不到也进不了提示词 */
export function liveMessageWhere(consultationId: string) {
  return { consultationId, createdAt: { gte: retentionCutoff() } };
}

/** 剩余多少毫秒后最早的一条会过期（给前端显示用，没有消息时返回 null） */
export function oldestLiveAt(createdAts: Date[]): Date | null {
  if (createdAts.length === 0) return null;
  return createdAts.reduce((a, b) => (a < b ? a : b));
}

let lastPurge = 0;
const PURGE_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 惰性清理：读路径上顺手删一次，但最多每 10 分钟真删一次，
 * 不至于每次打开问诊都打一条 delete。
 *
 * 除了过期消息，还会清掉"已经没有任何消息引用、且自身也过期"的附件记录和磁盘文件 ——
 * 承诺了不永久保留，上传的病历照片就不能留在硬盘上。
 */
export async function purgeExpiredMessages(force = false): Promise<number> {
  const now = Date.now();
  if (!force && now - lastPurge < PURGE_INTERVAL_MS) return 0;
  lastPurge = now;

  const cutoff = retentionCutoff();

  try {
    const res = await prisma.message.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    // 先删消息再找孤儿附件：消息没了，附件才可能真的没人引用
    const stale = await prisma.attachment.findMany({
      where: { createdAt: { lt: cutoff }, messages: { none: {} } },
      select: { id: true, storedName: true },
      take: 50,
    });
    for (const a of stale) {
      try {
        await prisma.attachment.delete({ where: { id: a.id } });
        await removeAttachmentFile(a.storedName);
      } catch {
        // 单个附件删失败不影响其它，下一轮还会再试
      }
    }

    return res.count;
  } catch {
    // 清理是后台杂活，失败不该影响这次问诊
    return 0;
  }
}
