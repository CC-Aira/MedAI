import type { Disease, DiseaseIndex } from "./knowledge-types";
import { toDiseaseIndex } from "./knowledge-types";
import { RESPIRATORY } from "./diseases/respiratory";
import { CARDIO } from "./diseases/cardio";
import { DIGESTIVE } from "./diseases/digestive";
import { ENDOCRINE } from "./diseases/endocrine";
import { NEURO } from "./diseases/neuro";
import { NEPHRO } from "./diseases/nephro";
import { SKIN } from "./diseases/skin";
import { ORTHO } from "./diseases/ortho";
import { OTHERS } from "./diseases/others";
import { PEDIATRIC } from "./diseases/pediatric";
import { GYNECO } from "./diseases/gyneco";
import { ENT } from "./diseases/ent";
import { PSYCH } from "./diseases/psych";
import { INFECTIOUS } from "./diseases/infectious";

/**
 * 疾病科普库：按「科室 → 病种」组织。
 * 内容都是给普通人看的科普整理，不替代医生诊断；页面上会标注来源和整理日期。
 */
export const DISEASES: Disease[] = [
  ...RESPIRATORY,
  ...CARDIO,
  ...DIGESTIVE,
  ...ENDOCRINE,
  ...NEURO,
  ...NEPHRO,
  ...SKIN,
  ...ORTHO,
  ...PEDIATRIC,
  ...GYNECO,
  ...ENT,
  ...PSYCH,
  ...INFECTIOUS,
  ...OTHERS,
];

export const DISEASE_INDEX: DiseaseIndex[] = DISEASES.map(toDiseaseIndex);

const BY_SLUG = new Map(DISEASES.map((d) => [d.slug, d]));

export function getDisease(slug: string): Disease | undefined {
  return BY_SLUG.get(slug);
}

/** 每个科室有多少条，用于分类标签上的计数 */
export const DISEASE_COUNT_BY_DEPT: Record<string, number> = DISEASES.reduce<
  Record<string, number>
>((acc, d) => {
  acc[d.department] = (acc[d.department] ?? 0) + 1;
  return acc;
}, {});

/** 最近一次整理日期，页脚统一展示 */
export const DISEASE_UPDATED_AT = DISEASES.reduce(
  (latest, d) => (d.updatedAt > latest ? d.updatedAt : latest),
  "2026-01",
);
