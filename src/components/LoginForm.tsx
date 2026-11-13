"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, login, register } from "@/lib/client/api";
import { rememberAccount } from "@/lib/client/accounts";

type Mode = "login" | "register";
/** 身份：普通个人用户，还是管理员。两者走同一个登录接口，只是界面和落地页不同。 */
type Role = "user" | "admin";

/** `demo` 由服务端按 MEDAI_DEMO_LOGIN 决定传不传 —— 组件本身不判断环境 */
export type DemoAccount = { email: string; password: string };

export default function LoginForm({
  build,
  demo,
  adminDemo,
  initialRole,
  initialEmail,
  platformName = "MedAI",
  notice,
  contact,
}: {
  build?: string;
  demo?: DemoAccount | null;
  /** 管理员演示账号：只在选到"管理员"身份时露出 */
  adminDemo?: DemoAccount | null;
  initialRole?: Role;
  /** 从「我的 → 切换账号」过来时预填的邮箱 */
  initialEmail?: string;
  /** 后台「系统参数 → 平台名称」 */
  platformName?: string;
  /** 后台「平台提示」：给用户看的一句说明 */
  notice?: string;
  /** 后台「联系方式」：展示在登录页底部 */
  contact?: string;
}) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(initialRole === "admin" ? "admin" : "user");
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState(initialEmail ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 密码可见切换：登录密码和确认密码各一个眼睛 */
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const isAdmin = role === "admin";

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
      if (mode === "login") {
        const res = await login(email.trim(), password);
        // 记到本机账号列表，下次在「我的」里一键切回来（只存邮箱）
        rememberAccount(email.trim());
        // 按返回的真实角色决定落地页：选错入口也能进去，不会卡在登录页
        router.replace(res.user?.role === "admin" ? "/admin" : "/");
      } else {
        await register(email.trim(), password);
        rememberAccount(email.trim());
        router.replace("/");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "网络不太顺，请再试一次");
      setBusy(false);
    }
  }

  function switchRole(next: Role) {
    setRole(next);
    setError(null);
    // 管理员没有自助注册入口 —— 角色一旦能注册，权限就形同虚设
    if (next === "admin") {
      setMode("login");
      setConfirm("");
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
      const res = await login(d.email, d.password);
      rememberAccount(d.email);
      router.replace(res.user?.role === "admin" ? "/admin" : "/");
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
          {platformName} · {isAdmin ? "管理后台" : "私人健康档案"}
        </p>
        <h1 className="auth__title">
          {isAdmin ? (
            <>
              看清平台在
              <br />
              怎么被使用
            </>
          ) : (
            <>
              每一分身体状况，
              <br />
              都值得被认真回应
            </>
          )}
        </h1>
        <p className="auth__sub">
          {isAdmin
            ? "管理员登录后可查看注册用户、问诊趋势与安全预警。后台只看统计与小结，不展示对话原文。"
            : "这是给你自己用的。建档、用药、问诊记录都只属于你，别人看不到。"}
        </p>

        {/* 身份入口：先选身份，再选登录 / 注册 */}
        <div className="auth__roles" role="tablist" aria-label="选择身份">
          <button
            type="button"
            role="tab"
            aria-selected={role === "user"}
            className={`auth__role${role === "user" ? " is-on" : ""}`}
            onClick={() => switchRole("user")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8.2" r="3.6" />
              <path d="M4.8 20c0-3.6 3.2-6.2 7.2-6.2s7.2 2.6 7.2 6.2" />
            </svg>
            <b>个人用户</b>
            <em>管理自己和家人的健康档案</em>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={role === "admin"}
            className={`auth__role${role === "admin" ? " is-on" : ""}`}
            onClick={() => switchRole("admin")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3.4l7.2 3v5.4c0 4.2-2.9 7.6-7.2 8.8-4.3-1.2-7.2-4.6-7.2-8.8V6.4z" />
              <path d="M9.2 12.1l2 2 3.6-3.9" />
            </svg>
            <b>管理员</b>
            <em>平台用户与问诊数据统计</em>
          </button>
        </div>

        {!isAdmin && (
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
        )}

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
              placeholder={isAdmin ? "admin@medai.local" : "you@example.com"}
            />
          </label>

          <div className="field">
            <span className="field__label">
              密码
              {mode === "register" && <em className="field__flag">至少 8 位</em>}
            </span>
            <div className="field__pw">
              <input
                className="field__input"
                type={showPw ? "text" : "password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                aria-label="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "至少 8 位" : "••••••••"}
              />
              <button
                className="field__eye"
                type="button"
                aria-label={showPw ? "隐藏密码" : "显示密码"}
                aria-pressed={showPw}
                title={showPw ? "隐藏密码" : "显示密码"}
                onClick={() => setShowPw((v) => !v)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {showPw ? (
                    <>
                      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
                      <circle cx="12" cy="12" r="3" />
                      <path d="M4.5 4.5l15 15" />
                    </>
                  ) : (
                    <>
                      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  )}
                </svg>
              </button>
            </div>
          </div>

          {mode === "register" && (
            <div className="field">
              <span className="field__label">再输一次</span>
              <div className="field__pw">
                <input
                  className="field__input"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  aria-label="确认密码"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="确认密码"
                />
                <button
                  className="field__eye"
                  type="button"
                  aria-label={showConfirm ? "隐藏密码" : "显示密码"}
                  aria-pressed={showConfirm}
                  title={showConfirm ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowConfirm((v) => !v)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    {showConfirm ? (
                      <>
                        <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
                        <circle cx="12" cy="12" r="3" />
                        <path d="M4.5 4.5l15 15" />
                      </>
                    ) : (
                      <>
                        <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="auth__error" role="alert">
              {error}
            </p>
          )}

          <button className="clay clay--pill auth__submit" type="submit" disabled={busy}>
            <span className="clay__text">
              {busy
                ? "稍等一下…"
                : mode === "register"
                  ? "建个账号"
                  : isAdmin
                    ? "进入管理后台"
                    : "回到小兔子"}
            </span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>

        {isAdmin && (
          <p className="auth__hint">
            管理员账号由系统预置，不支持自助注册。需要开通请联系运维。
          </p>
        )}

        {demo && !isAdmin && (
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

        {isAdmin && adminDemo && (
          <button
            type="button"
            className="auth__demo auth__demo--admin"
            onClick={() => enterDemo(adminDemo)}
            disabled={busy}
          >
            <b>用演示管理员账号直接进去 →</b>
            <em>{adminDemo.email} · 已备好用户、档案与问诊统计，无需记密码</em>
          </button>
        )}

        {(notice || contact) && (
          <p className="auth__notice">
            {notice}
            {notice && contact ? " · " : ""}
            {contact ? `联系：${contact}` : ""}
          </p>
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
