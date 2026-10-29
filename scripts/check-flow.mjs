/**
 * 红旗拦截 + 就诊摘要 的端到端自检（需要先启动服务）。
 *   node scripts/check-flow.mjs [baseUrl]
 *
 * 覆盖：
 *   [1] 红旗拦截走本地规则：响应头带标记、话术里有 120、落库后仍带 flag
 *   [2] 普通消息照常走模型，不会被误拦
 *   [3] 就诊摘要：本地模板 / 模型整理 两条路都能出纸，红旗会写进纸里
 *   [4] 浏览器里：红卡片长什么样、点开纸、打印时只剩这张纸
 *
 * 脚本自己建一次问诊，跑完删掉，不污染演示账号。
 */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] || "http://localhost:3200";
const HOST = new URL(BASE).hostname;
const PORT = 9355;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.join(process.cwd(), "docs");

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
    this.errors = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method === "Runtime.exceptionThrown") {
        this.errors.push(m.params.exceptionDetails?.text || "exception");
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
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
    }
    return r.result.value;
  }
  async shot(name) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(path.join(OUT, name), Buffer.from(data, "base64")),
    );
    return name;
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
  const raw = (res.headers.getSetCookie?.() || []).find((c) => c.startsWith("medai_session="));
  if (!raw) throw new Error("没拿到 medai_session");
  return raw.split(";")[0].slice("medai_session=".length);
}

/** 读 SSE，返回所有事件 */
async function readSse(res) {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => {
      try {
        return JSON.parse(l.slice(5).trim());
      } catch {
        return null;
      }
    })
    .filter(Boolean);
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
  const patient = patients[0];

  const { consultation } = await api(`/api/patients/${patient.id}/consultations`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const cid = consultation.id;
  console.log(`   用档案「${patient.name}」建了一次临时问诊 ${cid}`);

  const send = async (text) => {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/consultations/${cid}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ content: text }),
    });
    const events = await readSse(res);
    // Response 的 headers 是原型上的 getter，展开拿不到，要单独取
    return { status: res.status, headers: res.headers, events, ms: Date.now() - t0 };
  };

  try {
    /* ------------------------------------------------ 1. 先热一下，再测拦截 */
    console.log("\n[1] 红旗拦截（不经过模型）");
    // 先用一句正常的话把路由编译 / 连接热起来，否则第一次的耗时没参考价值
    const warm = await send("我最近下午老是头胀，睡不太好");
    ok("普通消息有模型回答", Boolean(warm.events.find((e) => e.type === "done")), `${warm.ms}ms`);

    const red = await send("我妈现在胸口疼，喘不上气，还出冷汗");
    const redDone = red.events.find((e) => e.type === "done");
    ok("响应头标明这是本地拦截", red.headers.get("x-medai-flag") === "redflag");
    ok("有回答", Boolean(redDone?.assistantMessage?.content));
    ok("回答里让打 120", /120/.test(redDone?.assistantMessage?.content || ""));
    ok("回答里说清「不是诊断」", /不是诊断/.test(redDone?.assistantMessage?.content || ""));
    ok("回答标了 flag", redDone?.assistantMessage?.flag === "redflag.emergency", redDone?.assistantMessage?.flag);
    ok("拦截比走模型快（<1.5s）", red.ms < 1500, `${red.ms}ms`);
    console.log(`      走模型 ${warm.ms}ms / 拦截 ${red.ms}ms`);

    const { consultation: detail } = await api(`/api/consultations/${cid}`);
    const flagged = detail.messages.filter((m) => m.flag);
    ok("刷新后仍是红卡片（flag 落库了）", flagged.length === 1 && flagged[0].flag === "redflag.emergency");
    ok("用户那句话也存下来了", detail.messages.some((m) => m.content.includes("胸口疼") && m.role === "user"));

    /* ---------------------------------------------------- 2. 误拦 / 过去时 */
    console.log("\n[2] 不该拦的不拦");
    const neg = await send("我没有胸痛，就是最近有点累");
    ok("否定句走正常回答", !neg.headers.get("x-medai-flag"), neg.headers.get("x-medai-flag"));
    ok("否定句不是红卡片", !neg.events.find((e) => e.type === "done")?.assistantMessage?.flag);

    /* -------------------------------------------------- 3. 就诊摘要：两条路 */
    console.log("\n[3] 就诊摘要");
    const local = await api(`/api/consultations/${cid}/sheet`, {
      method: "POST",
      body: JSON.stringify({ local: true }),
    });
    ok("本地模板能出纸", local.sheet?.source === "local");
    ok("本地模板写上主诉", Boolean(local.sheet?.chiefComplaint), local.sheet?.chiefComplaint);
    ok("本地模板把红旗写进纸里", local.sheet?.flags?.labels?.length > 0, JSON.stringify(local.sheet?.flags?.labels));
    ok("本地模板不问模型也要有问题清单", local.sheet?.questions?.length === 3);

    const ai = await api(`/api/consultations/${cid}/sheet`, { method: "POST", body: JSON.stringify({}) });
    ok("模型整理能出纸", Boolean(ai.sheet), ai.sheet?.source);
    ok("纸上有主诉", Boolean(ai.sheet?.chiefComplaint), ai.sheet?.chiefComplaint);
    ok("纸上有病程", (ai.sheet?.course?.length ?? 0) > 0, `${ai.sheet?.course?.length} 条`);
    const listed = await api(`/api/patients/${patient.id}/consultations`);
    ok("列表里标出「已有摘要」", listed.consultations.find((c) => c.id === cid)?.hasSheet === true);

    /* ------------------------------------------------------ 4. 浏览器里看 */
    console.log("\n[4] 浏览器：红卡片 / 打开纸 / 打印");
    const profile = await mkdtemp(path.join(tmpdir(), "medai-flow-"));
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
      await c.send("Network.setCookie", {
        name: "medai_session", value: token, domain: HOST, path: "/", httpOnly: true,
      });
      await c.send("Emulation.setDeviceMetricsOverride", {
        width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
      });
      await c.send("Page.navigate", { url: `${BASE}/?debug=1` });

      let ready = false;
      for (let i = 0; i < 60; i++) {
        try {
          ready = await c.eval("Boolean(window.__meadow && window.__meadow.ballRoot)");
        } catch {}
        if (ready) break;
        await sleep(500);
      }
      ok("3D 场景已挂载", ready);
      await c.eval("document.querySelector('.boot__skip')?.click()");
      await sleep(2200);

      // 进入问诊：点第一条档案
      await c.eval("document.querySelector('.record__btn')?.click()");
      let opened = false;
      for (let i = 0; i < 40; i++) {
        opened = await c.eval("Boolean(document.querySelector('.consult__form'))");
        if (opened) break;
        await sleep(300);
      }
      ok("问诊面板打开了", opened);
      await sleep(900);

      const boundary = await c.eval(
        "(() => { const el = document.querySelector('.consult__boundary'); return el ? el.textContent.trim() : null; })()",
      );
      ok("面板上常驻就医边界提示", Boolean(boundary && boundary.includes("120")), boundary || "");
      await c.shot("preview-consult-boundary.png");

      // 发一句红旗
      await c.eval(`(() => {
        const el = document.querySelector('.consult__input');
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(el, '我胸口疼，喘不上气，出冷汗');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await sleep(300);
      await c.eval("document.querySelector('.consult__form')?.requestSubmit()");

      let card = null;
      for (let i = 0; i < 60; i++) {
        card = await c.eval(`(() => {
          const el = document.querySelector('.redcard');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const log = document.querySelector('.consult__log');
          const lr = log.getBoundingClientRect();
          return {
            cls: el.className,
            title: el.querySelector('.redcard__title')?.textContent || '',
            tag: el.querySelector('.redcard__tag')?.textContent || '',
            text: el.querySelector('.redcard__text')?.textContent || '',
            inside: r.left >= lr.left - 1 && r.right <= lr.right + 1,
            h: Math.round(r.height),
          };
        })()`);
        if (card) break;
        await sleep(400);
      }
      ok("出现了红卡片", Boolean(card), JSON.stringify(card && { cls: card.cls, h: card.h }));
      ok("卡片写着「先别在这儿聊了」", card?.title === "先别在这儿聊了", card?.title);
      ok("卡片标明是本地规则", card?.tag === "本地规则拦截", card?.tag);
      ok("卡片正文让人打 120", (card?.text || "").includes("120"));
      ok("卡片没有溢出对话区", card?.inside === true);
      ok("卡片是 emergency 配色", (card?.cls || "").includes("redcard--emergency"), card?.cls);
      await sleep(500);
      await c.shot("preview-redflag.png");

      // 打开就诊摘要
      const openedSheet = await c.eval(`(() => {
        const btns = [...document.querySelectorAll('.chip--sheet')];
        if (!btns.length) return false;
        btns[0].click();
        return true;
      })()`);
      ok("有「带走就诊摘要」入口", openedSheet);

      let sheet = null;
      for (let i = 0; i < 80; i++) {
        sheet = await c.eval(`(() => {
          const el = document.querySelector('.paper');
          if (!el) return { missing: true };
          const h3 = [...el.querySelectorAll('.paper__h3')].map((x) => x.textContent.trim());
          const r = el.getBoundingClientRect();
          return {
            missing: false,
            sections: h3,
            name: el.querySelector('.paper__name')?.textContent || '',
            lead: el.querySelector('.paper__lead')?.textContent || '',
            flag: el.querySelector('.paper__flag')?.textContent || '',
            meds: el.querySelectorAll('.paper__meds tbody tr').length,
            foot: el.querySelector('.paper__foot')?.textContent || '',
            printBtn: el.querySelector('.paper__print')?.textContent?.trim() || '',
            // 病程那一段的条目，用来检查有没有把主诉又抄一遍
            course: [...el.querySelectorAll('.paper__sec')]
              .find((sec) => sec.querySelector('.paper__h3')?.textContent.includes('病程'))
              ?.querySelectorAll('.paper__list li').length
              ? [...[...el.querySelectorAll('.paper__sec')]
                  .find((sec) => sec.querySelector('.paper__h3')?.textContent.includes('病程'))
                  .querySelectorAll('.paper__list li')].map((li) => li.textContent.trim())
              : [],
            w: Math.round(r.width), h: Math.round(r.height),
            vh: innerHeight,
          };
        })()`);
        // 骨架屏阶段 .paper 已经在了、但一个区块都没有，必须等正文真的长出来
        if (sheet && !sheet.missing && sheet.sections.length >= 5) break;
        await sleep(500);
      }
      ok("纸打开了", Boolean(sheet && !sheet.missing && sheet.sections.length >= 5), JSON.stringify(sheet?.sections));
      ok("抬头写着患者名字", sheet?.name === patient.name, sheet?.name);
      ok("有主诉", Boolean(sheet?.lead), sheet?.lead);
      ok("纸上有红旗横幅", Boolean(sheet?.flag), sheet?.flag);
      ok("药物是表格", (sheet?.meds ?? 0) >= 1, `${sheet?.meds} 行`);
      ok("底部有免责说明", (sheet?.foot || "").includes("不是诊断"));
      ok("有打印按钮", (sheet?.printBtn || "").includes("打印"), sheet?.printBtn);
      ok("纸不超高", sheet.h <= sheet.vh, `${sheet.w}x${sheet.h} / ${sheet.vh}`);
      // 编号必须连着：某块空了就跳过的话，医生会以为少了一页
      ok(
        "区块编号连续、不留空号",
        sheet.sections.every((t, i) => t.startsWith(String(i + 1))),
        JSON.stringify(sheet.sections),
      );
      // 同一句话在纸上出现两遍，等于告诉读的人「这张纸是凑出来的」
      ok(
        "主诉没有在病程里重复一遍",
        !sheet.course.includes(sheet.lead),
        JSON.stringify(sheet.course),
      );
      await c.shot("preview-sheet.png");

      // 打印时只剩这张纸
      await c.send("Emulation.setEmulatedMedia", { media: "print" });
      await sleep(500);
      const printed = await c.eval(`(() => {
        const kids = [...document.body.children].map((el) => ({
          id: el.id || '', cls: String(el.className || '').slice(0, 30),
          display: getComputedStyle(el).display,
        }));
        const sheet = document.querySelector('.paper');
        const cs = sheet && getComputedStyle(sheet);

        return {
          visible: kids.filter((k) => k.display !== 'none'),
          bar: getComputedStyle(document.querySelector('.paper__bar')).display,
          mask: getComputedStyle(document.querySelector('.paperlayer__mask')).display,
          bg: cs && cs.backgroundColor,
          overflow: document.querySelector('.paper__body') && getComputedStyle(document.querySelector('.paper__body')).overflowY,
        };
      })()`);
      ok("打印时只剩纸这一层", printed.visible.length === 1 && printed.visible[0].id === "paper-print-root", JSON.stringify(printed.visible));
      ok("打印时隐藏按钮条", printed.bar === "none");
      ok("打印时隐藏遮罩", printed.mask === "none");
      ok("打印时正文不被裁切（overflow visible）", printed.overflow === "visible", printed.overflow);
      await c.shot("preview-sheet-print.png");
      await c.send("Emulation.setEmulatedMedia", { media: "screen" });
      await sleep(300);

      // 手机上这张纸是全屏的
      await c.send("Emulation.setDeviceMetricsOverride", {
        width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
      });
      await sleep(900);
      const mobile = await c.eval(`(() => {
        const el = document.querySelector('.paper');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight };
      })()`);
      ok("手机上纸铺满屏宽", Boolean(mobile) && mobile.w >= mobile.vw - 1, JSON.stringify(mobile));
      ok("手机上不留边距", Boolean(mobile) && mobile.l <= 1 && mobile.t <= 1);
      await c.shot("preview-sheet-mobile.png");

      await c.send("Emulation.setDeviceMetricsOverride", {
        width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
      });
      await sleep(400);

      // 关掉
      await c.eval("document.querySelector('.paper__close')?.click()");
      await sleep(500);
      const closed = await c.eval("Boolean(document.querySelector('.paper'))");
      ok("能关掉这张纸", closed === false);

      /* ---------- 第二条入口：档案页的「看就诊摘要」 ---------- */
      // 这条是复习时最常用的路径：不重开问诊，直接从问诊记录里调出那张纸
      await c.eval("document.querySelector('.consult__head .clay, .consult__close')?.click()");
      await c.send("Page.navigate", { url: `${BASE}/patients/${patient.id}` });
      await sleep(2600);
      // 摘要按钮在「问诊记录」这一页里，默认停在「用药」
      await c.eval(`(() => {
        const tab = [...document.querySelectorAll('.detail__tab')].find((t) => t.textContent.includes('问诊记录'));
        tab?.click();
      })()`);
      await sleep(600);
      const entry = await c.eval(`(() => {
        const btns = [...document.querySelectorAll('.vlogcard__sheet')];
        const b = btns[0];
        if (!b) return null;
        // 日历占了一大块，按钮可能在视口外 —— 鼠标事件是按视口坐标发的，先滚进来
        b.scrollIntoView({ block: 'center' });
        const r = b.getBoundingClientRect();
        return { text: b.textContent.trim(), ready: b.classList.contains('is-ready'), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      await sleep(400);
      ok("档案页有「看就诊摘要」按钮", Boolean(entry), JSON.stringify(entry));
      ok("刚生成过，按钮直接是「看」", entry?.text === "看就诊摘要" && entry?.ready === true, entry?.text);
      if (entry) {
        for (const type of ["mousePressed", "mouseReleased"]) {
          await c.send("Input.dispatchMouseEvent", { type, x: entry.x, y: entry.y, button: "left", clickCount: 1 });
        }
        await sleep(1400);
        const fromDetail = await c.eval(`(() => {
          const el = document.querySelector('.paper');
          if (!el) return null;
          return {
            name: el.querySelector('.paper__name')?.textContent || '',
            sections: [...el.querySelectorAll('.paper__h3')].map((x) => x.textContent.trim()),
            lead: el.querySelector('.paper__lead')?.textContent || '',
          };
        })()`);
        ok("档案页也能打开同一张纸", Boolean(fromDetail) && fromDetail.name === patient.name, JSON.stringify(fromDetail));
        // 已经存过就直接读，不该再调一次模型 —— 所以主诉要和刚才那张一致
        ok("读的是存下来的那张，没有重新生成", fromDetail?.lead === sheet?.lead, `${fromDetail?.lead} vs ${sheet?.lead}`);
        await c.shot("preview-sheet-detail.png");
        await c.eval("document.querySelector('.paper__close')?.click()");
        await sleep(400);
      }

      const errs = c.errors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
      ok("控制台没有报错", errs.length === 0, errs.slice(0, 2).join(" | "));
    } finally {
      chrome.kill();
    }

    /* --------------------------------------------------------- 5. 清理 */
    console.log("\n[5] 收尾");
    await api(`/api/consultations/${cid}`, { method: "DELETE" });
    // 测试里点「咨询」会让前端顺手建一条空问诊，走不同路径可能留下空壳 ——
    // 列表接口本来就过滤空问诊，用 Prisma 直接扫一遍这个档案的空壳删掉
    const swept = await prisma.consultation.deleteMany({
      where: { patientId: patient.id, messages: { none: {} }, summary: null, visitSheet: null },
    });
    if (swept.count > 0) console.log(`  （顺手清掉 ${swept.count} 条测试留下的空问诊）`);
    const after = await api(`/api/patients/${patient.id}/consultations`);
    ok("临时问诊已删除", !after.consultations.some((c) => c.id === cid));
  } catch (err) {
    failed += 1;
    console.error("\n脚本出错：", err);
  }

  console.log(`\n${failed === 0 ? "全部通过" : `${failed} 项失败`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
