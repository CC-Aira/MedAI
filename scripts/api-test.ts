/**
 * 接口自测清单
 *
 * 用法：
 *   1) npm run build && npx next start -p 3100
 *   2) API_BASE=http://127.0.0.1:3100 npm run test:api
 *
 * 覆盖四类必须成立的边界：
 *   · 未登录 → 401
 *   · 跨账号访问别人的数据 → 404（不区分"不存在"和"不是你的"）
 *   · 访问自己的数据 → 200
 *   · 非法输入 → 400
 */

const BASE = process.env.API_BASE || "http://127.0.0.1:3100";

type Result = { ok: boolean; name: string; detail: string };
const results: Result[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  results.push({ ok, name, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  ${mark}  ${name}${detail ? `  — ${detail}` : ""}`);
}

type Res = { status: number; body: any; cookie: string | null };

async function call(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string | null } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.cookie) headers["Cookie"] = init.cookie;

  const res = await fetch(`${BASE}${path}`, {
    method: init.method || "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: "manual",
  });

  let body: any = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  const raw = res.headers.get("set-cookie");
  const cookie = raw ? raw.split(";")[0] : null;

  return { status: res.status, body, cookie };
}

async function main(): Promise<void> {
  console.log(`\nMedAI 接口自测  →  ${BASE}\n`);

  const stamp = Date.now();
  const emailA = `a${stamp}@medai.test`;
  const emailB = `b${stamp}@medai.test`;
  const password = "medai-test-2026";

  /* ---------------------------------------------------------- 账号 */
  console.log("· 认证");

  const regA = await call("/api/auth/register", {
    method: "POST",
    body: { email: emailA, password },
  });
  check("注册账号 A → 201", regA.status === 201, `实际 ${regA.status}`);
  const cookieA = regA.cookie;
  check("注册后下发 httpOnly 会话 Cookie", !!cookieA, cookieA ? "有 Set-Cookie" : "没有下发");

  const regB = await call("/api/auth/register", {
    method: "POST",
    body: { email: emailB, password },
  });
  check("注册账号 B → 201", regB.status === 201, `实际 ${regB.status}`);
  const cookieB = regB.cookie;

  const dup = await call("/api/auth/register", {
    method: "POST",
    body: { email: emailA, password },
  });
  check("重复注册同一邮箱 → 400 或 409", dup.status === 400 || dup.status === 409, `实际 ${dup.status}`);

  const shortPw = await call("/api/auth/register", {
    method: "POST",
    body: { email: `c${stamp}@medai.test`, password: "123" },
  });
  check("密码太短 → 400", shortPw.status === 400, `实际 ${shortPw.status}`);

  const badEmail = await call("/api/auth/register", {
    method: "POST",
    body: { email: "not-an-email", password },
  });
  check("邮箱格式非法 → 400", badEmail.status === 400, `实际 ${badEmail.status}`);

  const wrongPw = await call("/api/auth/login", {
    method: "POST",
    body: { email: emailA, password: "wrong-password" },
  });
  check("密码错误 → 401", wrongPw.status === 401, `实际 ${wrongPw.status}`);

  const login = await call("/api/auth/login", {
    method: "POST",
    body: { email: emailA, password },
  });
  check("正确密码登录 → 200", login.status === 200, `实际 ${login.status}`);

  const bodyWithoutJson = await call("/api/auth/login", { method: "POST" });
  check("空 body → 400", bodyWithoutJson.status === 400, `实际 ${bodyWithoutJson.status}`);

  /* ---------------------------------------------------------- 未登录 */
  console.log("\n· 未登录一律 401");

  for (const [name, path, method] of [
    ["GET /api/patients", "/api/patients", "GET"],
    ["POST /api/patients", "/api/patients", "POST"],
    ["GET /api/growth", "/api/growth", "GET"],
    ["GET /api/patients/x", "/api/patients/whatever", "GET"],
    ["POST /api/upload/avatar", "/api/upload/avatar", "POST"],
  ] as const) {
    const r = await call(path, { method, body: method === "POST" ? {} : undefined });
    check(`${name} → 401`, r.status === 401, `实际 ${r.status}`);
  }

  /* ---------------------------------------------------------- 建档 */
  console.log("\n· 档案");

  const created = await call("/api/patients", {
    method: "POST",
    cookie: cookieA,
    body: {
      name: "自测档案",
      gender: "female",
      age: 31,
      allergies: "青霉素过敏",
      chiefComplaint: "反复头痛两周",
      ownerId: "hacker-tries-to-steal", // 必须被服务端忽略
    },
  });
  check("建档 → 201", created.status === 201, `实际 ${created.status}`);
  const patientId: string = created.body?.patient?.id;
  check("建档返回完整列表 patients[]", Array.isArray(created.body?.patients), "");
  check(
    "ownerId 由服务端决定（前端传的被忽略）",
    !!patientId && !created.body?.patient?.ownerId,
    "响应里不含 ownerId 字段",
  );

  const listA = await call("/api/patients", { cookie: cookieA });
  check("查自己的档案列表 → 200", listA.status === 200, `实际 ${listA.status}`);
  check("列表里有刚建的档案", (listA.body?.patients || []).length === 1, "");

  const detail = await call(`/api/patients/${patientId}`, { cookie: cookieA });
  check("查自己的档案详情 → 200", detail.status === 200, `实际 ${detail.status}`);

  const badName = await call("/api/patients", {
    method: "POST",
    cookie: cookieA,
    body: { name: "", gender: "female" },
  });
  check("姓名为空 → 400", badName.status === 400, `实际 ${badName.status}`);

  const badGender = await call("/api/patients", {
    method: "POST",
    cookie: cookieA,
    body: { name: "某人", gender: "unknown" },
  });
  check("性别不在白名单 → 400", badGender.status === 400, `实际 ${badGender.status}`);

  const longName = await call("/api/patients", {
    method: "POST",
    cookie: cookieA,
    body: { name: "名".repeat(40), gender: "male" },
  });
  check("姓名超长 → 400", longName.status === 400, `实际 ${longName.status}`);

  const patchOne = await call(`/api/patients/${patientId}`, {
    method: "PATCH",
    cookie: cookieA,
    body: { age: 32 },
  });
  check("只传 age 的 PATCH → 200", patchOne.status === 200, `实际 ${patchOne.status}`);
  check(
    "PATCH 不会把没传的字段擦成 null",
    patchOne.body?.patient?.allergies === "青霉素过敏" &&
      patchOne.body?.patient?.chiefComplaint === "反复头痛两周",
    `allergies=${patchOne.body?.patient?.allergies}`,
  );

  /* ------------------------------------------------------ 跨账号 404 */
  console.log("\n· 跨账号一律 404");

  const crossGet = await call(`/api/patients/${patientId}`, { cookie: cookieB });
  check("B 读 A 的档案 → 404", crossGet.status === 404, `实际 ${crossGet.status}`);

  const crossPatch = await call(`/api/patients/${patientId}`, {
    method: "PATCH",
    cookie: cookieB,
    body: { age: 99 },
  });
  check("B 改 A 的档案 → 404", crossPatch.status === 404, `实际 ${crossPatch.status}`);

  const crossDelete = await call(`/api/patients/${patientId}`, {
    method: "DELETE",
    cookie: cookieB,
  });
  check("B 删 A 的档案 → 404", crossDelete.status === 404, `实际 ${crossDelete.status}`);

  const crossMeds = await call(`/api/patients/${patientId}/medications`, {
    method: "POST",
    cookie: cookieB,
    body: { drugName: "偷加的" },
  });
  check("B 往 A 的档案加药 → 404", crossMeds.status === 404, `实际 ${crossMeds.status}`);

  const missing = await call(`/api/patients/does-not-exist`, { cookie: cookieA });
  check("不存在的 id → 404（与跨账号同码）", missing.status === 404, `实际 ${missing.status}`);

  const crossList = await call("/api/patients", { cookie: cookieB });
  check("B 的列表里看不到 A 的档案", (crossList.body?.patients || []).length === 0, "");

  /* ---------------------------------------------------------- 用药 */
  console.log("\n· 用药");

  const addMed = await call(`/api/patients/${patientId}/medications`, {
    method: "POST",
    cookie: cookieA,
    body: { drugName: "布洛芬缓释胶囊", dosage: "300mg", frequency: "每日两次" },
  });
  check("新增用药 → 201", addMed.status === 201, `实际 ${addMed.status}`);
  check("写操作返回完整 medications[]", Array.isArray(addMed.body?.medications), "");
  const medId: string = addMed.body?.medications?.[0]?.id;

  const longDrug = await call(`/api/patients/${patientId}/medications`, {
    method: "POST",
    cookie: cookieA,
    body: { drugName: "药".repeat(60) },
  });
  check("药名超 50 字 → 400", longDrug.status === 400, `实际 ${longDrug.status}`);

  const longDose = await call(`/api/patients/${patientId}/medications`, {
    method: "POST",
    cookie: cookieA,
    body: { drugName: "某药", dosage: "1".repeat(40) },
  });
  check("剂量超 30 字 → 400", longDose.status === 400, `实际 ${longDose.status}`);

  const stopMed = await call(`/api/medications/${medId}`, {
    method: "PATCH",
    cookie: cookieA,
    body: { isActive: false },
  });
  check("停用用药 → 200", stopMed.status === 200, `实际 ${stopMed.status}`);
  check("停用后仍在列表里（底部）", (stopMed.body?.medications || []).length === 1, "");

  const crossMed = await call(`/api/medications/${medId}`, {
    method: "PATCH",
    cookie: cookieB,
    body: { isActive: true },
  });
  check("B 改 A 的用药 → 404", crossMed.status === 404, `实际 ${crossMed.status}`);

  /* ---------------------------------------------------------- 问诊 */
  console.log("\n· 问诊与消息");

  const consult = await call(`/api/patients/${patientId}/consultations`, {
    method: "POST",
    cookie: cookieA,
    body: {},
  });
  check("新建问诊 → 201", consult.status === 201, `实际 ${consult.status}`);
  const consultId: string = consult.body?.consultation?.id;

  const crossConsult = await call(`/api/consultations/${consultId}`, {
    cookie: cookieB,
  });
  check("B 读 A 的问诊 → 404", crossConsult.status === 404, `实际 ${crossConsult.status}`);

  const emptyMsg = await call(`/api/consultations/${consultId}/messages`, {
    method: "POST",
    cookie: cookieA,
    body: { content: "" },
  });
  check("空消息 → 400", emptyMsg.status === 400, `实际 ${emptyMsg.status}`);

  const longMsg = await call(`/api/consultations/${consultId}/messages`, {
    method: "POST",
    cookie: cookieA,
    body: { content: "啊".repeat(2100) },
  });
  check("消息超 2000 字 → 400", longMsg.status === 400, `实际 ${longMsg.status}`);

  // 真实发一条：演示模式（MEDAI_DEMO_AI=1）也会返回同协议的 SSE 流
  const sendRes = await fetch(`${BASE}/api/consultations/${consultId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieA as string,
    },
    body: JSON.stringify({ content: "这两天头一直疼，早上更明显。" }),
  });
  const streamText = await sendRes.text();
  const hasDelta = streamText.includes('"type":"delta"');
  const hasDone = streamText.includes('"type":"done"');
  check("发消息返回 SSE 流 → 200", sendRes.status === 200, `实际 ${sendRes.status}`);
  check("流里有 delta 分片", hasDelta, "");
  check("流里有 done（此时才落库）", hasDone, "");

  const detailAfter = await call(`/api/consultations/${consultId}`, { cookie: cookieA });
  check(
    "落库后有 user + assistant 两条消息",
    (detailAfter.body?.consultation?.messages || []).length >= 2,
    `实际 ${(detailAfter.body?.consultation?.messages || []).length} 条`,
  );

  const summary = await call(`/api/consultations/${consultId}/summary`, {
    method: "POST",
    cookie: cookieA,
  });
  check("生成摘要 → 200", summary.status === 200, `实际 ${summary.status}`);

  const scan = await call(`/api/consultations/${consultId}/facts`, {
    method: "POST",
    cookie: cookieA,
  });
  check("扫描档案返回候选 → 200", scan.status === 200, `实际 ${scan.status}`);
  check("扫描是只读动作（只回 candidates）", Array.isArray(scan.body?.candidates), "");

  const applyTooMany = await call(`/api/consultations/${consultId}/facts`, {
    method: "PATCH",
    cookie: cookieA,
    body: {
      items: Array.from({ length: 25 }, (_, i) => ({
        id: `x${i}`,
        kind: "fill",
        field: "habits",
        value: "v",
        reason: "r",
        defaultChecked: true,
      })),
    },
  });
  check("一次应用超 20 条 → 400", applyTooMany.status === 400, `实际 ${applyTooMany.status}`);

  const applyBadField = await call(`/api/consultations/${consultId}/facts`, {
    method: "PATCH",
    cookie: cookieA,
    body: {
      items: [
        {
          id: "y1",
          kind: "fill",
          field: "ownerId", // 不在白名单
          value: "hacker",
          reason: "r",
          defaultChecked: true,
        },
      ],
    },
  });
  check("字段不在白名单 → 400", applyBadField.status === 400, `实际 ${applyBadField.status}`);

  /* ---------------------------------------------------------- 结论 */
  console.log("\n· 结论");

  const note = await call(`/api/patients/${patientId}/notes`, {
    method: "POST",
    cookie: cookieA,
    body: { title: "头痛记录", content: "早上最明显，午后缓解。", tags: "头痛,复查" },
  });
  check("新建结论 → 201", note.status === 201, `实际 ${note.status}`);
  const noteId: string = note.body?.note?.id;
  check("写操作返回完整 notes[]", Array.isArray(note.body?.notes), "");

  const star = await call(`/api/notes/${noteId}`, {
    method: "PATCH",
    cookie: cookieA,
    body: { isFavorite: true },
  });
  check("星标结论 → 200", star.status === 200, `实际 ${star.status}`);

  const crossNote = await call(`/api/notes/${noteId}`, {
    method: "PATCH",
    cookie: cookieB,
    body: { isFavorite: false },
  });
  check("B 改 A 的结论 → 404", crossNote.status === 404, `实际 ${crossNote.status}`);

  const longNote = await call(`/api/patients/${patientId}/notes`, {
    method: "POST",
    cookie: cookieA,
    body: { title: "标".repeat(50), content: "内容" },
  });
  check("标题超 40 字 → 400", longNote.status === 400, `实际 ${longNote.status}`);

  /* ---------------------------------------------------------- 成长 */
  console.log("\n· 成长");

  const growth = await call("/api/growth", { cookie: cookieA });
  check("查成长数据 → 200", growth.status === 200, `实际 ${growth.status}`);
  check(
    "成长只统计自己的数据",
    growth.body?.growth?.patients === 1,
    `patients=${growth.body?.growth?.patients}`,
  );

  /* ------------------------------------------------------ 删除幂等 */
  console.log("\n· 删除");

  const delNote = await call(`/api/notes/${noteId}`, { method: "DELETE", cookie: cookieA });
  check("删结论 → 200", delNote.status === 200, `实际 ${delNote.status}`);
  const delNoteAgain = await call(`/api/notes/${noteId}`, {
    method: "DELETE",
    cookie: cookieA,
  });
  check("重复删结论 → 404（幂等）", delNoteAgain.status === 404, `实际 ${delNoteAgain.status}`);

  const delConsult = await call(`/api/consultations/${consultId}`, {
    method: "DELETE",
    cookie: cookieA,
  });
  check("删问诊 → 200", delConsult.status === 200, `实际 ${delConsult.status}`);
  const delConsultAgain = await call(`/api/consultations/${consultId}`, {
    method: "DELETE",
    cookie: cookieA,
  });
  check("重复删问诊 → 404（幂等）", delConsultAgain.status === 404, `实际 ${delConsultAgain.status}`);

  const delPatient = await call(`/api/patients/${patientId}`, {
    method: "DELETE",
    cookie: cookieA,
  });
  check("删档案 → 200 并返回剩余列表", delPatient.status === 200, `实际 ${delPatient.status}`);
  const delPatientAgain = await call(`/api/patients/${patientId}`, {
    method: "DELETE",
    cookie: cookieA,
  });
  check("重复删档案 → 404（幂等）", delPatientAgain.status === 404, `实际 ${delPatientAgain.status}`);

  const afterDelete = await call(`/api/patients/${patientId}`, { cookie: cookieA });
  check("删完再查 → 404", afterDelete.status === 404, `实际 ${afterDelete.status}`);

  /* ---------------------------------------------------------- 登出 */
  console.log("\n· 登出");

  const out = await call("/api/auth/logout", { method: "POST", cookie: cookieA });
  check("登出 → 200", out.status === 200, `实际 ${out.status}`);
  check(
    "登出下发清空 Cookie（max-age=0）",
    !!out.cookie && out.cookie.includes("medai_session="),
    out.cookie ?? "没有 Set-Cookie",
  );

  // 浏览器此时会把 Cookie 覆盖成空值，这里用登出响应里的那条来模拟
  const afterLogout = await call("/api/patients", { cookie: out.cookie });
  check("登出后带清空值访问 → 401", afterLogout.status === 401, `实际 ${afterLogout.status}`);

  // 说明：会话是 HMAC 无状态签名，服务端不存白名单，
  // 所以"被偷走的那串旧 token"在 7 天到期前仍然有效。
  // 真要做到即时吊销，得加一张 token 黑名单表 —— 本项目的取舍是保持无状态。
  console.log(
    "  NOTE  会话是无状态 HMAC 签名：旧 token 值本身在到期前仍可用，登出只清浏览器侧 Cookie",
  );

  /* ---------------------------------------------------------- 汇总 */
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} 通过` +
      (failed.length ? `，${failed.length} 项失败：\n  - ${failed.map((f) => f.name).join("\n  - ")}` : ""),
  );

  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("\n自测脚本自身出错：", err);
  process.exitCode = 1;
});
