/**
 * 给知识库照图：科普库列表、疾病详情（含新增的检查与误区）、药品详情（含起效/漏服/储存）。
 *   node scripts/shot-kb.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3100";
const HOST = new URL(BASE).hostname;
const PORT = 9381;
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
  async shot(file, clip) {
    const { data } = await this.send("Page.captureScreenshot", {
      format: "png",
      // 段落可能在视口之外：不加这个开关，裁出来的就是一片空白
      ...(clip ? { clip: { ...clip, scale: 2 }, captureBeyondViewport: true } : {}),
    });
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
const token = (login.headers.getSetCookie?.() || [])
  .find((c) => c.startsWith("medai_session="))
  .split(";")[0]
  .slice("medai_session=".length);

const profile = await mkdtemp(path.join(tmpdir(), "medai-kb-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--enable-unsafe-swiftshader", "--window-size=1440,1000", "about:blank",
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
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const go = async (url, wait = 1400) => {
    await c.send("Page.navigate", { url });
    await sleep(wait);
  };

  // 1. 科普库列表：卡片上的科室插画
  await go(`${BASE}/library`, 2000);
  const deptCount = await c.eval("document.querySelectorAll('.kb__dept').length");
  const artCount = await c.eval("document.querySelectorAll('.kcard__art').length");
  console.log(`科室标签 ${deptCount} 个，卡片插画 ${artCount} 张`);
  await c.shot("docs/preview-kb-list.png");

  // 2. 疾病详情：头部插画 + 新增的「会做哪些检查」「流传很广但不对」
  await go(`${BASE}/library/psoriasis`, 1800);
  const secs = await c.eval("Array.from(document.querySelectorAll('.doc__h2')).map((h) => h.textContent.trim())");
  console.log("疾病详情小节：", JSON.stringify(secs));
  await c.shot("docs/preview-kb-disease.png");
  // captureScreenshot 的 clip 用的是「整页坐标」，别滚动后再裁 0 起点，会截到空白
  const mythBox = await c.eval(`(() => {
    const el = document.querySelector('.doc__sec--myth');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.left - 18), y: r.top + window.scrollY - 18, width: r.width + 36, height: r.height + 36 };
  })()`);
  if (mythBox) await c.shot("docs/preview-kb-myth.png", mythBox);
  else console.log("  ! 没找到误区小节");

  // 3. 药品详情：头部插画 + 起效/漏服/怎么存
  await c.eval("window.scrollTo(0, 0)");
  await go(`${BASE}/drugs/olopatadine`, 1800);
  const quick = await c.eval(`(() => {
    const el = document.querySelector('.doc__sec--quick');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.left - 18), y: r.top + window.scrollY - 18, width: r.width + 36, height: r.height + 36 };
  })()`);
  console.log("起效/漏服/储存卡片：", quick ? "有" : "没有");
  await c.shot("docs/preview-kb-drug.png");
  if (quick) await c.shot("docs/preview-kb-quick.png", quick);

  // 4. 新科室条目抽查
  for (const slug of ["chickenpox", "facial-palsy", "uterine-fibroids", "panic-disorder"]) {
    await go(`${BASE}/library/${slug}`, 900);
    const ok = await c.eval(`Boolean(document.querySelector('.doc__title'))`);
    console.log(`  /library/${slug} → ${ok ? "✓" : "✗"}`);
  }

  // 5. 手机宽度下卡片是否挤
  await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await go(`${BASE}/library`, 1600);
  await c.shot("docs/preview-kb-mobile.png");
} finally {
  chrome.kill();
}
