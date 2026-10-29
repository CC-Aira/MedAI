/**
 * 登录方式自检：只有「邮箱 + 密码」一条路。
 *
 * 手机号验证码登录已下线，这个脚本保证它不会以任何形式回来：
 * - 登录页没有切换登录方式的控件、没有手机号输入
 * - /api/auth/sms/* 已经不存在（404）
 * - 邮箱登录可用，右上角显示的是邮箱
 *
 *   node scripts/check-login.mjs http://127.0.0.1:3100
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3100";
const PORT = 9511;
const HEADER = { "content-type": "application/json" };
const EMAIL = "demo@medai.local";
const PASSWORD = "Medai@2026";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? `  ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}  ${detail}`);
  }
};

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

async function main() {
  /* ---------------- 1. 接口层面：短信登录接口已下线 ---------------- */
  console.log("\n[1] 短信登录接口");
  for (const [name, route, body] of [
    ["发码接口", "/api/auth/sms/send", { phone: "13800138000" }],
    ["登录接口", "/api/auth/sms/login", { phone: "13800138000", code: "000000" }],
  ]) {
    const res = await fetch(`${BASE}${route}`, {
      method: "POST",
      headers: HEADER,
      body: JSON.stringify(body),
    }).catch((err) => ({ status: -1, statusText: String(err) }));
    ok(`${name} 已不存在（404）`, res.status === 404, `HTTP ${res.status}`);
  }

  /* ---------------- 2. 邮箱登录仍然可用 ---------------- */
  console.log("\n[2] 邮箱登录");
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: HEADER,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  ok("邮箱密码登录成功", loginRes.status === 200, `HTTP ${loginRes.status}`);
  ok(
    "返回里只有邮箱，没有手机号字段",
    Boolean(loginBody.user?.email) && !("phone" in (loginBody.user || {})),
    JSON.stringify(loginBody.user),
  );
  const raw = (loginRes.headers.getSetCookie?.() || []).find((c) =>
    c.startsWith("medai_session="),
  );
  ok("下发了会话 Cookie", Boolean(raw));
  const token = raw ? raw.split(";")[0].slice("medai_session=".length) : "";

  const bad = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: HEADER,
    body: JSON.stringify({ email: EMAIL, password: "wrong-password" }),
  });
  ok("密码错时登录失败", bad.status >= 400, `HTTP ${bad.status}`);

  /* ---------------- 3. 登录页：只有一套表单 ---------------- */
  console.log("\n[3] 登录页");
  const profile = await mkdtemp(path.join(tmpdir(), "mli-"));
  const chrome = spawn(
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--enable-unsafe-swiftshader",
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    for (let i = 0; i < 80; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (r.ok) break;
      } catch {
        /* 还没起来 */
      }
      await sleep(250);
    }
    const target = await fetch(
      `http://127.0.0.1:${PORT}/json/new?about:blank`,
      { method: "PUT" },
    ).then((r) => r.json());
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });
    const c = new CDP(ws);
    await c.send("Page.enable");
    await c.send("Network.enable");
    await c.send("Runtime.enable");
    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await c.send("Page.navigate", { url: `${BASE}/login` });
    await sleep(2600);

    const page = await c.eval(`(() => ({
      methods: [...document.querySelectorAll(".auth__method")].map((b) => b.textContent.trim()),
      tabs: [...document.querySelectorAll(".auth__tab")].map((b) => b.textContent.trim()),
      tel: Boolean(document.querySelector('input[type=tel]')),
      code: Boolean(document.querySelector("#sms-code")),
      email: Boolean(document.querySelector('input[type=email]')),
      password: Boolean(document.querySelector('input[type=password]')),
      hint: Boolean(document.querySelector(".auth__hint")),
      send: Boolean(document.querySelector(".field__send")),
    }))()`);

    ok("没有「登录方式」切换控件", page.methods.length === 0, JSON.stringify(page.methods));
    ok("没有手机号输入框", page.tel === false);
    ok("没有验证码输入框", page.code === false);
    ok("没有「获取验证码」按钮", page.send === false);
    ok("没有演示验证码提示", page.hint === false);
    ok("仍有邮箱和密码输入", page.email && page.password);
    ok("仍有「登录 / 注册」切换", page.tabs.join("/") === "登录/注册", page.tabs.join("/"));

    /* ---------------- 4. 浏览器里真的能登进去 ---------------- */
    console.log("\n[4] 界面登录");
    await c.eval(`(() => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const e = document.querySelector("input[type=email]");
      set.call(e, ${JSON.stringify(EMAIL)});
      e.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await sleep(200);
    await c.eval(`(() => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const p = document.querySelector("input[type=password]");
      set.call(p, ${JSON.stringify(PASSWORD)});
      p.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await sleep(200);
    await c.eval(`document.querySelector(".auth__submit")?.click()`);

    let landed = "";
    for (let i = 0; i < 50; i++) {
      await sleep(300);
      landed = await c.eval("location.pathname");
      if (landed === "/") break;
    }
    ok("登录后进入首页", landed === "/", landed);

    // 右上角有多个带 title 的按钮（音效开关的 title 是「风声」），只取退出登录那个
    const title = await c.eval(
      `[...document.querySelectorAll(".hud__actions button[title]")]
        .map((b) => b.title).find((t) => t.includes("退出登录")) || ""`,
    );
    ok("右上角显示的是邮箱", title.includes(EMAIL), title);
    ok("没有显示打码手机号", !/1\d{2}\*{4}\d{4}/.test(title), title);

    /* ---------------- 5. 会话可用 ---------------- */
    console.log("\n[5] 会话");
    const me = await fetch(`${BASE}/api/patients`, {
      headers: { cookie: `medai_session=${token}` },
    });
    ok("带 Cookie 能访问受保护接口", me.status === 200, `HTTP ${me.status}`);

    const anon = await fetch(`${BASE}/api/patients`);
    ok("不带 Cookie 访问被拒", anon.status === 401, `HTTP ${anon.status}`);

    ws.close();
  } finally {
    chrome.kill();
  }

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("\n自检失败：", err.message);
  process.exit(1);
});
