/**
 * 调面部补光强度：同一只兔子、同一个机位，拍几张不同 faceBase 的特写。
 *   node scripts/tune-face-light.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3200";
const HOST = new URL(BASE).hostname;
const PORT = 9371;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.join(process.cwd(), "docs", "tune");

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
  const profile = await mkdtemp(path.join(tmpdir(), "medai-light-"));
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
    await sleep(2800);

    // 鼠标压在兔子身上，正脸
    const box = await c.eval(`(() => {
      const a = window.__meadow.rabbitAnchor();
      return { cx: Math.round(a.cx), cy: Math.round(a.cy) };
    })()`);
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.cx, y: box.cy, button: "none" });
    await sleep(900);

    const clip = { x: box.cx - 175, y: box.cy - 150, width: 350, height: 300 };
    for (const base of [0, 1.4, 2.2, 3.0, 4.0]) {
      await c.eval(`window.__meadow.faceBase = ${base}`);
      await sleep(450);
      const { data } = await c.send("Page.captureScreenshot", {
        format: "png",
        clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 },
      });
      await writeFile(path.join(OUT, `face-${base}.png`), Buffer.from(data, "base64"));
      const lit = await c.eval(`(() => {
        const l = window.__meadow.faceLight;
        return l ? { i: +l.intensity.toFixed(3), x: +l.position.x.toFixed(2), y: +l.position.y.toFixed(2) } : null;
      })()`);
      console.log(`  faceBase=${base} → intensity=${lit?.i}`);
    }

    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error("失败：", e.message);
  process.exit(1);
});
