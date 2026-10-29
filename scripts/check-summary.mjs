/**
 * 验证「小结这次问诊」：接口给的是对象，前端要取 .summary，不能整个塞进字符串。
 *   node scripts/check-summary.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3100";
const HOST = new URL(BASE).hostname;
const PORT = 9363;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function ok(label, cond, extra = "") {
  if (!cond) failed++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}

async function waitPort(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome 调试端口没起来");
}

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@medai.local", password: "Medai@2026" }),
});
const raw = (loginRes.headers.getSetCookie?.() || []).find((c) => c.startsWith("medai_session="));
const token = raw.split(";")[0].slice("medai_session=".length);
const cookie = `medai_session=${token}`;
const api = (p, init = {}) =>
  fetch(`${BASE}${p}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers || {}) },
  }).then((r) => r.json());

const { patients } = await api("/api/patients");
const patient = patients[0];

const { consultation } = await api(`/api/patients/${patient.id}/consultations`, {
  method: "POST",
  body: JSON.stringify({}),
});
const cid = consultation.id;

// 造两句对话
for (const text of ["我最近右上腹隐痛", "饭后会加重，已经三天了"]) {
  await fetch(`${BASE}/api/consultations/${cid}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ content: text }),
  }).then((r) => r.text());
}

console.log("[1] 接口形状");
const res = await api(`/api/consultations/${cid}/summary`, { method: "POST" });
ok("summary 是字符串而不是对象", typeof res.summary === "string", typeof res.summary);
ok("带上了 id / updatedAt", Boolean(res.id && res.updatedAt), JSON.stringify({ id: res.id, at: res.updatedAt }));
ok("文字有内容", (res.summary || "").length > 10, (res.summary || "").slice(0, 40));

console.log("\n[2] 浏览器里显示");
const profile = await mkdtemp(path.join(tmpdir(), "medai-sum-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--enable-unsafe-swiftshader", "--window-size=1440,900", "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  await waitPort(`http://127.0.0.1:${PORT}/json/version`);
  const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  const c = new CDP(ws);
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Network.setCookie", { name: "medai_session", value: token, domain: HOST, path: "/", httpOnly: true });
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await c.send("Page.navigate", { url: `${BASE}/?debug=1` });

  for (let i = 0; i < 60; i++) {
    try {
      if (await c.eval("Boolean(window.__meadow && window.__meadow.ballRoot)")) break;
    } catch {}
    await sleep(500);
  }
  await c.eval("document.querySelector('.boot__skip')?.click()");
  await sleep(1800);
  await c.eval("document.querySelector('.record__btn')?.click()");
  for (let i = 0; i < 40; i++) {
    if (await c.eval("Boolean(document.querySelector('.consult__form'))")) break;
    await sleep(300);
  }
  await sleep(1600);

  // 等这一轮的工具按钮可用
  for (let i = 0; i < 40; i++) {
    const ready = await c.eval(`(() => {
      const b = [...document.querySelectorAll('.chip--tool')].find((x) => x.textContent.includes('小结'));
      return b ? !b.disabled : false;
    })()`);
    if (ready) break;
    await sleep(500);
  }

  await c.eval(`(() => {
    const b = [...document.querySelectorAll('.chip--tool')].find((x) => x.textContent.includes('小结'));
    b?.click();
  })()`);

  let note = null;
  for (let i = 0; i < 90; i++) {
    note = await c.eval(`(() => {
      const n = [...document.querySelectorAll('.consult__log .msg--note')].map((x) => x.textContent.trim());
      return n.find((t) => t.includes('这次的小结')) || null;
    })()`);
    if (note) break;
    await sleep(500);
  }
  ok("聊天里出现小结", Boolean(note), (note || "").slice(0, 60));
  ok("没有 [object Object]", !String(note).includes("object Object"), note);
  ok("小结有实际内容（>15 字）", (note || "").length > 15, `${(note || "").length} 字`);
} finally {
  chrome.kill();
}

await api(`/api/consultations/${cid}`, { method: "DELETE" });
console.log(`\n${failed === 0 ? "全部通过" : `${failed} 项失败`}\n`);
process.exit(failed === 0 ? 0 : 1);
