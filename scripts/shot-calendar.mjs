/**
 * 给问诊日历拍图：桌面 + 手机 + 聊天原文。
 *   node scripts/shot-calendar.mjs [baseUrl]
 * 产物在 docs/preview-visits-*.png
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3100";
const HOST = new URL(BASE).hostname;
const PORT = 9369;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  async shot(file) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    await writeFile(file, Buffer.from(data, "base64"));
    console.log("  →", file);
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

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@medai.local", password: "Medai@2026" }),
});
const raw = (login.headers.getSetCookie?.() || []).find((c) => c.startsWith("medai_session="));
const token = raw.split(";")[0].slice("medai_session=".length);
const cookie = `medai_session=${token}`;
const api = (p, init = {}) =>
  fetch(`${BASE}${p}`, { ...init, headers: { "content-type": "application/json", cookie, ...(init.headers || {}) } }).then((r) => r.json());

const { patients } = await api("/api/patients");
const patient = patients[0];

const profile = await mkdtemp(path.join(tmpdir(), "medai-shot-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--enable-unsafe-swiftshader", "--window-size=1440,980", "about:blank",
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
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
  await c.send("Page.navigate", { url: `${BASE}/patients/${patient.id}` });

  for (let i = 0; i < 60; i++) {
    if (await c.eval("Boolean(document.querySelector('.detail__tabs'))")) break;
    await sleep(300);
  }
  await c.eval(`(() => {
    const b = [...document.querySelectorAll('.detail__tab')].find((x) => x.textContent.includes('问诊记录'));
    b?.click();
  })()`);
  for (let i = 0; i < 40; i++) {
    if (await c.eval("Boolean(document.querySelector('.vcal'))")) break;
    await sleep(300);
  }
  await sleep(900);

  // 等样式真的应用上：刚重启的服务第一次访问时 CSS 还在路上，
  // 只等 DOM 会出现"骨架出来了但完全没样式"的截图
  for (let i = 0; i < 60; i++) {
    const styled = await c.eval(`(() => {
      const d = document.querySelector('.vcal__day');
      if (!d) return false;
      const cs = getComputedStyle(d);
      return cs.minHeight === '52px' && cs.display === 'flex';
    })()`);
    if (styled) break;
    await sleep(250);
  }
  await sleep(400);

  // 截当前视口：日历那块本来就是页面的一部分，硬裁反而会裁穿
  await c.eval("document.querySelector('.panel')?.scrollIntoView({ block: 'start' })");
  await sleep(500);
  await c.shot("docs/preview-visits-calendar.png");

  // 聊天原文
  await c.eval("document.querySelector('.vlogcard__open')?.click()");
  for (let i = 0; i < 40; i++) {
    if (await c.eval("Boolean(document.querySelector('.vread__card'))")) break;
    await sleep(300);
  }
  await sleep(1000);
  await c.shot("docs/preview-visits-log.png");
  await c.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(400);

  // 手机：日历在窄屏下的样子
  await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(900);
  await c.eval("document.querySelector('.panel')?.scrollIntoView({ block: 'start' })");
  await sleep(500);
  await c.shot("docs/preview-visits-mobile.png");

  // 手机上打开聊天原文
  await c.eval("document.querySelector('.vlogcard__open')?.click()");
  for (let i = 0; i < 40; i++) {
    if (await c.eval("Boolean(document.querySelector('.vread__card'))")) break;
    await sleep(300);
  }
  await sleep(900);
  await c.shot("docs/preview-visits-log-mobile.png");
} finally {
  chrome.kill();
}
