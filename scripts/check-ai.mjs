/**
 * DeepSeek 连通性自检。
 * 用法：npm run ai:check
 * 只读 .env，不落库、不改数据；发一条最小请求确认 Key / 模型名 / 网络都通。
 */

const key = (process.env.DEEPSEEK_API_KEY || "").trim();
const base = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
const model = process.env.DEEPSEEK_MODEL || "deepseek-flash";
const demo = process.env.MEDAI_DEMO_AI === "1";

const line = (s = "") => console.log(s);
line("── MedAI · AI 配置自检 ──");
line(`BASE_URL  ${base}`);
line(`MODEL     ${model}`);
line(`DEMO_MODE ${demo ? "开（无 Key 时用本地模拟）" : "关"}`);

if (!key) {
  line("");
  line("✗ DEEPSEEK_API_KEY 是空的");
  line(`  → 问诊现在回答的是本地模板：${demo ? "已开启演示模式，会用固定话术拼接" : "会直接报 503"}`);
  line("  → 去 https://platform.deepseek.com/api_keys 建一个，填进 .env 的 DEEPSEEK_API_KEY");
  line("  → 改完重启服务：先关掉黑窗口，再双击「MedAI 启动.bat」");
  process.exit(1);
}

line(`KEY       ${key.slice(0, 6)}…${key.slice(-4)}（${key.length} 位）`);
line("");

const t0 = Date.now();
let res;
try {
  res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "只回复两个字：正常" }],
      stream: false,
      max_tokens: 16,
      thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(30000),
  });
} catch (err) {
  line(`✗ 连不上上游（${err?.name === "TimeoutError" ? "30 秒超时" : err?.message}）`);
  line("  → 检查网络 / 代理。挂了代理的机器，Node 需要能出网；也可以设 HTTPS_PROXY 再试");
  process.exit(2);
}

const ms = Date.now() - t0;

if (!res.ok) {
  const detail = (await res.text().catch(() => "")).slice(0, 300);
  line(`✗ 上游返回 ${res.status}（${ms}ms）`);
  line(`  ${detail}`);
  if (res.status === 401 || res.status === 403) line("  → Key 无效或已失效，去控制台重新建一个");
  if (res.status === 400) line("  → 多半是 DEEPSEEK_MODEL 写错了，当前官方名字是 deepseek-flash");
  if (res.status === 402) line("  → 账户余额不足，需要充值");
  process.exit(3);
}

const data = await res.json();
const text = data?.choices?.[0]?.message?.content ?? "";
line(`✓ 通了（${ms}ms）`);
line(`  模型回复：${text.trim() || "(空)"}`);
line(`  用量：prompt ${data?.usage?.prompt_tokens ?? "?"} / completion ${data?.usage?.completion_tokens ?? "?"}`);
line("");
line("下一步：把 .env 里的 MEDAI_DEMO_AI 清空，重启服务，问诊就是真模型在答了。");
