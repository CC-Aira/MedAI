import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import KnowledgeShell from "@/components/KnowledgeShell";
import { DeptArt } from "@/components/DeptArt";
import { DRUGS, DRUG_INDEX, getDrug } from "@/data/drugs";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const d = getDrug(slug);
  if (!d) return { title: "未找到该药品 · MedAI" };
  return {
    title: `${d.genericName} · 药品说明 · MedAI`,
    description: `${d.genericName}的适应症、用法用量、禁忌人群、副作用、药物相互作用与特殊人群注意事项。`,
  };
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="doc__list">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

function Pairs({ items }: { items: { group: string; detail: string }[] }) {
  return (
    <dl className="drug__pairs">
      {items.map((x) => (
        <div className="drug__pair" key={x.group}>
          <dt>{x.group}</dt>
          <dd>{x.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function DrugPage({ params }: Props) {
  await requireUser();
  const { slug } = await params;
  const d = getDrug(slug);
  if (!d) notFound();

  const group = DRUG_INDEX.find((x) => x.slug === d.slug)?.group ?? "other";

  const sameCat = DRUGS.filter(
    (x) => x.slug !== d.slug && x.category.split("（")[0] === d.category.split("（")[0],
  ).slice(0, 4);

  return (
    <KnowledgeShell active="drugs">
      <article className="detail doc">
        <header className="doc__head">
          <div className="doc__badge">
            <DeptArt id={group} size={68} className="doc__art" />
            <div>
              <p className="eyebrow">
                <span className="eyebrow__dot" />
                {d.category}
              </p>
              <h1 className="doc__title">{d.genericName}</h1>
            </div>
          </div>
          <p className="doc__alias">
            {d.brandNames.length > 0 && <>常见商品名：{d.brandNames.join("、")} · </>}
            <span className={`doc__rx${d.otc ? " is-otc" : ""}`}>
              {d.otc ? "非处方药 OTC" : "处方药 Rx"}
            </span>
          </p>

          <div className="drug__facts">
            <div className="drug__fact">
              <span>常见剂型</span>
              <b>{d.forms.join(" / ")}</b>
            </div>
            <div className="drug__fact">
              <span>主要成分</span>
              <b>{d.ingredients}</b>
            </div>
            <div className="drug__fact">
              <span>更新日期</span>
              <b>{d.updatedAt}</b>
            </div>
          </div>
        </header>

        <section className="doc__sec">
          <h2 className="doc__h2">
            <span className="doc__n">01</span>
            适应症（治什么）
          </h2>
          <Bullets items={d.indications} />
        </section>

        <section className="doc__sec">
          <h2 className="doc__h2">
            <span className="doc__n">02</span>
            用法用量
          </h2>
          <Pairs items={d.dosage} />
        </section>

        <section className="doc__sec doc__sec--red">
          <h2 className="doc__h2">
            <span className="doc__n">03</span>
            禁忌人群（谁不能吃）
          </h2>
          <Bullets items={d.contraindications} />
        </section>

        <section className="doc__sec">
          <h2 className="doc__h2">
            <span className="doc__n">04</span>
            副作用（可能出现的反应）
          </h2>
          <Bullets items={d.adverseReactions} />
        </section>

        <section className="doc__sec">
          <h2 className="doc__h2">
            <span className="doc__n">05</span>
            药物相互作用（不能一起用的）
          </h2>
          <Bullets items={d.interactions} />
        </section>

        <section className="doc__sec">
          <h2 className="doc__h2">
            <span className="doc__n">06</span>
            特殊人群用药注意事项
          </h2>
          <Pairs items={d.specialPopulations} />
        </section>

        {(d.onset || d.missedDose || d.storage) && (
          <section className="doc__sec doc__sec--quick">
            <h2 className="doc__h2">
              <span className="doc__n">07</span>
              起效、漏服、怎么存
            </h2>
            <div className="drug__quick">
              {d.onset && (
                <div className="drug__quick-item">
                  <span>多久起效</span>
                  <p>{d.onset}</p>
                </div>
              )}
              {d.missedDose && (
                <div className="drug__quick-item">
                  <span>漏了一次</span>
                  <p>{d.missedDose}</p>
                </div>
              )}
              {d.storage && (
                <div className="drug__quick-item">
                  <span>怎么存放</span>
                  <p>{d.storage}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {d.warnings.length > 0 && (
          <section className="doc__sec doc__warn">
            <h2 className="doc__h2">
              <span className="doc__n">!</span>
              必须知道的几句
            </h2>
            <Bullets items={d.warnings} />
          </section>
        )}

        <div className="doc__tags">
          {d.keywords.map((k) => (
            <span key={k} className="doc__tag">
              #{k}
            </span>
          ))}
        </div>

        <footer className="doc__meta">
          <div className="doc__meta-row">
            <span className="doc__meta-label">信息来源</span>
            <span>{d.source.join("；")}</span>
          </div>
          <div className="doc__meta-row">
            <span className="doc__meta-label">更新日期</span>
            <span>{d.updatedAt}（人工整理校对）</span>
          </div>
          <p className="doc__disclaim">
            本页为科普整理，不是药品说明书的替代品。剂量仅为常见范围，不同厂家、不同剂型
            差异很大；儿童、孕妇、哺乳期、肝肾功能不全者的用药必须由医生或药师确定。
            用药前请阅读药盒内的实际说明书，如有冲突以说明书和医嘱为准。
          </p>
        </footer>
      </article>

      {sameCat.length > 0 && (
        <section className="doc__more">
          <p className="doc__more-title">同类药物</p>
          <div className="doc__more-list">
            {sameCat.map((s) => (
              <Link key={s.slug} className="doc__more-item" href={`/drugs/${s.slug}`}>
                <b>{s.genericName}</b>
                <span>{s.otc ? "OTC" : "Rx"}</span>
              </Link>
            ))}
          </div>
          <Link className="doc__backall" href="/drugs">
            ← 回到药品说明查询
          </Link>
        </section>
      )}
    </KnowledgeShell>
  );
}
