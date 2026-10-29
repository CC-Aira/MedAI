import fs from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { getCurrentUser } from "@/lib/auth";

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

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");
  const demo =
    process.env.MEDAI_DEMO_LOGIN === "1"
      ? { email: DEMO_EMAIL, password: DEMO_PASSWORD }
      : null;
  return <LoginForm build={readBuildId()} demo={demo} />;
}
