import type { Metadata } from "next";
import AdminDashboard from "@/components/AdminDashboard";
import { requireAdmin } from "@/lib/auth";
import { getAdminStats } from "@/lib/admin-stats";
import { prisma } from "@/lib/db";
import { getSettings, maskKey, getPlatformName } from "@/lib/settings";
import { listAllFeedback } from "@/lib/feedback";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const name = await getPlatformName();
  return {
    title: `${name} 管理后台`,
    description: "平台运营控制台：账号、问诊、数据看板与系统配置。",
  };
}

export default async function AdminPage() {
  // 非管理员会被 requireAdmin 挡走：未登录去登录页，普通用户回首页
  const admin = await requireAdmin();

  const [stats, settings, announcements, logs, logTotal, feedbackBox, platformName] =
    await Promise.all([
      getAdminStats(),
      getSettings(true),
      prisma.announcement.findMany({
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        take: 50,
      }),
      prisma.adminLog.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
      prisma.adminLog.count(),
      listAllFeedback({ take: 100 }),
      getPlatformName(),
    ]);

  return (
    <AdminDashboard
      adminEmail={admin.email}
      stats={stats}
      settings={settings}
      keys={{
        textKey: maskKey(process.env.DEEPSEEK_API_KEY),
        visionKey: maskKey(process.env.VISION_API_KEY),
      }}
      env={{
        model: process.env.DEEPSEEK_MODEL || "glm-4-flash",
        baseUrl: process.env.DEEPSEEK_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
        visionModel: process.env.VISION_MODEL || "glm-4v-flash",
        demoMode: process.env.MEDAI_DEMO_AI === "1",
      }}
      announcements={announcements.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        pinned: a.pinned,
        enabled: a.enabled,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      }))}
      logs={logs.map((l) => ({
        id: l.id,
        actorEmail: l.actorEmail,
        action: l.action,
        target: l.target,
        detail: l.detail,
        createdAt: l.createdAt.toISOString(),
      }))}
      logTotal={logTotal}
      feedback={feedbackBox.rows}
      feedbackCounts={feedbackBox.counts}
      platformName={platformName}
    />
  );
}
