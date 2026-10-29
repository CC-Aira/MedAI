import type { Drug, DrugIndex } from "./knowledge-types";
import { toDrugIndex } from "./knowledge-types";
import { ANALGESIC } from "./drugs/analgesic";
import { ANTIBIOTIC } from "./drugs/antibiotic";
import { CARDIO_DRUGS } from "./drugs/cardio";
import { DIGESTIVE_DRUGS } from "./drugs/digestive";
import { ENDOCRINE_DRUGS } from "./drugs/endocrine";
import { OTHER_DRUGS } from "./drugs/others";
import { RESPIRATORY_DRUGS } from "./drugs/respiratory";
import { PSYCH_DRUGS } from "./drugs/psych";
import { NUTRITION_DRUGS } from "./drugs/nutrition";
import { DERM_DRUGS } from "./drugs/derm";
import { EYE_DRUGS } from "./drugs/eye";

/**
 * 药品说明库。
 * 收录的是常用通用名药物，字段按说明书结构组织：
 * 适应症 / 用法用量 / 禁忌人群 / 副作用 / 相互作用 / 特殊人群。
 * 全部为科普整理，剂量只写常见范围，实际用药以实物说明书和处方为准。
 */
export const DRUGS: Drug[] = [
  ...ANALGESIC,
  ...ANTIBIOTIC,
  ...CARDIO_DRUGS,
  ...DIGESTIVE_DRUGS,
  ...ENDOCRINE_DRUGS,
  ...RESPIRATORY_DRUGS,
  ...PSYCH_DRUGS,
  ...NUTRITION_DRUGS,
  ...DERM_DRUGS,
  ...EYE_DRUGS,
  ...OTHER_DRUGS,
];

/**
 * 药理分类有三十多个，筛选标签用这八个大类；
 * 详情页仍然显示完整的专业分类（如「二氢吡啶类钙通道阻滞剂」）。
 */
const GROUP_OF: Record<string, string> = {
  paracetamol: "analgesic",
  ibuprofen: "analgesic",
  aspirin: "cardio",
  amoxicillin: "antiinfective",
  cefixime: "antiinfective",
  azithromycin: "antiinfective",
  levofloxacin: "antiinfective",
  metronidazole: "antiinfective",
  acyclovir: "antiinfective",
  fluconazole: "antiinfective",
  amlodipine: "cardio",
  valsartan: "cardio",
  metoprolol: "cardio",
  atorvastatin: "cardio",
  nitroglycerin: "cardio",
  clopidogrel: "cardio",
  rivaroxaban: "cardio",
  omeprazole: "digestive",
  hydrotalcite: "digestive",
  montmorillonite: "digestive",
  domperidone: "digestive",
  lactulose: "digestive",
  metformin: "endocrine",
  glimepiride: "endocrine",
  levothyroxine: "endocrine",
  allopurinol: "endocrine",
  febuxostat: "endocrine",
  "calcium-carbonate-d3": "endocrine",
  alendronate: "endocrine",
  loratadine: "respiratory",
  montelukast: "respiratory",
  salbutamol: "respiratory",
  budesonide: "respiratory",
  "ferrous-succinate": "nutrition",
  "folic-acid": "nutrition",
  sertraline: "psych",
  diclofenac: "analgesic",
  celecoxib: "analgesic",
  tramadol: "analgesic",
  "lidocaine-patch": "analgesic",
  "amoxicillin-clavulanate": "antiinfective",
  cephalexin: "antiinfective",
  doxycycline: "antiinfective",
  oseltamivir: "antiinfective",
  nitrofurantoin: "antiinfective",
  benazepril: "cardio",
  hydrochlorothiazide: "cardio",
  spironolactone: "cardio",
  ezetimibe: "cardio",
  "bismuth-potassium-citrate": "digestive",
  loperamide: "digestive",
  "ursodeoxycholic-acid": "digestive",
  probiotics: "digestive",
  ambroxol: "respiratory",
  dextromethorphan: "respiratory",
  "fluticasone-nasal": "respiratory",
  "budesonide-formoterol": "respiratory",
  sitagliptin: "endocrine",
  dapagliflozin: "endocrine",
  "insulin-glargine": "endocrine",
  methimazole: "endocrine",
  escitalopram: "psych",
  zolpidem: "psych",
  melatonin: "psych",
  gabapentin: "psych",
  "vitamin-b12": "nutrition",
  "vitamin-d3": "nutrition",
  "zinc-gluconate": "nutrition",
  mupirocin: "derm",
  "mometasone-cream": "derm",
  adapalene: "derm",
  "artificial-tears": "eye",
  olopatadine: "eye",
};

const GROUP_NAMES: Record<string, string> = {
  analgesic: "解热镇痛",
  antiinfective: "抗感染",
  cardio: "心血管",
  digestive: "消化",
  endocrine: "内分泌与代谢",
  respiratory: "呼吸与抗过敏",
  nutrition: "补血与营养",
  psych: "精神神经",
  derm: "皮肤外用",
  eye: "眼科",
  other: "其他",
};

export type DrugIndexEntry = DrugIndex & { group: string };

export const DRUG_INDEX: DrugIndexEntry[] = DRUGS.map((d) => ({
  ...toDrugIndex(d),
  group: GROUP_OF[d.slug] ?? "other",
}));

const BY_SLUG = new Map(DRUGS.map((d) => [d.slug, d]));

export function getDrug(slug: string): Drug | undefined {
  return BY_SLUG.get(slug);
}

export const DRUG_GROUPS = Object.entries(GROUP_NAMES)
  .map(([id, name]) => ({
    id,
    name,
    count: DRUG_INDEX.filter((d) => d.group === id).length,
  }))
  .filter((g) => g.count > 0);

export const DRUG_UPDATED_AT = DRUGS.reduce(
  (latest, d) => (d.updatedAt > latest ? d.updatedAt : latest),
  "2026-01",
);
