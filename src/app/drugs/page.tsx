import type { Metadata } from "next";
import Link from "next/link";
import KnowledgeShell from "@/components/KnowledgeShell";
import DrugBrowser from "@/components/DrugBrowser";
import { DRUG_GROUPS, DRUG_INDEX, DRUG_UPDATED_AT } from "@/data/drugs";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "药品说明查询 · MedAI",
  description:
    "按药品名称、商品名、成分、适应症查询常用药：适应症、用法用量、禁忌人群、副作用、药物相互作用、特殊人群注意事项。",
};

export default async function DrugsPage() {
  await requireUser();

  return (
    <KnowledgeShell active="drugs">
      <header className="kbase__head">
        <p className="eyebrow">
          <span className="eyebrow__dot" />
          药品说明查询 · medicines
        </p>
        <h1 className="kbase__title">
          吃药之前，先看清楚<em>怎么吃、谁能吃</em>
        </h1>
        <p className="kbase__sub">
          {DRUG_INDEX.length} 种常用药，按通用名索引。每条都按说明书的结构写：适应症、用法用量、
          禁忌人群、副作用、药物相互作用、特殊人群注意事项，并标注来源和更新日期。
        </p>
      </header>

      <section className="sheet">
        <DrugBrowser index={DRUG_INDEX} groups={DRUG_GROUPS} />
      </section>

      <footer className="kbase__foot">
        <p className="kbase__note">
          说明内容整理自药监部门核准的说明书范本、药典临床用药须知与诊疗指南，最近一次整理：
          {DRUG_UPDATED_AT}。剂量只是常见成人范围，<b>实际用药以药盒内说明书和医生处方为准</b>；
          儿童、孕妇、肝肾功能不全者的剂量必须由医生个体化确定。
        </p>
        <Link className="kbase__other" href="/library">
          想了解这个病是怎么回事？去疾病科普库 →
        </Link>
      </footer>
    </KnowledgeShell>
  );
}
