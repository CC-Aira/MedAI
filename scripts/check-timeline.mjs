/**
 * 病程时间轴的端到端检查。
 *
 *   node scripts/check-timeline.mjs [baseUrl]
 *
 * 验五件事：
 *   1. 档案页多了「时间轴」tab，角标和记录数对得上
 *   2. 四类记录（建档 / 用药 / 问诊 / 结论）都排在一条轴上
 *   3. 问诊卡片能「看原文」，打开的正是那次问诊
 *   4. 投影视图能开、能关（Esc），里面有标题和统计
 *   5. 空档案不会空白一片，给的是引导文案
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3100";
const HOST = new URL(BASE).hostname;
const PORT = 9373;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
function ok(label, cond, extra = "") {
  if (!cond) failed++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
}

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
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome 调试端口没起来");
}

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@medai.local", password: "Medai@2026" }),
});
const rawCookie = (loginRes.headers.getSetCookie?.() || []).find((c) => c.startsWith("medai_session="));
const token = rawCookie.split(";")[0].slice("medai_session=".length);
const cookie = `medai_session=${token}`;
const api = (p, init = {}) =>
  fetch(`${BASE}${p}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers || {}) },
  }).then((r) => r.json());

const { patients } = await api("/api/patients");
const patient = patients[0];
console.log(`档案：${patient.name}`);

// 造一份空档案，用来验空态
const created = await api("/api/patients", {
  method: "POST",
  body: JSON.stringify({ name: "时间轴空档案", gender: "female", age: 30 }),
});
const emptyId = created.patient?.id;
ok("能建一份空档案用来验空态", Boolean(emptyId), emptyId || JSON.stringify(created).slice(0, 120));

const profile = await mkdtemp(path.join(tmpdir(), "medai-tlcheck-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--enable-unsafe-swiftshader", "--window-size=1440,900", "about:blank",
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
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await c.send("Page.navigate", { url: `${BASE}/patients/${patient.id}` });

  for (let i = 0; i < 60; i++) {
    if (await c.eval("Boolean(document.querySelector('.detail__tabs'))")) break;
    await sleep(300);
  }

  console.log("\n[1] tab 与角标");
  const tabs = await c.eval(`[...document.querySelectorAll('.detail__tab')].map((x) => x.textContent)`);
  const tlTab = tabs.find((t) => t.includes("时间轴"));
  ok("有「时间轴」tab", Boolean(tlTab), tabs.join(" / "));
  const badge = Number((tlTab || "").replace(/[^\d]/g, ""));
  ok("角标是记录数（>0）", badge > 0, `角标 ${badge}`);

  await c.eval(`(() => {
    const b = [...document.querySelectorAll('.detail__tab')].find((x) => x.textContent.includes('时间轴'));
    b?.click();
  })()`);
  for (let i = 0; i < 40; i++) {
    if (await c.eval("Boolean(document.querySelector('.tl__list'))")) break;
    await sleep(300);
  }
  await sleep(600);

  console.log("\n[2] 四类记录都在轴上");
  const shape = await c.eval(`(() => {
    const box = document.querySelector('.tl');
    if (!box) return null;
    const items = [...box.querySelectorAll('.tlev')];
    return {
      groups: box.querySelectorAll('.tlgroup').length,
      events: items.length,
      kinds: [...new Set(items.map((x) => [...x.classList].find((c) => c.startsWith('is-'))))],
      months: [...box.querySelectorAll('.tlgroup__month span')].map((x) => x.textContent),
      stats: [...box.querySelectorAll('.tl__cell')].map((x) => x.textContent),
      axisLine: (() => {
        const a = box.querySelector('.tlev__axis');
        if (!a) return 0;
        return parseFloat(getComputedStyle(a, '::before').width) || 0;
      })(),
    };
  })()`);
  ok("渲染出时间轴", Boolean(shape));
  ok("事件数和角标一致", Number(shape.events) === badge, `${shape.events} vs ${badge}`);
  ok("按月分组", shape.groups >= 1, shape.months.join(" | "));
  ok("至少有问诊和建档两类", shape.kinds.includes("is-visit") && shape.kinds.includes("is-formed"), shape.kinds.join("/"));
  ok("轴是一条真实的竖线", shape.axisLine >= 1.5, `${shape.axisLine}px`);
  ok("统计条有四项", shape.stats.length === 4, shape.stats.join(" | "));

  // 卡片正文限制两行：问诊内容一长，一屏就只剩两三条，轴读不出"病程"
  const lines = await c.eval(`(() => {
    const d = document.querySelector('.tlev__detail');
    if (!d) return null;
    const cs = getComputedStyle(d);
    const lh = parseFloat(cs.lineHeight) || 0;
    return {
      clamp: cs.webkitLineClamp,
      h: d.clientHeight,
      lines: lh ? Math.round(d.clientHeight / lh) : 0,
    };
  })()`);
  ok("正文最多两行", lines && lines.lines <= 2, `clamp=${lines?.clamp} / 高 ${lines?.h}px / ${lines?.lines} 行`);

  console.log("\n[3] 看原文");
  const opened = await c.eval(`(() => {
    const b = document.querySelector('.tlev__open');
    if (!b) return false;
    b.scrollIntoView({ block: 'center' });
    b.click();
    return true;
  })()`);
  ok("问诊卡片上有点开的按钮", opened);
  for (let i = 0; i < 40; i++) {
    if (await c.eval("Boolean(document.querySelector('.vread__card'))")) break;
    await sleep(300);
  }
  await sleep(700);
  const reader = await c.eval(`(() => {
    const card = document.querySelector('.vread__card');
    if (!card) return null;
    return {
      msgs: card.querySelectorAll('.vread__msg').length,
      hasSummary: Boolean(card.querySelector('.vread__sum')),
      width: Math.round(card.getBoundingClientRect().width),
    };
  })()`);
  ok("聊天阅读器打开了", Boolean(reader), reader ? `宽 ${reader.width}px` : "没打开");
  ok("阅读器里有内容（原文或小结）", Boolean(reader?.msgs || reader?.hasSummary), JSON.stringify(reader));
  await c.eval("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(500);
  ok("Esc 能关掉阅读器", !(await c.eval("Boolean(document.querySelector('.vread__card'))")));

  console.log("\n[4] 投影视图");
  await c.eval("document.querySelector('.tl__clean')?.click()");
  for (let i = 0; i < 40; i++) {
    if (await c.eval("Boolean(document.querySelector('.tlpaper'))")) break;
    await sleep(250);
  }
  await sleep(700);
  const paper = await c.eval(`(() => {
    const p = document.querySelector('.tlpaper');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return {
      title: p.querySelector('.tlpaper__title')?.textContent || '',
      who: p.querySelector('.tlpaper__who')?.textContent || '',
      nums: p.querySelectorAll('.tlpaper__nums b').length,
      events: p.querySelectorAll('.tlev').length,
      width: Math.round(r.width),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      bg: getComputedStyle(p).backgroundColor,
      bodyOverflow: getComputedStyle(document.body).overflow,
      links: p.querySelectorAll('.tlev__open').length,
    };
  })()`);
  ok("投影视图打开了", Boolean(paper));
  ok("标题是「病程时间轴」", paper?.title === "病程时间轴", paper?.title);
  ok("有患者信息", (paper?.who || "").includes(patient.name), paper?.who);
  ok("三个关键数字", paper?.nums === 3, String(paper?.nums));
  ok("纸是白底", paper?.bg === "rgb(255, 253, 248)", paper?.bg);
  ok("纸宽度受控（不是铺满 1440）", paper.width <= 900 && paper.width >= 600, `${paper.width}px`);
  ok("纸从视口顶部开始（不悬空也不跑出去）", paper.top >= 0 && paper.top <= 60, `top ${paper.top}`);
  ok("背后的页面锁了滚动", paper.bodyOverflow === "hidden", paper.bodyOverflow);
  ok("投影视图里不放「看原文」（截图要干净）", paper.links === 0, `${paper.links} 个`);

  console.log("\n[4b] 内容比一屏长时，能缩到一屏");
  const hasFit = await c.eval("Boolean(document.querySelector('.tlpaper__fit'))");
  ok("内容超一屏才出现「缩到一屏」", hasFit, `纸高 ${paper.bottom - paper.top}px / 视口 900`);
  if (hasFit) {
    await c.eval("document.querySelector('.tlpaper__fit')?.click()");
    await sleep(600);
    const fitted = await c.eval(`(() => {
      const p = document.querySelector('.tlpaper');
      const r = p.getBoundingClientRect();
      return {
        bottom: Math.round(r.bottom),
        top: Math.round(r.top),
        scale: getComputedStyle(p).transform,
        label: document.querySelector('.tlpaper__fit')?.textContent || '',
      };
    })()`);
    ok("缩完能一屏装下", fitted.bottom <= 900 + 8, `bottom ${fitted.bottom}`);
    ok("缩完仍在顶部", fitted.top <= 60, `top ${fitted.top}`);
    ok("按钮变成「原尺寸」", fitted.label.includes("原尺寸"), fitted.label);
    ok("真的用了 scale 变换", fitted.scale.startsWith("matrix"), fitted.scale.slice(0, 32));
  }

  await c.eval("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(500);
  ok("Esc 关掉投影视图", !(await c.eval("Boolean(document.querySelector('.tlpaper'))")));
  ok("滚动锁解开了", (await c.eval("getComputedStyle(document.body).overflow")) !== "hidden");

  console.log("\n[5] 空档案");
  if (emptyId) {
    await c.send("Page.navigate", { url: `${BASE}/patients/${emptyId}` });
    for (let i = 0; i < 60; i++) {
      if (await c.eval("Boolean(document.querySelector('.detail__tabs'))")) break;
      await sleep(300);
    }
    await c.eval(`(() => {
      const b = [...document.querySelectorAll('.detail__tab')].find((x) => x.textContent.includes('时间轴'));
      b?.click();
    })()`);
    for (let i = 0; i < 40; i++) {
      if (await c.eval("Boolean(document.querySelector('.tl'))")) break;
      await sleep(300);
    }
    await sleep(400);
    const empty = await c.eval(`(() => {
      const tl = document.querySelector('.tl');
      if (!tl) return null;
      return {
        events: tl.querySelectorAll('.tlev').length,
        hint: tl.querySelector('.tl__empty')?.textContent?.trim() || '',
        cleanDisabled: Boolean(tl.querySelector('.tl__clean')?.disabled),
      };
    })()`);
    ok("时间轴渲染出来了（空档案也要有）", Boolean(empty));
    ok("只有建档一条，不会空白", empty?.events === 1, `${empty?.events} 条`);
    ok("没有可截图内容时按钮禁用", empty?.cleanDisabled === true);
  }
} finally {
  chrome.kill();
  // 把刚才造的空档案删掉，别污染演示数据
  if (emptyId) await api(`/api/patients/${emptyId}`, { method: "DELETE" }).catch(() => {});
}

console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项没通过`);
process.exit(failed === 0 ? 0 : 1);
