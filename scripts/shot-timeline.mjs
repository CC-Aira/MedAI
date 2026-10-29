/**
 * 给病程时间轴拍图：档案页里的时间轴、投影视图、手机版，外加首页的空木牌。
 *   node scripts/shot-timeline.mjs [baseUrl]
 * 产物在 docs/preview-timeline-*.png
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3100";
const HOST = new URL(BASE).hostname;
const PORT = 9371;
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
console.log(`档案：${patient.name}`);

const profile = await mkdtemp(path.join(tmpdir(), "medai-tl-"));
/** 为了截「空木牌」临时停用的药，收尾一定要打开回来 */
let stoppedMeds = [];
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
    const b = [...document.querySelectorAll('.detail__tab')].find((x) => x.textContent.includes('时间轴'));
    b?.click();
  })()`);
  for (let i = 0; i < 40; i++) {
    if (await c.eval("Boolean(document.querySelector('.tl__list'))")) break;
    await sleep(300);
  }
  // 等样式落地（刚启动的服务 CSS 可能还在路上）
  for (let i = 0; i < 60; i++) {
    const styled = await c.eval(`(() => {
      const el = document.querySelector('.tlev');
      if (!el) return false;
      return getComputedStyle(el).gridTemplateColumns.split(' ').length === 3;
    })()`);
    if (styled) break;
    await sleep(250);
  }
  await sleep(500);

  await c.eval("document.querySelector('.tl')?.scrollIntoView({ block: 'start' })");
  await sleep(500);
  await c.shot("docs/preview-timeline.png");

  // 投影视图：截图进 PPT 的那张
  await c.eval("document.querySelector('.tl__clean')?.click()");
  for (let i = 0; i < 40; i++) {
    if (await c.eval("Boolean(document.querySelector('.tlpaper'))")) break;
    await sleep(250);
  }
  await sleep(900);
  await c.shot("docs/preview-timeline-projection.png");

  // 内容比一屏长：缩到一屏，这才是真能一张图贴进 PPT 的版本
  if (await c.eval("Boolean(document.querySelector('.tlpaper__fit'))")) {
    await c.eval("document.querySelector('.tlpaper__fit')?.click()");
    await sleep(700);
    await c.shot("docs/preview-timeline-projection-fit.png");
  }

  await c.eval("document.querySelector('.tlpaper__close')?.click()");
  await sleep(400);

  // 手机
  await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(900);
  await c.eval("document.querySelector('.tl')?.scrollIntoView({ block: 'start' })");
  await sleep(500);
  await c.shot("docs/preview-timeline-mobile.png");

  // 首页：空木牌（把演示账号的用药全停用，截完还原）
  const { patients: all } = await api("/api/patients");
  const medsAll = [];
  for (const p of all) {
    const r = await api(`/api/patients/${p.id}`);
    for (const m of r.patient.medications) medsAll.push(m);
  }
  const wasActive = medsAll.filter((m) => m.isActive).map((m) => m.id);
  stoppedMeds = wasActive;
  for (const id of wasActive) {
    await api(`/api/medications/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) });
  }

  await c.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
  // 首页有「吹散蒲公英」开场：用 sessionStorage 直接跳过，
  // 比等按钮出现再点稳（场景没加载完时按钮还不在 DOM 里）
  await c.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "try{sessionStorage.setItem('medai:intro','1')}catch(e){}",
  });
  await c.send("Page.navigate", { url: `${BASE}/?debug=1` });
  for (let i = 0; i < 80; i++) {
    if (await c.eval("Boolean(window.__meadow)")) break;
    await sleep(300);
  }
  await sleep(2500);
  await c.eval(`(() => {
    const m = window.__meadow;
    if (!m) return false;
    const a = m.signAnchor();
    return Boolean(a);
  })()`);
  await sleep(800);
  await c.shot("docs/preview-signboard-empty.png");

  // 点木牌，看空态说明卡
  const anchor = await c.eval(`(() => {
    const m = window.__meadow;
    const a = m?.signAnchor?.();
    return a ? { x: Math.round(a.cx), y: Math.round(a.cy) } : null;
  })()`);
  if (anchor) {
    await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: anchor.x, y: anchor.y, button: "left", clickCount: 1 });
    await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: anchor.x, y: anchor.y, button: "left", clickCount: 1 });
    await sleep(900);
    await c.shot("docs/preview-signboard-empty-card.png");
  } else {
    console.log("  ! 拿不到木牌坐标，跳过空牌卡片截图");
  }

  for (const id of wasActive) {
    await api(`/api/medications/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: true }) });
  }
  stoppedMeds = [];
  console.log(`  已还原 ${wasActive.length} 条用药的在服状态`);
} finally {
  chrome.kill();
  // 脚本中途抛错也要把药打开回来，否则首页木牌会一直空着
  for (const id of stoppedMeds) {
    await api(`/api/medications/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: true }) }).catch(() => {});
  }
}
