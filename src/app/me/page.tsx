import type { Metadata } from "next";
import MeDashboard from "@/components/MeDashboard";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listMyFeedback } from "@/lib/feedback";
import { getPlatformName } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "我的 · MedAI",
  description: "账号信息、切换账号与意见反馈。",
};

export default async function MePage() {
  const user = await requireUser();

  // 计数都在服务端一次算完，避免客户端再打三个接口
  const [patients, consults, attachments, reminders, feedback, full, platformName] =
    await Promise.all([
      prisma.patient.count({ where: { ownerId: user.id } }),
      prisma.consultation.count({ where: { patient: { ownerId: user.id } } }),
      prisma.attachment.count({ where: { ownerId: user.id } }),
      prisma.medication.count({
        where: { isActive: true, timeOfDay: { not: null }, patient: { ownerId: user.id } },
      }),
      listMyFeedback(user.id),
      prisma.user.findUnique({
        where: { id: user.id },
        select: { createdAt: true, lastLoginAt: true },
      }),
      getPlatformName(),
    ]);

  return (
    <MeDashboard
      email={user.email}
      role={user.role}
      createdAt={(full?.createdAt ?? user.createdAt).toISOString()}
      lastLoginAt={full?.lastLoginAt ? full.lastLoginAt.toISOString() : null}
      stats={{ patients, consults, attachments, reminders }}
      initialFeedback={feedback}
      platformName={platformName}
    />
  );
}
