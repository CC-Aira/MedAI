import fs from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { getCurrentUser } from "@/lib/auth";
import { getSettings, getPlatformName } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * 读构建号，在登录页角落显示一小行。
 *
 * 起因：Turbopack 的 chunk 文件名是稳定标识符，重新 build 也不会变，浏览器一旦按
 * immutable 缓存了旧的 CSS/JS，普通刷新永远拿不到新代码。光靠印象没法确认，
 * 所以把 build id 摆出来，核对一下就知道页面是不是本次构建的产物。
 * 读不到就干脆不显示 —— 绝不能因为它把登录页弄挂。
 */
function readBuildId(): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
    if (!raw || raw === "development") return undefined;
    return raw.slice(0, 8);
  } catch {
    return undefined;
  }
}

/** 演示账号：只在 MEDAI_DEMO_LOGIN=1 时才把入口交给前端 */
const DEMO_EMAIL = "demo@medai.local";
const DEMO_PASSWORD = "Medai@2026";
/** 管理员演示账号：和 seed 里的固定管理员一致 */
const ADMIN_DEMO_EMAIL = "admin@medai.local";
const ADMIN_DEMO_PASSWORD = "Admin@2026";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; email?: string }>;
}) {
  const user = await getCurrentUser();
  // 已登录的管理员直接进后台；已登录的普通用户回首页
  if (user) redirect(user.role === "admin" ? "/admin" : "/");

  const { role, email } = await searchParams;
  const demoEnabled = process.env.MEDAI_DEMO_LOGIN === "1";
  const demo = demoEnabled ? { email: DEMO_EMAIL, password: DEMO_PASSWORD } : null;
  const adminDemo = demoEnabled
    ? { email: ADMIN_DEMO_EMAIL, password: ADMIN_DEMO_PASSWORD }
    : null;

  // 平台名 / 提示语 / 联系方式都来自后台「系统参数」，改完刷新登录页就能看到
  const [platformName, settings] = await Promise.all([getPlatformName(), getSettings()]);

  return (
    <LoginForm
      build={readBuildId()}
      demo={demo}
      adminDemo={adminDemo}
      initialRole={role === "admin" ? "admin" : "user"}
      initialEmail={typeof email === "string" ? email : undefined}
      platformName={platformName}
      notice={settings["platform.notice"]?.trim() || undefined}
      contact={settings["platform.contact"]?.trim() || undefined}
    />
  );
}
