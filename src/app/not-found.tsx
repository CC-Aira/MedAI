import Link from "next/link";

/**
 * 404：链接打错、档案被删、旧书签翻出来时都会走到这里。
 *
 * 默认的 Next 404 是英文的「This page could not be found」，跟整个产品的语气完全不搭，
 * 而且没有出口 —— 评委或用户手抖打错一个字母，看到的第一屏就是这个。
 * 所以这里复用登录页那块奶油色面板，写清楚「怎么了」并给两条能走的路。
 */
export default function NotFound() {
  return (
    <main className="auth">
      <div className="auth__glow" aria-hidden="true" />

      <div className="auth__panel">
        <p className="eyebrow">
          <span className="eyebrow__dot" />
          MedAI · 走错了一块草地
        </p>
        <h1 className="auth__title">
          这里没有你要找的
          <br />
          那一页
        </h1>
        <p className="auth__sub">
          链接可能被打错了一个字母，也可能这份档案已经不在了。回草地上看看还在的东西吧。
        </p>

        <div className="nf__acts">
          <Link className="clay clay--pill nf__btn" href="/">
            回到草地
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </Link>
          <Link className="clay clay--pill clay--ghost nf__btn" href="/library">
            看看疾病科普
          </Link>
        </div>

        <p className="auth__foot">
          404 · 如果是从页面里的按钮点过来的，说明有个出口指错了地方，告诉开发者一声。
        </p>
      </div>
    </main>
  );
}
