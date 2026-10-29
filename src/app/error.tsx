"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * 页面级兜底：某个路由渲染 / 取数抛错时接住，别让用户看见 Next 的白屏或英文堆栈。
 *
 * 这里只做两件事 —— 说人话（出错了、数据没丢、可以重试）、给一个真的能用的「再试一次」
 * （`reset()` 会让 React 重新渲染那段子树）。错误详情只进控制台和 `digest`，
 * 不往页面上贴，医疗类产品不该把内部信息摊给用户。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[medai] 页面渲染出错", error);
  }, [error]);

  return (
    <main className="auth">
      <div className="auth__glow" aria-hidden="true" />

      <div className="auth__panel">
        <p className="eyebrow">
          <span className="eyebrow__dot" />
          MedAI · 绊了一下
        </p>
        <h1 className="auth__title">
          这一页没加载出来
          <br />
          你的资料都还在
        </h1>
        <p className="auth__sub">
          大概率是刚才那一下网络不顺。点下面再试一次；如果一直这样，刷新一下浏览器，或者先回草地。
        </p>

        <div className="nf__acts">
          <button type="button" className="clay clay--pill nf__btn" onClick={() => reset()}>
            再试一次
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12a8 8 0 1 1 3 6.2M4 18v-6h6" />
            </svg>
          </button>
          <Link className="clay clay--pill clay--ghost nf__btn" href="/">
            回到草地
          </Link>
        </div>

        <p className="auth__foot">
          {error.digest ? `错误编号 ${error.digest} · ` : ""}
          报告问题时带上这个编号，能直接定位到日志里那一条。
        </p>
      </div>
    </main>
  );
}
