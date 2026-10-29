/**
 * 从真实页面导出就诊摘要 PDF，用来核对"打印出来到底长什么样"。
 *   node scripts/shot-paper-pdf.mjs [baseUrl]
 *
 * 为什么要单独一个脚本：浏览器里截个 print 媒体的图，和真正走 Chrome 打印管线
 * 出 PDF，是两件事。折页、分页、背景色、box-shadow 的失真只在后者才暴露。
 *
 * 产物：docs/_probe/live.pdf（再用 PyMuPDF 转 PNG 肉眼看）
 */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFile } from "node:fs/promises";

const BASE = process.argv[2] || "http://localhost:3100";
const HOST = new URL(BASE).hostname;
const PORT = 9357;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.join(process.cwd(), "docs", "_probe");

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
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome 调试端口没起来");
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "demo@medai.local", password: "Medai@2026" }),
  });
  if (!loginRes.ok) throw new Error(`登录失败 ${loginRes.status}`);
  const raw = (loginRes.headers.getSetCookie?.() || []).find((c) => c.startsWith("medai_session="));
  const token = raw.split(";")[0].slice("medai_session=".length);
  const cookie = `medai_session=${token}`;
  const api = (p, init = {}) =>
    fetch(`${BASE}${p}`, {
      ...init,
      headers: { "content-type": "application/json", cookie, ...(init.headers || {}) },
    }).then((r) => r.json());

  const { patients } = await api("/api/patients");
  // 优先用截图里那个档案，没有就退到第一个
  const patient = patients.find((p) => p.name === "江雁南") || patients[0];
  console.log(`档案：${patient.name} · 过敏史=${patient.allergies || "无"} · 在服药物=${patient.medications.filter((m) => m.isActive).length}`);

  const { consultation } = await api(`/api/patients/${patient.id}/consultations`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const cid = consultation.id;

  // 造一次带红旗的问诊，这样纸上会同时出现红旗横幅和过敏史
  await fetch(`${BASE}/api/consultations/${cid}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ content: "胸口疼，喘不上气，出冷汗" }),
  }).then((r) => r.text());

  await api(`/api/consultations/${cid}/sheet`, { method: "POST", body: JSON.stringify({ local: true }) });
  console.log(`问诊 ${cid} 已生成摘要`);

  const profile = await mkdtemp(path.join(tmpdir(), "medai-pdf-"));
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

    // 档案页的「问诊记录」里有「看就诊摘要」，这条路不用等 3D 场景
    await c.send("Page.navigate", { url: `${BASE}/patients/${patient.id}` });
    await sleep(2600);
    await c.eval(`(() => {
      const tab = [...document.querySelectorAll('.detail__tab')].find((t) => t.textContent.includes('问诊记录'));
      tab?.click();
    })()`);
    await sleep(700);

    const point = await c.eval(`(() => {
      const b = document.querySelector('.visit__sheet');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (!point) throw new Error("没找到「看就诊摘要」按钮");

    for (const type of ["mousePressed", "mouseReleased"]) {
      await c.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
    }

    let ready = false;
    for (let i = 0; i < 40; i++) {
      ready = await c.eval("Boolean(document.querySelector('.paper__lead'))");
      if (ready) break;
      await sleep(400);
    }
    if (!ready) throw new Error("纸没打开");
    await sleep(600);

    const allergy = await c.eval(`(() => {
      const el = document.querySelector('.paper__allergy');
      return el ? { text: el.textContent.trim(), cls: el.className } : null;
    })()`);
    console.log("过敏史块：", JSON.stringify(allergy));

    const { data } = await c.send("Page.printToPDF", {
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    });
    const file = path.join(OUT, "live.pdf");
    await writeFile(file, Buffer.from(data, "base64"));
    console.log("已写出", file);
  } finally {
    chrome.kill();
  }

  await api(`/api/consultations/${cid}`, { method: "DELETE" });
  console.log("临时问诊已删除");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
