/**
 * 给新木牌照图：整屏一张 + 木牌特写（裁到牌子周围），再补一张有数据的样子。
 *   node scripts/shot-sign.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3100";
const HOST = new URL(BASE).hostname;
const PORT = 9379;
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
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  async shot(file, clip) {
    const { data } = await this.send("Page.captureScreenshot", {
      format: "png",
      ...(clip ? { clip: { ...clip, scale: 2 } } : {}),
    });
    await writeFile(file, Buffer.from(data, "base64"));
    console.log("  →", file);
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

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@medai.local", password: "Medai@2026" }),
});
const raw = (login.headers.getSetCookie?.() || []).find((c) => c.startsWith("medai_session="));
const token = raw.split(";")[0].slice("medai_session=".length);
const cookie = `medai_session=${token}`;
const api = (p, init = {}) =>
  fetch(`${BASE}${p}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers || {}) },
  }).then((r) => r.json());

/** 木牌在屏幕上的包围盒，往外放一圈给影子留位置 */
async function signBox(c) {
  return c.eval(`(() => {
    const m = window.__meadow;
    const a = m?.signAnchor?.();
    if (!a) return null;
    const pad = 46;
    const x = Math.max(0, a.left - pad);
    const y = Math.max(0, a.top - pad);
    return { x, y, width: a.right - a.left + pad * 2, height: a.bottom - a.top + pad * 2 };
  })()`);
}

async function waitSign(c) {
  for (let i = 0; i < 80; i++) {
    const ok = await c.eval(`(() => {
      const el = document.querySelector('.medsign');
      if (!el) return false;
      const o = Number(getComputedStyle(el).opacity);
      return o > 0.9 && getComputedStyle(el).transform !== 'none';
    })()`);
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

const profile = await mkdtemp(path.join(tmpdir(), "medai-sign-"));
const created = [];
const chrome = spawn(
  CHROME,
  [
    "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--enable-unsafe-swiftshader", "--window-size=1440,980", "about:blank",
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
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
  await c.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "try{sessionStorage.setItem('medai:intro','1')}catch(e){}",
  });

  // 有数据的样子：临时给两位档案各加一条在服的药（收尾删掉）
  const { patients } = await api("/api/patients");
  const [p1, p2] = patients;
  const meds = [
    { patientId: p1.id, drugName: "氨氯地平片", dosage: "5mg", timeOfDay: "08:00" },
    { patientId: p1.id, drugName: "阿托伐他汀", dosage: "20mg", timeOfDay: "21:00" },
    { patientId: p2?.id ?? p1.id, drugName: "二甲双胍", dosage: "0.5g", timeOfDay: "12:30" },
  ];
  // 只认「这次真的新增出来的 id」：靠药名反查会撞上同名的旧记录，
  // 收尾时删掉的可能是别人的药（踩过，别再靠 find 猜）
  const idsOf = async (patientId) => {
    const d = await api(`/api/patients/${patientId}`);
    return (d.patient?.medications ?? []).map((x) => x.id);
  };

  for (const m of meds) {
    const before = new Set(await idsOf(m.patientId));
    await api(`/api/patients/${m.patientId}/medications`, {
      method: "POST",
      body: JSON.stringify({ drugName: m.drugName, dosage: m.dosage, timeOfDay: m.timeOfDay }),
    });
    for (const id of await idsOf(m.patientId)) {
      if (!before.has(id)) created.push(id);
    }
  }
  console.log(`临时加药 ${created.length} 条`);

  await c.send("Page.navigate", { url: `${BASE}/?debug=1` });
  for (let i = 0; i < 100; i++) {
    if (await c.eval("Boolean(window.__meadow)")) break;
    await sleep(300);
  }
  const alive = await waitSign(c);
  console.log(`文字层就位：${alive}`);
  await sleep(2600);

  await c.shot("docs/preview-sign.png");
  const box = await signBox(c);
  if (box) await c.shot("docs/preview-sign-closeup.png", box);
  else console.log("  ! 没拿到木牌坐标");

  // 换几个窗口宽度量一遍：牌子不能压到兔子身上
  for (const w of [1240, 1440, 1680]) {
    await c.send("Emulation.setDeviceMetricsOverride", { width: w, height: 940, deviceScaleFactor: 1, mobile: false });
    await sleep(900);
    // 兔子是个椭圆（身体），牌子是个矩形：算矩形到椭圆的最近距离，
    // 小于半径就算压上了 —— 直接比包围盒会把「牌子在兔子左下角」也判成重叠
    const pair = await c.eval(`(() => {
      const m = window.__meadow;
      const s = m && m.signAnchor();
      const r = m && m.rabbitAnchor();
      if (!s || !r) return null;
      const dx = Math.max(s.left - r.cx, 0, r.cx - s.right);
      const dy = Math.max(s.top - r.cy, 0, r.cy - s.bottom);
      return {
        gap: Math.round(dx),
        overlap: (dx * dx) / (r.rx * r.rx) + (dy * dy) / (r.ry * r.ry) < 1,
        rabbitLeft: Math.round(r.cx - r.rx),
      };
    })()`);
    const verdict = pair ? (pair.overlap ? "✗ 压到兔子" : "✓ 没压到兔子") : "? 拿不到坐标";
    const gap = pair ? `，牌子右缘离兔子 ${pair.gap}px` : "";
    console.log(`  ${w}px：${verdict}${gap}`);
  }

  // 手机：木牌收起来，字也不该出现
  await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1200);
  const hidden = await c.eval(`(() => {
    const el = document.querySelector('.medsign');
    return el ? getComputedStyle(el).display : 'gone';
  })()`);
  console.log(`手机端文字层：${hidden}`);
} finally {
  chrome.kill();
  let gone = 0;
  for (const id of created) {
    try {
      const r = await fetch(`${BASE}/api/medications/${id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", cookie },
      });
      if (r.ok) gone += 1;
      else console.log(`  ! 删 ${id} 失败：HTTP ${r.status}`);
    } catch (err) {
      console.log(`  ! 删 ${id} 失败：${err.message}`);
    }
  }
  console.log(`已删除临时用药 ${gone}/${created.length} 条`);
}
