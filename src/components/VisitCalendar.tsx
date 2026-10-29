"use client";

import { useMemo, useState } from "react";
import type { Consultation } from "@/lib/client/types";

/**
 * 问诊记录的日历视图
 *
 * 有问诊的日期下面点一个小点，点日期看那天的记录，点记录看当次的聊天原文。
 * 一条记录归到「最后一次说话那天」——会话恢复机制会让同一次问诊跨几天接着聊，
 * 归到更新的那天才不会出现「今天聊完了但今天没有点」。
 */

const WEEK = ["一", "二", "三", "四", "五", "六", "日"];

/** 同一天最多先露几条 */
const PER_DAY = 5;

const pad = (n: number) => String(n).padStart(2, "0");

/** 本地时区的 YYYY-MM-DD，不能用 toISOString（那是 UTC，晚上会跨天） */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function clockLabel(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 这条问诊算哪天聊的。
 * 优先用最后一条消息的时间；过期问诊没有消息了，退回 updatedAt。
 * 不能用 updatedAt 打头：归档、生成摘要都会刷新它，会让上周的问诊跳到今天。
 */
function visitMoment(v: Consultation): string {
  return v.lastMessageAt ?? v.updatedAt;
}

/** 周一开头：把 getDay() 的周日=0 换成周一=0 */
function leadBlanks(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function dayTitle(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${m} 月 ${d} 日 · 周${WEEK[(date.getDay() + 6) % 7]}`;
}

export default function VisitCalendar({
  visits,
  busy,
  onOpenLog,
  onOpenSheet,
  onDelete,
}: {
  visits: Consultation[];
  busy: boolean;
  /** 打开这次问诊的聊天原文（或超过保留期后的小结） */
  onOpenLog: (v: Consultation) => void;
  onOpenSheet: (id: string) => void;
  onDelete: (v: Consultation) => void;
}) {
  /** 按最后活动日期归组 */
  const byDay = useMemo(() => {
    const map = new Map<string, Consultation[]>();
    for (const v of visits) {
      const key = dayKey(visitMoment(v));
      const list = map.get(key);
      if (list) list.push(v);
      else map.set(key, [v]);
    }
    // 同一天里按时间倒序
    for (const list of map.values()) {
      list.sort((a, b) => visitMoment(b).localeCompare(visitMoment(a)));
    }
    return map;
  }, [visits]);

  // 打开时停在最近一次问诊的那个月；一次都没有就看这个月
  const [cursor, setCursor] = useState(() => {
    const base = visits[0] ? new Date(visitMoment(visits[0])) : new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  // 默认就选中最近那一天：一进来先看到「上次聊了什么」，不用先点一下
  const [picked, setPicked] = useState<string | null>(() =>
    visits[0] ? dayKey(visitMoment(visits[0])) : null,
  );
  /** 一天聊了太多次时先折叠，展开过的那几天记在这里 */
  const [expanded, setExpanded] = useState<string[]>([]);

  const todayKey = dayKey(new Date().toISOString());

  const cells = useMemo(() => {
    const lead = leadBlanks(cursor.year, cursor.month);
    const total = daysInMonth(cursor.year, cursor.month);
    const out: (number | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= total; d++) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor]);

  /** 当前显示月份里的记录，按日期倒序 */
  const monthGroups = useMemo(() => {
    const prefix = `${cursor.year}-${pad(cursor.month + 1)}-`;
    return [...byDay.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort((a, b) => b[0].localeCompare(a[0]));
  }, [byDay, cursor]);

  const monthCount = monthGroups.reduce((n, [, list]) => n + list.length, 0);

  /** 点了某天就只显示那天，否则显示整月 */
  const shownGroup = picked
    ? { key: picked, items: byDay.get(picked) ?? [] }
    : null;

  function shift(delta: number) {
    setPicked(null);
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function pick(key: string) {
    setPicked((prev) => (prev === key ? null : key));
  }

  return (
    <section className="vcal">
      <header className="vcal__bar">
        <button
          className="vcal__nav"
          type="button"
          onClick={() => shift(-1)}
          aria-label="上个月"
        >
          ‹
        </button>
        <div className="vcal__now">
          <b>
            {cursor.year} 年 {cursor.month + 1} 月
          </b>
          <span>{monthCount ? `${monthCount} 次问诊` : "没有问诊"}</span>
        </div>
        <button
          className="vcal__nav"
          type="button"
          onClick={() => shift(1)}
          aria-label="下个月"
        >
          ›
        </button>
      </header>

      <div className="vcal__week">
        {WEEK.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="vcal__grid">
        {cells.map((day, i) => {
          if (day === null) return <span className="vcal__pad" key={`p${i}`} />;
          const key = `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}`;
          const list = byDay.get(key);
          const count = list?.length ?? 0;
          return (
            <button
              key={key}
              type="button"
              className={[
                "vcal__day",
                count ? "is-marked" : "",
                picked === key ? "is-picked" : "",
                key === todayKey ? "is-today" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => pick(key)}
              disabled={!count}
              aria-label={
                count ? `${dayTitle(key)}，${count} 次问诊` : `${dayTitle(key)}，没有问诊`
              }
              aria-pressed={picked === key}
            >
              <span className="vcal__num">{day}</span>
              {count > 0 && (
                <span className={`vcal__dot${count > 1 ? " is-many" : ""}`} aria-hidden="true">
                  <i />
                  {count > 1 && <i />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="vcal__hint">
        {picked
          ? `${dayTitle(picked)} · ${shownGroup?.items.length ?? 0} 次`
          : monthCount
            ? "点有圆点的日期，看当天聊了什么"
            : "这个月还没有问诊，换个月看看"}
        {picked && (
          <button className="vcal__clear" type="button" onClick={() => setPicked(null)}>
            看整月
          </button>
        )}
      </p>

      <div className="vloglist">
        {shownGroup
          ? renderGroup(shownGroup.key, shownGroup.items)
          : monthGroups.map(([key, items]) => renderGroup(key, items))}
        {!monthCount && !shownGroup && (
          <p className="vloglist__empty">还没有问诊记录，回小兔子那儿聊一次吧。</p>
        )}
        {shownGroup && shownGroup.items.length === 0 && (
          <p className="vloglist__empty">这天没有问诊。</p>
        )}
      </div>
    </section>
  );

  function renderGroup(key: string, items: Consultation[]) {
    if (!items.length) return null;
    // 一天里聊了七八次的情况多半是测试留下的，先露 5 条，剩下的自己展开
    const open = expanded.includes(key);
    const shown = open ? items : items.slice(0, PER_DAY);
    return (
      <div className="vloggroup" key={key}>
        <p className="vloggroup__day">{dayTitle(key)}</p>
        {shown.map((v) => {
          // messageCount 只统计保留期内的消息；为 0 说明原文已经超过 30 天
          const expired = v.messageCount === 0;
          const hasSummary = Boolean(v.summary && v.summary.trim());
          return (
            <article className={`vlogcard${expired ? " is-faded" : ""}`} key={v.id}>
              <div className="vlogcard__head">
                <b className="vlogcard__title">{v.title}</b>
                <span className="vlogcard__time">{clockLabel(visitMoment(v))}</span>
              </div>

              {expired ? (
                <p className="vlogcard__meta is-expired">
                  {hasSummary
                    ? "超过 30 天，聊天原文已清除，只剩小结"
                    : "超过 30 天，聊天原文已清除，当时没有留下小结"}
                </p>
              ) : (
                <p className="vlogcard__last">{v.lastMessage || "还没有对话"}</p>
              )}

              <div className="vlogcard__row">
                {!expired && (
                  <span className="vlogcard__count">{v.messageCount} 条消息</span>
                )}
                {hasSummary && <span className="vlogcard__badge">有小结</span>}
                <button
                  className="vlogcard__open"
                  type="button"
                  onClick={() => onOpenLog(v)}
                  disabled={busy}
                >
                  {expired ? (hasSummary ? "看小结" : "看看情况") : "看聊天记录"}
                </button>
                <button
                  className={`vlogcard__sheet${v.hasSheet ? " is-ready" : ""}`}
                  type="button"
                  onClick={() => onOpenSheet(v.id)}
                  disabled={busy || expired}
                  title={expired ? "原文已清除，整理不了新的摘要" : "整理成一张能带去门诊的纸"}
                >
                  {v.hasSheet ? "看就诊摘要" : "整理成摘要"}
                </button>
                <button
                  className="vlogcard__del"
                  type="button"
                  onClick={() => onDelete(v)}
                  disabled={busy}
                >
                  删除
                </button>
              </div>
            </article>
          );
        })}
        {items.length > PER_DAY && (
          <button
            className="vloggroup__more"
            type="button"
            onClick={() =>
              setExpanded((prev) =>
                prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
              )
            }
          >
            {open ? "收起" : `还有 ${items.length - PER_DAY} 次 · 展开`}
          </button>
        )}
      </div>
    );
  }
}
