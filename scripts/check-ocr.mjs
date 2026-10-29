/**
 * OCR 自检：确认 tesseract.js 能正常加载中文语言包并识别图片。
 * 用法：node scripts/check-ocr.mjs [图片路径]
 * 不带参数时用 docs/preview-home.png 当样本。
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createWorker } from "tesseract.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sample =
  process.argv[2] || path.join(here, "..", "docs", "preview-home.png");

if (!existsSync(sample)) {
  console.error(`找不到图片：${sample}`);
  process.exit(1);
}

/** 一行里"像字"的比例：汉字/字母/数字/常用标点 */
function saneRatio(text) {
  const chars = [...text.replace(/\s/g, "")];
  if (chars.length === 0) return 0;
  const good = chars.filter((c) => /[\u4e00-\u9fa5A-Za-z0-9，。、：；！？（）%·\-—.,:;()/]/.test(c));
  return good.length / chars.length;
}

const MIN_CONF = 60;
const MIN_RATIO = 0.75;

console.log(`样本：${sample}`);
const t0 = Date.now();

const worker = await createWorker("chi_sim", 1, {
  logger: (m) => {
    if (m.status === "recognizing text") return;
    if (typeof m.progress === "number" && m.progress < 1) return;
    console.log(`  · ${m.status}`);
  },
});

const { data } = await worker.recognize(sample, {}, { text: true, blocks: true });
await worker.terminate();

const secs = ((Date.now() - t0) / 1000).toFixed(1);

// 把 blocks → lines 摊平，按行置信度 + 字形合理度过滤
const lines = [];
for (const block of data.blocks ?? []) {
  for (const para of block.paragraphs ?? []) {
    for (const line of para.lines ?? []) {
      const text = (line.text || "").trim();
      if (!text) continue;
      const conf = line.confidence ?? 0;
      const ratio = saneRatio(text);
      lines.push({ text, conf, ratio, top: line.bbox?.y0 ?? 0, keep: conf >= MIN_CONF && ratio >= MIN_RATIO });
    }
  }
}

lines.sort((a, b) => a.top - b.top);
const kept = lines.filter((l) => l.keep).map((l) => l.text);
const dropped = lines.filter((l) => !l.keep);

console.log(`\n耗时 ${secs}s，原始 ${data.text.length} 字符，共 ${lines.length} 行`);
console.log(`过滤后保留 ${kept.length} 行 / 丢弃 ${dropped.length} 行`);
console.log("--- 保留 ---");
console.log(kept.join("\n") || "（空）");
console.log("--- 丢弃（前 12 行）---");
console.log(dropped.slice(0, 12).map((l) => `[${l.conf.toFixed(0)}|${(l.ratio * 100).toFixed(0)}%] ${l.text}`).join("\n") || "（无）");
console.log("---");

if (kept.length === 0) {
  console.error("✗ 没有可信的行");
  process.exit(2);
}
console.log("✓ 中文 OCR 可用");
