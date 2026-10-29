import Link from "next/link";

/** 科普库与药品库共用的外壳：同一套天空背景 + 顶部切换 */
export default function KnowledgeShell({
  children,
  active,
}: {
  children: React.ReactNode;
  active: "library" | "drugs";
}) {
  return (
    <div className="sheetwrap">
      <div className="sheetwrap__sky" aria-hidden="true" />
      <div className="sheetwrap__grain" aria-hidden="true" />

      <nav className="sheetwrap__nav">
        <Link className="sheetwrap__back" href="/">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          回到小兔子
        </Link>

        <div className="knav">
          <Link
            className={`knav__item${active === "library" ? " is-on" : ""}`}
            href="/library"
          >
            疾病科普
          </Link>
          <Link
            className={`knav__item${active === "drugs" ? " is-on" : ""}`}
            href="/drugs"
          >
            药品说明
          </Link>
        </div>

        <span className="sheetwrap__brand">MedAI</span>
      </nav>

      <main className="kbase">{children}</main>
    </div>
  );
}
