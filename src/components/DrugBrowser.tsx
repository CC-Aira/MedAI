"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DrugIndexEntry } from "@/data/drugs";
import { excerpt, matchScore } from "@/lib/knowledge-search";
import { DeptArt } from "@/components/DeptArt";

const HOT = ["布洛芬", "对乙酰氨基酚", "奥美拉唑", "二甲双胍", "氯雷他定", "阿莫西林"];

function fields(d: DrugIndexEntry) {
  return [
    { text: d.genericName, weight: 100 },
    { text: d.brandNames.join(" "), weight: 70 },
    { text: d.ingredients, weight: 45 },
    { text: d.indications.join(" "), weight: 34 },
    { text: d.category, weight: 28 },
    { text: d.keywords.join(" "), weight: 26 },
  ];
}

export default function DrugBrowser({
  index,
  groups,
}: {
  index: DrugIndexEntry[];
  groups: { id: string; name: string; count: number }[];
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [rx, setRx] = useState<"all" | "otc" | "rx">("all");

  const results = useMemo(() => {
    let base = index;
    if (cat !== "all") base = base.filter((d) => d.group === cat);
    if (rx !== "all") base = base.filter((d) => (rx === "otc" ? d.otc : !d.otc));

    const query = q.trim();
    if (!query) return base.map((d) => ({ d, score: 0 }));
    return base
      .map((d) => ({ d, score: matchScore(query, fields(d)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [q, cat, rx, index]);

  const searching = q.trim().length > 0;

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
          placeholder="搜药品名、商品名、成分或适应症，例如「胃酸」「对乙酰氨基酚」"
          aria-label="搜索药品说明"
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
          <button key={k} type="button" className="kb__hot-chip" onClick={() => setQ(k)}>
            {k}
          </button>
        ))}
      </div>

      <div className="kb__depts" role="group" aria-label="按分类筛选">
        <button
          type="button"
          className={`kb__dept${cat === "all" ? " is-on" : ""}`}
          onClick={() => setCat("all")}
        >
          全部
          <i>{index.length}</i>
        </button>
        {groups.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`kb__dept${cat === c.id ? " is-on" : ""}`}
            onClick={() => setCat(cat === c.id ? "all" : c.id)}
          >
            {c.name}
            <i>{c.count}</i>
          </button>
        ))}
      </div>

      <div className="kb__rx" role="group" aria-label="按处方类型筛选">
        {(
          [
            ["all", "不限"],
            ["otc", "非处方药 OTC"],
            ["rx", "处方药 Rx"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`kb__rx-chip${rx === id ? " is-on" : ""}`}
            onClick={() => setRx(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="kb__count">
        {searching ? (
          <>
            找到 <b>{results.length}</b> 条与「{q.trim()}」相关的药品
          </>
        ) : (
          <>
            共 {results.length} 种常用药 · 通用名索引
          </>
        )}
      </p>

      {results.length === 0 ? (
        <div className="kb__empty">
          <p className="kb__empty-title">这个药还没收进说明库</p>
          <p className="kb__empty-text">
            可以换个通用名试试，或者用成分名搜（比如「对乙酰氨基酚」而不是某个商品名）。
            没查到不代表药不存在，具体请以药盒里的说明书为准。
          </p>
          <div className="kb__empty-acts">
            <button className="clay clay--pill" type="button" onClick={() => { setQ(""); setCat("all"); setRx("all"); }}>
              <span className="clay__text">看看全部</span>
            </button>
            <Link className="clay clay--pill" href="/library">
              <span className="clay__text">去科普库</span>
            </Link>
          </div>
        </div>
      ) : (
        <ul className="kb__list">
          {results.map(({ d }) => (
            <li key={d.slug}>
              <Link className="kcard kcard--drug" href={`/drugs/${d.slug}`}>
                <div className="kcard__top">
                  <span className="kcard__dept">{d.category}</span>
                  <span className={`kcard__rx${d.otc ? " is-otc" : ""}`}>
                    {d.otc ? "OTC" : "Rx 处方药"}
                  </span>
                </div>
                <div className="kcard__title">
                  <DeptArt id={d.group} size={38} className="kcard__art" />
                  <h3 className="kcard__name">{d.genericName}</h3>
                </div>
                {d.brandNames.length > 0 && (
                  <p className="kcard__brands">常见商品名：{d.brandNames.join("、")}</p>
                )}
                <p className="kcard__sum">
                  {searching ? excerpt(d.indications.join("；"), q, 82) : d.indications[0]}
                </p>
                <div className="kcard__foot">
                  <span>更新于 {d.updatedAt}</span>
                  <span className="kcard__go">看说明书 →</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
