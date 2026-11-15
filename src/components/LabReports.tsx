"use client";

import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  deleteLabReport,
  extractLabReport,
  listLabReports,
  uploadAttachment,
} from "@/lib/client/api";
import type { LabDiff, LabItem, LabReportDTO } from "@/lib/lab-report";

/**
 * 化验单：拍一张、抽成表、和上一次比。
 *
 * 这一块存在的理由很具体 —— 子女拿到父母的化验单，看得懂"箭头朝上"，
 * 但看不懂"这张比上个月是好了还是坏了"。所以这里只回答两个问题：
 * 哪几项超了、比上次是往好还是往坏走。
 */

const STATUS_TEXT: Record<LabDiff["status"], string> = {
  improved: "在好转",
  worsened: "在变差",
  new: "新增项",
  same: "",
};

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** 趋势箭头：只表示数值方向，好与坏由 status 决定，避免"血糖降了"被当成坏事 */
function trendArrow(diff: LabDiff): string {
  if (diff.delta === null) return "";
  if (diff.trend === "up") return "↑";
  if (diff.trend === "down") return "↓";
  return "→";
}

function diffLabel(diff: LabDiff): string {
  if (diff.status === "new") return "首次";
  if (diff.delta === null) return "—";
  const arrow = trendArrow(diff);
  if (diff.pct === null) return `${arrow} ${diff.delta > 0 ? "+" : ""}${diff.delta}`;
  const sign = diff.pct > 0 ? "+" : "";
  return `${arrow} ${sign}${diff.pct}%`;
}

function ReportCard({
  report,
  onDelete,
}: {
  report: LabReportDTO;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const diffByName = new Map(report.diffs.map((d) => [d.name, d]));

  const worsened = report.diffs.filter((d) => d.status === "worsened").length;
  const improved = report.diffs.filter((d) => d.status === "improved").length;

  return (
    <article className={`lab__card${open ? " is-open" : ""}`}>
      <header className="lab__head" onClick={() => setOpen((v) => !v)}>
        <div>
          <p className="lab__date">
            {dateLabel(report.takenAt)}
            <span className="lab__kind">{report.kind}</span>
            {report.hospital && <span className="lab__hosp">{report.hospital}</span>}
          </p>
          <p className="lab__meta">
            {report.items.length} 项
            {report.abnormalCount > 0 ? (
              <b className="lab__bad">{report.abnormalCount} 项超参考区间</b>
            ) : (
              <b className="lab__good">全部在参考区间内</b>
            )}
            {worsened > 0 && <span className="lab__delta is-bad">较上次 {worsened} 项变差</span>}
            {improved > 0 && <span className="lab__delta is-good">较上次 {improved} 项好转</span>}
          </p>
        </div>
        <button
          type="button"
          className="lab__del"
          aria-label="删除这份化验单"
          onClick={(ev) => {
            ev.stopPropagation();
            onDelete(report.id);
          }}
        >
          删除
        </button>
      </header>

      {report.summary && <p className="lab__summary">{report.summary}</p>}

      {open && (
        <div className="lab__tablewrap">
          <table className="lab__table">
            <thead>
              <tr>
                <th>项目</th>
                <th>结果</th>
                <th>参考区间</th>
                <th>较上次</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((item: LabItem) => {
                const diff = diffByName.get(item.name);
                return (
                  <tr
                    key={`${item.name}-${item.value}`}
                    className={item.abnormal ? `is-${item.abnormal}` : ""}
                  >
                    <td>{item.name}</td>
                    <td className="lab__val">
                      {item.value}
                      {item.unit && <em>{item.unit}</em>}
                      {item.abnormal === "high" && <i className="lab__mark">↑</i>}
                      {item.abnormal === "low" && <i className="lab__mark">↓</i>}
                    </td>
                    <td className="lab__ref">{item.refText || "—"}</td>
                    <td
                      className={
                        diff
                          ? `lab__cmp${diff.status === "worsened" ? " is-bad" : ""}${
                              diff.status === "improved" ? " is-good" : ""
                            }`
                          : "lab__cmp"
                      }
                    >
                      {diff ? (
                        <>
                          {diffLabel(diff)}
                          {diff.prevValue && <em>上次 {diff.prevValue}</em>}
                          {STATUS_TEXT[diff.status] && (
                            <span>{STATUS_TEXT[diff.status]}</span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

export default function LabReports({ patientId }: { patientId: string }) {
  const [reports, setReports] = useState<LabReportDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  /**
   * 首屏拉一次列表。
   * 用 alive 标记而不是在 effect 里直接 setState：请求可能在组件卸载后回来，
   * 那一下 setState 会被 React 判为泄漏，也会让 lint 的 set-state-in-effect 规则报错。
   */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await listLabReports(patientId);
        if (alive) setReports(data.reports);
      } catch (err) {
        if (alive) setError(err instanceof ApiError ? err.message : "化验单加载失败");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [patientId]);

  const onPick = async (file: File | null | undefined) => {
    if (!file) return;
    setError("");
    try {
      setBusy("正在上传");
      const { attachment } = await uploadAttachment(file);
      setBusy("正在读这张单子");
      const data = await extractLabReport(patientId, attachment.id);
      setReports(data.reports);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "这张单子没读出来，换一张试试");
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm("删掉这份化验单？指标与对比会一起清空。")) return;
    try {
      await deleteLabReport(id);
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "删除失败");
    }
  };

  return (
    <div className="lab">
      <div className="lab__bar">
        <div>
          <h3 className="lab__title">化验单</h3>
          <p className="lab__hint">
            拍照或上传 PDF，自动抽出指标并与上一次对比。只做整理，不做解读。
          </p>
        </div>
        <label className={`clay clay--pill lab__pick${busy ? " is-busy" : ""}`}>
          <span className="clay__text">{busy || "上传化验单"}</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.txt"
            hidden
            disabled={Boolean(busy)}
            onChange={(e) => void onPick(e.target.files?.[0])}
          />
        </label>
      </div>

      {error && <p className="lab__error">{error}</p>}

      {loading ? (
        <p className="lab__empty">正在读取…</p>
      ) : reports.length === 0 ? (
        <p className="lab__empty">
          还没有化验单。拍一张血常规或生化的照片，几秒后这里就有一张能对比的表。
        </p>
      ) : (
        <div className="lab__list">
          {reports.map((report) => (
            <ReportCard key={report.id} report={report} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
