/**
 * 端到端：在界面上发一句话 → 真模型回答 → 气泡里出现「摘要 + 鼓励」。
 *   node scripts/check-bubble-ai.mjs [baseUrl]
 *
 * 会真实调用一次模型（需要 .env 里的 Key 可用）。
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3100";
const HOST = new URL(BASE).hostname;
const PORT = 9361;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const QUESTION = "我这两天右边太阳穴一跳一跳地疼，熬夜后更明显，需要担心吗？";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `  ← ${extra}` : ""}`); }
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method === "Runtime.exceptionThrown") {
        this.errors.push(m.params.exceptionDetails?.text || "exception");
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
  return raw.split(";")[0].slice("medai_session=".length);
}

const BUBBLE = `(() => {
  const el = document.querySelector('.rbubble');
  return {
    tone: el?.dataset.tone || null,
    hasTag: Boolean(document.querySelector('.rbubble__tag')),
    text: document.querySelector('.rbubble__text')?.textContent || '',
    tail: document.querySelector('.rbubble__tail')?.textContent || '',
    on: el?.classList.contains('is-on') || false,
    away: el?.dataset.away || '0',
  };
})()`;

async function main() {
  const token = await login();
  const profile = await mkdtemp(path.join(tmpdir(), "medai-bubble-ai-"));
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
    await c.send("Page.navigate", { url: `${BASE}/` });

    for (let i = 0; i < 60; i++) {
      try { if (await c.eval("Boolean(window.__meadow && window.__meadow.ballRoot)")) break; } catch {}
      await sleep(500);
    }
    await c.eval("document.querySelector('.boot__skip')?.click()");
    await sleep(2400);

    // 打开第一份档案
    await c.eval("document.querySelector('.record__btn')?.click()");
    await sleep(3200);

    const inputReady = await c.eval("Boolean(document.querySelector('.consult__input:not([disabled])'))");
    ok("输入框可用", inputReady);

    // 填字（React 受控组件要走原生 setter）
    await c.eval(`(() => {
      const el = document.querySelector('.consult__input');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, ${JSON.stringify(QUESTION)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    })()`);
    await sleep(300);
    await c.eval("document.querySelector('.consult__send')?.click()");

    // 思考语应当立刻出现并常驻
    let thinking = null;
    for (let i = 0; i < 30; i++) {
      const b = await c.eval(BUBBLE);
      if (b.text.includes("我看看")) { thinking = b; break; }
      await sleep(100);
    }
    ok("发送后气泡先说「我看看」", Boolean(thinking), JSON.stringify(thinking));
    ok("思考语是常驻的", Boolean(thinking) && thinking.on, JSON.stringify(thinking));

    // 等模型回答落进气泡
    console.log("  等模型回答…");
    let reply = null;
    for (let i = 0; i < 180; i++) {
      const b = await c.eval(BUBBLE);
      if (b.tone === "reply" && b.tail && !b.text.includes("我看看")) { reply = b; break; }
      await sleep(500);
    }
    ok("回答落进了气泡", Boolean(reply), JSON.stringify(reply));
    if (reply) {
      console.log(`    气泡内容：${reply.text}`);
      console.log(`    鼓励话术：${reply.tail}`);
      ok("是回复语气", reply.tone === "reply", reply.tone);
      ok("摘要长度合理(8~50字)", reply.text.length >= 8 && reply.text.length <= 50, `${reply.text.length} 字`);
      ok("带了鼓励话术", reply.tail.length > 3, reply.tail);
      ok("气泡上没有标签", reply.hasTag === false);
      ok("气泡可见", reply.on && reply.away === "0");
    }

    // 左侧对话里仍然有完整回答
    const chatLen = await c.eval(`(() => {
      const list = [...document.querySelectorAll('.msg--bot')].map((n) => n.textContent || '');
      return list.length ? list[list.length - 1].length : 0;
    })()`);
    ok("左侧对话保留了完整回答(>80字)", chatLen > 80, `${chatLen} 字`);

    const noisy = c.errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
    ok("没有 JS 报错", noisy.length === 0, noisy.slice(0, 2).join(" | "));

    ws.close();
  } finally {
    chrome.kill();
  }

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("\n失败：", e.message);
  process.exit(1);
});
