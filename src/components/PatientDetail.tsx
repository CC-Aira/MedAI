"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import VisitSheetPanel from "./VisitSheet";
import VisitCalendar from "./VisitCalendar";
import VisitTranscript from "./VisitTranscript";
import PatientTimeline from "./PatientTimeline";
import { buildTimeline } from "@/lib/timeline";
import { scheduleLabel } from "@/lib/medication-schedule";
import {
  isReminderEnabled,
  notifyPermission,
  notifySupportHint,
  requestNotifyPermission,
  setReminderEnabled,
  type NotifyPermission,
} from "@/lib/client/medication-notify";
import type {
  Consultation,
  Growth,
  Medication,
  Note,
  Patient,
} from "@/lib/client/types";
import {
  ApiError,
  checkinMedication,
  createMedication,
  createNote,
  deleteConsultation,
  deleteMedication,
  deleteNote,
  deletePatient,
  getMedicationReminder,
  patchMedication,
  patchNote,
  undoMedicationCheckin,
  type MedicationReminder,
} from "@/lib/client/api";

type Tab = "meds" | "notes" | "visits" | "timeline" | "growth";

const TABS: { key: Tab; label: string }[] = [
  { key: "meds", label: "用药" },
  { key: "notes", label: "结论" },
  { key: "visits", label: "问诊记录" },
  { key: "timeline", label: "时间轴" },
  { key: "growth", label: "成长" },
];

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export default function PatientDetail({
  patient: initialPatient,
  notes: initialNotes,
  consultations: initialVisits,
  growth,
}: {
  patient: Patient;
  notes: Note[];
  consultations: Consultation[];
  growth: Growth;
}) {
  const router = useRouter();

  const [patient, setPatient] = useState(initialPatient);
  const [meds, setMeds] = useState<Medication[]>(initialPatient.medications);
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [visits, setVisits] = useState<Consultation[]>(initialVisits);
  const [tab, setTab] = useState<Tab>("meds");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** 正在看哪一次问诊的就诊摘要 */
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  /** 正在看哪一次问诊的聊天原文 */
  const [logFor, setLogFor] = useState<{ id: string; title: string } | null>(null);

  /* ---------------------------------------------------------------- 用药 */

  const [drug, setDrug] = useState({
    drugName: "",
    dosage: "",
    frequency: "",
    note: "",
    timeOfDay: "08:00",
    mealTiming: "after",
    courseDays: "",
  });
  /** 展开的是哪一条的提醒，以及生成好的文案 */
  const [reminder, setReminder] = useState<{ id: string; data: MedicationReminder } | null>(null);
  const [reminderBusy, setReminderBusy] = useState<string | null>(null);

  /* -------------------------------------------------- 到点提醒（浏览器通知） */
  const [notifyOn, setNotifyOn] = useState(false);
  const [perm, setPerm] = useState<NotifyPermission>("default");

  // localStorage 和 Notification 只有浏览器里有，挂载后再读
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setNotifyOn(isReminderEnabled());
    setPerm(notifyPermission());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  async function toggleNotify() {
    if (notifyOn) {
      setReminderEnabled(false);
      setNotifyOn(false);
      return;
    }
    // 申请权限必须发生在点击里，否则浏览器直接拒绝
    const next = await requestNotifyPermission();
    setPerm(next);
    if (next === "granted") {
      setReminderEnabled(true);
      setNotifyOn(true);
    }
  }

  async function addMed(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!drug.drugName.trim()) {
      setError("药名不能空着");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { medications } = await createMedication(patient.id, {
        drugName: drug.drugName.trim(),
        dosage: drug.dosage.trim() || null,
        frequency: drug.frequency.trim() || null,
        note: drug.note.trim() || null,
        timeOfDay: drug.timeOfDay || null,
        mealTiming: drug.mealTiming,
        courseDays: drug.courseDays ? Number(drug.courseDays) : null,
      });
      setMeds(medications);
      setDrug({
        drugName: "",
        dosage: "",
        frequency: "",
        note: "",
        timeOfDay: "08:00",
        mealTiming: "after",
        courseDays: "",
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "没加上，请再试一次");
    } finally {
      setBusy(false);
    }
  }

  async function toggleMed(m: Medication) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { medications } = await patchMedication(m.id, { isActive: !m.isActive });
      setMeds(medications);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "改不动这条用药");
    } finally {
      setBusy(false);
    }
  }

  async function removeMed(m: Medication) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { medications } = await deleteMedication(m.id);
      setMeds(medications);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "删不掉这条用药");
    } finally {
      setBusy(false);
    }
  }

  /** 打卡：今天吃了 / 点错了撤销 */
  async function toggleCheckin(m: Medication) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { medications } = m.todayTaken
        ? await undoMedicationCheckin(m.id)
        : await checkinMedication(m.id);
      setMeds(medications);
      // 打卡会改变漏服次数，展开中的提醒要作废，避免显示旧文案
      if (reminder?.id === m.id) setReminder(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "打卡没成功，再试一次");
    } finally {
      setBusy(false);
    }
  }

  /** 生成提醒文案（站内通知 + 邮件正文） */
  async function showReminder(m: Medication) {
    if (reminder?.id === m.id) {
      setReminder(null);
      return;
    }
    setReminderBusy(m.id);
    setError(null);
    try {
      const data = await getMedicationReminder(m.id);
      setReminder({ id: m.id, data });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "生成失败，再试一次");
    } finally {
      setReminderBusy(null);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("浏览器不让复制，手动选中吧");
    }
  }

  /* ---------------------------------------------------------------- 结论 */

  const [note, setNote] = useState({ title: "", content: "", tags: "" });

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!note.title.trim() || !note.content.trim()) {
      setError("标题和内容都要写一点");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await createNote(patient.id, {
        title: note.title.trim(),
        content: note.content.trim(),
        tags: note.tags.trim() || null,
      });
      setNotes(res.notes);
      setNote({ title: "", content: "", tags: "" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "没记下来");
    } finally {
      setBusy(false);
    }
  }

  async function starNote(n: Note) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { notes: next } = await patchNote(n.id, { isFavorite: !n.isFavorite });
      setNotes(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "改不动星标");
    } finally {
      setBusy(false);
    }
  }

  async function removeNote(n: Note) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { notes: next } = await deleteNote(n.id);
      setNotes(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "删不掉这条结论");
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------ 问诊记录 */

  async function removeVisit(v: Consultation) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { consultations } = await deleteConsultation(v.id);
      setVisits(consultations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "删不掉这次问诊");
    } finally {
      setBusy(false);
    }
  }

  /* -------------------------------------------------------------- 删档案 */

  async function removePatient() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deletePatient(patient.id);
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "删不掉这份档案");
      setBusy(false);
    }
  }

  const active = meds.filter((m) => m.isActive);
  const stopped = meds.filter((m) => !m.isActive);

  // tab 上的角标：时间轴里一共有多少条记录（建档也算一条）
  const timelineTotal = useMemo(
    () =>
      buildTimeline({ patient, medications: meds, notes, consultations: visits }).total,
    [patient, meds, notes, visits],
  );

  return (
    <article className="detail">
      <header className="detail__head">
        <div className="detail__who">
          <span className="detail__avatar">
            {patient.avatarUrl ? (
                <img src={patient.avatarUrl} alt={patient.name} />
            ) : (
              patient.name.slice(0, 1)
            )}
          </span>
          <div>
            <p className="eyebrow">
              <span className="eyebrow__dot" />
              档案 · {patient.gender === "male" ? "男" : "女"}
              {patient.age != null ? ` · ${patient.age} 岁` : ""}
            </p>
            <h1 className="detail__name">{patient.name}</h1>
            <p className="detail__meta">
              {[
                patient.heightCm ? `${patient.heightCm}cm` : null,
                patient.weightKg ? `${patient.weightKg}kg` : null,
                patient.bloodType ? `${patient.bloodType} 型` : null,
                patient.constitution,
                `建档 ${fmt(patient.createdAt)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        <div className="detail__acts">
          <Link className="clay clay--pill" href={`/patients/${patient.id}/edit`}>
            <span className="clay__text">编辑档案</span>
          </Link>
          <Link className="clay clay--pill clay--ghost" href="/">
            <span className="clay__text">去问诊</span>
          </Link>
        </div>
      </header>

      <section className="detail__facts">
        {[
          ["主诉", patient.chiefComplaint],
          ["过敏史", patient.allergies],
          ["既往病史", patient.chronicDisease],
          ["生活习惯", patient.habits],
        ].map(([label, value]) => (
          <div className="detail__fact" key={label as string}>
            <span className="detail__fact-label">{label}</span>
            <p className={`detail__fact-value${value ? "" : " is-empty"}`}>
              {value || "还没有填"}
            </p>
          </div>
        ))}
      </section>

      <nav className="detail__tabs" role="tablist" aria-label="档案分区">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`detail__tab${tab === t.key ? " is-on" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <i>
              {t.key === "meds"
                ? active.length
                : t.key === "notes"
                  ? notes.length
                  : t.key === "visits"
                    ? visits.length
                    : t.key === "timeline"
                      ? timelineTotal
                      : growth.streak}
            </i>
          </button>
        ))}
      </nav>

      {error && (
        <p className="detail__error" role="alert">
          {error}
        </p>
      )}

      {/* ------------------------------------------------------------ 用药 */}
      {tab === "meds" && (
        <section className="panel">
          <div className={`mednotify${notifyOn ? " is-on" : ""}`}>
            <div className="mednotify__body">
              <b className="mednotify__title">到点提醒</b>
              <span className="mednotify__hint">
                {notifyOn
                  ? "到点会弹系统通知，点一下通知就记作已服用（页面需要开着）"
                  : notifySupportHint(perm)}
              </span>
            </div>
            <button
              className={`mednotify__btn${notifyOn ? " is-on" : ""}`}
              type="button"
              onClick={() => void toggleNotify()}
              disabled={perm === "unsupported"}
            >
              {notifyOn ? "已开启" : perm === "unsupported" ? "不支持" : "开启"}
            </button>
          </div>

          <form className="medform" onSubmit={addMed}>
            <label className="field medform__wide">
              <span className="field__label">药名</span>
              <input
                className="field__input"
                value={drug.drugName}
                onChange={(e) => setDrug({ ...drug, drugName: e.target.value })}
                maxLength={50}
                placeholder="如 氨氯地平片"
              />
            </label>
            <label className="field">
              <span className="field__label">单次剂量</span>
              <input
                className="field__input"
                value={drug.dosage}
                onChange={(e) => setDrug({ ...drug, dosage: e.target.value })}
                maxLength={30}
                placeholder="5mg"
              />
            </label>
            <label className="field">
              <span className="field__label">时间点</span>
              <input
                className="field__input"
                type="time"
                value={drug.timeOfDay}
                onChange={(e) => setDrug({ ...drug, timeOfDay: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field__label">饭前 / 饭后</span>
              <select
                className="field__input"
                value={drug.mealTiming}
                onChange={(e) => setDrug({ ...drug, mealTiming: e.target.value })}
              >
                <option value="before">饭前</option>
                <option value="after">饭后</option>
                <option value="any">不限</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">频率</span>
              <input
                className="field__input"
                value={drug.frequency}
                onChange={(e) => setDrug({ ...drug, frequency: e.target.value })}
                maxLength={30}
                placeholder="每日一次"
              />
            </label>
            <label className="field">
              <span className="field__label">疗程（天）</span>
              <input
                className="field__input"
                type="number"
                min={1}
                max={365}
                value={drug.courseDays}
                onChange={(e) => setDrug({ ...drug, courseDays: e.target.value })}
                placeholder="7"
              />
            </label>
            <label className="field medform__wide">
              <span className="field__label">备注</span>
              <input
                className="field__input"
                value={drug.note}
                onChange={(e) => setDrug({ ...drug, note: e.target.value })}
                maxLength={100}
                placeholder="医生嘱咐"
              />
            </label>
            <button className="clay clay--pill medform__add" type="submit" disabled={busy}>
              <span className="clay__text">加入</span>
            </button>
          </form>

          <ul className="medlist">
            {active.map((m) => {
              const when = scheduleLabel(m.timeOfDay, m.mealTiming);
              const opened = reminder?.id === m.id;
              return (
                <li className={`med${opened ? " is-open" : ""}`} key={m.id}>
                  <div className="med__body">
                    <b className="med__name">{m.drugName}</b>
                    <span className="med__dose">
                      {[m.dosage, m.frequency].filter(Boolean).join(" · ") || "剂量未填"}
                    </span>
                    {when && <span className="med__when">{when}</span>}
                    {m.courseDay !== null && (
                      <span className="med__course">
                        疗程第 {m.courseDay} 天
                        {m.remainingDays !== null ? ` · 还剩 ${m.remainingDays} 天` : ""}
                      </span>
                    )}
                    {m.note && <span className="med__note">{m.note}</span>}
                    {m.missedStreak >= 2 && (
                      <span className="med__warn">连续 {m.missedStreak} 次没打卡</span>
                    )}
                  </div>

                  <div className="med__acts">
                    <button
                      className={`med__check${m.todayTaken ? " is-on" : ""}`}
                      type="button"
                      onClick={() => void toggleCheckin(m)}
                      disabled={busy}
                    >
                      {m.todayTaken ? "今天已服 ✓" : "打卡"}
                    </button>
                    <button
                      className="med__remind"
                      type="button"
                      onClick={() => void showReminder(m)}
                      disabled={reminderBusy === m.id}
                    >
                      {reminderBusy === m.id ? "生成中…" : opened ? "收起提醒" : "提醒文案"}
                    </button>
                    <button className="med__stop" type="button" onClick={() => void toggleMed(m)} disabled={busy}>
                      停用
                    </button>
                    <button className="med__del" type="button" onClick={() => void removeMed(m)} disabled={busy}>
                      删除
                    </button>
                  </div>

                  {opened && reminder && (
                    <div className="remind">
                      <div className="remind__block">
                        <div className="remind__head">
                          <span className="remind__tag">站内通知</span>
                          <span className={`remind__count${reminder.data.noticeChars > 30 ? " is-over" : ""}`}>
                            {reminder.data.noticeChars}/30 字
                          </span>
                          <button
                            className="remind__copy"
                            type="button"
                            onClick={() => void copyText(reminder.data.notice)}
                          >
                            复制
                          </button>
                        </div>
                        <p className="remind__text remind__text--notice">{reminder.data.notice}</p>
                      </div>

                      <div className="remind__block">
                        <div className="remind__head">
                          <span className="remind__tag">邮件正文</span>
                          <span className={`remind__count${reminder.data.emailChars > 80 ? " is-over" : ""}`}>
                            {reminder.data.emailChars}/80 字
                          </span>
                          <button
                            className="remind__copy"
                            type="button"
                            onClick={() => void copyText(reminder.data.email)}
                          >
                            复制
                          </button>
                        </div>
                        <pre className="remind__text remind__text--mail">{reminder.data.email}</pre>
                      </div>

                      <p className="remind__meta">
                        连续漏服 {reminder.data.facts.missedStreak} 次
                        {reminder.data.careAdded ? " · 邮件里已追加关怀提醒" : " · 未触发关怀提醒（需连续漏服 2 次）"}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}

            {active.length === 0 && <li className="med med--empty">还没有在服的药</li>}
          </ul>

          {stopped.length > 0 && (
            <>
              <p className="medlist__divider">已停用 · {stopped.length}</p>
              <ul className="medlist">
                {stopped.map((m) => (
                  <li className="med med--off" key={m.id}>
                    <div className="med__body">
                      <b className="med__name">{m.drugName}</b>
                      <span className="med__dose">
                        {[m.dosage, m.frequency].filter(Boolean).join(" · ") || "剂量未填"}
                      </span>
                    </div>
                    <div className="med__acts">
                      <button className="med__restore" type="button" onClick={() => void toggleMed(m)} disabled={busy}>
                        恢复
                      </button>
                      <button className="med__del" type="button" onClick={() => void removeMed(m)} disabled={busy}>
                        删除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------ 结论 */}
      {tab === "notes" && (
        <section className="panel">
          <form className="noteform" onSubmit={addNote}>
            <label className="field">
              <span className="field__label">标题</span>
              <input
                className="field__input"
                value={note.title}
                onChange={(e) => setNote({ ...note, title: e.target.value })}
                maxLength={40}
                placeholder="这次聊完想记住的一句话"
              />
            </label>
            <label className="field">
              <span className="field__label">内容</span>
              <textarea
                className="field__input field__input--area"
                rows={3}
                value={note.content}
                onChange={(e) => setNote({ ...note, content: e.target.value })}
                maxLength={1000}
                placeholder="医生怎么说的、药吃了有没有用、下次要问什么…"
              />
            </label>
            <label className="field">
              <span className="field__label">标签</span>
              <input
                className="field__input"
                value={note.tags}
                onChange={(e) => setNote({ ...note, tags: e.target.value })}
                maxLength={100}
                placeholder="头痛, 复查（逗号分隔）"
              />
            </label>
            <button className="clay clay--pill noteform__add" type="submit" disabled={busy}>
              <span className="clay__text">记下来</span>
            </button>
          </form>

          <ul className="notelist">
            {notes.map((n) => (
              <li className={`note${n.isFavorite ? " is-star" : ""}`} key={n.id}>
                <div className="note__head">
                  <b className="note__title">{n.title}</b>
                  <span className="note__date">{fmt(n.createdAt)}</span>
                </div>
                <p className="note__content">{n.content}</p>
                {n.tags && (
                  <p className="note__tags">
                    {n.tags.split(",").map((t) => (
                      <i key={t}>{t.trim()}</i>
                    ))}
                  </p>
                )}
                <div className="note__acts">
                  <button
                    className="note__star"
                    type="button"
                    onClick={() => void starNote(n)}
                    disabled={busy}
                    title="星标的结论会优先进入 AI 的提示词"
                  >
                    {n.isFavorite ? "★ 已标为重要" : "☆ 标为重要"}
                  </button>
                  <button className="note__del" type="button" onClick={() => void removeNote(n)} disabled={busy}>
                    删除
                  </button>
                </div>
              </li>
            ))}
            {notes.length === 0 && <li className="note note--empty">还没有结论。问诊里聊出来的重要几句，记在这里。</li>}
          </ul>
        </section>
      )}

      {/* -------------------------------------------------------- 问诊记录 */}
      {tab === "visits" && (
        <section className="panel">
          <VisitCalendar
            visits={visits}
            busy={busy}
            onOpenLog={(v) => {
              setSheetFor(null);
              setLogFor({ id: v.id, title: v.title });
            }}
            onOpenSheet={(id) => {
              setLogFor(null);
              setSheetFor(id);
            }}
            onDelete={(v) => void removeVisit(v)}
          />
        </section>
      )}

      {/* ------------------------------------------------------------ 时间轴 */}
      {tab === "timeline" && (
        <section className="panel">
          <PatientTimeline
            patient={patient}
            medications={meds}
            notes={notes}
            consultations={visits}
            onOpenVisit={(v) => {
              setSheetFor(null);
              setLogFor(v);
            }}
          />
        </section>
      )}

      {/* ------------------------------------------------------------ 成长 */}
      {tab === "growth" && (
        <section className="panel">
          <div className="growth">
            {[
              ["连续记录", `${growth.streak} 天`],
              ["有记录的天数", `${growth.activeDays} 天`],
              ["问诊次数", `${growth.consultations}`],
              ["聊过的话", `${growth.messages} 条`],
              ["结论", `${growth.notes} 条`],
              ["星标", `${growth.favorites} 条`],
            ].map(([label, value]) => (
              <div className="growth__cell" key={label}>
                <b>{value}</b>
                <span>{label}</span>
              </div>
            ))}
          </div>

          <div className="week">
            {growth.weekly.map((w) => {
              const max = Math.max(1, ...growth.weekly.map((x) => x.count));
              return (
                <div className="week__col" key={w.weekStart}>
                  <div className="week__bar" style={{ height: `${8 + (w.count / max) * 72}px` }}>
                    <span>{w.count}</span>
                  </div>
                  <i>{w.weekStart.slice(5)}</i>
                </div>
              );
            })}
          </div>
          <p className="growth__note">
            统计的是这个账号下的全部档案，不含其他人的数据。
          </p>
        </section>
      )}

      {/* ------------------------------------------------------------ 危险区 */}
      {sheetFor && (
        <VisitSheetPanel
          consultationId={sheetFor}
          patient={patient}
          onClose={() => setSheetFor(null)}
        />
      )}

      {logFor && (
        <VisitTranscript
          consultationId={logFor.id}
          fallbackTitle={logFor.title}
          onClose={() => setLogFor(null)}
        />
      )}

      <footer className="detail__danger">
        {confirmDelete ? (
          <>
            <p>删除后这份档案的用药、问诊、结论会一起消失，不可恢复。</p>
            <button className="danger__yes" type="button" onClick={() => void removePatient()} disabled={busy}>
              确认删除
            </button>
            <button className="danger__no" type="button" onClick={() => setConfirmDelete(false)}>
              算了
            </button>
          </>
        ) : (
          <button className="danger__open" type="button" onClick={() => setConfirmDelete(true)}>
            删除这份档案
          </button>
        )}
      </footer>
    </article>
  );
}
