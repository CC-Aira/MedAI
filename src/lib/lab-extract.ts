import {
  askDeepSeekOnce,
  askVisionOnce,
  type ChatMessage,
  type VisionMessage,
} from "./ai";
import { HttpError } from "./http";
import { parseLabPayload } from "./lab-report";

/**
 * 化验单抽取：把一张照片变成一份能对比的指标表。
 *
 * 提示词只让它做两件事 —— 照抄单子上印的字、按是否超出参考区间打标。
 * 一旦允许它"解读"，模型就会开始写"提示轻度贫血""建议复查"，那就越过了
 * 产品的边界（不做诊断），而且这些句子没法参与数值对比。
 */

const MAX_VISION_BYTES = 8 * 1024 * 1024;

const PROMPT = `你是医学检验报告的结构化抽取器。任务只有一件：把这张化验单上印着的内容照抄成 JSON。不要诊断、不要建议、不要解释。

输出格式（严格 JSON，不要 markdown 代码块）：
{
  "takenAt": "采样或报告日期，YYYY-MM-DD；读不到就填空字符串",
  "hospital": "医院或体检机构名称；读不到填空字符串",
  "kind": "血常规|肝功能|肾功能|血脂|血糖|尿常规|凝血|电解质|其他",
  "summary": "一句客观归纳：共 N 项，其中 M 项超出参考区间，并列出这些项的名称。不要出现任何诊断词或建议",
  "items": [
    {
      "name": "项目名称，保留单据原文，不要把单位写进名字",
      "value": "结果原文，如 5.23 / <0.01 / 阴性",
      "unit": "单位，单据上没有就填空字符串",
      "refText": "参考区间原文，如 3.50-9.50 或 阴性",
      "abnormal": "high 或 low 或 空字符串"
    }
  ]
}

规则：
1. 只抄单据上真实印着的项。模糊、被裁掉、看不清的项目直接不输出，绝对不要猜。
2. abnormal 只有在单据本身标了箭头/星号，或数值明显超出参考区间时才填。
3. items 最多 40 项，按单据上的顺序。
4. 一份单子都没有识别出来时，items 返回空数组。`;

export type LabExtractResult = ReturnType<typeof parseLabPayload>;

export async function extractLabReport(input: {
  bytes: Buffer;
  mimeType: string;
  /** 附件已有的 OCR 文本：图片认不出字、或上传的是 PDF 时用它兜底 */
  text: string;
}): Promise<LabExtractResult> {
  const { bytes, mimeType, text } = input;

  if (mimeType.startsWith("image/")) {
    if (bytes.byteLength > MAX_VISION_BYTES) {
      throw new HttpError(413, "图片超过 8MB，视觉模型读不动。请压缩或裁剪后再传");
    }
    const dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;
    const messages: VisionMessage[] = [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: PROMPT },
        ],
      },
    ];
    return parseLabPayload(await askVisionOnce({ messages, maxTokens: 1000 }));
  }

  // PDF / Word / 文本：走附件解析出来的正文。这类单据已经有字了，
  // 用文本模型就够，不必为了"统一"去烧一次视觉调用。
  const body = text.trim();
  if (!body) {
    throw new HttpError(422, "这个文件里没有可读的文字，换成拍照的图片再试");
  }
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `${PROMPT}\n\n下面是这份化验单的正文，按同样的格式抽取：\n"""\n${body.slice(0, 6000)}\n"""`,
    },
  ];
  return parseLabPayload(
    await askDeepSeekOnce({ messages, json: true, temperature: 0, maxTokens: 2000 }),
  );
}
