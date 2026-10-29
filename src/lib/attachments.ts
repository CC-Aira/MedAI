import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./http";
import { LIMITS, type AttachKind } from "./constants";

/**
 * 附件（给 AI 看的资料：病历照片、化验单、PDF 报告、Word 文档）
 *
 * 关键判断：DeepSeek 的 deepseek-flash / deepseek-v4-pro 都是纯文本模型，
 * 不接受图片输入（旧的 vision-exp 已经退役）。所以图片必须先在本地把文字读出来，
 * 再把文字交给模型 —— 模型"看"到的是 OCR 结果，不是像素。
 *
 * 因此：图片里有字（化验单、病历、药盒）= 能用；纯图像（皮疹、舌象、X 光片）= 读不出内容，
 * 这种情况会明确告诉用户补一句文字描述，绝不假装看懂了。
 */

/* 存 data/uploads/attachments：不放 public，避免病历照片被静态路径直接访问。
   读取统一走 /api/attachments/[id]/raw，带登录校验。 */
const ATTACH_DIR = path.join(process.cwd(), "data", "uploads", "attachments");

type Sniffed = { kind: AttachKind; ext: string; mimeType: string };

const IMAGE_SIGNATURES: { ext: string; mime: string; match: (b: Buffer) => boolean }[] = [
  { ext: "png", mime: "image/png", match: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: "jpg", mime: "image/jpeg", match: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", mime: "image/gif", match: (b) => b.length >= 4 && b.toString("ascii", 0, 4) === "GIF8" },
  {
    ext: "webp",
    mime: "image/webp",
    match: (b) =>
      b.length >= 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP",
  },
];

/**
 * 只认文件头。客户端报的 MIME 和文件名一律不采信：
 * 把 .exe 改名成 .jpg、或者给个 image/png 的 MIME，都骗不过这里。
 */
export function sniffAttachment(buffer: Buffer): Sniffed | null {
  if (buffer.length === 0) return null;

  for (const sig of IMAGE_SIGNATURES) {
    if (sig.match(buffer)) return { kind: "image", ext: sig.ext, mimeType: sig.mime };
  }

  if (buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-") {
    return { kind: "pdf", ext: "pdf", mimeType: "application/pdf" };
  }

  // docx 是 zip 包，本地文件头 PK\x03\x04；前 4KB 里能搜到 word/ 目录就算 Word
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("latin1");
    if (head.includes("word/")) return { kind: "docx", ext: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    return null; // 别的 zip 不收
  }

  // 纯文本：没有 NUL 字节，且按 utf8 解码后基本不是替换符
  const hasNul = buffer.includes(0);
  if (!hasNul) {
    const text = buffer.toString("utf8");
    const bad = (text.match(/\uFFFD/g) || []).length;
    if (text.length > 0 && bad / text.length < 0.02) {
      return { kind: "text", ext: "txt", mimeType: "text/plain; charset=utf-8" };
    }
  }

  return null;
}

export async function saveAttachmentFile(
  buffer: Buffer,
  ext: string,
): Promise<{ storedName: string; sizeBytes: number }> {
  if (buffer.length === 0) throw new HttpError(400, "文件是空的");
  if (buffer.length > LIMITS.attachBytes) {
    throw new HttpError(413, "文件不能超过 10MB");
  }

  await mkdir(ATTACH_DIR, { recursive: true });
  const storedName = `${randomUUID().replace(/-/g, "")}.${ext}`;
  await writeFile(path.join(ATTACH_DIR, storedName), buffer);
  return { storedName, sizeBytes: buffer.length };
}

export async function readAttachmentFile(storedName: string): Promise<Buffer> {
  // 只允许自己生成的形状，杜绝 ../ 穿越
  if (!/^[a-f0-9]{32}\.[a-z0-9]{3,5}$/i.test(storedName)) {
    throw new HttpError(400, "附件路径不合法");
  }
  try {
    return await readFile(path.join(ATTACH_DIR, storedName));
  } catch {
    throw new HttpError(404, "附件文件已经不在了");
  }
}

export async function removeAttachmentFile(storedName: string | null): Promise<void> {
  if (!storedName) return;
  if (!/^[a-f0-9]{32}\.[a-z0-9]{3,5}$/i.test(storedName)) return;
  try {
    await unlink(path.join(ATTACH_DIR, storedName));
  } catch {
    // 文件不在就算了
  }
}

/* ------------------------------------------------------------------ OCR */

/** 粗判一行文字像不像真字：汉字/字母/数字/常用标点占比 */
function saneRatio(text: string): number {
  const chars = [...text.replace(/\s/g, "")];
  if (chars.length === 0) return 0;
  const good = chars.filter((c) =>
    /[\u4e00-\u9fa5A-Za-z0-9，。、：；！？（）《》%·\-—.,:;()/]/.test(c),
  );
  return good.length / chars.length;
}

const MIN_LINE_CONF = 60;
const MIN_LINE_RATIO = 0.75;

type OcrWorker = {
  recognize: (img: Buffer, o?: unknown, out?: unknown) => Promise<{ data: OcrData }>;
};

type OcrLine = { text: string; confidence?: number; bbox?: { y0?: number } };
type OcrData = {
  text: string;
  blocks?: { paragraphs?: { lines?: OcrLine[] }[] }[];
};

/**
 * worker 初始化要加载 core + 中文语言包，之前实测首次要几十秒，
 * 之后每次识别只要几百毫秒。所以必须复用，不能一次上传建一个。
 * 挂在 globalThis 上，dev 模式热重载也不会反复重建、把内存吃满。
 */
const globalForOcr = globalThis as unknown as {
  __medaiOcr?: Promise<OcrWorker | null>;
};

/** 语言包固定放在项目里（chi_sim.traineddata，约 2.4MB），避免运行时去 CDN 下载 */
const TESSDATA_DIR = path.join(process.cwd(), "data", "tesseract");

async function getOcrWorker(): Promise<OcrWorker | null> {
  if (!globalForOcr.__medaiOcr) {
    globalForOcr.__medaiOcr = (async () => {
      try {
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker("chi_sim", 1, {
          langPath: TESSDATA_DIR,
          cachePath: TESSDATA_DIR,
          // 本地文件是未压缩的 .traineddata，不用再按 .gz 去找
          gzip: false,
          // 只留错误日志，识别进度对服务端没意义
          logger: () => {},
        });
        return worker as unknown as OcrWorker;
      } catch (err) {
        console.error("[medai] OCR 引擎初始化失败", err);
        globalForOcr.__medaiOcr = undefined;
        return null;
      }
    })();
  }
  return globalForOcr.__medaiOcr;
}

/**
 * 启动预热：让 OCR 引擎在服务起来时就加载好。
 * 不预热的话，用户第一次上传要现等语言包加载（实测 90 秒），体验很差。
 */
export async function warmUpOcr(): Promise<boolean> {
  const worker = await getOcrWorker();
  return worker !== null;
}

/**
 * 图片 → 文字。
 * 关键是按行过滤：tesseract 会把照片里的草地、阴影也"读"成字，
 * 那些行置信度普遍在 0~30，而且拼不出像样的中文，两层过滤后基本只剩印刷体。
 */
async function ocrImage(buffer: Buffer): Promise<string> {
  const worker = await getOcrWorker();
  if (!worker) return "";

  const { data } = await worker.recognize(buffer, {}, { text: true, blocks: true });

  const lines: { text: string; conf: number; ratio: number; top: number }[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const text = (line.text || "").trim();
        if (!text) continue;
        lines.push({
          text,
          conf: line.confidence ?? 0,
          ratio: saneRatio(text),
          top: line.bbox?.y0 ?? 0,
        });
      }
    }
  }

  const kept = lines
    .filter((l) => l.conf >= MIN_LINE_CONF && l.ratio >= MIN_LINE_RATIO)
    .sort((a, b) => a.top - b.top)
    .map((l) => l.text);

  // 一行都没过筛，说明整张图没有可读文字，返回空串让上层如实告知用户
  return kept.join("\n").trim();
}

/* -------------------------------------------------------- 文档正文提取 */

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function pdfText(buffer: Buffer): Promise<string> {
  // pdf-parse 的入口在打包环境下会去读它自带的测试样本，直接引实现文件更稳
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string }>;
  const out = await pdfParse(buffer);
  return out.text || "";
}

async function docxText(buffer: Buffer): Promise<string> {
  const mod = await import("mammoth");
  const mammoth = (mod.default ?? mod) as {
    extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const out = await mammoth.extractRawText({ buffer });
  return out.value || "";
}

export type ExtractedAttachment = {
  /** 提取出的正文，已清洗截断；空串表示没读到内容 */
  text: string;
  /** 给人看的一句话说明，直接显示在气泡里 */
  note: string;
};

/**
 * 把附件变成可以塞进提示词的文字。
 * 任何一步失败都不抛异常 —— 附件坏掉不该让整次问诊 500，
 * 而是返回空正文 + 一句如实的说明。
 */
export async function extractAttachmentText(
  buffer: Buffer,
  kind: AttachKind,
  filename: string,
): Promise<ExtractedAttachment> {
  let raw = "";
  let note = "";

  try {
    if (kind === "text") {
      raw = buffer.toString("utf8");
      note = "文本文件，已直接读取";
    } else if (kind === "pdf") {
      raw = await pdfText(buffer);
      note = raw.trim() ? "PDF 报告，已提取文字" : "PDF 里没有可提取的文字（可能是扫描件）";
    } else if (kind === "docx") {
      raw = await docxText(buffer);
      note = raw.trim() ? "Word 文档，已提取文字" : "Word 文档里没有文字";
    } else if (kind === "image") {
      raw = await ocrImage(buffer);
      note = raw
        ? "图片，已在本地识别出图中的文字"
        : "图片里没识别出文字（可能是纯照片），可以再补一句描述";
    }
  } catch (err) {
    console.error(`[medai] 解析附件失败 ${filename}`, err);
    return { text: "", note: "这个文件没能解析出内容" };
  }

  const text = cleanText(raw).slice(0, LIMITS.attachText);
  return { text, note };
}
