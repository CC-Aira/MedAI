/**
 * 直接打接口看「整理进档案」到底返回了什么。
 *   node scripts/probe-facts.mjs [baseUrl]
 */
const BASE = process.argv[2] || "http://localhost:3100";

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
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const { patients } = await fetch(`${BASE}/api/patients`, { headers: { cookie } }).then((r) => r.json());
const patient = patients.find((p) => p.name === "江雁南") || patients[0];
console.log(`档案：${patient.name} · 现有用药：${patient.medications.map((m) => m.drugName).join("、") || "无"}`);

const created = await api(`/api/patients/${patient.id}/consultations`, { method: "POST", body: "{}" });
const cid = created.body.consultation.id;
console.log(`临时问诊 ${cid}`);

const say = await fetch(`${BASE}/api/consultations/${cid}/messages`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ content: "我这两个月在吃二甲双胍，一次一片，一天两次" }),
});
await say.text();

const facts = await api(`/api/consultations/${cid}/facts`, { method: "POST" });
console.log("\n扫描结果：", JSON.stringify(facts, null, 2).slice(0, 1500));

await api(`/api/consultations/${cid}`, { method: "DELETE" });
