"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DiseaseIndex } from "@/data/knowledge-types";
import { DEPARTMENTS } from "@/data/departments";
import { DeptArt } from "@/components/DeptArt";
import { excerpt, matchScore } from "@/lib/knowledge-search";

const HOT = ["头痛", "咳嗽", "失眠", "胃痛", "皮疹", "血糖", "血压", "腰痛"];

function fields(d: DiseaseIndex) {
  return [
    { text: d.name, weight: 100 },
    { text: d.alias.join(" "), weight: 60 },
    { text: d.keywords.join(" "), weight: 40 },
    { text: d.summary, weight: 16 },
    { text: d.symptoms.join(" "), weight: 14 },
  ];
}

export default function LibraryBrowser({ index }: { index: DiseaseIndex[] }) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState<string>("all");

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of index) map[d.department] = (map[d.department] ?? 0) + 1;
    return map;
  }, [index]);

  const results = useMemo(() => {
    const base = dept === "all" ? index : index.filter((d) => d.department === dept);
    const query = q.trim();
    if (!query) return base.map((d) => ({ d, score: 0 }));
    return base
      .map((d) => ({ d, score: matchScore(query, fields(d)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [q, dept, index]);

  const searching = q.trim().length > 0;
  const deptName = DEPARTMENTS.find((d) => d.id === dept)?.name;

  return (
    <div className="kb">
      <div className="kb__search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.4" />
          <path d="M16 16l4.2 4.2" />
        </svg>
        <input
          className="kb__input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜症状、病名或科室，例如「头晕」「血糖高」"
          aria-label="搜索疾病科普"
        />
        {q && (
          <button className="kb__clear" type="button" onClick={() => setQ("")}>
            清空
          </button>
        )}
      </div>

      <div className="kb__hot" aria-label="常见搜索">
        <span className="kb__hot-label">常搜</span>
        {HOT.map((k) => (
          <button
            key={k}
            type="button"
            className="kb__hot-chip"
            onClick={() => setQ(k)}
          >
            {k}
          </button>
        ))}
      </div>

      <div className="kb__depts" role="group" aria-label="按科室筛选">
        <button
          type="button"
          className={`kb__dept${dept === "all" ? " is-on" : ""}`}
          onClick={() => setDept("all")}
        >
          全部
          <i>{index.length}</i>
        </button>
        {DEPARTMENTS.filter((d) => counts[d.id]).map((d) => (
          <button
            key={d.id}
            type="button"
            className={`kb__dept${dept === d.id ? " is-on" : ""}`}
            onClick={() => setDept(dept === d.id ? "all" : d.id)}
            title={d.scope}
          >
            {d.name}
            <i>{counts[d.id]}</i>
          </button>
        ))}
      </div>

      <p className="kb__count">
        {searching ? (
          <>
            找到 <b>{results.length}</b> 条与「{q.trim()}」相关的科普
            {deptName && dept !== "all" ? `（限${deptName}）` : ""}
          </>
        ) : dept === "all" ? (
          <>共 {index.length} 条，按科室整理</>
        ) : (
          <>
            {deptName} · {results.length} 条
          </>
        )}
      </p>

      {results.length === 0 ? (
        <div className="kb__empty">
          <p className="kb__empty-title">这个词还没收进科普库</p>
          <p className="kb__empty-text">
            换个更常见的说法试试，比如把「脑袋昏沉」换成「头晕」。也可以直接建一份档案，
            让 MedAI 问清楚你的具体情况。
          </p>
          <div className="kb__empty-acts">
            <button className="clay clay--pill" type="button" onClick={() => { setQ(""); setDept("all"); }}>
              <span className="clay__text">看看全部</span>
            </button>
            <Link className="clay clay--pill" href="/">
              <span className="clay__text">去 AI 问诊</span>
            </Link>
          </div>
        </div>
      ) : (
        <ul className="kb__list">
          {results.map(({ d }) => (
            <li key={d.slug}>
              <Link className="kcard" href={`/library/${d.slug}`}>
                <div className="kcard__top">
                  <span className="kcard__dept">
                    {DEPARTMENTS.find((x) => x.id === d.department)?.name ?? "其他"}
                  </span>
                  <span className="kcard__tag">{d.tag}</span>
                </div>
                <div className="kcard__title">
                  <DeptArt id={d.department} size={38} className="kcard__art" />
                  <h3 className="kcard__name">{d.name}</h3>
                </div>
                <p className="kcard__sum">
                  {searching ? excerpt(d.summary, q, 78) : d.summary}
                </p>
                <div className="kcard__signs">
                  {d.symptoms.slice(0, 3).map((s) => (
                    <span key={s} className="kcard__sign">
                      {s.length > 16 ? `${s.slice(0, 15)}…` : s}
                    </span>
                  ))}
                </div>
                <div className="kcard__foot">
                  <span>整理于 {d.updatedAt}</span>
                  <span className="kcard__go">读一读 →</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
