"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createPatient, patchPatient, uploadAvatar } from "@/lib/client/api";
import type { Patient } from "@/lib/client/types";

type Draft = {
  name: string;
  gender: string;
  birthDate: string;
  age: string;
  heightCm: string;
  weightKg: string;
  bloodType: string;
  constitution: string;
  habits: string;
  allergies: string;
  chronicDisease: string;
  chiefComplaint: string;
};

function toDraft(p?: Patient): Draft {
  return {
    name: p?.name ?? "",
    gender: p?.gender ?? "female",
    birthDate: p?.birthDate ? p.birthDate.slice(0, 10) : "",
    age: p?.age != null ? String(p.age) : "",
    heightCm: p?.heightCm != null ? String(p.heightCm) : "",
    weightKg: p?.weightKg != null ? String(p.weightKg) : "",
    bloodType: p?.bloodType ?? "",
    constitution: p?.constitution ?? "",
    habits: p?.habits ?? "",
    allergies: p?.allergies ?? "",
    chronicDisease: p?.chronicDisease ?? "",
    chiefComplaint: p?.chiefComplaint ?? "",
  };
}

/** 空字符串一律当作"清空这个字段"，数字字段转成 number */
function payload(d: Draft): Record<string, unknown> {
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return {
    name: d.name.trim(),
    gender: d.gender,
    birthDate: d.birthDate ? new Date(d.birthDate).toISOString() : null,
    age: num(d.age),
    heightCm: num(d.heightCm),
    weightKg: num(d.weightKg),
    bloodType: d.bloodType.trim() || null,
    constitution: d.constitution.trim() || null,
    habits: d.habits.trim() || null,
    allergies: d.allergies.trim() || null,
    chronicDisease: d.chronicDisease.trim() || null,
    chiefComplaint: d.chiefComplaint.trim() || null,
  };
}

export default function PatientForm({ patient }: { patient?: Patient }) {
  const router = useRouter();
  const editing = !!patient;

  const [draft, setDraft] = useState<Draft>(() => toDraft(patient));
  const [avatarUrl, setAvatarUrl] = useState<string | null>(patient?.avatarUrl ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function set<K extends keyof Draft>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      setError("头像不能超过 2MB");
      return;
    }
    setError(null);
    setFile(f);
    setAvatarUrl(URL.createObjectURL(f));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (!draft.name.trim()) {
      setError("先给这份档案起个名字");
      return;
    }

    setBusy(true);
    try {
      let id = patient?.id;

      if (editing && id) {
        await patchPatient(id, payload(draft));
      } else {
        const { patient: created } = await createPatient(payload(draft));
        id = created.id;
      }

      if (file && id) {
        try {
          await uploadAvatar(file, id);
        } catch (err) {
          // 头像失败不该让整份档案白填，提示一下继续走
          setError(
            err instanceof ApiError ? `档案已保存，但头像没传上去：${err.message}` : "头像没传上去",
          );
          setBusy(false);
          router.refresh();
          return;
        }
      }

      router.push(id ? `/patients/${id}` : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败了，请再试一次");
      setBusy(false);
    }
  }

  return (
    <form className="sheet" onSubmit={submit} noValidate>
      <header className="sheet__head">
        <div>
          <p className="eyebrow">
            <span className="eyebrow__dot" />
            {editing ? "编辑档案" : "新建档案"}
          </p>
          <h1 className="sheet__title">
            {editing ? `改一改 ${patient?.name}` : "谁的身体，要开始被记录"}
          </h1>
          <p className="sheet__sub">
            只有填了的部分会进提示词。空着没关系，问诊里说过的内容也能整理进来。
          </p>
        </div>

        <button
          className="avatar"
          type="button"
          onClick={() => fileRef.current?.click()}
          title="上传头像（PNG / JPEG / GIF / WebP，≤2MB）"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="头像预览" />
          ) : (
            <span className="avatar__empty">{draft.name.trim().slice(0, 1) || "＋"}</span>
          )}
          <span className="avatar__hint">换头像</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={onPick}
        />
      </header>

      <div className="form-grid">
        <label className="field">
          <span className="field__label">姓名</span>
          <input
            className="field__input"
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            maxLength={20}
            placeholder="本人或家人"
          />
        </label>

        <label className="field">
          <span className="field__label">性别</span>
          <select
            className="field__input"
            value={draft.gender}
            onChange={(e) => set("gender", e.target.value)}
          >
            <option value="female">女</option>
            <option value="male">男</option>
          </select>
        </label>

        <label className="field">
          <span className="field__label">出生日期</span>
          <input
            className="field__input"
            type="date"
            value={draft.birthDate}
            onChange={(e) => set("birthDate", e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">年龄</span>
          <input
            className="field__input"
            type="number"
            min={0}
            max={130}
            value={draft.age}
            onChange={(e) => set("age", e.target.value)}
            placeholder="留空也行"
          />
        </label>

        <label className="field">
          <span className="field__label">身高 cm</span>
          <input
            className="field__input"
            type="number"
            min={30}
            max={250}
            step="0.5"
            value={draft.heightCm}
            onChange={(e) => set("heightCm", e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">体重 kg</span>
          <input
            className="field__input"
            type="number"
            min={2}
            max={400}
            step="0.1"
            value={draft.weightKg}
            onChange={(e) => set("weightKg", e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">血型</span>
          <input
            className="field__input"
            value={draft.bloodType}
            onChange={(e) => set("bloodType", e.target.value)}
            placeholder="A / B / AB / O / 不详"
            maxLength={12}
          />
        </label>

        <label className="field">
          <span className="field__label">中医体质</span>
          <input
            className="field__input"
            value={draft.constitution}
            onChange={(e) => set("constitution", e.target.value)}
            placeholder="气虚 / 湿热 / 阳虚…"
            maxLength={30}
          />
        </label>
      </div>

      <div className="form-stack">
        <label className="field">
          <span className="field__label">
            过敏史
            <i className="field__flag">每次对话都会被强制提醒</i>
          </span>
          <textarea
            className="field__input field__input--area"
            rows={2}
            maxLength={200}
            value={draft.allergies}
            onChange={(e) => set("allergies", e.target.value)}
            placeholder="青霉素过敏、磺胺类过敏…没有就写「无」"
          />
        </label>

        <label className="field">
          <span className="field__label">既往病史</span>
          <textarea
            className="field__input field__input--area"
            rows={2}
            maxLength={200}
            value={draft.chronicDisease}
            onChange={(e) => set("chronicDisease", e.target.value)}
            placeholder="高血压 5 年、甲状腺结节、做过胆囊手术…"
          />
        </label>

        <label className="field">
          <span className="field__label">生活习惯</span>
          <textarea
            className="field__input field__input--area"
            rows={2}
            maxLength={200}
            value={draft.habits}
            onChange={(e) => set("habits", e.target.value)}
            placeholder="作息、烟酒、运动、饮食偏好"
          />
        </label>

        <label className="field">
          <span className="field__label">主诉</span>
          <textarea
            className="field__input field__input--area"
            rows={2}
            maxLength={120}
            value={draft.chiefComplaint}
            onChange={(e) => set("chiefComplaint", e.target.value)}
            placeholder="这次最想解决的一件事，比如「反复头痛两周」"
          />
        </label>
      </div>

      {error && (
        <p className="sheet__error" role="alert">
          {error}
        </p>
      )}

      <footer className="sheet__foot">
        <button className="clay clay--pill sheet__save" type="submit" disabled={busy}>
          <span className="clay__text">{busy ? "保存中…" : editing ? "保存修改" : "建好，去问诊"}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h13M13 6l6 6-6 6" />
          </svg>
        </button>
        <button
          className="sheet__cancel"
          type="button"
          onClick={() => router.back()}
          disabled={busy}
        >
          取消
        </button>
      </footer>
    </form>
  );
}
