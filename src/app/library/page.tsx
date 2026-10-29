import type { Metadata } from "next";
import Link from "next/link";
import KnowledgeShell from "@/components/KnowledgeShell";
import LibraryBrowser from "@/components/LibraryBrowser";
import { DISEASE_INDEX, DISEASE_UPDATED_AT } from "@/data/diseases";
import { DEPARTMENTS } from "@/data/departments";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "疾病科普库 · MedAI",
  description:
    "按科室和病种整理常见病、多发病的病因、症状、预防与治疗原则，支持关键词搜索，面向普通大众。",
};

export default async function LibraryPage() {
  await requireUser();

  return (
    <KnowledgeShell active="library">
      <header className="kbase__head">
        <p className="eyebrow">
          <span className="eyebrow__dot" />
          疾病科普库 · library
        </p>
        <h1 className="kbase__title">
          身体哪里不对劲，先弄明白<em>它是什么</em>
        </h1>
        <p className="kbase__sub">
          {DEPARTMENTS.length} 个科室、{DISEASE_INDEX.length} 条常见病与多发病。每条都写了病因、表现、
          什么情况要就医、怎么预防和治疗原则，用普通话讲清楚，不堆术语。
        </p>
      </header>

      <section className="sheet">
        <LibraryBrowser index={DISEASE_INDEX} />
      </section>

      <footer className="kbase__foot">
        <p className="kbase__note">
          科普内容整理自国内外诊疗指南与教材，最近一次整理：{DISEASE_UPDATED_AT}。
          它帮你把问题问得更清楚，但不能替代执业医师的面诊、检查和处方。
        </p>
        <Link className="kbase__other" href="/drugs">
          想查药怎么吃？去药品说明查询 →
        </Link>
      </footer>
    </KnowledgeShell>
  );
}
