"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  axisDay,
  axisTime,
  buildTimeline,
  type TimelineEvent,
  type TimelineKind,
} from "@/lib/timeline";
import type { Consultation, Medication, Note, Patient } from "@/lib/client/types";

/**
 * 病程时间轴：一条纵轴读完这段病程。
 *
 * 两种看法：
 *   - 平时在档案页里看，卡片上能点「看原文」跳回那次问诊；
 *   - 「投影视图」铺一张干净白纸，只留标题、基本信息和时间轴本体，
 *     截一张图直接贴进 PPT / 病历汇报，不用再裁掉周围的按钮。
 */

const KIND_LABEL: Record<TimelineKind, string> = {
  formed: "建档",
  med: "用药",
  visit: "问诊",
  note: "结论",
};

function fmtSpan(first: string | null, last: string | null): string {
  if (!first) return "";
  const f = new Date(first);
  const l = last ? new Date(last) : f;
  const one = (d: Date) =>
    `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  const a = one(f);
  const b = one(l);
  return a === b ? a : `${a} — ${b}`;
}

export default function PatientTimeline({
  patient,
  medications,
  notes,
  consultations,
  onOpenVisit,
}: {
  patient: Patient;
  medications: Medication[];
  notes: Note[];
  consultations: Consultation[];
  onOpenVisit: (v: { id: string; title: string }) => void;
}) {
  const timeline = useMemo(
    () => buildTimeline({ patient, medications, notes, consultations }),
    [patient, medications, notes, consultations],
  );

  const [clean, setClean] = useState(false);
  /**
   * 投影视图里「缩到一屏」：纸比视口高的时候，缩一下才能一张截图拍完整段病程。
   * 默认不缩 —— 字号是给投影仪看的，能原尺寸就别缩。
   */
  const [fitAll, setFitAll] = useState(false);
  const [fitScale, setFitScale] = useState(1);
  const paperRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!clean) return;
    const measure = () => {
      const el = paperRef.current;
      if (!el) return;
      // offsetHeight 不受 transform 影响，缩过之后量到的还是原尺寸
      const h = el.offsetHeight;
      const room = window.innerHeight - 56;
      // 0.4 以下字就看不清了，宁可让它滚
      setFitScale(Math.min(1, Math.max(0.4, room / Math.max(h, 1))));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [clean]);

  // 投影视图打开时锁住背后的页面，滚轮只滚这张纸
  useEffect(() => {
    if (!clean) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setClean(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [clean]);

  const { stats } = timeline;
  // 建档那条永远在，所以「只有建档」等于什么都没记
  const hasRecords = timeline.total > 1;

  return (
    <div className="tl">
      <header className="tl__head">
        <div>
          <h2 className="tl__title">病程时间轴</h2>
          <p className="tl__sub">
            {fmtSpan(stats.firstAt, stats.lastAt)}
            {stats.firstAt ? ` · 共 ${stats.days} 天` : ""}
          </p>
        </div>
        <button
          className="tl__clean"
          type="button"
          onClick={() => {
            // 每次打开都从原尺寸开始，别记住上次缩过
            setFitAll(false);
            setClean(true);
          }}
          disabled={!hasRecords}
        >
          投影视图
        </button>
      </header>

      <div className="tl__stats">
        {[
          ["问诊", stats.visits],
          ["结论", stats.notes],
          ["用药", stats.meds],
          ["在服", stats.activeMeds],
        ].map(([label, value]) => (
          <div className="tl__cell" key={label as string}>
            <b>{value as number}</b>
            <span>{label as string}</span>
          </div>
        ))}
      </div>

      {/* 只有建档时给一句引导，但轴上那条建档照常摆着 —— 让人先看清这东西长什么样 */}
      {!hasRecords && (
        <p className="tl__empty">
          先记一条用药、聊一次问诊，或者写一条结论，它们会依次排到这条轴上。
        </p>
      )}
      <TimelineList groups={timeline.groups} onOpenVisit={onOpenVisit} />

      {clean &&
        createPortal(
          <div className="tlpaper__wrap" role="dialog" aria-modal="true" aria-label="病程时间轴投影视图">
            <div className="tlpaper__tools">
              {fitScale < 0.99 && (
                <button
                  className="tlpaper__fit"
                  type="button"
                  onClick={() => setFitAll((v) => !v)}
                >
                  {fitAll ? "原尺寸" : "缩到一屏"}
                </button>
              )}
              <button className="tlpaper__close" type="button" onClick={() => setClean(false)}>
                关闭 (Esc)
              </button>
            </div>
            <article
              className="tlpaper"
              ref={paperRef}
              style={fitAll ? { transform: `scale(${fitScale})` } : undefined}
            >
              <header className="tlpaper__head">
                <div>
                  <p className="tlpaper__eyebrow">MedAI · 病程记录</p>
                  <h1 className="tlpaper__title">病程时间轴</h1>
                  <p className="tlpaper__who">
                    {patient.name}
                    <i>·</i>
                    {patient.gender === "male" ? "男" : "女"}
                    {patient.age != null && (
                      <>
                        <i>·</i>
                        {patient.age} 岁
                      </>
                    )}
                    {patient.bloodType && (
                      <>
                        <i>·</i>
                        {patient.bloodType} 型
                      </>
                    )}
                  </p>
                </div>
                <div className="tlpaper__nums">
                  <div>
                    <b>{stats.days}</b>
                    <span>天病程</span>
                  </div>
                  <div>
                    <b>{stats.visits}</b>
                    <span>次问诊</span>
                  </div>
                  <div>
                    <b>{stats.activeMeds}</b>
                    <span>种在服</span>
                  </div>
                </div>
              </header>

              <p className="tlpaper__span">{fmtSpan(stats.firstAt, stats.lastAt)}</p>

              <TimelineList
                groups={timeline.groups}
                onOpenVisit={onOpenVisit}
                dense
                hideLink
              />

              <footer className="tlpaper__foot">
                <span>{patient.name} · 病程时间轴</span>
                <span>MedAI 毛发小球医生</span>
              </footer>
            </article>
          </div>,
          document.body,
        )}
    </div>
  );
}

function TimelineList({
  groups,
  onOpenVisit,
  dense = false,
  hideLink = false,
}: {
  groups: { key: string; label: string; events: TimelineEvent[] }[];
  onOpenVisit: (v: { id: string; title: string }) => void;
  dense?: boolean;
  hideLink?: boolean;
}) {
  return (
    <ol className={`tl__list${dense ? " is-dense" : ""}`}>
      {groups.map((g) => (
        <li className="tlgroup" key={g.key}>
          <p className="tlgroup__month">
            <span>{g.label}</span>
            <i>{g.events.length} 条</i>
          </p>
          <ul className="tlgroup__items">
            {g.events.map((ev, idx) => {
              const prev = g.events[idx - 1];
              // 同一天里只写一次日期，后面几行只留时间，轴才不啰嗦
              const sameDay =
                prev && axisDay(prev.at) === axisDay(ev.at) ? true : false;
              return (
                <li className={`tlev is-${ev.kind}`} key={ev.id}>
                  <span className="tlev__when">
                    <b>{sameDay ? "" : axisDay(ev.at)}</b>
                    <i>{axisTime(ev.at)}</i>
                  </span>
                  <span className="tlev__axis" aria-hidden="true">
                    <i />
                  </span>
                  <div className="tlev__card">
                    <div className="tlev__top">
                      <b className="tlev__title">{ev.title}</b>
                      <span className="tlev__kind">{KIND_LABEL[ev.kind]}</span>
                    </div>
                    {ev.detail && <p className="tlev__detail">{ev.detail}</p>}
                    {ev.tags.length > 0 && (
                      <p className="tlev__tags">
                        {ev.tags.map((t) => (
                          <i key={t} className={t === "已停用" || t === "重要" ? "is-hot" : ""}>
                            {t}
                          </i>
                        ))}
                      </p>
                    )}
                    {ev.consultationId && !hideLink && (
                      <button
                        className="tlev__open"
                        type="button"
                        onClick={() =>
                          onOpenVisit({ id: ev.consultationId as string, title: ev.title })
                        }
                      >
                        看原文
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
