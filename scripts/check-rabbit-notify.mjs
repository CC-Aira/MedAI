/**
 * 站内提醒「接兔子」的端到端检查。
 *
 *   node scripts/check-rabbit-notify.mjs [baseUrl]
 *
 * 验的是这条链路：到点 → watcher 轮询到 → 兔子在草地上说话（不依赖通知权限）。
 *
 * 关键点是**把通知权限设成 denied**：
 *   - 系统通知一条都不该弹（`Notification` 被换成计数器）；
 *   - 但兔子照样得说，因为站内提醒才是主通道。
 * 以前只要权限不是 granted 就整个不轮询，这条测试当时是必挂的。
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3100";
const HOST = new URL(BASE).hostname;
const PORT = 9375;
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

const pad = (n) => String(n).padStart(2, "0");
const timeAgo = (minutes) => {
  const d = new Date(Date.now() - minutes * 60_000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@medai.local", password: "Medai@2026" }),
});
const rawCookie = (login.headers.getSetCookie?.() || []).find((c) => c.startsWith("medai_session="));
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

// 造一颗「5 分钟前该吃」的药
const DRUG = "端到端提醒测试药";
const created = await api(`/api/patients/${patient.id}/medications`, {
  method: "POST",
  body: JSON.stringify({ drugName: DRUG, timeOfDay: timeAgo(5), courseDays: 3 }),
});
const medId = created.medications?.find((m) => m.drugName === DRUG)?.id;
ok("造出一条到点的药", Boolean(medId), medId || JSON.stringify(created).slice(0, 120));

if (medId) {
  const today = await api("/api/medications/today");
  const due = today.due.find((d) => d.medicationId === medId);
  ok("接口认为它该提醒了", Boolean(due), due ? `${due.timeOfDay} · ${due.notice}` : "没进 due");
}

const profile = await mkdtemp(path.join(tmpdir(), "medai-rnotify-"));
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

  // 开场跳过 + 通知权限设为 denied + 打开提醒开关
  await c.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      try { sessionStorage.setItem('medai:intro','1'); } catch (e) {}
      try { localStorage.setItem('medai:med-remind:on','1'); } catch (e) {}
      window.__notifyCount = 0;
      class FakeNotification {
        static permission = 'denied';
        static requestPermission = async () => 'denied';
        constructor() { window.__notifyCount += 1; }
        close() {}
      }
      Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true });
    `,
  });

  await c.send("Page.navigate", { url: `${BASE}/` });

  // 别等 window.__meadow（headless 下 3D 场景可能起不来，且气泡不依赖它）：
  // 气泡挂载就会订阅，提醒晚到也会补发，所以直接盯气泡
  await sleep(1200);

  console.log("\n[1] 没通知权限，兔子也要说话");
  let bubble = null;
  for (let i = 0; i < 30; i++) {
    bubble = await c.eval(`(() => {
      const el = document.querySelector('.rbubble.is-on');
      if (!el) return null;
      return {
        text: (el.querySelector('.rbubble__text')?.textContent || '').trim(),
        tail: (el.querySelector('.rbubble__tail')?.textContent || '').trim(),
        notifies: window.__notifyCount,
      };
    })()`);
    if (bubble && bubble.text.includes(DRUG)) break;
    await sleep(400);
  }
  ok("气泡出现了", Boolean(bubble), bubble?.text || "没有 .rbubble.is-on");
  ok("说的正是这颗药", Boolean(bubble?.text.includes(DRUG)), bubble?.text);
  ok("带上了时间点", Boolean(bubble?.text.match(/\d{2}:\d{2}/)), bubble?.text);
  ok("文案里有档案名", Boolean(bubble?.text.includes(patient.name)), bubble?.text);
  const notifyCount = await c.eval("typeof window.__notifyCount === 'number' ? window.__notifyCount : -1");
  ok("系统通知一条都没弹", notifyCount === 0, `Notification 被构造 ${notifyCount} 次`);

  console.log("\n[2] 不会每 25 秒重复唠叨");
  const marked = await c.eval(`(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('medai:med-remind:seen')) keys.push(k);
    }
    return { keys, hits: keys.filter((k) => k.includes(${JSON.stringify(medId || "")})).length };
  })()`);
  ok("今天已经记成「提醒过」", marked.hits === 1, marked.keys.join(" / ") || "没有标记");
  ok("标记里带日期", marked.keys.some((k) => /\d{4}-\d{2}-\d{2}/.test(k)), marked.keys[0] || "");

  console.log("\n[3] 欢迎语不会盖掉提醒");
  // 补发的提醒先到 → 欢迎语让位；如果反过来，气泡会变成「欢迎」那几句
  const stillMed = await c.eval(`(() => {
    const el = document.querySelector('.rbubble.is-on');
    return el ? (el.querySelector('.rbubble__text')?.textContent || '').trim() : '';
  })()`);
  ok("两秒后还是那句提醒", stillMed.includes(DRUG), stillMed || "气泡没了");
} finally {
  chrome.kill();
  if (medId) await api(`/api/medications/${medId}`, { method: "DELETE" }).catch(() => {});
  console.log("  测试用药已删除");
}

console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项没通过`);
process.exit(failed === 0 ? 0 : 1);
