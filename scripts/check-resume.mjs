/**
 * 验证「关掉档案再打开，还看得到刚才的记录」。
 *   node scripts/check-resume.mjs [baseUrl]
 *
 * 之前每次点开档案都会新建一次问诊，所以回来只剩一句开场白。
 * 现在改成接这个档案最近一次未归档、且真的聊过的问诊。
 *
 * 覆盖：
 *   [1] 第一次打开：没有历史 → 新建
 *   [2] 聊一句 → 关掉 → 重新打开：同一问诊、消息都在
 *   [3] 点「这次聊完了」→ 归档 → 再打开：开新的一次（记录不串）
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3100";
const HOST = new URL(BASE).hostname;
const PORT = 9359;
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
    this.errors = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
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

/** 读当前聊天区：几条消息、最后一条是什么 */
const readChat = `(() => {
  const items = [...document.querySelectorAll('.consult__log .msg')]
    .map((el) => ({ cls: el.className, text: el.textContent.trim().slice(0, 60) }))
    .filter((x) => !x.cls.includes('msg--typing'));
  return {
    count: items.length,
    texts: items.map((x) => x.text),
    note: items.filter((x) => x.cls.includes('msg--note')).map((x) => x.text),
  };
})()`;

async function main() {
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
  const patient = patients[0];
  console.log(`档案：${patient.name}`);

  // 把这个档案的活跃问诊先收干净，从「没有历史」开始测
  const pre = await api(`/api/patients/${patient.id}/consultations`);
  for (const c of pre.consultations) {
    if (c.status !== "archived") {
      await api(`/api/consultations/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "archived" }),
      });
    }
  }
  const baseline = (await api(`/api/patients/${patient.id}/consultations`)).consultations.length;
  console.log(`已有问诊 ${baseline} 条（都归档了）`);

  const profile = await mkdtemp(path.join(tmpdir(), "medai-resume-"));
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
    await c.send("Runtime.enable");
    await c.send("Network.setCookie", { name: "medai_session", value: token, domain: HOST, path: "/", httpOnly: true });
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await c.send("Page.navigate", { url: `${BASE}/?debug=1` });

    for (let i = 0; i < 60; i++) {
      try {
        if (await c.eval("Boolean(window.__meadow && window.__meadow.ballRoot)")) break;
      } catch {}
      await sleep(500);
    }
    await c.eval("document.querySelector('.boot__skip')?.click()");
    await sleep(2200);

    const openRecord = async () => {
      await c.eval("document.querySelector('.record__btn')?.click()");
      for (let i = 0; i < 40; i++) {
        if (await c.eval("Boolean(document.querySelector('.consult__form'))")) break;
        await sleep(300);
      }
      await sleep(1400);
    };

    /* ------------------------------------------- 1. 没有历史 → 新建一次 */
    console.log("\n[1] 第一次打开（没有历史）");
    await openRecord();
    let chat = await c.eval(readChat);
    ok("面板打开，只有开场白", chat.count === 1, JSON.stringify(chat.texts));
    const afterOpen = (await api(`/api/patients/${patient.id}/consultations`)).consultations;
    // 空问诊不进列表（一句话没说就关掉的会被自动删掉的同款），所以这里数量不变才对
    ok("空问诊不占列表位置", afterOpen.length === baseline, `${baseline} → ${afterOpen.length}`);

    /* --------------------------------- 2. 聊一句 / 关掉 / 重开要能接上 */
    console.log("\n[2] 关掉再打开，记录还在");
    await c.eval(`(() => {
      const el = document.querySelector('.consult__input');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, '我最近在吃布洛芬，每天两次');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(300);
    await c.eval("document.querySelector('.consult__form')?.requestSubmit()");

    let answered = false;
    for (let i = 0; i < 80; i++) {
      chat = await c.eval(readChat);
      if (chat.count >= 3) { answered = true; break; }
      await sleep(500);
    }
    ok("聊完一轮（我一句 + 兔子一句）", answered, `${chat.count} 条`);

    await c.eval("document.querySelector('.consult__close')?.click()");
    await sleep(1600);
    const closed = await c.eval("document.querySelector('.consult').getAttribute('aria-hidden')");
    ok("档案关掉了", closed === "true", closed);

    await openRecord();
    chat = await c.eval(readChat);
    ok("重开后历史消息还在", chat.count >= 3, `${chat.count} 条：${JSON.stringify(chat.texts.slice(0, 3))}`);
    ok("重开时说明「上次聊到这儿」", chat.note.some((t) => t.includes("上次聊到这儿")), JSON.stringify(chat.note));
    const noNew = (await api(`/api/patients/${patient.id}/consultations`)).consultations;
    ok("没有偷偷新建第二次问诊", noNew.length === baseline + 1, `${noNew.length} 条`);

    /* ------------------------------------ 3. 这次聊完了 → 下次是新的一次 */
    console.log("\n[3] 点「这次聊完了」之后开新的一次");
    const doneClicked = await c.eval(`(() => {
      const b = [...document.querySelectorAll('.chip--done')][0];
      if (!b) return false;
      b.click();
      return true;
    })()`);
    ok("有「这次聊完了」按钮", doneClicked);
    await sleep(1800);

    const afterArchive = (await api(`/api/patients/${patient.id}/consultations`)).consultations;
    ok("刚才那次已归档", afterArchive.some((x) => x.status === "archived"));

    await openRecord();
    chat = await c.eval(readChat);
    ok("再打开是干净的一次", chat.count === 1, JSON.stringify(chat.texts));
    const fresh = (await api(`/api/patients/${patient.id}/consultations`)).consultations;
    // 只有第一次聊过的那条会留下；这一条新开的还是空的，不会进列表
    ok("确实开了新的一次", fresh.length === baseline + 1, `${fresh.length} 条`);

    const errs = c.errors.filter((e) => !/favicon|DevTools/i.test(e));
    ok("控制台没有报错", errs.length === 0, errs.slice(0, 2).join(" | "));

    /* --------------------------------------------------------- 收尾 */
    for (const x of fresh) {
      if (x.status !== "archived") await api(`/api/consultations/${x.id}`, { method: "DELETE" });
    }
    const leftovers = (await api(`/api/patients/${patient.id}/consultations`)).consultations;
    for (const x of leftovers) {
      if (x.createdAt > new Date(Date.now() - 6e5).toISOString()) {
        await api(`/api/consultations/${x.id}`, { method: "DELETE" });
      }
    }
  } finally {
    chrome.kill();
  }

  console.log(`\n${failed === 0 ? "全部通过" : `${failed} 项失败`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
