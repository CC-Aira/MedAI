import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import KnowledgeShell from "@/components/KnowledgeShell";
import { DeptArt } from "@/components/DeptArt";
import { DISEASES, getDisease } from "@/data/diseases";
import { departmentName } from "@/data/departments";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const d = getDisease(slug);
  if (!d) return { title: "未找到该科普 · MedAI" };
  return { title: `${d.name} · 疾病科普库 · MedAI`, description: d.summary };
}

function Section({
  n,
  title,
  items,
}: {
  n: string;
  title: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="doc__sec">
      <h2 className="doc__h2">
        <span className="doc__n">{n}</span>
        {title}
      </h2>
      <ul className="doc__list">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </section>
  );
}

export default async function DiseasePage({ params }: Props) {
  await requireUser();
  const { slug } = await params;
  const d = getDisease(slug);
  if (!d) notFound();

  // 同科室的其他病种，作为「继续看看」
  const siblings = DISEASES.filter(
    (x) => x.department === d.department && x.slug !== d.slug,
  ).slice(0, 4);

  return (
    <KnowledgeShell active="library">
      <article className="detail doc">
        <header className="doc__head">
          <div className="doc__badge">
            <DeptArt id={d.department} size={68} className="doc__art" />
            <div>
              <p className="eyebrow">
                <span className="eyebrow__dot" />
                {departmentName(d.department)} · {d.tag}
              </p>
              <h1 className="doc__title">{d.name}</h1>
            </div>
          </div>
          {d.alias.length > 0 && (
            <p className="doc__alias">也叫：{d.alias.join(" / ")}</p>
          )}
          <p className="doc__lede">{d.summary}</p>
        </header>

        <Section n="01" title="为什么会得" items={d.causes} />
        <Section n="02" title="有什么表现" items={d.symptoms} />

        {d.redFlags.length > 0 && (
          <section className="doc__sec doc__sec--red">
            <h2 className="doc__h2">
              <span className="doc__n">03</span>
              出现这些情况别拖
            </h2>
            <ul className="doc__list">
              {d.redFlags.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <p className="doc__rednote">
              这一节不是让你自己判断病情，而是提醒：有些信号值得马上找医生。
            </p>
          </section>
        )}

        <Section n="04" title="去医院一般会做哪些检查" items={d.checks ?? []} />
        <Section n="05" title="怎么预防" items={d.prevention} />
        <Section n="06" title="治疗原则" items={d.treatment} />
        <Section n="07" title="日常怎么照护" items={d.care} />

        {d.myths && d.myths.length > 0 && (
          <section className="doc__sec doc__sec--myth">
            <h2 className="doc__h2">
              <span className="doc__n">08</span>
              流传很广，但不对
            </h2>
            <ul className="doc__list doc__list--myth">
              {d.myths.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <p className="doc__mythnote">
              这一节只拆说法，不改治疗方案。真正拿不准的，还是当面问医生。
            </p>
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
            本页是面向大众的健康科普，不是诊疗方案。具体诊断、检查和用药请到医院面诊，
            个体情况差异很大，同一句话在不同人身上未必适用。
          </p>
        </footer>
      </article>

      {siblings.length > 0 && (
        <section className="doc__more">
          <p className="doc__more-title">{departmentName(d.department)}的其他科普</p>
          <div className="doc__more-list">
            {siblings.map((s) => (
              <Link key={s.slug} className="doc__more-item" href={`/library/${s.slug}`}>
                <b>{s.name}</b>
                <span>{s.tag}</span>
              </Link>
            ))}
          </div>
          <Link className="doc__backall" href="/library">
            ← 回到科普库，按科室浏览
          </Link>
        </section>
      )}
    </KnowledgeShell>
  );
}
