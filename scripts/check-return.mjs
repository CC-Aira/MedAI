/**
 * 开场文案 + 从科普库/药品库返回 的自检。
 *
 *   node scripts/check-return.mjs http://localhost:3000
 *
 * 覆盖：
 *  - 开场按钮没有 click 键帽、文案是中文、尺寸合理
 *  - 疾病 / 药品页的返回入口写的是「回到小兔子」
 *  - 从这两个页面返回时，蒲公英开场一次都不出现（hydration 之前也不能闪）
 *  - 返回后的第一句是「回来啦」类，不是重新做一遍自我介绍
 *  - 站点标题里不再有「毛绒小球医生」
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3100";
const PORT = 9451;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function ok(name, cond, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? `  ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}  ${detail}`);
  }
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.p = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.p.has(m.id)) {
        const { res, rej } = this.p.get(m.id);
        this.p.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.p.set(id, { res, rej });
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

const res = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@medai.local", password: "Medai@2026" }),
});
const raw = (res.headers.getSetCookie?.() || []).find((c) =>
  c.startsWith("medai_session="),
);
const token = raw.split(";")[0].slice("medai_session=".length);

const profile = await mkdtemp(path.join(tmpdir(), "mret-"));
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

const waitScene = async (c) => {
  for (let i = 0; i < 60; i++) {
    try {
      if (await c.eval("Boolean(window.__meadow && window.__meadow.ballRoot)")) return true;
    } catch {}
    await sleep(500);
  }
  return false;
};

try {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) break;
    } catch {}
    await sleep(250);
  }
  const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, {
    method: "PUT",
  }).then((r) => r.json());
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res2, rej) => {
    ws.addEventListener("open", res2, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  const c = new CDP(ws);
  await c.send("Page.enable");
  await c.send("Network.enable");
  await c.send("Runtime.enable");
  await c.send("Network.setCookie", {
    name: "medai_session",
    value: token,
    url: BASE,
    path: "/",
    httpOnly: true,
  });
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  /* ---------------- 1. 开场按钮文案 ---------------- */
  console.log("\n[1] 开场按钮");
  // 生产包只在带 ?debug=1 时把 window.__meadow 挂出来（方便线上排查），
  // 所以首屏加了参数；后面的返回流程仍然走不带参数的普通路径。
  await c.send("Page.navigate", { url: `${BASE}/?debug=1` });
  ok("3D 场景就绪", await waitScene(c));
  await sleep(1600);

  const boot = await c.eval(`(() => {
    const b = document.querySelector('.boot__blow');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {
      text: b.textContent.trim(),
      hasKbd: Boolean(b.querySelector('kbd')),
      w: Math.round(r.width),
      h: Math.round(r.height),
      center: Math.round(r.left + r.width / 2),
      vw: innerWidth,
      skip: document.querySelector('.boot__skip')?.textContent.trim() || '',
      seeds: document.querySelectorAll('.dandelion__seeds .seed.is-on').length,
    };
  })()`);
  ok("按钮还在", Boolean(boot), JSON.stringify(boot));
  ok("按钮里没有 click 键帽", boot.hasKbd === false);
  ok("按钮文案是中文", /[\u4e00-\u9fa5]/.test(boot.text) && !/click/i.test(boot.text), boot.text);
  ok("按钮水平居中", Math.abs(boot.center - boot.vw / 2) <= 2, `center=${boot.center} vw=${boot.vw}`);
  ok("按钮高度正常（不塌）", boot.h >= 40 && boot.w >= 140, `${boot.w}×${boot.h}`);
  ok("跳过入口也是中文", /[\u4e00-\u9fa5]/.test(boot.skip), boot.skip);
  ok("蒲公英的种子画出来了", boot.seeds >= 80, `${boot.seeds} 颗`);

  const title = await c.eval("document.title");
  ok("站点标题不再叫「毛绒小球医生」", !/毛绒|绒球|小球/.test(title), title);

  /* ---------------- 2. 吹散后进疾病页 ---------------- */
  console.log("\n[2] 去疾病科普再回来");
  await c.eval("document.querySelector('.boot__blow')?.click()");
  await sleep(2400);
  await c.eval(`document.querySelector('a.portal__item[href="/library"]')?.click()`);
  await sleep(2400);
  ok("已进入疾病科普", (await c.eval("location.pathname")) === "/library");

  const backLabel = await c.eval(
    "document.querySelector('.sheetwrap__back')?.textContent.trim() || ''",
  );
  ok("返回入口写的是「回到小兔子」", backLabel.includes("回到小兔子"), backLabel);

  /* ---------------- 3. 返回：开场不能闪 ---------------- */
  const t0 = Date.now();
  c.eval(
    `[...document.querySelectorAll('a')].find((a) => a.textContent.includes('回到小兔子'))?.click()`,
  ).catch(() => {});
  const rows = [];
  for (let i = 0; i < 45; i++) {
    await sleep(120);
    const s = await c
      .eval(`(() => {
        const b = document.querySelector('.boot');
        return {
          p: location.pathname,
          seen: document.documentElement.dataset.introSeen || '',
          boot: b ? getComputedStyle(b).display : "none",
          op: b ? Number(getComputedStyle(b).opacity) : 0,
        };
      })()`)
      .catch(() => null);
    if (s) rows.push({ ms: Date.now() - t0, ...s });
    if (rows.length > 8 && s && s.p === "/" && s.boot === "none") break;
  }
  const flashed = rows.filter((r) => r.boot !== "none" && r.op > 0.02);
  ok("回到首页", rows.at(-1)?.p === "/", rows.at(-1)?.p);
  ok("开场页一次都没闪出来", flashed.length === 0, `采样 ${rows.length} 次，闪现 ${flashed.length} 次`);
  ok("解析阶段就打上了看过开场的标记", rows.at(-1)?.seen === "1", `seen=${rows.at(-1)?.seen}`);

  /* ---------------- 4. 回来时的问候 ---------------- */
  console.log("\n[3] 回来时的第一句话");
  await sleep(1800);
  const line = await c.eval(
    `document.querySelector('.rbubble__text')?.textContent || ''`,
  );
  ok("气泡说了话", line.length > 3, line);
  ok("是「回来」类问候，不是重新自我介绍", /回来|回来啦|放心|坐下/.test(line), line);
  ok("没有把「我是…」这类开场白带回来", !/初次|第一次|我是/.test(line), line);

  /* ---------------- 5. 药品页同样 ---------------- */
  console.log("\n[4] 药品说明页");
  await c.eval(`document.querySelector('a.portal__item[href="/drugs"]')?.click()`);
  await sleep(2400);
  const drugBack = await c.eval(
    "document.querySelector('.sheetwrap__back')?.textContent.trim() || ''",
  );
  ok("药品页返回入口也是「回到小兔子」", drugBack.includes("回到小兔子"), drugBack);

  /* ---------------- 6. 控制台 ---------------- */
  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  ws.close();
  if (fail > 0) process.exitCode = 1;
} finally {
  chrome.kill();
}
