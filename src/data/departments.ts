import type { Department } from "./knowledge-types";

/** 科室分类，顺序就是页面上标签的顺序 */
export const DEPARTMENTS: Department[] = [
  { id: "respiratory", name: "呼吸内科", scope: "咳嗽、咳痰、气短、发热、鼻炎" },
  { id: "cardio", name: "心血管内科", scope: "血压、胸闷、心悸、血脂" },
  { id: "digestive", name: "消化内科", scope: "胃痛、反酸、腹泻、便秘、肝胆" },
  { id: "endocrine", name: "内分泌科", scope: "血糖、甲状腺、尿酸、骨量、体重" },
  { id: "neuro", name: "神经内科", scope: "头痛、头晕、失眠、肢体麻木" },
  { id: "nephro", name: "肾内科", scope: "尿频尿痛、结石、水肿、尿检异常" },
  { id: "skin", name: "皮肤科", scope: "皮疹、瘙痒、痤疮、水疱、脱皮" },
  { id: "ortho", name: "骨科", scope: "颈肩腰腿痛、关节痛、扭伤" },
  { id: "pediatric", name: "儿科", scope: "儿童发热、腹泻、手足口病" },
  { id: "gyneco", name: "妇科", scope: "月经、痛经、白带、备孕" },
  { id: "ent", name: "眼耳鼻喉科", scope: "眼干、耳鸣、咽痛、鼻塞" },
  { id: "psych", name: "精神心理科", scope: "焦虑、情绪低落、睡眠问题" },
  { id: "infectious", name: "感染科", scope: "肝炎、结核、水痘等传染病" },
];

export function departmentName(id: string): string {
  return DEPARTMENTS.find((d) => d.id === id)?.name ?? id;
}
