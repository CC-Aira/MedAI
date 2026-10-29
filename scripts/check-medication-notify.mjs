/**
 * 浏览器通知（到点提醒）自检。
 *
 * 分两段：
 *   [接口] 该不该提醒的判定 —— 现在到点、超过宽限、还没到点、已打卡、疗程走完、匿名
 *   [浏览器] 真的会弹、同一天不重复弹、点通知会打卡
 *
 *   node scripts/check-medication-notify.mjs http://127.0.0.1:3100
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3100";
const PORT = 9521;
const EMAIL = "demo@medai.local";
const PASSWORD = "Medai@2026";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, "0");
/** 相对现在往前 minutes 分钟的时间点 "HH:MM" */
const timeAgo = (minutes) => {
  const d = new Date(Date.now() - minutes * 60_000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const timeIn = (minutes) => timeAgo(-minutes);

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
  /* ---------------- 登录 ---------------- */
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const raw = (loginRes.headers.getSetCookie?.() || []).find((c) =>
    c.startsWith("medai_session="),
  );
  const token = raw ? raw.split(";")[0].slice("medai_session=".length) : "";
  if (!token) throw new Error("登录失败，脚本没法继续");

  const cookie = { cookie: `medai_session=${token}` };
  const jsonHeaders = { ...cookie, "content-type": "application/json" };

  const { patients } = await fetch(`${BASE}/api/patients`, { headers: cookie }).then((r) =>
    r.json(),
  );
  const patient = patients.find((p) => p.medications?.length) ?? patients[0];
  if (!patient) throw new Error("没有档案，先建一个再跑");

  const meds = patient.medications ?? [];
  const dueMed = meds[0];
  const courseMed = meds[1] ?? meds[0];
  if (!dueMed) throw new Error("这个档案没有用药，先加一条再跑");

  const today = `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}-${pad(new Date().getDate())}`;
  const todayReminders = async () =>
    fetch(`${BASE}/api/medications/today`, { headers: cookie, cache: "no-store" }).then((r) =>
      r.json(),
    );
  const patch = (id, body) =>
    fetch(`${BASE}/api/medications/${id}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }).then((r) => r.json());
  const checkin = (id, method = "POST") =>
    fetch(`${BASE}/api/medications/${id}/checkin`, {
      method,
      headers: jsonHeaders,
      body: method === "POST" ? "{}" : undefined,
    }).then((r) => r.json());

  const find = (data, id) => (data.due ?? []).find((d) => d.medicationId === id);
  const findUpcoming = (data, id) => (data.upcoming ?? []).find((d) => d.medicationId === id);

  try {
    /* ================= 1. 接口判定 ================= */
    console.log("\n[1] 该不该提醒");

    // 先回到干净状态
    await patch(dueMed.id, { timeOfDay: null, courseDays: null, startDate: null });
    await fetch(`${BASE}/api/medications/${dueMed.id}/checkin`, {
      method: "DELETE",
      headers: cookie,
    });
    let data = await todayReminders();
    ok("没设时间点的药不提醒", !find(data, dueMed.id), `due=${data.due.length}`);

    // 10 分钟前 → 现在就该吃
    await patch(dueMed.id, { timeOfDay: timeAgo(10) });
    data = await todayReminders();
    const hit = find(data, dueMed.id);
    ok("到点后出现在 due 里", Boolean(hit), hit ? `迟到 ${hit.minutesLate} 分钟` : "没出现");
    ok("通知文案不是空的且 ≤30 字", Boolean(hit) && hit.notice.length > 0 && hit.notice.length <= 30, hit?.notice);
    ok(
      "文案里带上了药名",
      Boolean(hit) && hit.notice.includes(dueMed.drugName),
      hit?.notice,
    );
    ok("带上所属档案", Boolean(hit) && hit.patientId === patient.id);

    // 超过 3 小时宽限 → 今天不再打扰
    await patch(dueMed.id, { timeOfDay: timeAgo(240) });
    data = await todayReminders();
    ok("超过宽限（4 小时前）不再提醒", !find(data, dueMed.id));

    // 还没到点 → upcoming，不进 due。
    // 时间点是"今天这一刻"，临近零点时构造不出今天未来的时刻，只能跳过。
    const nowD = new Date();
    const minutesLeftToday = 24 * 60 - (nowD.getHours() * 60 + nowD.getMinutes());
    if (minutesLeftToday > 70) {
      await patch(dueMed.id, { timeOfDay: timeIn(60) });
      data = await todayReminders();
      ok("还没到点的不进 due", !find(data, dueMed.id));
      const up = findUpcoming(data, dueMed.id);
      ok(
        "还没到点的进 upcoming",
        Boolean(up) && up.minutesUntil > 50,
        up ? `${up.minutesUntil} 分钟后` : "没出现",
      );
    } else {
      console.log(
        `  - 跳过「还没到点」用例：今天只剩 ${minutesLeftToday} 分钟，构造不出未来的时间点`,
      );
    }

    // 打卡后立刻消失
    await patch(dueMed.id, { timeOfDay: timeAgo(10) });
    await checkin(dueMed.id, "POST");
    data = await todayReminders();
    ok("今天打过卡就不再提醒", !find(data, dueMed.id));

    // 撤销 → 回到 due
    await checkin(dueMed.id, "DELETE");
    data = await todayReminders();
    ok("撤销打卡后重新回到 due", Boolean(find(data, dueMed.id)));

    // 疗程走完 → 不提醒
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    await patch(courseMed.id, {
      timeOfDay: timeAgo(10),
      courseDays: 1,
      startDate: `${threeDaysAgo.getFullYear()}-${pad(threeDaysAgo.getMonth() + 1)}-${pad(threeDaysAgo.getDate())}`,
    });
    data = await todayReminders();
    ok("疗程已经走完的药不提醒", !find(data, courseMed.id));

    // 匿名
    const anon = await fetch(`${BASE}/api/medications/today`);
    ok("未登录访问被拒（401）", anon.status === 401, `HTTP ${anon.status}`);

    /* ================= 2. 浏览器端 ================= */
    console.log("\n[2] 浏览器通知");

    // 给测试账号造一条"刚到点"的药
    await patch(dueMed.id, { timeOfDay: timeAgo(5), courseDays: null, startDate: null });

    const profile = await mkdtemp(path.join(tmpdir(), "mnotify-"));
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
      await c.send("Network.enable");
      await c.send("Runtime.enable");
      await c.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await c.send("Network.setCookie", {
        name: "medai_session",
        value: token,
        url: BASE,
        path: "/",
        httpOnly: true,
      });

      // 无头浏览器里的系统通知没法真的弹出来，用替身记录「弹了什么」
      await c.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `
          window.__notes = [];
          window.__clicked = null;
          class FakeNotification {
            constructor(title, opts) {
              this.title = title;
              this.body = opts && opts.body;
              this.tag = opts && opts.tag;
              this.onclick = null;
              window.__notes.push({ title, body: this.body, tag: this.tag });
              window.__lastNote = this;
            }
            close() {}
          }
          FakeNotification.permission = "granted";
          FakeNotification.requestPermission = async () => "granted";
          Object.defineProperty(window, "Notification", {
            configurable: true, writable: true, value: FakeNotification,
          });
          try { localStorage.setItem("medai:med-remind:on", "1"); } catch (e) {}
        `,
      });

      await c.send("Page.navigate", { url: `${BASE}/patients/${patient.id}` });
      await sleep(1500);
      for (let i = 0; i < 40; i++) {
        if (await c.eval(`Boolean(document.querySelector(".medform"))`).catch(() => false)) break;
        await sleep(300);
      }
      await sleep(4000);

      const notes = await c.eval("window.__notes");
      ok("页面加载后弹出了通知", notes.length >= 1, `${notes.length} 条`);
      const first = notes[0];
      ok(
        "通知正文就是那条药的文案",
        Boolean(first) && first.body.includes(dueMed.drugName),
        first?.body,
      );
      ok("通知带了 tag（同一条药不会堆成一片）", Boolean(first?.tag) && first.tag.includes(dueMed.id), first?.tag);

      // 等到下一轮轮询（25 秒），看会不会重复弹
      await sleep(27_000);
      const notesLater = await c.eval("window.__notes");
      ok("同一天不会重复弹", notesLater.length === 1, `${notesLater.length} 条`);

      // 点通知：应该打卡
      await c.eval("window.__lastNote && window.__lastNote.onclick && window.__lastNote.onclick()");
      await sleep(1500);
      const after = await todayReminders();
      ok("点通知后自动打卡", !find(after, dueMed.id), `due=${after.due.length}`);

      const medsNow = await fetch(`${BASE}/api/patients/${patient.id}/medications`, {
        headers: cookie,
      }).then((r) => r.json());
      const checked = (medsNow.medications ?? []).find((m) => m.id === dueMed.id);
      ok("接口里也显示今天已服", checked?.todayTaken === true, `todayTaken=${checked?.todayTaken}`);

      ws.close();
    } finally {
      chrome.kill();
    }
  } finally {
    /* ================= 清理：还原测试动过的字段 ================= */
    for (const med of [dueMed, courseMed]) {
      await fetch(`${BASE}/api/medications/${med.id}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ timeOfDay: null, courseDays: null, startDate: null }),
      }).catch(() => {});
      await fetch(`${BASE}/api/medications/${med.id}/checkin`, {
        method: "DELETE",
        headers: cookie,
      }).catch(() => {});
    }
    console.log("\n（测试期间改动的用药字段已还原）");
  }

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("\n自检失败：", err.message);
  process.exit(1);
});
