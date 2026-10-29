"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, getConsultation } from "@/lib/client/api";
import type { ConsultationDetail, Message } from "@/lib/client/types";

/**
 * 看一次问诊的聊天原文
 *
 * 对话只留 30 天（见 lib/retention）。超过之后 messageCount 会变成 0，
 * 这时不再假装还有原文，改读那次问诊的小结；小结也没有就照实说清楚。
 */

const pad = (n: number) => String(n).padStart(2, "0");

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${m} 月 ${d} 日 · 周${WEEK[date.getDay()]}`;
}

function clock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function roleLabel(m: Message): string {
  if (m.role === "user") return "我";
  if (m.flag) return "提醒";
  return "小兔子";
}

export default function VisitTranscript({
  consultationId,
  fallbackTitle,
  onClose,
}: {
  consultationId: string;
  /** 详情还没回来时先顶上的标题，避免头部一行空白 */
  fallbackTitle: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ConsultationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    getConsultation(consultationId)
      .then(({ consultation }) => {
        if (alive) setDetail(consultation);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : "打不开这次问诊");
      });
    return () => {
      alive = false;
    };
  }, [consultationId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 一次性打开时滚到最底下看最后几句，比从头读更接近"刚才聊到哪"
  useEffect(() => {
    if (detail && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [detail]);

  const messages = detail?.messages ?? [];
  const hasText = messages.length > 0;
  const summary = detail?.summary?.trim() || "";
  const days = detail?.retention?.days ?? 30;

  /** 按天分组，跨天聊的内容不会挤成一坨 */
  const groups: { key: string; items: Message[] }[] = [];
  for (const m of messages) {
    const key = dayKey(m.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(m);
    else groups.push({ key, items: [m] });
  }

  // 必须挂到 body 上。
  // 档案页的 .detail 带入场动画（sheet-in），动画元素会成为后代 fixed 元素的
  // containing block —— 直接写在组件里，position: fixed 就变成"相对这张卡片"，
  // 阅读器会被撑成整个面板高度、卡片落到视口外几千像素。
  // 这个面板只在点击后渲染，服务端走不到这里。
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="vread" role="dialog" aria-modal="true" aria-label="问诊聊天记录">
      <div className="vread__mask" onClick={onClose} />

      <section className="vread__card">
        <header className="vread__head">
          <div>
            <p className="vread__eyebrow">
              问诊记录 ·{" "}
              {detail ? clock(detail.lastMessageAt ?? detail.updatedAt) : "…"}
            </p>
            <h2 className="vread__title">{detail?.title || fallbackTitle}</h2>
            {detail && (
              <p className="vread__sub">
                {hasText
                  ? `${messages.length} 条消息 · 原文保留 ${days} 天`
                  : `聊天原文已超出 ${days} 天保留期`}
              </p>
            )}
          </div>
          <button className="vread__close" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="vread__body" ref={bodyRef}>
          {error && <p className="vread__error">{error}</p>}

          {!detail && !error && (
            <div className="vread__loading">
              <span />
              <span />
              <span />
            </div>
          )}

          {detail && !hasText && (
            <>
              <p className="vread__note">
                这次聊天已经超过 {days} 天，按保留策略把原文清掉了 —— 留着的只有当时整理出来的东西。
              </p>
              {summary ? (
                <div className="vread__sum">
                  <p className="vread__sum-tag">当时的问诊小结</p>
                  <p className="vread__sum-text">{summary}</p>
                </div>
              ) : (
                <p className="vread__gone">
                  当时没有生成小结，所以这次问诊现在只剩标题和时间。
                  以后聊完点一下「生成小结」，超期之后就还能看到这一页。
                </p>
              )}
            </>
          )}

          {groups.map((g) => (
            <div className="vread__day" key={g.key}>
              <p className="vread__daytag">{dayLabel(g.key)}</p>
              {g.items.map((m) => {
                const mine = m.role === "user";
                const flag = Boolean(m.flag);
                return (
                  <div
                    className={[
                      "vread__msg",
                      mine ? "is-mine" : "is-ai",
                      flag ? "is-flag" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={m.id}
                  >
                    <p className="vread__who">
                      {roleLabel(m)}
                      <span>{clock(m.createdAt)}</span>
                    </p>
                    <p className="vread__text">{m.content}</p>
                    {m.attachment && (
                      <p className="vread__file">
                        附件 · {m.attachment.filename}
                        {m.attachment.hasText ? `（已读到 ${m.attachment.textLength} 字）` : ""}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <footer className="vread__foot">
          {detail && hasText && summary && (
            <p className="vread__footsum">这次的小结：{summary}</p>
          )}
          <button className="clay clay--pill vread__done" type="button" onClick={onClose}>
            <span className="clay__text">看完了</span>
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
