"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, login, register } from "@/lib/client/api";

type Mode = "login" | "register";

/** `demo` 由服务端按 MEDAI_DEMO_LOGIN 决定传不传 —— 组件本身不判断环境 */
export type DemoAccount = { email: string; password: string };

export default function LoginForm({ build, demo }: { build?: string; demo?: DemoAccount | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (mode === "register") {
      if (password.length < 8) {
        setError("密码至少 8 位");
        return;
      }
      if (password !== confirm) {
        setError("两次输入的密码不一样");
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register(email.trim(), password);

      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "网络不太顺，请再试一次");
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setConfirm("");
  }

  /**
   * 演示入口：直接把演示账号登进去。
   *
   * 现场演示时最怕两件事 —— 记错密码、被限流锁 15 分钟。这个按钮跳过键盘输入，
   * 但走的是**完全相同的**登录接口（不是后门），密码错了照样 401。
   * 只在 MEDAI_DEMO_LOGIN=1 时由服务端渲染，正式部署关掉这个环境变量就没有入口。
   */
  async function enterDemo(d: DemoAccount) {
    if (busy) return;
    setError(null);
    setMode("login");
    setEmail(d.email);
    setPassword(d.password);
    setBusy(true);
    try {
      await login(d.email, d.password);
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "演示账号没登进去，稍后再试");
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth__glow" aria-hidden="true" />

      <div className="auth__panel">
        <p className="eyebrow">
          <span className="eyebrow__dot" />
          MedAI · 私人健康档案
        </p>
        <h1 className="auth__title">
          每一分身体状况，
          <br />
          都值得被认真回应
        </h1>
        <p className="auth__sub">
          这是给你自己用的。建档、用药、问诊记录都只属于你，别人看不到。
        </p>

        <div className="auth__tabs" role="tablist" aria-label="登录或注册">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={`auth__tab${mode === "login" ? " is-on" : ""}`}
            onClick={() => switchMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={`auth__tab${mode === "register" ? " is-on" : ""}`}
            onClick={() => switchMode("register")}
          >
            注册
          </button>
        </div>

        <form className="auth__form" onSubmit={submit} noValidate>
          <label className="field">
            <span className="field__label">邮箱</span>
            <input
              className="field__input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>

          <label className="field">
            <span className="field__label">
              密码
              {mode === "register" && <em className="field__flag">至少 8 位</em>}
            </span>
            <input
              className="field__input"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "至少 8 位" : "••••••••"}
            />
          </label>

          {mode === "register" && (
            <label className="field">
              <span className="field__label">再输一次</span>
              <input
                className="field__input"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="确认密码"
              />
            </label>
          )}

          {error && (
            <p className="auth__error" role="alert">
              {error}
            </p>
          )}

          <button className="clay clay--pill auth__submit" type="submit" disabled={busy}>
            <span className="clay__text">
              {busy ? "稍等一下…" : mode === "register" ? "建个账号" : "回到小兔子"}
            </span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>

        {demo && (
          <button
            type="button"
            className="auth__demo"
            onClick={() => enterDemo(demo)}
            disabled={busy}
          >
            <b>没有账号？用演示账号直接进去 →</b>
            <em>已备好一家人的档案、在服药物和几次问诊记录</em>
          </button>
        )}

        <p className="auth__foot">
          密码用 scrypt 加盐哈希保存，登录态是 7 天有效的签名 Cookie。
        </p>
        {build && (
          <p className="auth__build" title="构建号：内容不同的是不同版本">
            build {build}
          </p>
        )}
      </div>
    </div>
  );
}
