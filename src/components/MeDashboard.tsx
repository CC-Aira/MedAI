"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, listMyFeedback, logout, submitFeedback } from "@/lib/client/api";
import type { FeedbackItem } from "@/lib/client/api";
import { forgetAccount, loadAccounts, rememberAccount } from "@/lib/client/accounts";
import type { SavedAccount } from "@/lib/client/accounts";

/**
 * 「我的」页面。
 *
 * 三件事：看清自己是谁、换个账号登、把意见交给平台。
 * 反馈内容由用户自愿填写，管理员在后台能看到 —— 页面上明确写了这句，
 * 不做「说了以为没人看」的暗示。
 */

const KINDS = [
  { key: "bug", label: "用不了 / 出错", hint: "点了没反应、页面报错、图片传不上去" },
  { key: "suggest", label: "功能建议", hint: "希望加什么、哪里用着别扭" },
  { key: "content", label: "内容有误", hint: "科普或药品说明写错了、说法过时" },
  { key: "other", label: "其他", hint: "想说的都行" },
] as const;

const STATUS_LABEL: Record<string, string> = {
  open: "待处理",
  read: "已查看",
  done: "已处理",
};

const KIND_LABEL: Record<string, string> = {
  bug: "用不了 / 出错",
  suggest: "功能建议",
  content: "内容有误",
  other: "其他",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function initials(email: string): string {
  const name = email.split("@")[0] ?? "";
  return (name.slice(0, 2) || "U").toUpperCase();
}

export default function MeDashboard({
  email,
  role,
  createdAt,
  lastLoginAt,
  stats,
  initialFeedback,
  platformName = "MedAI",
}: {
  email: string;
  role: "user" | "admin";
  createdAt: string;
  lastLoginAt: string | null;
  stats: { patients: number; consults: number; attachments: number; reminders: number };
  initialFeedback: FeedbackItem[];
  /** 后台「系统参数 → 平台名称」 */
  platformName?: string;
}) {
  const router = useRouter();

  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [feedback, setFeedback] = useState<FeedbackItem[]>(initialFeedback);
  const [kind, setKind] = useState<string>("suggest");
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // localStorage 只能在浏览器端读，所以放 effect 里；同时把当前账号补进去
  useEffect(() => {
    setAccounts(rememberAccount(email));
  }, [email]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const others = useMemo(() => accounts.filter((a) => a.email !== email), [accounts, email]);
  const pending = feedback.filter((f) => f.status !== "done").length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    const text = content.trim();
    if (text.length < 4) {
      setError("再多写几个字吧，至少 4 个字");
      return;
    }

    setBusy(true);
    try {
      const res = await submitFeedback({
        kind,
        content: text,
        contact: contact.trim(),
        rating,
        page: "/me",
      });
      setFeedback((prev) => [res.feedback, ...prev]);
      setContent("");
      setContact("");
      setRating(null);
      setToast("收到了，管理员会在后台看到这条意见");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "网络不太顺，请再试一次");
    } finally {
      setBusy(false);
    }
  }

  /** 切换账号：退出当前会话，带邮箱去登录页（密码还是要输一次） */
  async function switchTo(target: string | null) {
    if (switching) return;
    setSwitching(target ?? "__new__");
    try {
      await logout();
      rememberAccount(email);
      const qs = target ? `?email=${encodeURIComponent(target)}` : "";
      router.replace(`/login${qs}`);
      router.refresh();
    } catch {
      setError("退出登录失败，请刷新页面重试");
      setSwitching(null);
    }
  }

  function removeSaved(target: string) {
    setAccounts(forgetAccount(target));
    setToast("已从本机账号列表移除（账号本身还在）");
  }

  async function refreshFeedback() {
    try {
      const res = await listMyFeedback();
      setFeedback(res.feedback);
      setToast("已刷新");
    } catch {
      setError("刷新失败，稍后再试");
    }
  }

  return (
    <div className="me">
      <div className="me__sky" aria-hidden="true" />
      <div className="me__grain" aria-hidden="true" />

      <nav className="me__nav">
        <Link className="sheetwrap__back" href="/">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          回到小兔子
        </Link>
        {role === "admin" && (
          <Link className="me__navlink" href="/admin">
            管理后台
          </Link>
        )}
        <span className="me__brand">{platformName}</span>
      </nav>

      <div className="me__wrap">
        <header className="me__head">
          <span className="me__avatar" aria-hidden="true">
            {initials(email)}
          </span>
          <div className="me__id">
            <h1>
              {email}
              <span className={`me__role me__role--${role}`}>
                {role === "admin" ? "管理员" : "个人用户"}
              </span>
            </h1>
            <p>
              注册于 {fmtDate(createdAt)}
              {lastLoginAt ? ` · 最近登录 ${fmtDate(lastLoginAt)}` : ""}
            </p>
          </div>
        </header>

        <ul className="me__stats">
          <li>
            <b>{stats.patients}</b>
            <span>份档案</span>
          </li>
          <li>
            <b>{stats.consults}</b>
            <span>次问诊</span>
          </li>
          <li>
            <b>{stats.attachments}</b>
            <span>份资料</span>
          </li>
          <li>
            <b>{stats.reminders}</b>
            <span>条用药提醒</span>
          </li>
        </ul>

        <div className="me__cols">
          {/* ---------------------------------------------------- 左：账号 */}
          <section className="me__card" aria-labelledby="me-account">
            <h2 id="me-account">切换账号</h2>
            <p className="me__note">
              同一台设备上登录过的账号记在这里，只记邮箱、不记密码。
              点一下就用它登录（仍需输密码），换人用不必重新敲一长串。
            </p>

            <ul className="me__accts">
              <li className="me__acct is-now">
                <span className="me__acct-mail">{email}</span>
                <span className="me__acct-tag">当前</span>
              </li>

              {others.map((a) => (
                <li className="me__acct" key={a.email}>
                  <button
                    type="button"
                    className="me__acct-pick"
                    onClick={() => switchTo(a.email)}
                    disabled={!!switching}
                  >
                    {a.email}
                  </button>
                  <button
                    type="button"
                    className="me__acct-x"
                    title="从本机列表移除"
                    aria-label={`从本机列表移除 ${a.email}`}
                    onClick={() => removeSaved(a.email)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>

            <div className="me__acct-actions">
              <button
                type="button"
                className="me__btn"
                onClick={() => switchTo(null)}
                disabled={!!switching}
              >
                {switching === "__new__" ? "正在退出…" : "用另一个账号登录"}
              </button>
              <button
                type="button"
                className="me__btn me__btn--danger"
                onClick={() => switchTo(null)}
                disabled={!!switching}
              >
                退出登录
              </button>
            </div>

            {others.length === 0 && (
              <p className="me__hint">
                还没有别的账号。家里人用同一台设备时，各自登录一次就会出现在上面。
              </p>
            )}
          </section>

          {/* ---------------------------------------------------- 右：反馈 */}
          <section className="me__card me__card--wide" aria-labelledby="me-feedback">
            <h2 id="me-feedback">意见反馈</h2>
            <p className="me__note">
              用着别扭、内容写错、想要什么功能，都可以写在这里。
              <b>内容会展示给平台管理员</b>，但不会带上你的档案和对话原文。
            </p>

            <form className="me__form" onSubmit={submit}>
              <div className="me__kinds" role="radiogroup" aria-label="反馈类型">
                {KINDS.map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    role="radio"
                    aria-checked={kind === k.key}
                    className={`me__kind${kind === k.key ? " is-on" : ""}`}
                    onClick={() => setKind(k.key)}
                    title={k.hint}
                  >
                    {k.label}
                  </button>
                ))}
              </div>

              <label className="me__field">
                <span>具体说说</span>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="例：用药提醒开到点后没弹出通知，手机是 iPhone，已经允许通知了。"
                  rows={5}
                  maxLength={2000}
                />
                <i className="me__count">{content.length}/2000</i>
              </label>

              <div className="me__row">
                <label className="me__field">
                  <span>联系方式（可不填）</span>
                  <input
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="邮箱或微信，方便回你"
                    maxLength={120}
                  />
                </label>

                <div className="me__field me__field--rate">
                  <span>整体感受（可不填）</span>
                  <div className="me__stars" role="group" aria-label="满意度评分">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        aria-label={`${n} 分`}
                        aria-pressed={rating === n}
                        className={`me__star${rating !== null && n <= rating ? " is-on" : ""}`}
                        onClick={() => setRating(rating === n ? null : n)}
                      >
                        ★
                      </button>
                    ))}
                    {rating !== null && (
                      <button
                        type="button"
                        className="me__star-clear"
                        onClick={() => setRating(null)}
                      >
                        清除
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {error && (
                <p className="me__err" role="alert">
                  {error}
                </p>
              )}

              <div className="me__submit">
                <button className="me__btn me__btn--primary" type="submit" disabled={busy}>
                  {busy ? "正在提交…" : "提交反馈"}
                </button>
                <span className="me__submit-hint">提交后管理员后台会立刻看到</span>
              </div>
            </form>

            <div className="me__histhead">
              <h3>
                我提过的 {feedback.length > 0 && <b>{feedback.length}</b>}
                {pending > 0 && <em>（{pending} 条待处理）</em>}
              </h3>
              <button type="button" className="me__refresh" onClick={refreshFeedback}>
                刷新
              </button>
            </div>

            {feedback.length === 0 ? (
              <p className="me__empty">还没有提过反馈。第一条意见往往最有用。</p>
            ) : (
              <ul className="me__hist">
                {feedback.map((f) => (
                  <li className={`me__fb is-${f.status}`} key={f.id}>
                    <div className="me__fb-head">
                      <span className={`me__fb-status is-${f.status}`}>
                        {STATUS_LABEL[f.status] ?? f.status}
                      </span>
                      <span className="me__fb-kind">{KIND_LABEL[f.kind] ?? f.kind}</span>
                      <time>{fmtDate(f.createdAt)}</time>
                    </div>
                    <p className="me__fb-body">{f.content}</p>
                    {f.reply && (
                      <div className="me__fb-reply">
                        <span>管理员回复</span>
                        <p>{f.reply}</p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {toast && (
          <div className="me__toast" role="status">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
