"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, patchFeedback } from "@/lib/client/api";

/**
 * 后台「用户反馈」面板。
 *
 * 用户在「我的」页面写的内容会原样出现在这里 —— 这是用户主动写给平台看的，
 * 与问诊记录「只给摘要不给原文」的边界不冲突。
 */

export type FeedbackRow = {
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

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "open", label: "待处理" },
  { key: "read", label: "已查看" },
  { key: "done", label: "已处理" },
] as const;

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AdminFeedbackPanel({
  rows,
  counts,
}: {
  rows: FeedbackRow[];
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("open");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const list = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  async function act(id: string, body: { status?: string; reply?: string }, okText: string) {
    setBusy(id);
    setMsg(null);
    try {
      await patchFeedback(id, body);
      setMsg({ kind: "ok", text: okText });
      router.refresh();
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof ApiError ? err.message : "操作失败" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="adm__card">
      <div className="adm__card-head">
        <h2>用户反馈</h2>
        <span className="adm__legend">
          待处理 {counts.open ?? 0} · 已查看 {counts.read ?? 0} · 已处理 {counts.done ?? 0}
        </span>
      </div>

      <div className="adm__fb-filters">
        {FILTERS.map((f) => {
          const n = f.key === "all" ? rows.length : (counts[f.key] ?? 0);
          return (
            <button
              key={f.key}
              type="button"
              className={`adm__fb-filter${filter === f.key ? " is-on" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <i>{n}</i>
            </button>
          );
        })}
      </div>

      {msg && (
        <p className={`adm__fb-msg is-${msg.kind}`} role="status">
          {msg.text}
        </p>
      )}

      {list.length === 0 ? (
        <p className="adm__empty">
          {filter === "open" ? "没有待处理的反馈，干净。" : "这个筛选下没有内容"}
        </p>
      ) : (
        <ul className="adm__fbs">
          {list.map((f) => {
            const draft = drafts[f.id] ?? f.reply ?? "";
            return (
              <li className={`adm__fb is-${f.status}`} key={f.id}>
                <div className="adm__fb-head">
                  <span className={`adm__fb-status is-${f.status}`}>
                    {STATUS_LABEL[f.status] ?? f.status}
                  </span>
                  <span className="adm__fb-kind">{KIND_LABEL[f.kind] ?? f.kind}</span>
                  <b className="adm__fb-user">{f.userEmail ?? "未知用户"}</b>
                  <time className="adm__fb-time">{fmt(f.createdAt)}</time>
                  {f.rating !== null && (
                    <span className="adm__fb-stars" title={`满意度 ${f.rating}/5`}>
                      {"★".repeat(f.rating)}
                      <i>{"★".repeat(5 - f.rating)}</i>
                    </span>
                  )}
                </div>

                <p className="adm__fb-body">{f.content}</p>

                <div className="adm__fb-meta">
                  {f.contact && (
                    <span>
                      联系方式：<b>{f.contact}</b>
                    </span>
                  )}
                  {f.page && <span>来自：{f.page}</span>}
                  {f.handledAt && <span>处理于 {fmt(f.handledAt)}</span>}
                </div>

                <div className="adm__fb-replybox">
                  <textarea
                    value={draft}
                    placeholder="写一句回复，用户会在「我的」页面看到…"
                    rows={2}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [f.id]: e.target.value }))}
                  />
                  <div className="adm__fb-actions">
                    <button
                      className="adm__mini adm__mini--ok"
                      type="button"
                      disabled={busy === f.id || draft === (f.reply ?? "")}
                      onClick={() => act(f.id, { reply: draft }, "回复已保存，用户能看到")}
                    >
                      保存回复
                    </button>

                    {f.status === "open" && (
                      <button
                        className="adm__mini"
                        type="button"
                        disabled={busy === f.id}
                        onClick={() => act(f.id, { status: "read" }, "已标记为查看")}
                      >
                        标记已查看
                      </button>
                    )}

                    {f.status !== "done" ? (
                      <button
                        className="adm__mini adm__mini--ok"
                        type="button"
                        disabled={busy === f.id}
                        onClick={() =>
                          act(
                            f.id,
                            // 处理完顺手把草稿里的回复一起存下来，少一次点击
                            draft && draft !== (f.reply ?? "")
                              ? { status: "done", reply: draft }
                              : { status: "done" },
                            "已标记为处理完成",
                          )
                        }
                      >
                        标记已处理
                      </button>
                    ) : (
                      <button
                        className="adm__mini"
                        type="button"
                        disabled={busy === f.id}
                        onClick={() => act(f.id, { status: "open" }, "已重新打开")}
                      >
                        重新打开
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="adm__card-foot">
        共 {rows.length} 条（最近 100 条）。反馈内容为用户主动提交，可直接阅读；
        回复会展示在用户「我的」页面。
      </p>
    </section>
  );
}
