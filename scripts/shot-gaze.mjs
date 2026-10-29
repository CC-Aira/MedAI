/**
 * 注视核对：把兔子那只脸的局部截图出来，看它是不是真的在看鼠标。
 *   node scripts/shot-gaze.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3100";
const HOST = new URL(BASE).hostname;
const PORT = 9367;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.join(process.cwd(), "docs");

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
}

async function waitPort(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
    await sleep(250);
  }
  throw new Error("Chrome 端口没起来");
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "demo@medai.local", password: "Medai@2026" }),
  });
  const raw = (res.headers.getSetCookie?.() || []).find((c) => c.startsWith("medai_session="));
  return raw.split(";")[0].slice("medai_session=".length);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const token = await login();
  const profile = await mkdtemp(path.join(tmpdir(), "medai-gaze-"));
  const chrome = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--enable-unsafe-swiftshader", "--window-size=1440,900", "about:blank",
  ], { stdio: "ignore" });

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
    await c.send("Network.enable");
    await c.send("Runtime.enable");
    await c.send("Network.setCookie", { name: "medai_session", value: token, domain: HOST, path: "/", httpOnly: true });
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await c.send("Page.navigate", { url: `${BASE}/?debug=1` });

    for (let i = 0; i < 60; i++) {
      try { if (await c.eval("Boolean(window.__meadow && window.__meadow.ballRoot)")) break; } catch {}
      await sleep(500);
    }
    await c.eval("document.querySelector('.boot__skip')?.click()");
    await sleep(2600);

    const box = await c.eval(`(() => {
      const a = window.__meadow.rabbitAnchor();
      return { x: Math.round(a.cx - 170), y: Math.round(a.cy - 190), w: 360, h: 340, cx: Math.round(a.cx), cy: Math.round(a.cy) };
    })()`);

    const shot = async (file, clip) => {
      const { x, y, w, h } = clip;
      const { data } = await c.send("Page.captureScreenshot", {
        format: "png",
        clip: { x, y, width: w, height: h, scale: 1 },
      });
      await writeFile(path.join(OUT, file), Buffer.from(data, "base64"));
      console.log(`  ${file}`);
    };

    const cases = [
      { file: "gaze-left.png", x: 40, y: 450, label: "鼠标在最左" },
      { file: "gaze-center.png", x: 720, y: 450, label: "鼠标在屏幕中间" },
      { file: "gaze-on.png", x: box.cx, y: box.cy, label: "鼠标在兔子身上" },
      { file: "gaze-right.png", x: 1430, y: 450, label: "鼠标在最右" },
    ];

    for (const k of cases) {
      await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: k.x, y: k.y, button: "none" });
      await sleep(900);
      const yaw = await c.eval("window.__meadow.eyeAim.yaw");
      console.log(`  ${k.label} → yaw=${yaw.toFixed(3)}`);
      await shot(k.file, box);
    }

    // 跳起来的一帧
    await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.cx, y: box.cy, button: "left", clickCount: 1 });
    await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.cx, y: box.cy, button: "left", clickCount: 1 });
    await sleep(210);
    await shot("gaze-hop.png", { x: box.x, y: box.y - 60, w: box.w, h: box.h + 60 });

    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error("失败：", e.message);
  process.exit(1);
});
