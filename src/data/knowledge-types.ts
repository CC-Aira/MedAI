/**
 * 疾病科普库 / 药品说明库的数据形状。
 *
 * 这两个库都是「人工整理的科普内容」，不是官方说明书原文：
 * - 每条都带 source（参考来源）和 updatedAt（整理/校对日期），页面必须展示；
 * - 文案要面向普通大众，避免堆砌术语，剂量一律不写具体数字（避免被当成处方照抄）；
 * - 用药相关的判断最终以实物说明书和医师处方为准，界面上要反复提示。
 */

export type Department = {
  id: string;
  name: string;
  /** 这一科大致看什么，帮用户判断该找哪一个 */
  scope: string;
};

export type Disease = {
  slug: string;
  name: string;
  /** 别名、俗称，搜索时也要能命中 */
  alias: string[];
  department: string;
  /** 常见 / 多发 / 需长期管理 —— 用于列表上的小标签 */
  tag: string;
  /** 一句话说清这是什么 */
  summary: string;
  causes: string[];
  symptoms: string[];
  /** 出现这些情况别拖，尽快就医 */
  redFlags: string[];
  prevention: string[];
  /** 治疗原则，只讲思路，不给具体处方 */
  treatment: string[];
  /** 日常照护建议 */
  care: string[];
  /** 去医院一般会做哪些检查，说清楚是为了让人别怕 */
  checks?: string[];
  /** 流传很广但不对的说法，一条条拆开 */
  myths?: string[];
  keywords: string[];
  source: string[];
  updatedAt: string;
};

export type DrugDosage = {
  /** 人群或场景，例如「成人」「儿童」「漏服时」 */
  group: string;
  detail: string;
};

export type Drug = {
  slug: string;
  /** 通用名：查药时最该认的名字 */
  genericName: string;
  brandNames: string[];
  /** 药理分类，例如「解热镇痛药」「他汀类调脂药」 */
  category: string;
  /** 主要成分 / 复方组成 */
  ingredients: string;
  forms: string[];
  otc: boolean;
  indications: string[];
  dosage: DrugDosage[];
  contraindications: string[];
  adverseReactions: string[];
  interactions: string[];
  specialPopulations: DrugDosage[];
  /** 必须让用户知道的风险提示 */
  warnings: string[];
  /** 吃下去多久能感觉到效果 —— 决定要不要着急 */
  onset?: string;
  /** 漏了一顿时怎么办，这是门诊被问得最多的一句 */
  missedDose?: string;
  /** 怎么存：哪些要放冰箱、哪些怕潮 */
  storage?: string;
  keywords: string[];
  source: string[];
  updatedAt: string;
};

/** 传给列表页的精简索引：体积小，够客户端做即时搜索 */
export type DiseaseIndex = Pick<
  Disease,
  | "slug"
  | "name"
  | "alias"
  | "department"
  | "tag"
  | "summary"
  | "symptoms"
  | "keywords"
  | "updatedAt"
>;

export type DrugIndex = Pick<
  Drug,
  | "slug"
  | "genericName"
  | "brandNames"
  | "category"
  | "ingredients"
  | "otc"
  | "indications"
  | "keywords"
  | "updatedAt"
>;

export function toDiseaseIndex(d: Disease): DiseaseIndex {
  const { slug, name, alias, department, tag, summary, symptoms, keywords, updatedAt } = d;
  return { slug, name, alias, department, tag, summary, symptoms, keywords, updatedAt };
}

export function toDrugIndex(d: Drug): DrugIndex {
  const {
    slug,
    genericName,
    brandNames,
    category,
    ingredients,
    otc,
    indications,
    keywords,
    updatedAt,
  } = d;
  return {
    slug,
    genericName,
    brandNames,
    category,
    ingredients,
    otc,
    indications,
    keywords,
    updatedAt,
  };
}
