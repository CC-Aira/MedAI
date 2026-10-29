/**
 * 知识库页面端到端检查：未登录跳转、登录后三个入口、列表与详情内容。
 * 用法：node scripts/knowledge-page-test.mjs [baseUrl]
 */
const BASE = process.argv[2] || "http://127.0.0.1:3100";
const EMAIL = process.env.DEMO_EMAIL || "demo@medai.local";
const PASS = process.env.DEMO_PASS || "Medai@2026";

let cookie = "";
let failed = 0;

const ok = (c, m) => {
  if (!c) failed += 1;
  console.log(`${c ? "✓" : "✗"} ${m}`);
};

async function req(pathname, init = {}) {
  return fetch(`${BASE}${pathname}`, {
    ...init,
    redirect: "manual",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(init.headers || {}),
    },
  });
}

async function main() {
  console.log(`目标 ${BASE}\n`);

  // 1. 未登录应被挡回登录页
  const anon = await req("/library");
  ok(
    anon.status === 307 || anon.status === 302,
    `未登录访问 /library 被拦截（${anon.status} → ${anon.headers.get("location") || "-"}）`,
  );

  // 2. 登录
  const login = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  ok(login.ok, `登录 ${EMAIL}（${login.status}）`);
  cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("没拿到登录 cookie");

  // 3. 首页三个入口
  const home = await req("/");
  const homeHtml = await home.text();
  ok(home.ok, `首页可访问（${home.status}, ${homeHtml.length} 字节）`);
  ok(homeHtml.includes("疾病科普") && homeHtml.includes("药品说明"), "首页出现「疾病科普」「药品说明」入口");
  ok(homeHtml.includes('href="/library"') && homeHtml.includes('href="/drugs"'), "入口链接指向 /library 与 /drugs");

  // 4. 疾病科普列表
  const lib = await req("/library");
  const libHtml = await lib.text();
  ok(lib.ok, `疾病科普库可访问（${lib.status}, ${libHtml.length} 字节）`);
  ok(libHtml.includes("疾病科普库"), "页面标题含「疾病科普库」");
  ok(libHtml.includes("高血压") && libHtml.includes("2 型糖尿病"), "列表含常见病条目");
  ok(/呼吸内科|心血管内科/.test(libHtml), "列表含科室分类标签");
  ok(libHtml.includes("整理于"), "卡片标注整理日期");

  // 5. 疾病详情
  const dz = await req("/library/hypertension");
  const dzHtml = await dz.text();
  ok(dz.ok, `疾病详情 /library/hypertension（${dz.status}）`);
  for (const key of ["为什么会得", "有什么表现", "出现这些情况别拖", "怎么预防", "治疗原则", "信息来源", "更新日期"]) {
    ok(dzHtml.includes(key), `  详情含「${key}」`);
  }

  // 6. 药品列表
  const drugs = await req("/drugs");
  const drugsHtml = await drugs.text();
  ok(drugs.ok, `药品库可访问（${drugs.status}, ${drugsHtml.length} 字节）`);
  ok(drugsHtml.includes("药品说明查询"), "页面标题含「药品说明查询」");
  ok(drugsHtml.includes("布洛芬") && drugsHtml.includes("对乙酰氨基酚"), "列表含常用药");
  ok(drugsHtml.includes("OTC") && drugsHtml.includes("Rx"), "区分处方药与非处方药");
  ok(drugsHtml.includes("更新于"), "卡片标注更新日期");

  // 7. 药品详情六项
  const dr = await req("/drugs/ibuprofen");
  const drHtml = await dr.text();
  ok(dr.ok, `药品详情 /drugs/ibuprofen（${dr.status}）`);
  for (const key of [
    "适应症",
    "用法用量",
    "禁忌人群",
    "副作用",
    "药物相互作用",
    "特殊人群用药注意事项",
    "信息来源",
    "更新日期",
  ]) {
    ok(drHtml.includes(key), `  详情含「${key}」`);
  }

  // 8. 不存在的 slug 应 404
  const miss = await req("/library/not-a-real-disease");
  ok(miss.status === 404, `不存在的病种返回 404（${miss.status}）`);
  const missDrug = await req("/drugs/not-a-real-drug");
  ok(missDrug.status === 404, `不存在的药品返回 404（${missDrug.status}）`);

  console.log(failed === 0 ? "\n全部通过 ✓\n" : `\n${failed} 项未通过 ✗\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("测试失败：", e.message);
  process.exit(1);
});
