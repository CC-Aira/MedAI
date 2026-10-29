/**
 * 主页（有 3D 兔子）截图：站立态 + 趴在面板沿上两种，用来核对气泡位置。
 * 用法：node scripts/shot-home.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3100";
const HOST = new URL(BASE).hostname;
const PORT = 9341;
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
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
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
  const raw = (res.headers.getSetCookie?.() || []).find((c) =>
    c.startsWith("medai_session="),
  );
  if (!raw) throw new Error("没拿到 medai_session");
  return raw.split(";")[0].slice("medai_session=".length);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const token = await login();

  const profile = await mkdtemp(path.join(tmpdir(), "medai-home-"));
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
      domain: HOST,
      path: "/",
      httpOnly: true,
    });

    const shot = async (file) => {
      const vp = await c.eval("({ w: innerWidth, h: innerHeight })");
      const { data } = await c.send("Page.captureScreenshot", {
        format: "png",
        clip: { x: 0, y: 0, width: vp.w, height: vp.h, scale: 1 },
      });
      await writeFile(path.join(OUT, file), Buffer.from(data, "base64"));
      console.log(`  ${file}`);
    };

    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await c.send("Page.navigate", { url: `${BASE}/?debug=1` });
    await sleep(3600);
    await c.eval("document.querySelector('.boot__skip')?.click()");
    // 开发模式编译慢，等 3D 场景真的挂上
    await sleep(3000);
    for (let i = 0; i < 40; i++) {
      const ok = await c.eval("Boolean(window.__meadow && window.__meadow.ballRoot)");
      if (ok) break;
      await sleep(500);
    }
    await sleep(1600);

    // 站立态：量一下兔子的屏幕位置和气泡位置
    const standing = await c.eval(`(() => {
      const m = window.__meadow;
      if (!m) return { err: "no __meadow" };
      const a = m.rabbitAnchor();
      const b = document.querySelector('.rbubble')?.getBoundingClientRect();
      return {
        anchor: { x: Math.round(a.x), y: Math.round(a.y), cx: Math.round(a.cx), rx: Math.round(a.rx), ry: Math.round(a.ry) },
        bubble: b && { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) },
        side: document.querySelector('.rbubble')?.dataset.side,
        text: document.querySelector('.rbubble__text')?.textContent,
        opacity: getComputedStyle(document.querySelector('.rbubble')).opacity,
      };
    })()`);
    console.log("站立态", JSON.stringify(standing));
    await shot("preview-rabbit-home.png");

    // 打开第一份档案 → 兔子趴到面板沿
    await c.eval(
      `document.querySelector('.record__btn')?.click()`,
    );
    await sleep(3200);
    const perched = await c.eval(`(() => {
      const m = window.__meadow;
      const a = m.rabbitAnchor();
      const b = document.querySelector('.rbubble')?.getBoundingClientRect();
      return {
        anchor: { x: Math.round(a.x), y: Math.round(a.y), cx: Math.round(a.cx), rx: Math.round(a.rx), ry: Math.round(a.ry), perched: a.perched },
        bubble: b && { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) },
        side: document.querySelector('.rbubble')?.dataset.side,
        text: document.querySelector('.rbubble__text')?.textContent,
        opacity: getComputedStyle(document.querySelector('.rbubble')).opacity,
        panel: (() => { const r = document.querySelector('.consult')?.getBoundingClientRect(); return r && { top: Math.round(r.top), right: Math.round(r.right), w: Math.round(r.width) }; })(),
        topbar: (() => { const r = document.querySelector('.hud')?.getBoundingClientRect(); return r && Math.round(r.bottom); })(),
      };
    })()`);
    console.log("趴框态", JSON.stringify(perched));
    await shot("preview-rabbit-bubble-perched.png");

    // 模拟问诊回复落进气泡
    await c.eval(`window.medaiRabbit.reply("从描述看，右侧上颌部疼三天、吃饭加重，更像牙源性感染，先温盐水漱口、避免过冷过热，48 小时不好转要看口腔科。")`);
    await sleep(900);
    const reply = await c.eval(`(() => {
      const b = document.querySelector('.rbubble__box')?.getBoundingClientRect();
      return { text: document.querySelector('.rbubble__text')?.textContent, tail: document.querySelector('.rbubble__tail')?.textContent,
        rect: b && { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } };
    })()`);
    console.log("回复态", JSON.stringify(reply));
    await shot("preview-rabbit-bubble.png");

    // 移动端：重新加载，走真实的手机流程（草地态 + 问诊态各一张）
    await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await c.send("Page.navigate", { url: `${BASE}/?debug=1` });
    for (let i = 0; i < 60; i++) {
      try {
        if (await c.eval("Boolean(window.__meadow && window.__meadow.ballRoot)")) break;
      } catch {}
      await sleep(500);
    }
    await c.eval("document.querySelector('.boot__skip')?.click()");
    await sleep(2800);
    await c.eval(`window.medaiRabbit.say("记得喝水呀，别让嗓子一直干着。", { tone: "care" })`);
    await sleep(900);
    await shot("preview-rabbit-bubble-mobile.png");

    await c.eval("document.querySelector('.record__btn')?.click()");
    await sleep(3600);
    await shot("preview-rabbit-mobile-consult.png");

    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error("失败：", e.message);
  process.exit(1);
});
