/**
 * 验证：吹过蒲公英后，从科普库返回主页不再重播开场。
 * 用法：node scripts/check-intro.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3100";
const PORT = 9334;
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
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true });
    return r.result?.value;
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

const login = async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "demo@medai.local", password: "Medai@2026" }),
  });
  const raw = (res.headers.getSetCookie?.() || []).find((c) => c.startsWith("medai_session="));
  return raw.split(";")[0].slice("medai_session=".length);
};

async function main() {
  const token = await login();
  const profile = await mkdtemp(path.join(tmpdir(), "medai-intro-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
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
    await c.send("Network.setCookie", {
      name: "medai_session",
      value: token,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
    });

    // 第一次进主页：开场应该在
    await c.send("Page.navigate", { url: BASE + "/" });
    await sleep(3500);
    const first = await c.eval(
      "({ bootHidden: document.querySelector('.boot')?.hidden === true, hasBtn: !!document.querySelector('.boot__skip') })",
    );
    console.log(`${first.hasBtn && !first.bootHidden ? "✓" : "✗"} 首次进入有开场动画`);

    // 吹散
    await c.eval("document.querySelector('.boot__skip')?.click()");
    await sleep(2500);
    const afterBlow = await c.eval(
      "({ bootHidden: document.querySelector('.boot')?.hidden === true, flag: sessionStorage.getItem('medai:intro') })",
    );
    console.log(`${afterBlow.bootHidden && afterBlow.flag === "1" ? "✓" : "✗"} 吹散后开场关闭并记住状态`);

    // 去科普库再回来
    await c.send("Page.navigate", { url: BASE + "/library" });
    await sleep(1800);
    await c.send("Page.navigate", { url: BASE + "/" });
    await sleep(3000);
    const back = await c.eval(
      "({ bootHidden: document.querySelector('.boot')?.hidden === true, ready: document.body.classList.contains('is-ready'), records: !!document.querySelector('.records') })",
    );
    console.log(`${back.bootHidden ? "✓" : "✗"} 返回主页不重播开场`);
    console.log(`${back.ready && back.records ? "✓" : "✗"} 草地与档案直接可见`);

    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error("失败：", e.message);
  process.exit(1);
});
