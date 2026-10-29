/**
 * 用无头 Chrome + CDP 给知识库页面截图（需要先启动 3100 服务）。
 * 用法：node scripts/shot.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3100";
const PORT = 9333;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.join(process.cwd(), "docs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method) {
        this.events.push(m);
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
}

async function waitPort(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome 调试端口没起来");
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "demo@medai.local", password: "Medai@2026" }),
  });
  if (!res.ok) throw new Error(`登录失败 ${res.status}`);
  const raw = (res.headers.getSetCookie?.() || []).find((c) => c.startsWith("medai_session="));
  if (!raw) throw new Error("没拿到 medai_session");
  return raw.split(";")[0].slice("medai_session=".length);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const token = await login();
  console.log("登录成功，开始截图");

  const profile = await mkdtemp(path.join(tmpdir(), "medai-shot-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--enable-unsafe-swiftshader",
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    await waitPort(`http://127.0.0.1:${PORT}/json/version`);

    const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, {
      method: "PUT",
    }).then((r) => r.json());

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });
    const c = new CDP(ws);

    await c.send("Page.enable");
    await c.send("Network.enable");
    await c.send("Runtime.enable");
    await c.send("Network.setCookie", {
      name: "medai_session",
      value: token,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
    });

    const shots = [
      { file: "preview-knowledge-home.png", url: "/", w: 1440, h: 900, skipIntro: true },
      { file: "preview-library.png", url: "/library", w: 1440, h: 900, maxH: 1350 },
      { file: "preview-disease.png", url: "/library/hypertension", w: 1200, h: 900 },
      { file: "preview-drugs.png", url: "/drugs", w: 1440, h: 900, maxH: 1350 },
      { file: "preview-drug-detail.png", url: "/drugs/ibuprofen", w: 1200, h: 900 },
      { file: "preview-library-mobile.png", url: "/library", w: 390, h: 844, mobile: true, maxH: 1100 },
    ];

    for (const s of shots) {
      await c.send("Emulation.setDeviceMetricsOverride", {
        width: s.w,
        height: s.h,
        deviceScaleFactor: 1,
        mobile: !!s.mobile,
      });
      await c.send("Page.navigate", { url: `${BASE}${s.url}` });
      await sleep(s.url === "/" ? 3800 : 1800);

      if (s.skipIntro) {
        await c.send("Runtime.evaluate", {
          expression: "document.querySelector('.boot__skip')?.click()",
        });
        await sleep(2600);
      }

      const { cssContentSize } = await c.send("Page.getLayoutMetrics");
      const height = Math.min(cssContentSize.height, s.maxH || 6000);
      const { data } = await c.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: s.w, height, scale: 1 },
      });
      const file = path.join(OUT, s.file);
      await writeFile(file, Buffer.from(data, "base64"));
      console.log(`  ${s.file}  ${s.w}×${Math.round(height)}`);
    }

    ws.close();
  } finally {
    chrome.kill();
  }
  console.log("完成");
}

main().catch((e) => {
  console.error("截图失败：", e.message);
  process.exit(1);
});
