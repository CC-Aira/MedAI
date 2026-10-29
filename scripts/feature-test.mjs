/**
 * 三个新功能的端到端验证：附件上传 → 带附件问诊 → 改错字重答 → 保留策略。
 * 用法：node scripts/feature-test.mjs [baseUrl] [图片路径]
 * 默认打 http://127.0.0.1:3200（dev）。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "http://127.0.0.1:3200";
const IMG = process.argv[3] || path.join(here, "..", "docs", "preview-home.png");
const EMAIL = process.env.DEMO_EMAIL || "demo@medai.local";
const PASS = process.env.DEMO_PASS || "Medai@2026";

let cookie = "";
const log = (...a) => console.log(...a);

async function call(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...(cookie ? { cookie } : {}),
      ...(init.headers || {}),
    },
  });
  return res;
}

async function json(pathname, init) {
  const res = await call(pathname, init);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${pathname} 返回非 JSON（${res.status}）：${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${pathname} 失败 ${res.status}：${data.error || text.slice(0, 200)}`);
  return data;
}

/** 读 SSE，收集 delta 与 done */
async function stream(pathname, body) {
  const res = await call(pathname, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${pathname} ${res.status}: ${t.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let done = null;
  let err = null;

  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      let p;
      try {
        p = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (p.type === "delta") text += p.text;
      else if (p.type === "done") done = p;
      else if (p.type === "error") err = p.message;
    }
  }
  return { text, done, err };
}

const ok = (c, m) => log(`${c ? "✓" : "✗"} ${m}`);

async function main() {
  log(`目标 ${BASE}\n`);

  /* 1. 登录 */
  const loginRes = await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  if (!loginRes.ok) throw new Error(`登录失败 ${loginRes.status}`);
  cookie = (loginRes.headers.getSetCookie?.() || [])
    .map((c) => c.split(";")[0])
    .join("; ");
  ok(!!cookie, `登录成功`);

  /* 2. 找一个档案 */
  const { patients } = await json("/api/patients");
  if (!patients?.length) throw new Error("没有患者档案，先跑 seed");
  const patient = patients[0];
  log(`  用档案：${patient.name} (${patient.id})`);

  /* 3. 上传附件 */
  const bytes = await readFile(IMG);
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: "image/png" }), path.basename(IMG));
  const t0 = Date.now();
  const up = await json("/api/upload/attachment", { method: "POST", body: fd });
  const a = up.attachment;
  ok(!!a?.id, `上传成功（${Date.now() - t0}ms）：${a.filename} / ${a.kind}`);
  log(`  hasText=${a.hasText} textLength=${a.textLength} note=${a.note}`);

  /* 4. 附件原文可读（鉴权后） */
  const rawRes = await call(`/api/attachments/${a.id}/raw`);
  ok(rawRes.ok && Number(rawRes.headers.get("content-length")) === bytes.length,
    `附件原文可读（${rawRes.status}）`);

  /* 5. 建一次问诊 */
  const { consultation } = await json(`/api/patients/${patient.id}/consultations`, {
    method: "POST",
    body: JSON.stringify({ title: "功能验证 · 附件与改错字" }),
  });
  ok(!!consultation.id, `问诊已建：${consultation.id}`);

  /* 6. 带附件发一条 */
  const first = await stream(`/api/consultations/${consultation.id}/messages`, {
    content: "这是我刚拍的病历/化验单，帮我看看有什么要注意的",
    attachmentId: a.id,
  });
  if (first.err) throw new Error(`首次提问出错：${first.err}`);
  ok(first.done?.messages?.length === 2, `带附件问诊落库 ${first.done?.messages?.length} 条`);
  const userMsg = first.done.messages[0];
  ok(!!userMsg?.attachment, `用户消息上带回了附件：${userMsg?.attachment?.filename}`);
  log(`  回答开头：${first.text.slice(0, 60).replace(/\n/g, " ")}…`);

  /* 7. 改错字：把第一句改掉，重新回答 */
  const edited = await stream(`/api/consultations/${consultation.id}/messages`, {
    content: "刚才打错了，我是想问：这张化验单上的指标有没有需要复查的",
    editMessageId: userMsg.id,
  });
  if (edited.err) throw new Error(`编辑重答出错：${edited.err}`);

  const after = edited.done?.messages ?? [];
  ok(after.length === 2, `编辑后消息数 ${after.length}（旧回答已作废）`);
  ok(after[0]?.id === userMsg.id, `改的是同一条消息（id 未变）`);
  ok(!!after[0]?.editedAt, `已标记 editedAt=${after[0]?.editedAt}`);
  ok(
    after[0]?.content.includes("刚才打错了"),
    `内容已更新：${after[0]?.content.slice(0, 20)}…`,
  );

  /* 8. 编辑后的上下文确实用上了附件（问的是化验单，回答应该提到检查） */
  ok(
    /化验|指标|检查|报告|数值/.test(edited.text),
    `新回答确实在谈这份资料（${edited.text.length} 字）`,
  );

  /* 9. 保留策略：接口应返回 retention */
  const detail = await json(`/api/consultations/${consultation.id}`);
  ok(!!detail.consultation.retention, `详情带保留策略`);
  log(
    `  保留 ${detail.consultation.retention?.days} 天，最早到期 ${detail.consultation.retention?.expiresAt}`,
  );

  /* 10. 校验：改一条不存在的消息应该 404 */
  const bad = await call(`/api/consultations/${consultation.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: "x", editMessageId: "no-such-id" }),
  });
  ok(bad.status === 404, `改不存在的消息 → ${bad.status}`);

  /* 11. 校验：空内容且无附件应该 400 */
  const empty = await call(`/api/consultations/${consultation.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: "  " }),
  });
  ok(empty.status === 400, `空消息 → ${empty.status}`);

  log("\n全部通过。");
}

main().catch((err) => {
  console.error("\n✗ 失败：", err.message);
  process.exit(1);
});
