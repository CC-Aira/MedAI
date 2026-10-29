"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiError, generateVisitSheet, getVisitSheet } from "@/lib/client/api";
import { sheetText, sheetTime, type VisitSheet } from "@/lib/visit-sheet";
import type { Patient } from "@/lib/client/types";

type Phase = "loading" | "generating" | "ready" | "error";

/**
 * 就诊摘要：一次问诊的「可带走」形态。
 *
 * 打开时先读已经存在的那张纸；没生成过就当场整理一张。
 * 整理失败也不会让人空手 —— 还有"用本地模板"这条路。
 *
 * 用 portal 挂到 body 上，打印时才能只留下这张纸（见 globals.css 的 @media print）。
 */
export default function VisitSheetPanel({
  consultationId,
  patient,
  onClose,
}: {
  consultationId: string;
  patient: Patient;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [sheet, setSheet] = useState<VisitSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const busy = phase === "loading" || phase === "generating";
  const copyTimer = useRef<number | null>(null);

  const activeMeds = useMemo(
    () => patient.medications.filter((m) => m.isActive && m.drugName.trim()),
    [patient.medications],
  );

  const run = useCallback(
    async (local: boolean) => {
      setPhase(local ? "generating" : "loading");
      setError(null);
      try {
        const { sheet: next } = await generateVisitSheet(consultationId, local);
        setSheet(next);
        setPhase("ready");
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "没能整理出来，再试一次");
        setPhase("error");
      }
    },
    [consultationId],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { sheet: saved } = await getVisitSheet(consultationId);
        if (!alive) return;
        if (saved) {
          setSheet(saved);
          setPhase("ready");
          return;
        }
      } catch {
        // 读不到就当没生成过，直接整理一张
      }
      if (!alive) return;
      await run(false);
    })();
    return () => {
      alive = false;
    };
  }, [consultationId, run]);

  // 打开期间锁住背后的页面滚动，关掉再还回去
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    if (!sheet) return;
    try {
      await navigator.clipboard.writeText(sheetText(sheet, patient, activeMeds));
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("浏览器不让复制，可以选中文字手动复制");
    }
  }

  // portal 需要一个 document；这个面板只在点击后渲染，服务端本来也走不到这儿
  if (typeof document === "undefined") return null;

  const ageText = patient.age != null ? `${patient.age} 岁` : "";
  const genderText = patient.gender === "male" ? "男" : patient.gender === "female" ? "女" : "";

  return createPortal(
    <div
      id="paper-print-root"
      className="paperlayer"
      role="dialog"
      aria-modal="true"
      aria-label="就诊摘要"
    >
      <button className="paperlayer__mask" type="button" aria-label="关闭" onClick={onClose} />

      <article className="paper">
        <header className="paper__head">
          <div>
            <p className="paper__eyebrow">就诊摘要 · 带去给医生看</p>
            <h2 className="paper__name">{patient.name}</h2>
            <p className="paper__meta">
              {[genderText, ageText].filter(Boolean).join(" · ")}
              {sheet ? ` · 整理于 ${sheetTime(sheet.generatedAt)}` : ""}
            </p>
          </div>
          <button className="paper__close" type="button" aria-label="关闭" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="paper__body">
          {(phase === "loading" || phase === "generating") && <SheetSkeleton local={phase === "generating"} />}

          {phase === "error" && (
            <div className="paper__fail">
              <p>{error || "没能整理出来"}</p>
              <div className="paper__fail-acts">
                <button className="clay clay--pill" type="button" onClick={() => void run(false)}>
                  <span className="clay__text">再试一次</span>
                </button>
                <button className="paper__ghost" type="button" onClick={() => void run(true)}>
                  用本地模板整理
                </button>
              </div>
            </div>
          )}

          {phase === "ready" && sheet && (
            <>
              {sheet.flags && (
                <div className="paper__flag">
                  <b>这次问诊里出现过需要马上就医的信号</b>
                  <span>
                    {sheet.flags.labels.join("、")} · 当时已提示立即就医
                  </span>
                </div>
              )}

              {/* 编号按实际出现的区块往下排：某块空了不留空号，
                  医生看到 1、2、3 就是一路顺着读 */}
              {sheetBlocks(sheet, patient, activeMeds).map((block, i) => (
                <Section key={block.title} n={i + 1} title={block.title}>
                  {block.node}
                </Section>
              ))}

              <p className="paper__foot">
                {sheet.source === "ai"
                  ? "由 MedAI 根据这次问诊整理，内容已交给患者核对。"
                  : "由 MedAI 按档案和对话原文整理，本次没有使用模型。"}
                不是诊断，不含处方建议；用药请遵医嘱，不要自行加减。
              </p>
            </>
          )}
        </div>

        <footer className="paper__bar">
          <button
            className="clay clay--pill paper__print"
            type="button"
            onClick={() => window.print()}
            disabled={phase !== "ready"}
          >
            <span className="clay__text">打印 / 存 PDF</span>
          </button>
          <button className="paper__act" type="button" onClick={() => void copy()} disabled={phase !== "ready"}>
            {copied ? "已复制 ✓" : "复制文字"}
          </button>
          <button
            className="paper__act"
            type="button"
            onClick={() => void run(false)}
            disabled={busy}
          >
            {busy ? "整理中…" : "重新整理"}
          </button>
          <span className="paper__hint">打印时只输出这张纸</span>
        </footer>
      </article>
    </div>,
    document.body,
  );
}

type SheetBlock = { title: string; node: ReactNode };

/**
 * 纸张的区块顺序 —— 病历的阅读顺序，不是数据的顺序。
 * 每一块都可能因为没内容而消失，所以编号不能写在数据里，只能等排完再给。
 */
function sheetBlocks(
  sheet: VisitSheet,
  patient: Patient,
  activeMeds: Patient["medications"],
): SheetBlock[] {
  const blocks: SheetBlock[] = [
    {
      title: "主诉",
      node: <p className="paper__lead">{sheet.chiefComplaint}</p>,
    },
  ];

  if (sheet.course.length > 0) {
    blocks.push({
      title: "病程",
      node: (
        <ul className="paper__list">
          {sheet.course.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ),
    });
  }

  if (sheet.ruledOut.length > 0) {
    blocks.push({
      title: "已经排除的",
      node: <p className="paper__muted">{sheet.ruledOut.join("；")}</p>,
    });
  }

  blocks.push({
    title: "目前在吃的药",
    node: (
      <>
        {activeMeds.length > 0 ? (
          <table className="paper__meds">
            <thead>
              <tr>
                <th>药名</th>
                <th>单次</th>
                <th>频次</th>
              </tr>
            </thead>
            <tbody>
              {activeMeds.map((m) => (
                <tr key={m.id}>
                  <td>{m.drugName}</td>
                  <td>{m.dosage || "—"}</td>
                  <td>{m.frequency || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="paper__muted">档案里没有登记在服药物</p>
        )}
        {/* 过敏史单独成块：医生扫一眼就要看到，混在「没登记药物」的灰字里等于没写 */}
        <p className={`paper__allergy${patient.allergies?.trim() ? " is-marked" : " is-none"}`}>
          <b>过敏史</b>
          <span>{patient.allergies?.trim() || "未记录"}</span>
        </p>
        {patient.chronicDisease?.trim() && (
          <p className="paper__inline">既往病史：{patient.chronicDisease}</p>
        )}
      </>
    ),
  });

  if (sheet.advice.length > 0) {
    blocks.push({
      title: "这次可以先做的",
      node: (
        <ol className="paper__list paper__list--num">
          {sheet.advice.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      ),
    });
  }

  if (sheet.whenToGo) {
    blocks.push({
      title: "什么情况必须马上去医院",
      node: <p className="paper__alert">{sheet.whenToGo}</p>,
    });
  }

  blocks.push({
    title: "想问医生的问题",
    node: (
      <ol className="paper__list paper__list--num">
        {sheet.questions.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
    ),
  });

  return blocks;
}

function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="paper__sec">
      <h3 className="paper__h3">
        <i>{n}</i>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** 整理中的占位：一行行淡出的灰条，比转圈更不打断阅读 */
function SheetSkeleton({ local }: { local: boolean }) {
  return (
    <div className="paper__sk">
      <p className="paper__sk-note">
        {local ? "正在按档案和对话原文整理…" : "正在把这次问诊整理成一张纸，大约十几秒…"}
      </p>
      {[72, 92, 64, 88, 56, 78].map((w, i) => (
        <i key={i} style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  );
}
