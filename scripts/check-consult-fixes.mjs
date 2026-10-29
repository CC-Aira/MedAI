/**
 * 两件事的自检（需要先启动服务）：
 *   node scripts/check-consult-fixes.mjs [baseUrl]
 *
 * [1] 从档案面板跳到「档案详情 → 编辑档案」，再一路返回：
 *     面板不能以「全是 —」的空状态浮在草地上（以前 body 上的 is-consulting
 *     没人清，回来就是个空壳挡在中间，看着像卡死）。
 * [2] 「整理进档案」：聊过的药要能扫出来、写进档案，而且结果要落在聊天里 ——
 *     否则用户以为按钮没反应。
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3100";
const HOST = new URL(BASE).hostname;
const PORT = 9361;
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

async function main() {
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
  const patient = patients.find((p) => p.name === "江雁南") || patients[0];
  console.log(`档案：${patient.name}`);

  // 这个测试会真的聊一段、真的把药整理进档案 —— 收尾必须自己擦干净，
  // 否则用户打开时间轴会看见一句莫名其妙的「二甲双胍」。
  const snapshot = async () => {
    const [list, detail] = await Promise.all([
      api(`/api/patients/${patient.id}/consultations`),
      api(`/api/patients/${patient.id}`),
    ]);
    return {
      visits: new Set((list.consultations ?? []).map((c) => c.id)),
      meds: new Set((detail.patient?.medications ?? []).map((m) => m.id)),
    };
  };
  const before = await snapshot();
  const cleanup = async () => {
    try {
      const after = await snapshot();
      for (const id of after.visits) {
        if (!before.visits.has(id)) await api(`/api/consultations/${id}`, { method: "DELETE" });
      }
      for (const id of after.meds) {
        if (!before.meds.has(id)) await api(`/api/medications/${id}`, { method: "DELETE" });
      }
      console.log("  已清掉这次测试造的问诊和用药");
    } catch (err) {
      console.warn("  清理失败（手动跑 scripts/clean-test-residue.mjs --apply）", err.message);
    }
  };

  const profile = await mkdtemp(path.join(tmpdir(), "medai-fix-"));
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

    /* --------------------------------------- 1. 编辑档案来回一趟不卡 */
    console.log("\n[1] 档案详情 → 编辑 → 返回");
    await c.send("Page.navigate", { url: `${BASE}/?debug=1` });
    for (let i = 0; i < 60; i++) {
      try {
        if (await c.eval("Boolean(window.__meadow && window.__meadow.ballRoot)")) break;
      } catch {}
      await sleep(500);
    }
    // 开场只在第一次进场；这里先把它跳掉，后面返回时不该再出现
    await c.eval("document.querySelector('.boot__skip')?.click()");
    await sleep(1800);

    await c.eval("document.querySelector('.record__btn')?.click()");
    for (let i = 0; i < 40; i++) {
      if (await c.eval("Boolean(document.querySelector('.consult__form'))")) break;
      await sleep(300);
    }
    await sleep(1200);
    const openState = await c.eval(`(() => {
      const el = document.querySelector('.consult');
      return { cls: el.className, op: getComputedStyle(el).opacity, body: document.body.className };
    })()`);
    ok("面板打开", Number(openState.op) > 0.5, JSON.stringify(openState));

    // 点「档案详情」跳走 —— 这一步以前会把 is-consulting 留在 body 上
    await c.eval("document.querySelector('.consult__open')?.click()");
    await sleep(2200);
    const afterJump = await c.eval(`({ url: location.pathname, body: document.body.className })`);
    ok("跳到了档案详情", afterJump.url.startsWith("/patients/"), afterJump.url);
    ok("跳走时已经收好面板状态", !afterJump.body.includes("is-consulting"), afterJump.body || "(空)");

    // 进编辑页，再退回
    await c.eval(`(() => {
      const a = [...document.querySelectorAll('a')].find((x) => x.getAttribute('href')?.endsWith('/edit'));
      a?.click();
    })()`);
    await sleep(2000);
    const atEdit = await c.eval("location.pathname");
    ok("进了编辑页", atEdit.endsWith("/edit"), atEdit);

    await c.send("Page.navigate", { url: `${BASE}/?debug=1` });
    await sleep(3000);
    const back = await c.eval(`(() => {
      const el = document.querySelector('.consult');
      const cs = el && getComputedStyle(el);
      return {
        body: document.body.className,
        hasEl: Boolean(el),
        closed: el ? el.classList.contains('is-closed') : null,
        op: cs ? cs.opacity : null,
        pe: cs ? cs.pointerEvents : null,
      };
    })()`);
    ok("回到主页看不到空面板", !back.op || Number(back.op) < 0.1, JSON.stringify(back));
    ok("空面板不挡点击", back.pe !== "auto", back.pe);
    ok("body 上没有残留的 is-consulting", !back.body.includes("is-consulting"), back.body || "(空)");

    // 再点一次档案，应该正常打开
    await c.eval("document.querySelector('.record__btn')?.click()");
    for (let i = 0; i < 40; i++) {
      if (await c.eval("Boolean(document.querySelector('.consult__form'))")) break;
      await sleep(300);
    }
    await sleep(1400);
    const reopened = await c.eval(`(() => {
      const el = document.querySelector('.consult');
      return { op: getComputedStyle(el).opacity, name: el.querySelector('.consult__name')?.textContent?.trim() };
    })()`);
    ok("重新打开面板正常", Number(reopened.op) > 0.5 && Boolean(reopened.name) && reopened.name !== "—", JSON.stringify(reopened));

    /* -------------------------------- 2. 整理进档案：药要能写进去 */
    console.log("\n[2] 整理进档案");
    const say = async (text) => {
      await c.eval(`(() => {
        const el = document.querySelector('.consult__input');
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(el, ${JSON.stringify(text)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await sleep(300);
      await c.eval("document.querySelector('.consult__form')?.requestSubmit()");
    };

    await say("我这两个月在吃二甲双胍，一次一片，一天两次");
    for (let i = 0; i < 90; i++) {
      const n = await c.eval("document.querySelectorAll('.consult__log .msg').length");
      if (n >= 3) break;
      await sleep(500);
    }

    // 消息落进 DOM ≠ 这一轮结束：sending 还挂着时按钮是 disabled 的，
    // 这时候 click() 会被直接吞掉，什么都不会发生。
    for (let i = 0; i < 60; i++) {
      const ready = await c.eval(`(() => {
        const b = [...document.querySelectorAll('.chip--tool')].find((x) => x.textContent.includes('整理进档案'));
        return b ? !b.disabled : false;
      })()`);
      if (ready) break;
      await sleep(500);
    }

    const clicked = await c.eval(`(() => {
      const b = [...document.querySelectorAll('.chip--tool')].find((x) => x.textContent.includes('整理进档案'));
      if (!b || b.disabled) return false;
      b.click();
      return true;
    })()`);
    ok("点了「整理进档案」", clicked);

    let facts = null;
    for (let i = 0; i < 90; i++) {
      facts = await c.eval(`(() => {
        const box = document.querySelector('.facts');
        if (!box) return null;
        const items = [...box.querySelectorAll('.facts__item')].map((li) => ({
          text: li.textContent.trim().slice(0, 80),
          checked: Boolean(li.querySelector('input')?.checked),
        }));
        return items.length ? { items } : null;
      })()`);
      if (facts) break;
      const note = await c.eval(`(() => {
        const el = document.querySelector('.consult__notice');
        return el ? el.textContent.trim() : null;
      })()`);
      if (note) {
        console.log(`     面板提示：${note}`);
        break;
      }
      await sleep(500);
    }
    ok("扫出了候选", Boolean(facts), facts ? `${facts.items.length} 条` : "（空）");
    const drug = facts?.items.find((x) => x.text.includes("二甲双胍"));
    ok("提到了药名", Boolean(drug), drug?.text);

    if (drug) {
      const applied = await c.eval(`(() => {
        const box = document.querySelector('.facts');
        const btn = [...box.querySelectorAll('button')].find((b) => b.textContent.includes('写进档案'));
        if (!btn) return false;
        btn.click();
        return true;
      })()`);
      ok("点了「写进档案」", applied);
      await sleep(2600);

      const noteText = await c.eval(`(() => {
        const notes = [...document.querySelectorAll('.consult__log .msg--note')].map((x) => x.textContent.trim());
        return notes.find((t) => t.includes('已经写进档案')) || null;
      })()`);
      ok("聊天里能看到「已经写进档案」", Boolean(noteText), noteText);

      const fresh = await api(`/api/patients/${patient.id}`);
      const found = fresh.patient.medications.some((m) => m.drugName.includes("二甲双胍"));
      ok("档案里真的有这条药", found, fresh.patient.medications.map((m) => m.drugName).join("、"));
    }

    const errs = c.errors.filter((e) => !/favicon|DevTools/i.test(e));
    ok("控制台没有报错", errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    chrome.kill();
    await cleanup();
  }

  console.log(`\n${failed === 0 ? "全部通过" : `${failed} 项失败`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
