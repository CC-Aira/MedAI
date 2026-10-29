/**
 * 档案里的用药 + 提醒文案 自检（浏览器端）。
 *
 *   node scripts/check-reminder.mjs http://localhost:3000
 *
 * 覆盖：加药表单带时间点/饭前饭后/疗程 → 卡片显示 → 打卡 → 生成两段文案 →
 * 字数上限 → 连续漏服 2 次时追加关怀句 → 清理测试数据。
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3100";
const PORT = 9501;
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
const count = (s) => Array.from((s || "").replace(/\n/g, "")).length;

/**
 * 等到 React 真的接上再操作：空表单点「加入」应该立刻报"药名不能空着"。
 * dev 模式下 HTML 先到、hydration 后到，直接填输入框会白填（受控组件没有事件处理）。
 */
async function waitHydrated(c) {
  for (let i = 0; i < 60; i++) {
    await c.eval(`document.querySelector(".medform__add")?.click()`);
    await new Promise((r) => setTimeout(r, 200));
    const hit = await c
      .eval(`(document.querySelector(".detail__error")?.textContent || "").includes("药名")`)
      .catch(() => false);
    if (hit) return true;
  }
  return false;
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

/* 用接口先拿登录态和档案 id */
const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@medai.local", password: "Medai@2026" }),
});
const raw = (login.headers.getSetCookie?.() || []).find((c) =>
  c.startsWith("medai_session="),
);
const token = raw.split(";")[0].slice("medai_session=".length);

const { patients } = await fetch(`${BASE}/api/patients`, {
  headers: { cookie: `medai_session=${token}` },
}).then((r) => r.json());
const patient = patients[0];
if (!patient) throw new Error("演示账号下没有档案，先跑 seed");

const stamp = Date.now().toString().slice(-6);
const DRUG = `测试药${stamp}`;
const DRUG_MISS = `漏服药${stamp}`;
const created = [];

const profile = await mkdtemp(path.join(tmpdir(), "mrem-"));
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
    } catch {}
    await sleep(250);
  }
  const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, {
    method: "PUT",
  }).then((r) => r.json());
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
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
  await c.send("Page.navigate", { url: `${BASE}/patients/${patient.id}` });
  for (let i = 0; i < 40; i++) {
    if (await c.eval(`Boolean(document.querySelector(".medform"))`).catch(() => false)) break;
    await sleep(300);
  }
  ok("页面已经可以交互（React 接上了）", await waitHydrated(c));

  /* ---------------- 1. 表单 ---------------- */
  console.log("\n[1] 加一条带时间点与疗程的药");
  // 逐项填：一次性批量设置 6 个受控输入，React 只会认最后一次的事件
  await c.eval(`(() => {
    window.__setV = (el, v) => {
      const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    };
    window.__byLabel = (label) => {
      const field = [...document.querySelectorAll(".medform .field")].find((f) => f.textContent.includes(label));
      return field?.querySelector("input, select");
    };
  })()`);
  for (const [label, value] of [
    ["药名", DRUG],
    ["单次剂量", "200mg"],
    ["时间点", "08:00"],
    ["频率", "每日一次"],
    ["疗程", "5"],
  ]) {
    await c.eval(`window.__setV(window.__byLabel(${JSON.stringify(label)}), ${JSON.stringify(value)})`);
    await sleep(120);
  }
  await c.eval(`window.__setV(document.querySelector(".medform select"), "after")`);
  await sleep(200);

  ok(
    "表单有时间点、饭前饭后、疗程三栏",
    await c.eval(
      `Boolean(document.querySelector('.medform input[type=time]')) && Boolean(document.querySelector(".medform select")) && !![...document.querySelectorAll(".medform .field")].find(f=>f.textContent.includes("疗程"))`,
    ),
  );
  ok(
    "药名确实写进了输入框",
    (await c.eval(`(() => {
      const f = [...document.querySelectorAll(".medform .field")].find((n) => n.textContent.includes("药名"));
      return f?.querySelector("input")?.value || "";
    })()`)) === DRUG,
  );

  await c.eval(`document.querySelector(".medform__add")?.click()`);
  for (let i = 0; i < 25; i++) {
    const has = await c
      .eval(`[...document.querySelectorAll(".med")].some((n) => n.textContent.includes(${JSON.stringify(DRUG)}))`)
      .catch(() => false);
    if (has) break;
    await sleep(300);
  }

  const card = await c.eval(`(() => {
    const li = [...document.querySelectorAll(".med")].find((n) => n.textContent.includes(${JSON.stringify(DRUG)}));
    return li ? li.innerText : "";
  })()`);
  ok("卡片里有这条药", card.includes(DRUG), card.split("\n")[0]);
  ok("显示了时间点与饭前饭后", card.includes("08:00") && card.includes("饭后"), card.replace(/\n/g, " | "));
  ok("显示了疗程进度", card.includes("疗程第 1 天") && card.includes("还剩 5 天"), card.replace(/\n/g, " | "));
  ok("新药默认没打卡", card.includes("打卡") && !card.includes("今天已服"));

  // 记下这条药的 id，最后统一清理
  const listAfterAdd = await fetch(`${BASE}/api/patients/${patient.id}/medications`, {
    headers: { cookie: `medai_session=${token}` },
  }).then((r) => r.json());
  for (const m of listAfterAdd.medications || []) {
    if (m.drugName === DRUG) created.push(m.id);
  }

  /* ---------------- 2. 打卡 ---------------- */
  console.log("\n[2] 打卡");
  await c.eval(`(() => {
    const li = [...document.querySelectorAll(".med")].find((n) => n.textContent.includes(${JSON.stringify(DRUG)}));
    li?.querySelector(".med__check")?.click();
  })()`);
  await sleep(1200);
  const afterCheck = await c.eval(`(() => {
    const li = [...document.querySelectorAll(".med")].find((n) => n.textContent.includes(${JSON.stringify(DRUG)}));
    return li ? li.querySelector(".med__check")?.textContent : "";
  })()`);
  ok("点完变成「今天已服」", (afterCheck || "").includes("今天已服"), afterCheck);

  /* ---------------- 3. 生成提醒 ---------------- */
  console.log("\n[3] 生成提醒文案");
  await c.eval(`(() => {
    const li = [...document.querySelectorAll(".med")].find((n) => n.textContent.includes(${JSON.stringify(DRUG)}));
    li?.querySelector(".med__remind")?.click();
  })()`);
  for (let i = 0; i < 20; i++) {
    if (await c.eval(`Boolean(document.querySelector(".remind__text--notice"))`).catch(() => false)) break;
    await sleep(300);
  }
  const texts = await c.eval(`(() => ({
    notice: document.querySelector(".remind__text--notice")?.textContent || "",
    email: document.querySelector(".remind__text--mail")?.textContent || "",
    meta: document.querySelector(".remind__meta")?.textContent || "",
    counts: [...document.querySelectorAll(".remind__count")].map((n) => n.textContent),
  }))()`);
  console.log(`    ${texts.notice}  (${count(texts.notice)} 字)`);
  console.log(texts.email.split("\n").map((l) => `    ${l}`).join("\n"));

  ok("站内通知 ≤30 字", count(texts.notice) > 0 && count(texts.notice) <= 30, `${count(texts.notice)} 字`);
  ok("站内通知带药名/剂量/饭后", texts.notice.includes(DRUG) && texts.notice.includes("200mg") && texts.notice.includes("饭后"));
  ok("邮件 ≤80 字", count(texts.email) > 0 && count(texts.email) <= 80, `${count(texts.email)} 字`);
  ok("邮件有问候与安全提示", texts.email.includes("您好") && texts.email.includes("如有不适请及时就医"));
  ok("只吃了一天，不该有漏服关怀", !texts.email.includes("未打卡"), texts.meta.trim());
  ok("字数标注与正文一致", texts.counts.join(",").includes(`${count(texts.notice)}/30`) && texts.counts.join(",").includes(`${count(texts.email)}/80`), texts.counts.join(" "));

  const shot = await c.send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 },
  });
  await writeFile("docs/preview-med-reminder.png", Buffer.from(shot.data, "base64"));

  /* ---------------- 4. 连续漏服 ---------------- */
  console.log("\n[4] 连续漏服 2 次时的关怀句");
  const backdated = await fetch(`${BASE}/api/patients/${patient.id}/medications`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `medai_session=${token}` },
    body: JSON.stringify({
      drugName: DRUG_MISS,
      dosage: "10mg",
      timeOfDay: "21:00",
      mealTiming: "before",
      courseDays: 7,
      startDate: (() => {
        const d = new Date();
        d.setDate(d.getDate() - 3);
        return d.toISOString().slice(0, 10);
      })(),
    }),
  }).then((r) => r.json());
  for (const m of backdated.medications || []) {
    if (m.drugName === DRUG_MISS) created.push(m.id);
  }
  const miss = (backdated.medications || []).find((m) => m.drugName === DRUG_MISS);
  ok("3 天前开始的药，被算成连续漏服 2 次", miss && miss.missedStreak >= 2, `missedStreak=${miss?.missedStreak}`);

  /* 让页面重新取一次数据 */
  await c.send("Page.reload");
  for (let i = 0; i < 40; i++) {
    if (await c.eval(`Boolean(document.querySelector(".medform"))`).catch(() => false)) break;
    await sleep(300);
  }
  await waitHydrated(c);
  await sleep(300);
  const missCard = await c.eval(`(() => {
    const li = [...document.querySelectorAll(".med")].find((n) => n.textContent.includes(${JSON.stringify(DRUG_MISS)}));
    return li ? li.textContent : "(没有这张卡片)";
  })()`);
  ok("卡片上有漏服提示", missCard.includes("没打卡"), missCard);
  await c.eval(`(() => {
    const li = [...document.querySelectorAll(".med")].find((n) => n.textContent.includes(${JSON.stringify(DRUG_MISS)}));
    li?.querySelector(".med__remind")?.click();
  })()`);
  for (let i = 0; i < 20; i++) {
    if (await c.eval(`Boolean(document.querySelector(".remind__text--mail"))`).catch(() => false)) break;
    await sleep(300);
  }
  const missTexts = await c.eval(`(() => ({
    email: document.querySelector(".remind__text--mail")?.textContent || "",
    meta: document.querySelector(".remind__meta")?.textContent || "",
  }))()`);
  console.log(missTexts.email.split("\n").map((l) => `    ${l}`).join("\n"));
  ok("邮件里追加了关怀句", missTexts.email.includes("最近两次未打卡，记得按时服药哦，身体最重要～"));
  ok("追加后仍然 ≤80 字", count(missTexts.email) <= 80, `${count(missTexts.email)} 字`);
  ok("面板标明追加了关怀提醒", missTexts.meta.includes("已追加"), missTexts.meta.trim());

  /* ---------------- 5. 清理 ---------------- */
  console.log("\n[5] 清理测试数据");
  const before = await fetch(`${BASE}/api/patients/${patient.id}/medications`, {
    headers: { cookie: `medai_session=${token}` },
  }).then((r) => r.json());
  for (const m of before.medications || []) {
    if (m.drugName.startsWith("测试药") || m.drugName.startsWith("漏服药")) {
      await fetch(`${BASE}/api/medications/${m.id}`, {
        method: "DELETE",
        headers: { cookie: `medai_session=${token}` },
      });
    }
  }
  const left = await fetch(`${BASE}/api/patients/${patient.id}/medications`, {
    headers: { cookie: `medai_session=${token}` },
  }).then((r) => r.json());
  const stillThere = (left.medications || []).filter(
    (m) => m.drugName === DRUG || m.drugName === DRUG_MISS,
  );
  ok("测试用药都删掉了", stillThere.length === 0, `剩 ${stillThere.length} 条`);

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  ws.close();
  if (fail > 0) process.exitCode = 1;
} finally {
  chrome.kill();
}
