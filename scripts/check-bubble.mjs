/**
 * 兔子气泡自检（需要先启动服务）。
 *   node scripts/check-bubble.mjs [baseUrl]
 *
 * 覆盖：欢迎语、点击兔子换一句、对外接口 rabbitSay/rabbitSayReply、
 *      站立/趴框两种摆放、视口内不越界、移动端尺寸、控制台无报错。
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3100";
const HOST = new URL(BASE).hostname;
const PORT = 9353;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function ok(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? `  ← ${extra}` : ""}`);
  }
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
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
  const raw = (res.headers.getSetCookie?.() || []).find((c) => c.startsWith("medai_session="));
  if (!raw) throw new Error("没拿到 medai_session");
  return raw.split(";")[0].slice("medai_session=".length);
}


const DECO_SCAN = `(() => {
  const m = window.__meadow, cam = m.camera, a = m.rabbitAnchor();
  const bp = m.ballRoot.position;
  const hits = [];
  const scan = (pts, maxSize, kind, minPx) => {
    const pos = pts.geometry.attributes.position, sz = pts.geometry.attributes.aSize;
    for (let i = 0; i < pos.count; i++) {
      const p = new (bp.constructor)(pos.getX(i), pos.getY(i), pos.getZ(i));
      // 只看"在兔子前面、且在相机前面"的：后面的会被兔子正常挡住
      if (!(p.z > bp.z + 0.05 && p.z < cam.position.z - 0.2)) continue;
      const q = p.clone().project(cam);
      const x = (q.x * 0.5 + 0.5) * innerWidth;
      const y = (-q.y * 0.5 + 0.5) * innerHeight;
      const px = Math.min(maxSize, sz.getX(i) * 600 / Math.max(0.001, p.distanceTo(cam.position)));
      if (px < minPx) continue;
      const dx = (x - a.cx) / (a.rx + px / 2);
      const dy = (y - a.cy) / (a.ry + px / 2);
      if (dx * dx + dy * dy < 1) hits.push({ kind, x: Math.round(x), y: Math.round(y), px: Math.round(px) });
    }
  };
  scan(m.dandelions, 120, "head", 1);
  scan(m.seeds, 52, "seed", 16);
  return hits;
})()`;

const READ = `(() => {
  const el = document.querySelector('.rbubble');
  const box = document.querySelector('.rbubble__box');
  const a = window.__meadow?.rabbitAnchor?.() || null;
  const r = box ? box.getBoundingClientRect() : null;
  return {
    exists: Boolean(el),
    on: el ? el.classList.contains('is-on') : false,
    side: el?.dataset.side || null,
    away: el?.dataset.away || '0',
    opacity: el ? Number(getComputedStyle(el).opacity) : 0,
    tone: el?.dataset.tone || null,
    cat: el?.dataset.cat || null,
    hasTag: Boolean(document.querySelector('.rbubble__tag')),
    text: document.querySelector('.rbubble__text')?.textContent || '',
    tail: document.querySelector('.rbubble__tail')?.textContent || '',
    rect: r && { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    anchor: a && { x: Math.round(a.x), y: Math.round(a.y), cx: Math.round(a.cx), rx: Math.round(a.rx), perched: a.perched },
    vw: innerWidth, vh: innerHeight,
  };
})()`;

async function main() {
  const token = await login();
  const profile = await mkdtemp(path.join(tmpdir(), "medai-bubble-"));
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

    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await c.send("Page.navigate", { url: `${BASE}/?debug=1` });

    // 等场景挂上
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        ready = await c.eval("Boolean(window.__meadow && window.__meadow.ballRoot)");
      } catch {}
      if (ready) break;
      await sleep(500);
    }
    ok("3D 场景已挂载", ready);
    if (!ready) throw new Error("场景没起来，后面没法测");

    await c.eval("document.querySelector('.boot__skip')?.click()");
    await sleep(2600);

    /* ---------------- 1. 欢迎语 ---------------- */
    console.log("\n[1] 加载后自动欢迎");
    let s = await c.eval(READ);
    ok("气泡已出现", s.exists && s.on);
    ok("有欢迎语文本", s.text.length > 6, s.text);
    ok("初始是欢迎语分类", s.cat === "welcome", `cat=${s.cat}`);
    ok("语气为 greet", s.tone === "greet", s.tone);
    ok("气泡上没有任何标签", s.hasTag === false);
    ok("气泡在兔子头顶上方", s.side === "top" && s.rect.y + s.rect.h <= s.anchor.y, JSON.stringify(s.rect) + JSON.stringify(s.anchor));
    const gapTop = s.anchor.y - (s.rect.y + s.rect.h);
    ok("与兔子留有空隙(6~26px)", gapTop >= 6 && gapTop <= 26, `${gapTop}px`);

    /* ---------------- 2. 点兔子换一句 ---------------- */
    console.log("\n[2] 点击兔子随机换一句");
    const before = s.text;
    const clickAt = await c.eval(
      "(() => { const a = window.__meadow.rabbitAnchor(); return { x: Math.round(a.cx), y: Math.round(a.cy) }; })()",
    );
    await c.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: clickAt.x, y: clickAt.y, button: "left", clickCount: 1,
    });
    await c.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: clickAt.x, y: clickAt.y, button: "left", clickCount: 1,
    });
    await sleep(700);
    s = await c.eval(READ);
    ok("点兔子后有反应", s.on);
    ok("换成了另一句", s.text !== before, `before=${before} after=${s.text}`);
    ok("点出来的句子来自四大分类之一", ["welcome", "comfort", "health", "medical"].includes(s.cat), `cat=${s.cat}`);
    ok("语气和分类对得上", ["greet", "care", "remind", "visit"].includes(s.tone), s.tone);

    // 连点三次，确认不会连着重复
    const seen = new Set([s.text]);
    let repeats = 0;
    for (let i = 0; i < 3; i++) {
      await c.send("Input.dispatchMouseEvent", {
        type: "mousePressed", x: clickAt.x, y: clickAt.y, button: "left", clickCount: 1,
      });
      await sleep(420);
      const t = await c.eval("document.querySelector('.rbubble__text')?.textContent || ''");
      if (seen.has(t)) repeats++;
      seen.add(t);
    }
    ok("连点不重复上一句", repeats === 0, `${repeats} 次重复`);

    /* ---------------- 2b. 点击的物理反馈：跳一下 + 啾一声 ---------------- */
    console.log("\n[2b] 点击后跳一下、出声");
    await c.eval(`(() => {
      window.__osc = 0;
      const AC = window.AudioContext;
      if (AC && !AC.prototype.__patched) {
        const orig = AC.prototype.createOscillator;
        AC.prototype.createOscillator = function () {
          window.__osc += 1;
          return orig.call(this);
        };
        AC.prototype.__patched = true;
      }
      return true;
    })()`);

    // 等上一轮连点引起的跳跃彻底落地，否则基线是半空中的
    await sleep(750);
    const beforeY = await c.eval("Math.round(window.__meadow.rabbitAnchor().cy)");
    await c.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: clickAt.x, y: clickAt.y, button: "left", clickCount: 1,
    });
    await c.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: clickAt.x, y: clickAt.y, button: "left", clickCount: 1,
    });
    await sleep(180);
    const hopY = await c.eval("Math.round(window.__meadow.rabbitAnchor().cy)");
    ok("点一下会跳起来", beforeY - hopY >= 8, `cy ${beforeY} → ${hopY}`);
    const hopLeft = await c.eval("window.__meadow.hopLeft");
    ok("跳跃在计时中", hopLeft > 0, `hopLeft=${hopLeft}`);
    await sleep(600);
    const settledY = await c.eval("Math.round(window.__meadow.rabbitAnchor().cy)");
    ok("半秒后落回地面", Math.abs(settledY - beforeY) <= 8, `cy ${settledY} vs ${beforeY}`);
    const osc = await c.eval("window.__osc");
    ok("同时响了（合成器建了 3 个振荡器）", osc >= 3, `osc=${osc}`);

    /* ---------------- 2c. 桌面注视：真的看着鼠标 ---------------- */
    console.log("\n[2c] 桌面注视");
    const baseYaw = await c.eval(`(() => {
      const m = window.__meadow, bp = m.ballRoot.position, cam = m.camera;
      return -Math.atan2(bp.x - cam.position.x, cam.position.z - bp.z) * 0.93;
    })()`);
    const look = async (x, y) => {
      await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
      await sleep(650);
      return c.eval("window.__meadow.eyeAim.yaw");
    };
    const yawLeft = await look(60, 450);
    ok("鼠标在左边 → 转头向左", yawLeft < baseYaw - 0.3, `yaw=${yawLeft.toFixed(2)} 正脸=${baseYaw.toFixed(2)}`);
    const yawRight = await look(1400, 450);
    ok("鼠标在右边 → 转头向右", yawRight > baseYaw + 0.1, `yaw=${yawRight.toFixed(2)} 正脸=${baseYaw.toFixed(2)}`);
    const yawOn = await look(clickAt.x, clickAt.y);
    ok("鼠标落在兔子身上 → 正面朝人", Math.abs(yawOn - baseYaw) < 0.1, `yaw=${yawOn.toFixed(2)} 正脸=${baseYaw.toFixed(2)}`);

    // 兔子还站在草地上的时候，检查蒲公英有没有压在它身上
    const decoD = await c.eval(DECO_SCAN);
    ok("桌面：绒球没有压在兔子身上", decoD.filter((h) => h.kind === "head").length === 0, JSON.stringify(decoD.slice(0, 4)));
    ok("桌面：没有大颗种子盖住兔子", decoD.filter((h) => h.kind === "seed").length === 0, JSON.stringify(decoD.slice(0, 4)));

    /* ---------------- 3. 预留接口 ---------------- */
    console.log("\n[3] 对外接口（问诊表单对接用）");
    const api = await c.eval(
      "(() => { const r = window.medaiRabbit; return r ? Object.keys(r) : null; })()",
    );
    ok("window.medaiRabbit 已暴露", Array.isArray(api) && api.includes("showBubble"), JSON.stringify(api));
    ok("全局 window.showBubble 已暴露", (await c.eval("typeof window.showBubble")) === "function");

    // 表单那边最可能的调用方式：拿到模型回复直接丢给 showBubble
    await c.eval(`window.showBubble("从化验单看，白细胞偏高，更像是细菌感染。")`);
    await sleep(500);
    s = await c.eval(READ);
    ok("全局 showBubble 能直接显示", s.text.includes("白细胞"), s.text);
    ok("showBubble 自动配了鼓励话术", s.tail.length > 3, s.tail);

    await c.eval(`window.medaiRabbit.say("这是一句测试话术。", { tone: "care" })`);
    await sleep(400);
    s = await c.eval(READ);
    ok("rabbitSay 能直接说", s.text === "这是一句测试话术。", s.text);

    // 模拟问诊表单提交后把大模型回答塞进气泡
    const long =
      "您好，我是 MedAI。从你描述的情况看，发热三天伴咽痛，最可能是病毒性上呼吸道感染。" +
      "建议先对症处理：多喝温水、体温超过 38.5℃ 时可用对乙酰氨基酚，注意间隔 4~6 小时。" +
      "如果出现呼吸困难、持续高热不退，请及时去医院。";
    await c.eval(`window.medaiRabbit.reply(${JSON.stringify(long)})`);
    await sleep(450);
    s = await c.eval(READ);
    ok("reply 语气为 reply", s.tone === "reply", s.tone);
    ok("回复被压成一句(<=70字)", s.text.length > 8 && s.text.length <= 70, `${s.text.length} 字 / ${s.text}`);
    ok("不会把「我是 MedAI」带进气泡", !s.text.startsWith("我是 MedAI"), s.text);
    ok("附带了鼓励话术", s.tail.length > 3, s.tail);
    ok("回复态也没有标签", s.hasTag === false);

    /* ---------------- 4. 趴框态 ---------------- */
    console.log("\n[4] 趴到问诊框沿之后");
    await c.eval("document.querySelector('.record__btn')?.click()");
    await sleep(3400);
    s = await c.eval(READ);
    ok("兔子已趴上框沿", s.anchor?.perched === true, JSON.stringify(s.anchor));
    ok("气泡仍然可见", s.on);
    ok("气泡在视口内", s.rect.x >= 0 && s.rect.y >= 0 && s.rect.x + s.rect.w <= s.vw && s.rect.y + s.rect.h <= s.vh, JSON.stringify(s.rect));
    ok("不压住兔子本体", s.rect.x >= s.anchor.cx + s.anchor.rx - 2 || s.rect.y + s.rect.h <= s.anchor.y + 4, `side=${s.side}`);
    // 按钮区必须始终干净：短句、以及更高的回复气泡，两种都要测
    const hits = () => c.eval(`(() => {
      const rect = (s) => { const n = document.querySelector(s); return n ? n.getBoundingClientRect() : null; };
      const b = rect('.rbubble__box');
      const out = {};
      for (const [k, sel] of [['close', '.consult__close'], ['open', '.consult__open']]) {
        const t = rect(sel);
        if (!b || !t) { out[k] = 'none'; continue; }
        out[k] = (!(b.right <= t.left || b.left >= t.right || b.bottom <= t.top || b.top >= t.bottom)) ? 'HIT' : 'ok';
      }
      out.size = b ? Math.round(b.height) : 0;
      return out;
    })()`);

    const shortHit = await hits();
    ok("短句气泡不压按钮", shortHit.close === "ok" && shortHit.open === "ok", JSON.stringify(shortHit));

    // 换成一条长回答：气泡变高，最容易压到按钮，这是用户报过的问题
    await c.eval(`window.medaiRabbit.reply("从描述看，右侧上颌部疼三天、吃饭加重，更像牙源性感染，先温盐水漱口、避免过冷过热，48 小时不好转要看口腔科。")`);
    await sleep(700);
    const tallHit = await hits();
    const tall = await c.eval(READ);
    ok("回复气泡不压按钮", tallHit.close === "ok" && tallHit.open === "ok", JSON.stringify(tallHit));
    ok("回复气泡仍然贴在兔子边上", tall.side === "right", `side=${tall.side}`);
    ok("回复气泡还在视口内", tall.rect.x + tall.rect.w <= tall.vw, JSON.stringify(tall.rect));


    /* ---------------- 5. 移动端 ---------------- */
    console.log("\n[5] 移动端 390×844（重新加载，走真实的手机流程）");
    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    await c.send("Page.navigate", { url: `${BASE}/?debug=1` });
    for (let i = 0; i < 60; i++) {
      try {
        if (await c.eval("Boolean(window.__meadow && window.__meadow.ballRoot)")) break;
      } catch {}
      await sleep(500);
    }
    await c.eval("document.querySelector('.boot__skip')?.click()");
    await sleep(2600);

    s = await c.eval(READ);
    ok("手机草地态：有欢迎语", s.on && s.text.length > 6, s.text);
    ok("手机草地态：气泡在头顶且不越界", s.side === "top" && s.rect.y >= 0 && s.rect.x >= 0 && s.rect.x + s.rect.w <= 390, JSON.stringify(s.rect));

    // 打开问诊框 —— 手机上头顶空间不够，气泡应让位
    await c.eval("document.querySelector('.record__btn')?.click()");
    await sleep(3400);
    s = await c.eval(READ);
    const covering = s.rect && s.rect.y + s.rect.h > s.anchor.y + 6 && s.rect.y < s.anchor.y + 60;
    ok("手机问诊态：兔子已趴上框沿", s.anchor?.perched === true, JSON.stringify(s.anchor));
    ok("手机问诊态：不盖住兔子（挤不下就让位）", s.away === "1" || !covering, `away=${s.away} side=${s.side}`);
    ok("手机问诊态：让位时真的透明", s.away !== "1" || s.opacity === 0, `opacity=${s.opacity}`);

    // 关掉问诊框回到草地，气泡应该重新出现
    await c.eval("document.querySelector('.consult__close')?.click()");
    await sleep(2800);
    await c.eval(`window.medaiRabbit.say("回到草地啦。", { tone: "care" })`);
    await sleep(800);
    s = await c.eval(READ);
    ok("回到草地后重新显示", s.away === "0" && s.opacity > 0.9, `away=${s.away} opacity=${s.opacity}`);
    ok("回到草地后仍在头顶", s.side === "top" && s.rect.y + s.rect.h <= s.anchor.y + 1, `side=${s.side}`);

    /* ---------------- 6. 面部补光 ---------------- */
    console.log("\n[6] 兔子脸上的补光");
    const light = await c.eval(`(() => {
      const m = window.__meadow, l = m.faceLight;
      if (!l) return null;
      const bp = m.ballRoot.position, cam = m.camera;
      return {
        intensity: +l.intensity.toFixed(3),
        toRabbit: +l.position.distanceTo(bp).toFixed(2),
        nearCamera: l.position.distanceTo(cam.position) < bp.distanceTo(cam.position),
        scale: +m.ballRoot.scale.x.toFixed(3),
      };
    })()`);
    ok("面部补光存在且亮着", Boolean(light) && light.intensity > 0.2, JSON.stringify(light));
    ok("灯在兔子和镜头之间（照的是脸）", Boolean(light) && light.nearCamera);
    // 灯故意拉远到约 2 个单位，光才柔；超过 3 就成环境光了
    ok("灯离头约两个单位（柔光）", Boolean(light) && light.toRabbit > 1.1 && light.toRabbit < 2.8, `d=${light?.toRabbit}`);

    /* ---------------- 6b. 天空积云 ---------------- */
    console.log("\n[6b] 写实积云");
    const cloudInfo = await c.eval(`(() => {
      const m = window.__meadow;
      if (!m.clouds) return null;
      const bp = m.ballRoot.position;
      let quads = 0, behind = 0, above = 0, noRay = 0;
      for (const c of m.clouds) {
        const q = c.group.children;
        quads += q.length;
        if (c.group.position.z < bp.z - 20) behind++;
        if (c.group.position.y > bp.y + 6) above++;
        for (const mesh of q) if (typeof mesh.raycast === "function") noRay++;
      }
      return { n: m.clouds.length, quads, behind, above, noRay, wrap: m.cloudWrap };
    })()`);
    ok("云层已生成", Boolean(cloudInfo) && cloudInfo.n > 0, JSON.stringify(cloudInfo));
    ok("云的数量适中（4~12 朵）", cloudInfo.n >= 4 && cloudInfo.n <= 12, `${cloudInfo.n} 朵`);
    ok("每朵云由多层贴片叠成（≥3 层）", cloudInfo.quads >= cloudInfo.n * 3, `${cloudInfo.quads} 片 / ${cloudInfo.n} 朵`);
    ok("云全部在兔子后方（不会被当成前景）", cloudInfo.behind === cloudInfo.n, `${cloudInfo.behind}/${cloudInfo.n}`);
    ok("云全部在兔子上方", cloudInfo.above === cloudInfo.n, `${cloudInfo.above}/${cloudInfo.n}`);
    ok("云片都禁用了射线拾取", cloudInfo.noRay === cloudInfo.quads, `${cloudInfo.noRay}/${cloudInfo.quads}`);

    // 漂移：等两秒，x 应该往前走，而且速度是"平缓"的
    const drift = await c.eval(`(() => { const c = window.__meadow.clouds[0]; return c.group.position.x; })()`);
    await sleep(2000);
    const drift2 = await c.eval(`(() => { const c = window.__meadow.clouds[0]; return c.group.position.x; })()`);
    const moved = drift2 - drift;
    ok("云在横向漂移", moved > 0.2, `2 秒移动 ${moved.toFixed(2)} 单位`);
    ok("漂移是平缓的（<3 单位/秒）", moved / 2 < 3, `${(moved / 2).toFixed(2)}/秒`);

    // 云不能挡在兔子正前方：取兔子中心那条竖线，云底不能低于兔头顶
    const overlap = await c.eval(`(() => {
      const m = window.__meadow, cam = m.camera;
      const a = m.rabbitAnchor();
      let worst = null;
      for (const c of m.clouds) {
        c.group.updateMatrixWorld(true);
        c.group.traverse((o) => {
          if (!o.isMesh) return;
          const g = o.geometry.parameters;
          // 贴片下沿 14% 以内是透明边，取"云体实际能到的最低点"
          for (const sx of [-0.5, 0.5]) {
            const p = new o.position.constructor(sx * g.width, -0.36 * g.height, 0);
            p.applyMatrix4(o.matrixWorld).project(cam);
            const px = (p.x * 0.5 + 0.5) * innerWidth;
            const py = (-p.y * 0.5 + 0.5) * innerHeight;
            if (Math.abs(px - a.cx) < a.rx + 20) {
              if (!worst || py > worst.bottom) worst = { bottom: py, cloudX: Math.round(c.group.position.x) };
            }
          }
        });
      }
      return { headTop: Math.round(a.y), worst };
    })()`);
    ok(
      "正对兔子那条竖线上，云不会压到兔头以下",
      !overlap.worst || overlap.worst.bottom < overlap.headTop,
      `云底 ${Math.round(overlap.worst?.bottom ?? 0)} vs 兔头顶 ${overlap.headTop}`,
    );

    /* ---------------- 6c. 蒲公英不挡兔子 ---------------- */
    console.log("\n[6c] 蒲公英不遮兔子（手机）");
    const decoM = await c.eval(DECO_SCAN);
    ok("手机：绒球没有压在兔子身上", decoM.filter((h) => h.kind === "head").length === 0, JSON.stringify(decoM.slice(0, 4)));
    ok("手机：没有大颗种子盖住兔子", decoM.filter((h) => h.kind === "seed").length === 0, JSON.stringify(decoM.slice(0, 4)));

    /* ---------------- 7. 控制台 ---------------- */
    console.log("\n[7] 控制台");
    const noisy = c.errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
    ok("没有 JS 报错", noisy.length === 0, noisy.slice(0, 3).join(" | "));

    ws.close();
  } finally {
    chrome.kill();
  }

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("\n自检失败：", e.message);
  process.exit(1);
});
