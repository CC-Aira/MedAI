/**
 * 验证问诊记录的日历视图。
 *
 *   node scripts/check-visit-calendar.mjs [baseUrl]
 *
 * 要验的四件事：
 *   1. 有问诊的那天在日历上有点，点开只剩那天的记录
 *   2. 点「看聊天记录」能看到原文（气泡按天分组）
 *   3. 超过 30 天的问诊不会被踢出列表（消息被清了就只剩小结），点开读小结
 *   4. 老数据（只有小结、没有消息）照样在日历上有点
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] || "http://localhost:3100";
const HOST = new URL(BASE).hostname;
const PORT = 9367;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const prisma = new PrismaClient();

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
const raw = (loginRes.headers.getSetCookie?.() || []).find((c) => c.startsWith("medai_session="));
const token = raw.split(";")[0].slice("medai_session=".length);
const cookie = `medai_session=${token}`;
const api = (p, init = {}) =>
  fetch(`${BASE}${p}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers || {}) },
  }).then((r) => r.json());

const { patients } = await api("/api/patients");
const patient = patients[0];
console.log(`档案：${patient.name}`);

/* ------------------------------------------------ 造两次问诊：一次今天、一次 40 天前 */

async function makeVisit(texts) {
  const { consultation } = await api(`/api/patients/${patient.id}/consultations`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  for (const text of texts) {
    await fetch(`${BASE}/api/consultations/${consultation.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ content: text }),
    }).then((r) => r.text());
  }
  return consultation.id;
}

const todayId = await makeVisit(["我今天嗓子有点痒", "早上起来咳了两声"]);
const oldId = await makeVisit(["我上个月胸口闷", "走快一点就喘"]);

// 把 oldId 的对话整体推到 40 天前，并留下小结 —— 模拟「超过 30 天只剩摘要」
const back = new Date(Date.now() - 40 * 86400_000);
await prisma.message.updateMany({ where: { consultationId: oldId }, data: { createdAt: back } });
await prisma.consultation.update({
  where: { id: oldId },
  data: {
    createdAt: back,
    updatedAt: back,
    summary: "40 天前聊过一次：胸口发闷、活动后气短，建议先去心内科做个心电图。",
  },
});

console.log("\n[1] 接口：超期问诊不能消失");
const listed = await api(`/api/patients/${patient.id}/consultations`);
const oldInList = listed.consultations.find((c) => c.id === oldId);
ok("40 天前那条还在列表里", Boolean(oldInList), `${listed.consultations.length} 条`);
ok("它的消息数按 0 算（原文已被保留策略过滤）", oldInList?.messageCount === 0, `messageCount=${oldInList?.messageCount}`);
ok("小结还在", Boolean(oldInList?.summary));

const oldDetail = await api(`/api/consultations/${oldId}`);
ok("详情里没有消息了", oldDetail.consultation.messages.length === 0, `${oldDetail.consultation.messages.length} 条`);

const todayListed = listed.consultations.find((c) => c.id === todayId);
ok("今天那条有消息", todayListed?.messageCount >= 2, `messageCount=${todayListed?.messageCount}`);

console.log("\n[2] 日历视图");
const profile = await mkdtemp(path.join(tmpdir(), "medai-vcal-"));
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

  // 切到问诊记录
  await c.eval(`(() => {
    const b = [...document.querySelectorAll('.detail__tab')].find((x) => x.textContent.includes('问诊记录'));
    b?.click();
  })()`);
  for (let i = 0; i < 40; i++) {
    if (await c.eval("Boolean(document.querySelector('.vcal'))")) break;
    await sleep(300);
  }

  const cal = await c.eval(`(() => {
    const box = document.querySelector('.vcal');
    if (!box) return null;
    return {
      week: [...box.querySelectorAll('.vcal__week span')].map((x) => x.textContent),
      cells: box.querySelectorAll('.vcal__day').length,
      marked: box.querySelectorAll('.vcal__day.is-marked').length,
      dots: box.querySelectorAll('.vcal__dot').length,
      today: box.querySelectorAll('.vcal__day.is-today').length,
      cards: box.querySelectorAll('.vlogcard').length,
      picked: box.querySelectorAll('.vcal__day.is-picked').length,
      month: box.querySelector('.vcal__now b')?.textContent || '',
    };
  })()`);
  ok("日历渲染出来了", Boolean(cal));
  ok("表头是周一到周日", JSON.stringify(cal.week) === JSON.stringify(["一", "二", "三", "四", "五", "六", "日"]), cal.week.join(""));
  ok("有问诊的日期带圆点", cal.dots >= 1, `${cal.dots} 个点 / ${cal.marked} 天`);
  ok("今天被标出来了", cal.today === 1, cal.month);
  ok("默认停在最近一次问诊那天", cal.picked === 1, cal.month);
  ok("一进来就有记录可看", cal.cards >= 1, `${cal.cards} 张卡`);

  // 切到「看整月」再点某一天，验证按天过滤真的生效
  await c.eval("document.querySelector('.vcal__clear')?.click()");
  await sleep(400);
  const wholeMonth = await c.eval(`(() => {
    const box = document.querySelector('.vcal');
    return {
      groups: box.querySelectorAll('.vloggroup__day').length,
      marked: box.querySelectorAll('.vcal__day.is-marked').length,
    };
  })()`);
  ok("「看整月」把分组放回全月", wholeMonth.groups >= wholeMonth.marked, `${wholeMonth.groups} 组 / ${wholeMonth.marked} 天有记录`);

  const oneDay = await c.eval(`(() => {
    const btn = [...document.querySelectorAll('.vcal__day.is-marked')].pop();
    if (!btn) return null;
    btn.click();
    return true;
  })()`);
  await sleep(600);
  const picked = await c.eval(`(() => {
    const box = document.querySelector('.vcal');
    return {
      picked: box.querySelectorAll('.vcal__day.is-picked').length,
      hint: box.querySelector('.vcal__hint')?.textContent || '',
      groups: [...box.querySelectorAll('.vloggroup__day')].map((x) => x.textContent.trim()),
      cards: box.querySelectorAll('.vlogcard').length,
      clear: Boolean(box.querySelector('.vcal__clear')),
    };
  })()`);
  ok("点日期后进入选中态", oneDay === true && picked.picked === 1);
  ok("只剩当天的分组", picked.groups.length === 1, picked.groups.join(" / "));
  ok("出现了「看整月」的退回入口", picked.clear);

  // 打开聊天记录
  const opened = await c.eval(`(() => {
    const b = [...document.querySelectorAll('.vlogcard__open')][0];
    if (!b) return null;
    b.click();
    return true;
  })()`);
  for (let i = 0; i < 40; i++) {
    if (await c.eval("Boolean(document.querySelector('.vread__card'))")) break;
    await sleep(300);
  }
  await sleep(900);
  const read = await c.eval(`(() => {
    const box = document.querySelector('.vread');
    if (!box) return null;
    return {
      title: box.querySelector('.vread__title')?.textContent || '',
      msgs: [...box.querySelectorAll('.vread__text')].map((x) => x.textContent.trim()),
      days: box.querySelectorAll('.vread__daytag').length,
      mine: box.querySelectorAll('.vread__msg.is-mine').length,
      sub: box.querySelector('.vread__sub')?.textContent || '',
      sum: Boolean(box.querySelector('.vread__sum')),
    };
  })()`);
  ok("打开的是聊天原文", opened === true && Boolean(read), read?.title?.slice(0, 20));
  ok("能看到刚才说的话", read.msgs.some((m) => m.includes("嗓子有点痒")), read.msgs.join(" | ").slice(0, 60));
  ok("用户消息靠右（is-mine）", read.mine >= 1, `${read.mine} 条`);
  ok("按天分组", read.days >= 1, `${read.days} 个日期标签`);
  ok("这条是原文，不该显示小结块", read.sum === false);

  // Esc 关闭
  await c.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(500);
  ok("Esc 能关掉", (await c.eval("Boolean(document.querySelector('.vread'))")) === false);

  console.log("\n[3] 超过 30 天：读小结，不假装有原文");
  // 切到上一个月，找那条 40 天前的
  const toOld = await c.eval(`(() => {
    const nav = document.querySelectorAll('.vcal__nav');
    nav[0]?.click();
    return true;
  })()`);
  await sleep(600);
  let oldCell = await c.eval(`(() => {
    const b = [...document.querySelectorAll('.vcal__day.is-marked')].pop();
    if (!b) return null;
    b.click();
    return true;
  })()`);
  // 40 天前可能落在上上个月，再往前翻一次
  if (!oldCell) {
    await c.eval(`document.querySelectorAll('.vcal__nav')[0]?.click()`);
    await sleep(600);
    oldCell = await c.eval(`(() => {
      const b = [...document.querySelectorAll('.vcal__day.is-marked')].pop();
      if (!b) return null;
      b.click();
      return true;
    })()`);
    await sleep(600);
  }
  ok("在老月份里找到了那条问诊", toOld === true && Boolean(oldCell));

  const faded = await c.eval(`(() => {
    const card = [...document.querySelectorAll('.vlogcard')].find((x) => x.classList.contains('is-faded'));
    if (!card) return null;
    return {
      meta: card.querySelector('.vlogcard__meta')?.textContent || '',
      open: card.querySelector('.vlogcard__open')?.textContent || '',
      sheetOff: card.querySelector('.vlogcard__sheet')?.disabled ?? null,
    };
  })()`);
  ok("卡片标成「已过期」的淡色态", Boolean(faded));
  ok("写明原文已清除", (faded?.meta || "").includes("超过 30 天"), faded?.meta);
  ok("按钮变成「看小结」", (faded?.open || "").includes("小结"), faded?.open);
  ok("过期后不能再整理摘要", faded?.sheetOff === true);

  await c.eval(`(() => {
    const card = [...document.querySelectorAll('.vlogcard')].find((x) => x.classList.contains('is-faded'));
    card?.querySelector('.vlogcard__open')?.click();
  })()`);
  for (let i = 0; i < 40; i++) {
    if (await c.eval("Boolean(document.querySelector('.vread'))")) break;
    await sleep(300);
  }
  await sleep(700);
  const sumView = await c.eval(`(() => {
    const box = document.querySelector('.vread');
    if (!box) return null;
    return {
      msgs: box.querySelectorAll('.vread__text').length,
      sum: box.querySelector('.vread__sum-text')?.textContent || '',
      note: box.querySelector('.vread__note')?.textContent || '',
      gone: Boolean(box.querySelector('.vread__gone')),
    };
  })()`);
  ok("没有假气泡", sumView.msgs === 0, `${sumView.msgs} 条`);
  ok("读到的是当时的小结", (sumView.sum || "").includes("心电图"), (sumView.sum || "").slice(0, 30));
  ok("说明了为什么只剩小结", (sumView.note || "").includes("30 天"), (sumView.note || "").slice(0, 30));
  ok("没有小结记录时不会显示「已清除」话术", sumView.gone === false);
} finally {
  chrome.kill();
}

/* ------------------------------------------------------------------ 收尾 */

await api(`/api/consultations/${todayId}`, { method: "DELETE" });
await prisma.consultation.delete({ where: { id: oldId } }).catch(() => {});
await prisma.$disconnect();

console.log(`\n${failed === 0 ? "全部通过" : `${failed} 项失败`}\n`);
process.exit(failed === 0 ? 0 : 1);
