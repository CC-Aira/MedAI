import Link from "next/link";
import { getPlatformName } from "@/lib/settings";

/** 表单类页面的外壳：静态渐变背景 + 返回入口 + 居中纸面 */
export default async function SheetShell({
  children,
  backHref = "/",
  backLabel = "回到小兔子",
}: {
  children: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  const platformName = await getPlatformName();

  return (
    <div className="sheetwrap">
      <div className="sheetwrap__sky" aria-hidden="true" />
      <div className="sheetwrap__grain" aria-hidden="true" />

      <nav className="sheetwrap__nav">
        <Link className="sheetwrap__back" href={backHref}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          {backLabel}
        </Link>
        <span className="sheetwrap__brand">{platformName}</span>
      </nav>

      {children}
    </div>
  );
}
