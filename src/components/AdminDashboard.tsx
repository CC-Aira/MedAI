"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminFeedbackPanel from "./AdminFeedbackPanel";
import type { AdminStats, ConsultationRow, TrendPoint, UserRow } from "@/lib/admin-stats";

/**
 * 管理员控制台。
 *
 * 四个分组：数据看板 / 用户与权限 / 问诊业务 / 系统配置与安全。
 * 隐私边界：后台永远不展示对话原文与病历细节，只到"主诉 + AI 小结"这一层。
 */

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type LogRow = {
  id: string;
  actorEmail: string;
  action: string;
  target: string;
  detail: string | null;
  createdAt: string;
};

/** 与 lib/feedback.ts 的 FeedbackRow 对齐；这里复制一份，客户端不引 prisma */
type FeedbackRow = {
  id: string;
  kind: string;
  content: string;
  contact: string | null;
  rating: number | null;
  page: string | null;
  status: string;
  reply: string | null;
  createdAt: string;
  handledAt: string | null;
  userEmail?: string;
};

type Section =
  | "overview"
  | "report"
  | "ai"
  | "users"
  | "feedback"
  | "consults"
  | "aiConfig"
  | "params"
  | "notice"
  | "logs";

/** 客户端不能 import lib/admin-log（那边引了 prisma），标签在这里复制一份 */
const ACTION_LABELS: Record<string, string> = {
  "user.disable": "停用账号",
  "user.enable": "启用账号",
  "user.resetPassword": "重置密码",
  "announcement.create": "发布公告",
  "announcement.update": "修改公告",
  "announcement.delete": "删除公告",
  "settings.update": "修改配置",
  "aiKey.update": "更新密钥",
  "feedback.handle": "处理反馈",
};

const ACTION_TONE: Record<string, "danger" | "ok" | "neutral"> = {
  "user.disable": "danger",
  "user.resetPassword": "danger",
  "announcement.delete": "danger",
  "user.enable": "ok",
  "announcement.create": "ok",
  "feedback.handle": "ok",
};

const NAV: { group: string; icon: string; items: { key: Section; label: string }[] }[] = [
  {
    group: "数据看板",
    icon: "📊",
    items: [
      { key: "overview", label: "首页总览" },
      { key: "report", label: "问诊数据报表" },
      { key: "ai", label: "AI 效果监控" },
    ],
  },
  { group: "用户与权限", icon: "👤", items: [
      { key: "users", label: "患者管理" },
      { key: "feedback", label: "用户反馈" },
    ] },
  { group: "问诊业务", icon: "🏥", items: [{ key: "consults", label: "问诊记录" }] },
  {
    group: "系统配置与安全",
    icon: "⚙️",
    items: [
      { key: "aiConfig", label: "AI 模型配置" },
      { key: "params", label: "系统参数" },
      { key: "notice", label: "公告管理" },
      { key: "logs", label: "操作日志" },
    ],
  },
];

/* --------------------------------------------------------------- 小工具 */

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function relative(iso: string | null): string {
  if (!iso) return "从未登录";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return `${Math.floor(day / 30)} 个月前`;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

async function call<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

/* ---------------------------------------------------------------- 图表 */

/** 图表的画布尺寸与内边距：提到组件外，引用稳定，放 useMemo 依赖里也不会反复重建 */
const CHART_W = 760;
const CHART_H = 190;
const PAD = { top: 16, right: 12, bottom: 24, left: 12 } as const;

function TrendChart({ data }: { data: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const { line, area, points, maxV } = useMemo(() => {
    const max = Math.max(1, ...data.map((d) => d.consultations));
    const innerW = CHART_W - PAD.left - PAD.right;
    const innerH = CHART_H - PAD.top - PAD.bottom;
    const step = data.length > 1 ? innerW / (data.length - 1) : innerW;
    const pts = data.map((d, i) => ({
      x: PAD.left + i * step,
      y: PAD.top + innerH - (d.consultations / max) * innerH,
      d,
    }));
    const path = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ");
    const base = PAD.top + innerH;
    const areaPath = `${path} L${pts[pts.length - 1]?.x ?? PAD.left},${base} L${PAD.left},${base} Z`;
    return { line: path, area: areaPath, points: pts, maxV: max };
  }, [data]);

  const active = hover !== null ? points[hover] : null;

  return (
    <div className="adm__chart">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label="近 30 天每日问诊次数"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="admFill2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#b4522a" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#b4522a" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((r) => {
          const y = PAD.top + (CHART_H - PAD.top - PAD.bottom) * r;
          return (
            <line
              key={r}
              x1={PAD.left}
              x2={CHART_W - PAD.right}
              y1={y}
              y2={y}
              stroke="rgba(38,41,35,0.08)"
              strokeDasharray="3 5"
            />
          );
        })}
        <path d={area} fill="url(#admFill2)" />
        <path
          d={line}
          fill="none"
          stroke="#b4522a"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <g key={p.d.date}>
            <rect
              x={p.x - 8}
              y={PAD.top}
              width={16}
              height={CHART_H - PAD.top - PAD.bottom}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
            {(hover === i || p.d.consultations === maxV) && (
              <circle cx={p.x} cy={p.y} r={3.5} fill="#b4522a" stroke="#fffdf6" strokeWidth="1.5" />
            )}
          </g>
        ))}
        {active && (
          <line x1={active.x} x2={active.x} y1={PAD.top} y2={CHART_H - PAD.bottom} stroke="rgba(180,82,42,0.35)" />
        )}
        <text x={PAD.left} y={CHART_H - 6} className="adm__axis">
          {data[0]?.date.slice(5)}
        </text>
        <text x={CHART_W - PAD.right} y={CHART_H - 6} textAnchor="end" className="adm__axis">
          {data[data.length - 1]?.date.slice(5)}
        </text>
      </svg>
      {active && (
        <p className="adm__tip">
          {active.d.date} · 问诊 {active.d.consultations} 次 · 消息 {active.d.messages} 条
        </p>
      )}
    </div>
  );
}

function Bars({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="adm__bars" role="img" aria-label="近 30 天每日活跃用户数">
      {data.map((d) => (
        <span
          key={d.date}
          className="adm__bar"
          style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }}
          title={`${d.date}：${d.count} 人活跃`}
        >
          <i style={{ opacity: d.count > 0 ? 1 : 0.25 }} />
        </span>
      ))}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "accent" | "sage" | "warn";
}) {
  return (
    <div className={`adm__metric${tone ? ` adm__metric--${tone}` : ""}`}>
      <span className="adm__metric-label">{label}</span>
      <b className="adm__metric-value">{value}</b>
      {hint && <span className="adm__metric-hint">{hint}</span>}
    </div>
  );
}

function RateBar({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <li className="adm__rate">
      <span className="adm__rate-label">{label}</span>
      <span className="adm__rate-track">
        <i style={{ width: `${Math.min(100, Math.round(value * 100))}%` }} />
      </span>
      <b className="adm__rate-value">{pct(value)}</b>
      <em className="adm__rate-note">{note}</em>
    </li>
  );
}

/* ---------------------------------------------------------------- 主体 */

export default function AdminDashboard({
  stats,
  adminEmail,
  settings,
  keys,
  env,
  announcements,
  logs,
  logTotal,
  feedback,
  feedbackCounts,
  platformName = "MedAI",
}: {
  stats: AdminStats;
  adminEmail: string;
  settings: Record<string, string>;
  keys: { textKey: string; visionKey: string };
  env: { model: string; baseUrl: string; visionModel: string; demoMode: boolean };
  announcements: AnnouncementRow[];
  logs: LogRow[];
  logTotal: number;
  feedback: FeedbackRow[];
  feedbackCounts: Record<string, number>;
  /** 后台「系统参数 → 平台名称」 */
  platformName?: string;
}) {
  const router = useRouter();
  const [section, setSection] = useState<Section>("overview");
  const [navOpen, setNavOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [tempPwd, setTempPwd] = useState<{ email: string; password: string } | null>(null);

  const { overview, users, consultations, trend, attachmentKinds, activeUsers, departments, ai } = stats;

  const notify = (kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 4200);
  };

  async function run<T>(key: string, fn: () => Promise<T>, okText?: string): Promise<T | null> {
    setBusy(key);
    try {
      const out = await fn();
      if (okText) notify("ok", okText);
      router.refresh();
      return out;
    } catch (err) {
      notify("err", err instanceof Error ? err.message : "操作失败");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function toggleUser(u: UserRow) {
    const next = !u.disabled;
    await run(
      `user-${u.id}`,
      () => call(`/api/admin/users/${u.id}`, "PATCH", { action: next ? "disable" : "enable" }),
      next ? `已停用 ${u.email}` : `已恢复 ${u.email}`,
    );
  }

  async function resetPwd(u: UserRow) {
    const out = await run(`pwd-${u.id}`, () =>
      call<{ tempPassword: string }>(`/api/admin/users/${u.id}`, "PATCH", {
        action: "resetPassword",
      }),
    );
    if (out?.tempPassword) setTempPwd({ email: u.email, password: out.tempPassword });
  }

  const filteredUsers = useMemo(() => {
    const key = q.trim().toLowerCase();
    if (!key) return users;
    return users.filter((u) => u.email.toLowerCase().includes(key));
  }, [users, q]);

  const filteredConsults = useMemo(() => {
    const key = q.trim().toLowerCase();
    if (!key) return consultations;
    return consultations.filter(
      (c) =>
        c.title.toLowerCase().includes(key) ||
        c.patientName.toLowerCase().includes(key) ||
        c.ownerEmail.toLowerCase().includes(key) ||
        c.department.includes(key),
    );
  }, [consultations, q]);

  const topUsers = [...users].sort((a, b) => b.consultations - a.consultations).slice(0, 5);
  const maxDept = Math.max(1, ...departments.map((d) => d.count));
  const maxKind = Math.max(1, ...attachmentKinds.map((k) => k.count));
  const kindLabel: Record<string, string> = { image: "图片", pdf: "PDF", docx: "Word", text: "文本" };

  const titles: Record<Section, { title: string; sub: string }> = {
    overview: { title: "首页总览", sub: "平台核心指标，数据实时计算" },
    report: { title: "问诊数据报表", sub: "问诊流量、分科分布与服务质量" },
    ai: { title: "AI 效果监控", sub: "全部指标由真实数据算出，口径写在页面里" },
    users: { title: "患者管理", sub: "检索患者档案，管理所属账号的启用状态与密码" },
    feedback: { title: "用户反馈", sub: "用户在「我的」页面提交的问题与建议，可直接回复" },
    consults: { title: "问诊记录", sub: "症状输入与 AI 分析结果（不含对话原文）" },
    aiConfig: { title: "AI 模型配置", sub: "模型、参数与提示词；密钥只显示掩码" },
    params: { title: "系统参数", sub: "平台名称、联系方式与问诊规则" },
    notice: { title: "公告管理", sub: "发布给用户的系统公告" },
    logs: { title: "操作日志", sub: "后台关键操作记录，只能查看" },
  };

  return (
    <div className="adm adm--console">
      <div className="adm__sky" aria-hidden="true" />
      <div className="adm__grain" aria-hidden="true" />

      <div className="adm__layout">
        <aside className={`adm__side${navOpen ? " is-open" : ""}`}>
          <div className="adm__brand">
            <span className="adm__brand-dot" />
            <div>
              <b>{platformName} 控制台</b>
              <em>{adminEmail}</em>
            </div>
          </div>

          <nav className="adm__nav">
            {NAV.map((g) => (
              <div className="adm__nav-group" key={g.group}>
                <p className="adm__nav-title">
                  <span aria-hidden="true">{g.icon}</span>
                  {g.group}
                </p>
                {g.items.map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    className={`adm__nav-item${section === it.key ? " is-on" : ""}`}
                    onClick={() => {
                      setSection(it.key);
                      setQ("");
                      setNavOpen(false);
                    }}
                  >
                    {it.label}
                    {it.key === "users" && <i>{users.length}</i>}
                    {it.key === "consults" && <i>{consultations.length}</i>}
                    {it.key === "feedback" && feedbackCounts.open > 0 && (
                      <i className="adm__nav-badge">{feedbackCounts.open}</i>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <Link className="adm__exit" href="/">
            回到小兔子 →
          </Link>
        </aside>

        <main className="adm__main">
          <header className="adm__topbar">
            <button
              className="adm__menu"
              type="button"
              onClick={() => setNavOpen((v) => !v)}
              aria-label="切换菜单"
            >
              ☰
            </button>
            <div>
              <h1 className="adm__page-title">{titles[section].title}</h1>
              <p className="adm__page-sub">{titles[section].sub}</p>
            </div>
          </header>

          {toast && (
            <p className={`adm__toast adm__toast--${toast.kind}`} role="status">
              {toast.text}
            </p>
          )}

          {section === "overview" && (
            <>
              <section className="adm__metrics">
                <Metric label="患者档案" value={overview.patients} hint={`${overview.users} 个注册账号`} />
                <Metric
                  label="问诊总量"
                  value={overview.consultations}
                  hint={`近 30 天 ${overview.consultations30d} 次`}
                  tone="accent"
                />
                <Metric label="对话消息" value={overview.messages} hint={`进行中 ${overview.activeConsultations} 次`} />
                <Metric label="报告解读" value={overview.attachments} hint="用户上传的资料总数" />
                <Metric label="结论卡片" value={overview.notes} hint="用户自己沉淀的结论" tone="sage" />
                <Metric
                  label="红旗预警"
                  value={overview.redFlagCount}
                  hint={`涉及 ${overview.redFlagConsultations} 次问诊`}
                  tone="warn"
                />
              </section>

              <div className="adm__grid">
                <section className="adm__card adm__card--wide">
                  <div className="adm__card-head">
                    <h2>近 30 天问诊趋势</h2>
                    <span className="adm__legend">
                      <i /> 每日新建问诊
                    </span>
                  </div>
                  <TrendChart data={trend} />
                </section>

                <section className="adm__card">
                  <div className="adm__card-head">
                    <h2>每日活跃用户</h2>
                    <span className="adm__legend adm__legend--sage">当天有对话的人数</span>
                  </div>
                  <Bars data={activeUsers} />
                  <p className="adm__card-foot">
                    峰值 {Math.max(0, ...activeUsers.map((d) => d.count))} 人/天 · 共 30 天
                  </p>
                </section>

                <section className="adm__card">
                  <div className="adm__card-head">
                    <h2>资料构成</h2>
                    <span className="adm__legend">共 {overview.attachments} 份</span>
                  </div>
                  {attachmentKinds.length === 0 ? (
                    <p className="adm__empty">还没有人上传资料</p>
                  ) : (
                    <ul className="adm__kinds">
                      {attachmentKinds.map((k) => (
                        <li key={k.kind}>
                          <span className="adm__kind-name">{kindLabel[k.kind] ?? k.kind}</span>
                          <span className="adm__kind-track">
                            <i style={{ width: `${(k.count / maxKind) * 100}%` }} />
                          </span>
                          <b>{k.count}</b>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="adm__card adm__card--wide">
                  <div className="adm__card-head">
                    <h2>问诊最活跃的用户</h2>
                    <span className="adm__legend">按问诊次数</span>
                  </div>
                  {topUsers.length === 0 ? (
                    <p className="adm__empty">还没有用户产生问诊</p>
                  ) : (
                    <ul className="adm__rank">
                      {topUsers.map((u, i) => (
                        <li key={u.id}>
                          <span className="adm__rank-n">{i + 1}</span>
                          <span className="adm__rank-mail">{u.email}</span>
                          <span className="adm__rank-bar">
                            <i
                              style={{
                                width: `${(u.consultations / Math.max(1, topUsers[0].consultations)) * 100}%`,
                              }}
                            />
                          </span>
                          <b>{u.consultations} 次</b>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              <p className="adm__foot">
                统计口径：问诊按创建时间计；活跃用户指当天发过消息的账号；报告解读数 = 用户上传的资料数。
                {overview.since && ` 平台数据始于 ${fmtDate(overview.since)}。`}
              </p>
            </>
          )}

          {section === "report" && (
            <>
              <section className="adm__metrics">
                <Metric label="问诊总量" value={overview.consultations} hint="全部时间" />
                <Metric label="近 30 天" value={overview.consultations30d} hint="新建问诊数" tone="accent" />
                <Metric label="进行中" value={overview.activeConsultations} hint="未归档" />
                <Metric label="已归档" value={overview.archivedConsultations} hint="已结束" />
                <Metric label="平均轮次" value={ai.avgTurns} hint="每会话用户发言数" />
                <Metric label="红旗拦截" value={overview.redFlagCount} hint="命中危险信号" tone="warn" />
              </section>

              <div className="adm__grid">
                <section className="adm__card adm__card--wide">
                  <div className="adm__card-head">
                    <h2>问诊流量（近 30 天）</h2>
                    <span className="adm__legend">
                      <i /> 每日新建问诊
                    </span>
                  </div>
                  <TrendChart data={trend} />
                </section>

                <section className="adm__card">
                  <div className="adm__card-head">
                    <h2>分科分布</h2>
                    <span className="adm__legend">按标题/主诉关键词推断</span>
                  </div>
                  {departments.length === 0 ? (
                    <p className="adm__empty">还没有问诊数据</p>
                  ) : (
                    <ul className="adm__kinds">
                      {departments.slice(0, 9).map((d) => (
                        <li key={d.name}>
                          <span className="adm__kind-name">{d.name}</span>
                          <span className="adm__kind-track">
                            <i style={{ width: `${(d.count / maxDept) * 100}%` }} />
                          </span>
                          <b>{d.count}</b>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="adm__card-foot">
                    平台没有让用户选科室，这里是按标题与主诉关键词归类的推断值，仅用于了解问题分布。
                  </p>
                </section>

                <section className="adm__card">
                  <div className="adm__card-head">
                    <h2>服务质量</h2>
                    <span className="adm__legend">按会话数计算</span>
                  </div>
                  <ul className="adm__rates">
                    <RateBar label="有 AI 回复" value={ai.answerRate} note="会话得到过模型回答" />
                    <RateBar label="生成小结" value={ai.summaryRate} note="用户点了「小结这次问诊」" />
                    <RateBar label="沉淀结论" value={ai.noteRate} note="会话产出了结论卡片" />
                    <RateBar label="纠正提问" value={ai.editRate} note="用户改动过自己的话" />
                  </ul>
                  <p className="adm__card-foot">
                    「纠正提问」不是越高越好：它意味着 AI 第一次没听懂，是观察提问体验的负向信号。
                  </p>
                </section>

                <section className="adm__card">
                  <div className="adm__card-head">
                    <h2>每日活跃用户</h2>
                    <span className="adm__legend adm__legend--sage">当天有对话的人数</span>
                  </div>
                  <Bars data={activeUsers} />
                  <p className="adm__card-foot">
                    近 30 天，峰值 {Math.max(0, ...activeUsers.map((d) => d.count))} 人/天
                  </p>
                </section>
              </div>
            </>
          )}

          {section === "ai" && (
            <>
              <section className="adm__metrics">
                <Metric label="回答覆盖率" value={pct(ai.answerRate)} hint="有 AI 回复的会话占比" tone="sage" />
                <Metric label="分诊归类率" value={pct(ai.triageCoverage)} hint="能归到具体科室的会话" />
                <Metric label="资料识别率" value={pct(ai.attachExtractRate)} hint="读出正文或视觉描述" />
                <Metric label="小结生成率" value={pct(ai.summaryRate)} hint="用户主动生成小结" tone="accent" />
                <Metric label="结论沉淀率" value={pct(ai.noteRate)} hint="会话产出结论卡片" />
                <Metric label="红旗命中" value={ai.redFlagCount} hint="模型之外的安全兜底" tone="warn" />
              </section>

              <div className="adm__grid">
                <section className="adm__card">
                  <div className="adm__card-head">
                    <h2>效果指标明细</h2>
                    <span className="adm__legend">全部由真实数据算出</span>
                  </div>
                  <ul className="adm__rates">
                    <RateBar label="回答覆盖率" value={ai.answerRate} note="至少一条助手消息的会话" />
                    <RateBar label="分诊归类率" value={ai.triageCoverage} note="能归到具体科室的会话" />
                    <RateBar label="资料识别率" value={ai.attachExtractRate} note="附件读出了正文或图像描述" />
                    <RateBar label="小结生成率" value={ai.summaryRate} note="生成了问诊小结" />
                    <RateBar label="结论沉淀率" value={ai.noteRate} note="用户留下了结论卡片" />
                    <RateBar label="提问纠正率" value={ai.editRate} note="越低越好" />
                  </ul>
                </section>

                <section className="adm__card">
                  <div className="adm__card-head">
                    <h2>指标口径说明</h2>
                    <span className="adm__legend">请按这个理解数字</span>
                  </div>
                  <dl className="adm__defs">
                    <div>
                      <dt>分诊归类率</dt>
                      <dd>
                        平台没有独立的分诊模型，这里统计「能被关键词规则归到某科室」的会话占比，反映问题分布的可解释程度，不等于分诊准确率。
                      </dd>
                    </div>
                    <div>
                      <dt>资料识别率</dt>
                      <dd>
                        附件里能提取到文字，或被视觉模型读出内容的占比。识别失败通常意味着图片太糊或格式不支持。
                      </dd>
                    </div>
                    <div>
                      <dt>小结 / 结论沉淀率</dt>
                      <dd>
                        这两个是「用户觉得这次对话值得留下来」的可观测代理，比任何自评分都更能说明 AI 是否真的有用。
                      </dd>
                    </div>
                    <div>
                      <dt>平均轮次</dt>
                      <dd>{ai.avgTurns} 轮/会话。过低说明一问就结束，过高可能是 AI 一直在追问却没给结论。</dd>
                    </div>
                  </dl>
                </section>
              </div>
            </>
          )}

          {section === "users" && (
            <section className="adm__card">
              <div className="adm__card-head adm__card-head--search">
                <h2>全部患者档案</h2>
                <input
                  className="adm__search"
                  placeholder="按邮箱搜索"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>

              {tempPwd && (
                <div className="adm__temp">
                  <b>临时密码已生成（只显示这一次）</b>
                  <p>
                    {tempPwd.email} → <code>{tempPwd.password}</code>
                  </p>
                  <button type="button" className="adm__temp-x" onClick={() => setTempPwd(null)}>
                    我记下了
                  </button>
                </div>
              )}

              {filteredUsers.length === 0 ? (
                <p className="adm__empty">没有匹配的账号</p>
              ) : (
                <div className="adm__table-wrap">
                  <table className="adm__table">
                    <thead>
                      <tr>
                        <th>邮箱</th>
                        <th>注册</th>
                        <th>最近登录</th>
                        <th>档案</th>
                        <th>问诊</th>
                        <th>消息</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => (
                        <tr key={u.id} className={u.disabled ? "is-off" : ""}>
                          <td className="adm__td-mail">{u.email}</td>
                          <td>{fmtDate(u.createdAt)}</td>
                          <td>{relative(u.lastLoginAt)}</td>
                          <td>{u.patients}</td>
                          <td>{u.consultations}</td>
                          <td>{u.messages}</td>
                          <td>
                            <span
                              className={`adm__badge ${u.disabled ? "adm__badge--off" : "adm__badge--active"}`}
                            >
                              {u.disabled ? "已停用" : "正常"}
                            </span>
                          </td>
                          <td className="adm__td-acts">
                            <button
                              type="button"
                              className={`adm__mini${u.disabled ? " adm__mini--ok" : " adm__mini--danger"}`}
                              disabled={busy === `user-${u.id}`}
                              onClick={() => void toggleUser(u)}
                            >
                              {busy === `user-${u.id}` ? "…" : u.disabled ? "启用" : "停用"}
                            </button>
                            <button
                              type="button"
                              className="adm__mini"
                              disabled={busy === `pwd-${u.id}`}
                              onClick={() => void resetPwd(u)}
                            >
                              {busy === `pwd-${u.id}` ? "…" : "重置密码"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="adm__card-foot">
                停用立即生效：该账号已登录的会话也会失效。重置密码生成 12 位临时密码，只在本次弹窗显示。
              </p>
            </section>
          )}

          {section === "consults" && (
            <section className="adm__card">
              <div className="adm__card-head adm__card-head--search">
                <h2>全部问诊会话</h2>
                <input
                  className="adm__search"
                  placeholder="按标题 / 患者 / 邮箱 / 科室搜索"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              {filteredConsults.length === 0 ? (
                <p className="adm__empty">没有匹配的问诊记录</p>
              ) : (
                <ul className="adm__rows">
                  {filteredConsults.map((c) => (
                    <ConsultCard key={c.id} row={c} />
                  ))}
                </ul>
              )}
              <p className="adm__card-foot">
                共 {filteredConsults.length} 条。展示症状输入（档案主诉）与 AI 小结，不提供对话原文。
              </p>
            </section>
          )}

          {section === "aiConfig" && (
            <AiConfigForm settings={settings} keys={keys} env={env} notify={notify} />
          )}

          {section === "feedback" && (
            <AdminFeedbackPanel rows={feedback} counts={feedbackCounts} />
          )}

          {section === "params" && <ParamsForm settings={settings} notify={notify} />}

          {section === "notice" && <NoticePanel rows={announcements} busy={busy} run={run} notify={notify} />}

          {section === "logs" && (
            <section className="adm__card">
              <div className="adm__card-head">
                <h2>后台操作日志</h2>
                <span className="adm__legend">
                  共 {logTotal} 条 · 显示最近 {logs.length} 条
                </span>
              </div>
              {logs.length === 0 ? (
                <p className="adm__empty">还没有记录到管理操作</p>
              ) : (
                <ul className="adm__logs">
                  {logs.map((l) => (
                    <li key={l.id} className="adm__log">
                      <span className={`adm__log-tag adm__log-tag--${ACTION_TONE[l.action] ?? "neutral"}`}>
                        {ACTION_LABELS[l.action] ?? l.action}
                      </span>
                      <span className="adm__log-main">
                        <b>{l.target}</b>
                        {l.detail && <em>{l.detail}</em>}
                      </span>
                      <span className="adm__log-meta">
                        {l.actorEmail} · {fmtDateTime(l.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="adm__card-foot">日志只读，后台不提供删除或改写入口。</p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ 问诊卡片 */

function ConsultCard({ row }: { row: ConsultationRow }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="adm__row">
      <div className="adm__row-main">
        <div className="adm__row-head">
          <b className="adm__row-title">{row.title}</b>
          <span className="adm__badge adm__badge--dept">{row.department}</span>
          <span className={`adm__badge adm__badge--${row.status}`}>
            {row.status === "active" ? "进行中" : "已归档"}
          </span>
          {row.redFlagCount > 0 && <span className="adm__badge adm__badge--flag">红旗 ×{row.redFlagCount}</span>}
        </div>
        <p className="adm__row-meta">
          {row.patientName} · {row.ownerEmail} · {row.messageCount} 条消息 · 更新于 {fmtDateTime(row.updatedAt)}
        </p>
        {row.chiefComplaint && <p className="adm__row-symptom">主诉：{row.chiefComplaint}</p>}
        {row.redFlagLabels.length > 0 && (
          <div className="adm__tags">
            {row.redFlagLabels.slice(0, 6).map((t) => (
              <span key={t} className="adm__tag adm__tag--warn">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <button className="adm__expand" type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "收起" : "AI 分析"}
      </button>
      {open && (
        <p className="adm__summary">
          {row.summary || "这次问诊还没有生成 AI 小结（用户没点「小结这次问诊」）。"}
        </p>
      )}
    </li>
  );
}

/* ------------------------------------------------------------ AI 配置 */

function AiConfigForm({
  settings,
  keys,
  env,
  notify,
}: {
  settings: Record<string, string>;
  keys: { textKey: string; visionKey: string };
  env: { model: string; baseUrl: string; visionModel: string; demoMode: boolean };
  notify: (kind: "ok" | "err", text: string) => void;
}) {
  const router = useRouter();
  const [model, setModel] = useState(settings["ai.model"] ?? "");
  const [temperature, setTemperature] = useState(settings["ai.temperature"] ?? "0.6");
  const [maxTokens, setMaxTokens] = useState(settings["ai.maxTokens"] ?? "900");
  const [prompt, setPrompt] = useState(settings["ai.prompt"] ?? "");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const out = await call<{ restartRequired: boolean }>("/api/admin/settings", "PATCH", {
        "ai.model": model,
        "ai.temperature": temperature,
        "ai.maxTokens": maxTokens,
        "ai.prompt": prompt,
        ...(apiKey.trim() ? { aiApiKey: apiKey.trim() } : {}),
      });
      notify("ok", out.restartRequired ? "已保存；密钥写入 .env，需重启服务生效" : "AI 配置已保存并生效");
      setApiKey("");
      router.refresh();
    } catch (err) {
      notify("err", err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="adm__grid">
      <section className="adm__card">
        <div className="adm__card-head">
          <h2>模型与参数</h2>
          <span className="adm__legend">保存后立即生效</span>
        </div>
        <div className="adm__form">
          <label className="adm__field">
            <span>文本模型</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={env.model} />
            <em>留空则使用 .env 的 {env.model}</em>
          </label>
          <div className="adm__form-row">
            <label className="adm__field">
              <span>temperature</span>
              <input value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="0.6" />
              <em>0 ~ 1.5，越低越稳定</em>
            </label>
            <label className="adm__field">
              <span>max_tokens</span>
              <input value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="900" />
              <em>100 ~ 4000</em>
            </label>
          </div>
          <label className="adm__field">
            <span>补充 System Prompt</span>
            <textarea
              rows={6}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="会在每次问诊的系统提示词末尾追加，用于统一话术风格等。"
            />
            <em>拼接在系统提示词末尾，与红线规则共存</em>
          </label>
          <button
            className="clay clay--pill adm__save"
            type="button"
            disabled={saving}
            onClick={() => void save()}
          >
            <span className="clay__text">{saving ? "保存中…" : "保存配置"}</span>
          </button>
        </div>
      </section>

      <section className="adm__card">
        <div className="adm__card-head">
          <h2>接口与密钥</h2>
          <span className="adm__legend">密钥只显示掩码</span>
        </div>
        <dl className="adm__defs">
          <div>
            <dt>接口地址</dt>
            <dd>{env.baseUrl}</dd>
          </div>
          <div>
            <dt>文本模型 Key</dt>
            <dd>
              <code>{keys.textKey}</code>
            </dd>
          </div>
          <div>
            <dt>视觉模型</dt>
            <dd>
              {env.visionModel} · Key <code>{keys.visionKey}</code>
            </dd>
          </div>
          <div>
            <dt>演示模式</dt>
            <dd>{env.demoMode ? "已开启（不调用真实模型）" : "关闭（调用真实模型）"}</dd>
          </div>
        </dl>
        <div className="adm__form">
          <label className="adm__field">
            <span>更新密钥</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="粘贴新的 API Key（留空表示不修改）"
              autoComplete="off"
            />
            <em>密钥写入服务器 .env，不存数据库；写入后需重启服务生效。当前 Key 不会回显。</em>
          </label>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ 系统参数 */

function ParamsForm({
  settings,
  notify,
}: {
  settings: Record<string, string>;
  notify: (kind: "ok" | "err", text: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(settings["platform.name"] ?? "MedAI");
  const [contact, setContact] = useState(settings["platform.contact"] ?? "");
  const [notice, setNotice] = useState(settings["platform.notice"] ?? "");
  const [rules, setRules] = useState(settings["consult.rules"] ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await call("/api/admin/settings", "PATCH", {
        "platform.name": name,
        "platform.contact": contact,
        "platform.notice": notice,
        "consult.rules": rules,
      });
      notify("ok", "系统参数已保存");
      router.refresh();
    } catch (err) {
      notify("err", err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="adm__card">
      <div className="adm__card-head">
        <h2>基础配置</h2>
        <span className="adm__legend">保存后立即生效</span>
      </div>
      <div className="adm__form">
        <div className="adm__form-row">
          <label className="adm__field">
            <span>平台名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="MedAI" />
          </label>
          <label className="adm__field">
            <span>联系方式</span>
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="如 support@example.com"
            />
          </label>
        </div>
        <label className="adm__field">
          <span>平台提示</span>
          <input
            value={notice}
            onChange={(e) => setNotice(e.target.value)}
            placeholder="给用户看的一句话说明，可留空"
          />
        </label>
        <label className="adm__field">
          <span>问诊规则</span>
          <textarea
            rows={6}
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            placeholder="会追加到每次问诊的系统提示词，例如：凡涉及儿童，一律建议线下就诊。"
          />
          <em>与红线规则一起生效；留空表示不追加</em>
        </label>
        <button
          className="clay clay--pill adm__save"
          type="button"
          disabled={saving}
          onClick={() => void save()}
        >
          <span className="clay__text">{saving ? "保存中…" : "保存参数"}</span>
        </button>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- 公告 */

function NoticePanel({
  rows,
  busy,
  run,
  notify,
}: {
  rows: AnnouncementRow[];
  busy: string | null;
  run: <T>(key: string, fn: () => Promise<T>, okText?: string) => Promise<T | null>;
  notify: (kind: "ok" | "err", text: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [editing, setEditing] = useState<AnnouncementRow | null>(null);

  async function create() {
    if (!title.trim() || !body.trim()) {
      notify("err", "标题和内容都要填");
      return;
    }
    const ok = await run("notice-create", () =>
      call("/api/admin/announcements", "POST", { title, body, pinned }), "公告已发布");
    if (ok) {
      setTitle("");
      setBody("");
      setPinned(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const ok = await run(`notice-${editing.id}`, () =>
      call(`/api/admin/announcements/${editing.id}`, "PATCH", {
        title: editing.title,
        body: editing.body,
        pinned: editing.pinned,
      }), "公告已更新");
    if (ok) setEditing(null);
  }

  return (
    <div className="adm__grid">
      <section className="adm__card">
        <div className="adm__card-head">
          <h2>发布新公告</h2>
          <span className="adm__legend">启用后用户可见</span>
        </div>
        <div className="adm__form">
          <label className="adm__field">
            <span>标题</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={60}
              placeholder="如 系统维护通知"
            />
          </label>
          <label className="adm__field">
            <span>内容</span>
            <textarea
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
              placeholder="公告正文"
            />
          </label>
          <label className="adm__check">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            置顶这条公告
          </label>
          <button
            className="clay clay--pill adm__save"
            type="button"
            disabled={busy === "notice-create"}
            onClick={() => void create()}
          >
            <span className="clay__text">{busy === "notice-create" ? "发布中…" : "发布公告"}</span>
          </button>
        </div>
      </section>

      <section className="adm__card">
        <div className="adm__card-head">
          <h2>已有公告</h2>
          <span className="adm__legend">共 {rows.length} 条</span>
        </div>
        {rows.length === 0 ? (
          <p className="adm__empty">还没有发布过公告</p>
        ) : (
          <ul className="adm__notices">
            {rows.map((a) => (
              <li key={a.id} className={`adm__notice${a.enabled ? "" : " is-off"}`}>
                {editing?.id === a.id ? (
                  <div className="adm__form">
                    <input
                      className="adm__inline-input"
                      value={editing.title}
                      onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    />
                    <textarea
                      className="adm__inline-input"
                      rows={4}
                      value={editing.body}
                      onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                    />
                    <label className="adm__check">
                      <input
                        type="checkbox"
                        checked={editing.pinned}
                        onChange={(e) => setEditing({ ...editing, pinned: e.target.checked })}
                      />
                      置顶
                    </label>
                    <div className="adm__notice-acts">
                      <button className="adm__mini adm__mini--ok" type="button" onClick={() => void saveEdit()}>
                        保存
                      </button>
                      <button className="adm__mini" type="button" onClick={() => setEditing(null)}>
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="adm__notice-head">
                      <b>{a.title}</b>
                      {a.pinned && <span className="adm__badge adm__badge--pin">置顶</span>}
                      <span className={`adm__badge ${a.enabled ? "adm__badge--active" : "adm__badge--off"}`}>
                        {a.enabled ? "已启用" : "已停用"}
                      </span>
                    </div>
                    <p className="adm__notice-body">{a.body}</p>
                    <p className="adm__notice-meta">
                      {fmtDateTime(a.createdAt)} 发布 · {fmtDateTime(a.updatedAt)} 更新
                    </p>
                    <div className="adm__notice-acts">
                      <button className="adm__mini" type="button" onClick={() => setEditing(a)}>
                        编辑
                      </button>
                      <button
                        className="adm__mini"
                        type="button"
                        disabled={busy === `notice-${a.id}`}
                        onClick={() =>
                          void run(
                            `notice-${a.id}`,
                            () => call(`/api/admin/announcements/${a.id}`, "PATCH", { enabled: !a.enabled }),
                            a.enabled ? "已停用该公告" : "已启用该公告",
                          )
                        }
                      >
                        {a.enabled ? "停用" : "启用"}
                      </button>
                      <button
                        className="adm__mini adm__mini--danger"
                        type="button"
                        disabled={busy === `del-${a.id}`}
                        onClick={() => {
                          if (!window.confirm(`确定删除公告《${a.title}》？`)) return;
                          void run(
                            `del-${a.id}`,
                            () => call(`/api/admin/announcements/${a.id}`, "DELETE"),
                            "公告已删除",
                          );
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
