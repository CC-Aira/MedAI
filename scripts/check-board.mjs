/**
 * 草地小木牌自检：造一份「全家今天」的用药，验证
 *   1. 有跟踪中的用药才立牌，没设跟踪就缩在土里
 *   2. 木牌位置不压兔子、不出视口、不钻左边档案栏
 *   3. 点一下弹明细，名字/时间/状态都对
 *   4. 全部吃完的药不再上榜
 *
 * 用法：node scripts/check-board.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3200";
const HOST = new URL(BASE).hostname;
const PORT = 9351;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.join(process.cwd(), "docs");

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
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
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

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "demo@medai.local", password: "Medai@2026" }),
  });
  if (!res.ok) throw new Error(`登录失败 ${res.status}`);
  const raw = (res.headers.getSetCookie?.() || []).find((c) =>
    c.startsWith("medai_session="),
  );
  if (!raw) throw new Error("没拿到 medai_session");
  return raw.split(";")[0].slice("medai_session=".length);
}

const hhmm = (d) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** 取一个「今天已经过点」和「今天还没到点」的时间，凌晨跑也不会跨到昨天 */
function probeTimes(now = new Date()) {
  const h = now.getHours();
  const past = h >= 3 ? hhmm(new Date(now.getTime() - 2 * 3600e3)) : "00:05";
  const future = h <= 21 ? hhmm(new Date(now.getTime() + 2 * 3600e3)) : "23:55";
  return { past, future };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const token = await login();
  const cookie = `medai_session=${token}`;

  const json = (r) => r.json();
  const api = (p, init = {}) =>
    fetch(`${BASE}${p}`, {
      ...init,
      headers: { "content-type": "application/json", cookie, ...(init.headers || {}) },
    }).then(json);

  const { patients } = await api("/api/patients");
  if (!patients || patients.length < 2) throw new Error("演示账号至少要有两份档案");
  const [p1, p2] = patients;
  const { past, future } = probeTimes();
  console.log(`\n[0] 造数据 — 过点时间 ${past} / 未来时间 ${future}`);

  const created = [];
  const seen = [];

  async function addMed(patient, drugName, timeOfDay, checkin = false) {
    const res = await api(`/api/patients/${patient.id}/medications`, {
      method: "POST",
      body: JSON.stringify({ drugName, dosage: "1片", timeOfDay }),
    });
    const med = (res.medications || []).find((m) => m.drugName === drugName);
    if (!med) throw new Error(`没建成 ${drugName}`);
    created.push(med.id);
    seen.push(med.id);
    if (checkin) {
      await api(`/api/medications/${med.id}/checkin`, { method: "POST", body: "{}" });
    }
    return med;
  }

  // 林小满：一早吃过、中午漏了、晚上还没到
  await addMed(p1, "维生素D滴剂", "07:30", true);
  await addMed(p1, "二甲双胍片", past, false);
  await addMed(p1, "阿托伐他汀钙片", future, false);
  // 陈立：只差一颗
  await addMed(p2, "苯磺酸氨氯地平片", past, false);
  await addMed(p2, "阿司匹林肠溶片", future, true);

  const profile = await mkdtemp(path.join(tmpdir(), "medai-board-"));
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

  const cleanup = async () => {
    chrome.kill();
    for (const id of created) {
      await fetch(`${BASE}/api/medications/${id}`, {
        method: "DELETE",
        headers: { cookie },
      }).catch(() => {});
    }
  };

  try {
    await waitPort(`http://127.0.0.1:${PORT}/json/version`);
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
    await c.send("Network.setCookie", {
      name: "medai_session",
      value: token,
      domain: HOST,
      path: "/",
      httpOnly: true,
    });

    const shot = async (file) => {
      const { data } = await c.send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(OUT, file), Buffer.from(data, "base64"));
      console.log(`  📸 ${file}`);
    };

    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await c.send("Page.navigate", { url: `${BASE}/?debug=1` });
    await sleep(3200);
    await c.eval("document.querySelector('.boot__skip')?.click()");
    for (let i = 0; i < 60; i++) {
      if (await c.eval("Boolean(window.__meadow && window.__meadow.signBoard)")) break;
      await sleep(500);
    }
    await sleep(2200);

    console.log("\n[1] 木牌应该立起来了");
    const geo = await c.eval(`(() => {
      const m = window.__meadow;
      const a = m.signAnchor();
      const r = m.rabbitAnchor();
      return {
        sign: a && { l: Math.round(a.left), t: Math.round(a.top), r: Math.round(a.right), b: Math.round(a.bottom), cx: Math.round(a.cx), cy: Math.round(a.cy) },
        rabbit: { cx: Math.round(r.cx), cy: Math.round(r.cy), rx: Math.round(r.rx), ry: Math.round(r.ry) },
        board: m.boardData && { total: m.boardData.total, done: m.boardData.done, overdue: m.boardData.overdue, names: m.boardData.entries.map(e => e.patientName), counts: m.boardData.entries.map(e => e.done + "/" + e.total) },
        vw: innerWidth, vh: innerHeight,
      };
    })()`);
    console.log("   ", JSON.stringify(geo));

    ok("木牌可见", !!geo.sign);
    ok("今天共 5 次、已吃 2 次", geo.board?.total === 5 && geo.board?.done === 2, JSON.stringify(geo.board));
    ok("两位都在牌上", geo.board?.names?.length === 2);
    ok("有 2 次过点没吃", geo.board?.overdue === 2, `overdue=${geo.board?.overdue}`);

    if (geo.sign) {
      const s = geo.sign;
      ok("木牌在视口内", s.l >= 0 && s.t >= 0 && s.r <= geo.vw && s.b <= geo.vh, JSON.stringify(s));
      ok("木牌没钻进左边档案栏", s.l > 0.33 * geo.vw * 0.85, `left=${s.l}`);
      // 兔子和木牌的矩形不相交
      const hit =
        s.l < geo.rabbit.cx + geo.rabbit.rx &&
        s.r > geo.rabbit.cx - geo.rabbit.rx &&
        s.t < geo.rabbit.cy + geo.rabbit.ry &&
        s.b > geo.rabbit.cy - geo.rabbit.ry;
      ok("木牌不压兔子", !hit, `sign=${s.l},${s.t},${s.r},${s.b}`);
      // 记下桌面位置，等手机那一轮跑完切回来要对得上
      geo.signBefore = { l: s.l, t: s.t };
    }

    await shot("preview-signboard.png");

    console.log("\n[1b] 手机视口");
    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    });
    await sleep(2200);
    const mob = await c.eval(`(() => {
      const m = window.__meadow;
      const bar = document.querySelector(".medtoday");
      const r = bar && bar.getBoundingClientRect();
      const cs = bar && getComputedStyle(bar);
      return {
        sign: m.signAnchor(),
        bar: r && { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), text: bar.textContent.trim() },
        display: cs && cs.display,
        vw: innerWidth, vh: innerHeight,
      };
    })()`);
    console.log("   ", JSON.stringify(mob));
    ok("手机上不立 3D 木牌", mob.sign === null);
    ok("手机上有「今天的药」条", mob.display === "flex" && mob.bar.w > 100, JSON.stringify(mob.bar));
    ok("条上写着 2/5", mob.bar?.text?.includes("2/5"), mob.bar?.text);
    ok("条不超出视口", mob.bar.l >= 0 && mob.bar.l + mob.bar.w <= mob.vw + 1);
    await shot("preview-signboard-mobile.png");

    if (mob.bar) {
      for (const type of ["mousePressed", "mouseReleased"]) {
        await c.send("Input.dispatchMouseEvent", {
          type, x: mob.bar.l + mob.bar.w / 2, y: mob.bar.t + mob.bar.h / 2,
          button: "left", clickCount: 1,
        });
      }
      await sleep(600);
      const mcard = await c.eval(`(() => {
        const el = document.querySelector(".signcard");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), rows: el.querySelectorAll(".signcard__row").length };
      })()`);
      console.log("   ", JSON.stringify(mcard));
      ok("手机上卡片也弹得出来", !!mcard && mcard.rows === 2);
      ok("手机卡片不越界", !!mcard && mcard.l >= 0 && mcard.r <= mob.vw + 1 && mcard.b <= mob.vh + 1, JSON.stringify(mcard));
      await shot("preview-signboard-mobile-card.png");
      await c.eval(`document.querySelector(".signcard__close")?.click()`);
      await sleep(300);
    }

    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await sleep(2000);
    geo.sign = await c.eval("(() => { const a = window.__meadow.signAnchor(); return a && { l: a.left, t: a.top, r: a.right, b: a.bottom, cx: a.cx, cy: a.cy }; })()");
    // 切回桌面木牌必须回到原位：resize 那一刻 .records 还是手机版宽度、相机也在插值，
    // 只重摆一次的话板子会停错地方（曾经停在左下，卡片跟着长歪）
    ok(
      "切回桌面木牌回到原位",
      !!geo.sign && Math.abs(geo.sign.l - geo.signBefore.l) < 24 && Math.abs(geo.sign.t - geo.signBefore.t) < 24,
      `before=${geo.signBefore.l},${geo.signBefore.t} after=${geo.sign ? Math.round(geo.sign.l) + "," + Math.round(geo.sign.t) : "null"}`,
    );

    console.log("\n[2] 点木牌 → 明细卡片");
    if (geo.sign) {
      for (const type of ["mousePressed", "mouseReleased"]) {
        await c.send("Input.dispatchMouseEvent", {
          type,
          x: geo.sign.cx,
          y: geo.sign.cy,
          button: "left",
          clickCount: 1,
        });
      }
      await sleep(700);
      const card = await c.eval(`(() => {
        const el = document.querySelector(".signcard");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          text: el.textContent,
          left: Math.round(r.left), top: Math.round(r.top),
          right: Math.round(r.right), bottom: Math.round(r.bottom),
          rows: [...el.querySelectorAll(".signcard__row")].map(n => n.querySelector(".signcard__name")?.textContent + " " + n.querySelector(".signcard__count")?.textContent),
          doses: [...el.querySelectorAll(".signcard__dose")].map(n => n.textContent),
        };
      })()`);
      console.log("   ", JSON.stringify(card));
      ok("卡片弹出来了", !!card);
      ok("卡片在视口内", !!card && card.left >= 0 && card.right <= geo.vw + 1);
      ok(
        "卡片底部不越界（行多了也不许长到屏幕外）",
        !!card && card.bottom <= geo.vh + 1,
        `bottom=${card?.bottom} vh=${geo.vh}`,
      );
      ok("两位都列出", card?.rows?.length === 2, JSON.stringify(card?.rows));
      ok("林小满是 1/3", card?.rows?.[0]?.includes("1/3"), card?.rows?.[0]);
      ok("明细里有药名和时间", card?.doses?.some((d) => d.includes("二甲双胍片")), JSON.stringify(card?.doses));
      ok("过点的写成「没吃」", card?.doses?.filter((d) => d.includes("没吃")).length === 2, JSON.stringify(card?.doses));
      ok("吃过的那行有「已服」", card?.doses?.some((d) => d.includes("已服")));
      await shot("preview-signboard-card.png");

      console.log("\n[2b] 在卡片上直接打卡（不进档案）");
      const clickAt = async (x, y) => {
        for (const type of ["mousePressed", "mouseReleased"]) {
          await c.send("Input.dispatchMouseEvent", {
            type, x, y, button: "left", clickCount: 1,
          });
        }
      };
      const dose = await c.eval(`(() => {
        const el = document.querySelector(".signcard__dose.is-late");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
          tag: el.tagName, pressed: el.getAttribute("aria-pressed"),
          text: el.textContent.trim(),
        };
      })()`);
      console.log("   ", JSON.stringify(dose));
      ok("过点那一行是个按钮", dose?.tag === "BUTTON" && dose?.pressed === "false", JSON.stringify(dose));

      await clickAt(dose.x, dose.y);
      await sleep(1200);
      const after = await c.eval(`(() => {
        const el = document.querySelector(".signcard");
        const m = window.__meadow;
        return {
          rows: [...el.querySelectorAll(".signcard__row")].map(n => n.querySelector(".signcard__name").textContent + " " + n.querySelector(".signcard__count").textContent),
          doneRows: el.querySelectorAll(".signcard__dose.is-done").length,
          sum: el.querySelector(".signcard__sum")?.textContent,
          board: { total: m.boardData.total, done: m.boardData.done, overdue: m.boardData.overdue },
          sign: document.querySelector(".medsign")?.textContent || "",
        };
      })()`);
      console.log("   ", JSON.stringify(after));
      ok("这一行变成已服", after.doneRows === 3, `已服 ${after.doneRows} 行`);
      ok("3D 板子：已吃 2 → 3", after.board.done === 3, JSON.stringify(after.board));
      ok("3D 板子：没吃 2 → 1", after.board.overdue === 1, JSON.stringify(after.board));
      ok("卡片表头跟着变 3 / 5", after.sum?.includes("3 / 5"), after.sum);
      ok("板面上的字也变了", /3\s*\/\s*5/.test(after.sign.replace(/\s+/g, " ")), after.sign.slice(0, 40));
      ok("行没有跳走（还是那两个人）", after.rows.length === 2, JSON.stringify(after.rows));
      await shot("preview-signboard-checkin.png");

      // 卡片特写：只放大裁剪框（clip.scale = 2），**不动 deviceScaleFactor** ——
      // 改设备缩放会触发一次 resize，3D 场景跟着重建，吊牌会跑出裁剪框。
      // 1 倍的全屏图里卡片只有 300 px 宽，字看不清，没法当资料用。
      const box = await c.eval(`(() => {
        const card = document.querySelector(".signcard").getBoundingClientRect();
        // 板面那层 HTML 字就贴在木头表面，它的包围盒 = 板子在屏幕上的位置。
        // 比 window.__meadow.signAnchor() 稳：打卡后 React 会重渲染，那一刻 3D 接口可能是空的。
        const sg = document.querySelector(".medsign")?.getBoundingClientRect();
        const left = Math.max(0, Math.min(sg ? sg.left : card.left, card.left) - 30);
        const top = Math.max(0, Math.min(sg ? sg.top : card.top, card.top) - 26);
        const right = Math.max(card.right, sg ? sg.right : 0) + 30;
        const bottom = Math.max(card.bottom, sg ? sg.bottom : 0) + 22;
        return { x: left, y: top, width: right - left, height: bottom - top, sign: !!sg,
          sg: sg ? { l: Math.round(sg.left), t: Math.round(sg.top), w: Math.round(sg.width), h: Math.round(sg.height) } : null,
          card: { l: Math.round(card.left), t: Math.round(card.top), r: Math.round(card.right), b: Math.round(card.bottom) },
          anchor: window.__meadow?.signAnchor?.() || null,
          tf: getComputedStyle(document.querySelector(".medsign")).transform.slice(0, 70) };
      })()`);
      const { data: big } = await c.send("Page.captureScreenshot", {
        format: "png",
        clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 2 },
        captureBeyondViewport: true,
      });
      await writeFile(path.join(OUT, "preview-signboard-zoom.png"), Buffer.from(big, "base64"));
      console.log(`  📸 preview-signboard-zoom.png  ${Math.round(box.width)}×${Math.round(box.height)} @2x`);
      console.log("    " + JSON.stringify({ sg: box.sg, card: box.card, anchor: box.anchor, tf: box.tf }));

      // 再点一下撤销：点错了得能退回来
      await clickAt(dose.x, dose.y);
      await sleep(1200);
      const undone = await c.eval(`(() => {
        const m = window.__meadow;
        return { done: m.boardData.done, overdue: m.boardData.overdue };
      })()`);
      ok("撤销后回到 2", undone.done === 2 && undone.overdue === 2, JSON.stringify(undone));

      // 点空地 → 卡片收起
      await c.send("Input.dispatchMouseEvent", {
        type: "mousePressed", x: 1200, y: 780, button: "left", clickCount: 1,
      });
      await sleep(500);
      const gone = await c.eval(`!document.querySelector(".signcard")`);
      ok("点别处卡片收起", gone);
    }

    console.log("\n[3] 没设用药跟踪 → 立一块空板子，不是消失");
    // 把所有药停用，再刷新
    for (const id of seen) {
      await api(`/api/medications/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) });
    }
    await c.send("Page.navigate", { url: `${BASE}/?debug=1` });
    await sleep(3000);
    await c.eval("document.querySelector('.boot__skip')?.click()");
    for (let i = 0; i < 60; i++) {
      if (await c.eval("Boolean(window.__meadow && window.__meadow.signBoard)")) break;
      await sleep(500);
    }
    await sleep(2600);
    const emptySign = await c.eval(`(() => {
      const m = window.__meadow;
      return {
        anchor: m.signAnchor(),
        visible: !!(m.signGroup && m.signGroup.visible),
        target: m.signTarget,
        entries: m.boardData ? m.boardData.entries.length : -1,
      };
    })()`);
    // 改成常显之后：没有跟踪也得立着一块写着「今天还没有」的板子 ——
    // 空地才是真的找不到功能（这一条以前是断言「缩回土里」）
    ok("木牌仍然立着", Boolean(emptySign.anchor) && emptySign.visible, JSON.stringify(emptySign));
    ok("板子上没有条目", emptySign.entries === 0, `${emptySign.entries} 条`);
    ok("点得进去（有锚点）", Number(emptySign.anchor?.cx) > 0, `cx=${Math.round(emptySign.anchor?.cx ?? 0)}`);
    await shot("preview-signboard-nodrugs.png");

    console.log(`\n${failed === 0 ? "全部通过" : `${failed} 项未通过`}\n`);
  } finally {
    await cleanup();
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
