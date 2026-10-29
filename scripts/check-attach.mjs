/**
 * 单个文件的上传解析自检：看魔数判定和正文提取是否符合预期。
 * 用法：node scripts/check-attach.mjs <文件> [baseUrl]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const file = process.argv[2];
const BASE = process.argv[3] || "http://127.0.0.1:3200";

if (!file) {
  console.error("用法：node scripts/check-attach.mjs <文件> [baseUrl]");
  process.exit(1);
}

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@medai.local", password: "Medai@2026" }),
});
if (!login.ok) {
  console.error(`登录失败 ${login.status}`);
  process.exit(1);
}
const cookie = (login.headers.getSetCookie?.() || [])
  .map((c) => c.split(";")[0])
  .join("; ");

const bytes = await readFile(file);
const fd = new FormData();
fd.append("file", new Blob([bytes]), path.basename(file));

const t0 = Date.now();
const res = await fetch(`${BASE}/api/upload/attachment`, {
  method: "POST",
  body: fd,
  headers: { cookie },
});
const body = await res.json();
const ms = Date.now() - t0;

if (!res.ok) {
  console.error(`✗ ${res.status} ${body.error}`);
  process.exit(1);
}

const a = body.attachment;
console.log(`文件：${a.filename}（${(a.sizeBytes / 1024).toFixed(1)} KB）`);
console.log(`类型：${a.kind}　耗时 ${ms}ms`);
console.log(`正文：${a.textLength} 字　hasText=${a.hasText}`);
console.log(`说明：${a.note}`);

// 让路由把正文吐回来方便核对：直接查一次原始记录
const raw = await fetch(`${BASE}/api/attachments/${a.id}/raw`, { headers: { cookie } });
console.log(`原文可读：${raw.status}`);

if (!a.hasText) {
  console.error("✗ 没提取到正文");
  process.exit(2);
}
console.log("✓ 解析成功");
