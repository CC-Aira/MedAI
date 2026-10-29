/**
 * 入口自检：评委 / 陌生人拿到链接后的头两步不能掉链子。
 *
 *   1. 打错地址 → 中文 404，不是 Next 的英文默认页，而且有出口
 *   2. 登录页有「用演示账号进去」，点一下真的进了草地（走的是正常登录接口）
 *
 * 用法：node scripts/check-entry.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3100";
const PORT = 9377;
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
  /* ---------------- 1. 404 ---------------- */
  console.log("\n[1] 打错地址");
  const html = await fetch(`${BASE}/no-such-page-${Date.now()}`).then((r) => r.text());
  ok("HTTP 里带中文 404 文案", html.includes("走错了一块草地"));
  ok("没有 Next 的英文默认 404", !html.includes("This page could not be found"));
  ok("给了「回到草地」的出口", html.includes("回到草地"));

  /* ---------------- 2. 登录页的演示入口 ---------------- */
  console.log("\n[2] 演示入口");
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
    await c.send("Runtime.enable");
    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await c.send("Page.navigate", { url: `${BASE}/login` });
    await sleep(2200);

    const hasBtn = await c.eval(`Boolean(document.querySelector(".auth__demo"))`);
    ok("登录页有演示入口", hasBtn);

    if (hasBtn) {
      const label = await c.eval(`document.querySelector(".auth__demo b").textContent.trim()`);
      ok("按钮文案说清楚是干什么的", label.includes("演示账号"), label);

      await c.eval(`document.querySelector(".auth__demo").click()`);
      let landed = "";
      for (let i = 0; i < 60; i++) {
        await sleep(300);
        landed = await c.eval("location.pathname");
        if (landed === "/") break;
      }
      ok("点一下直接进草地", landed === "/", landed);

      // 草地本体：档案栏有名字，说明真的取到了数据
      const names = await c.eval(
        `[...document.querySelectorAll(".record__name")].map((e) => e.textContent.trim())`,
      );
      ok("草地上有档案（演示数据齐）", Array.isArray(names) && names.length > 0, `${names?.length || 0} 份`);

      const err = await c.eval(`document.querySelector(".auth__error")?.textContent || ""`);
      ok("没有报错提示", err === "", err);
    }
  } finally {
    chrome.kill();
  }

  console.log(`\n${fail === 0 ? "全部通过" : "有失败项"}：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
