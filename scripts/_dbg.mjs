#!/usr/bin/env node
/**
 * 打省赛提交包（.zip）。
 *
 *   node scripts/pack-submission.mjs --team "广东医科大学+陈妍萱+18612345678"
 *
 * 与 `pack.mjs` 的分工：
 *   pack.mjs           —— 部署包，给「拿到就能跑」的机器用（含 .next 构建产物）
 *   pack-submission.mjs —— 提交包，给评委看（源码 + 说明文档 + 视频 + PPT）
 *
 * 提交包用**白名单**而不是黑名单：只收明确列出来的东西。
 * 提交是单向操作，漏掉一个文件最多被扣分，多带一个 .env 就是把模型 Key 和
 * 会话签名密钥一起交出去。宁可白名单。
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const STAGE = path.join(DIST, "submission");

/** bsdtar 在 Windows 上自带，且 `-a` 会按扩展名选 zip */
const TAR = "C:/Windows/System32/tar.exe";

/** 压缩包上限：组委会要求 zip ≤ 200MB */
const MAX_MB = 200;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/* ------------------------------------------------------------ 白名单 */

/** 整个目录收进去 */
const DIRS = ["src", "scripts"];

/** 单独挑文件收（目录里只挑这几个） */
const PICK = {
  prisma: [/^schema.*\.prisma$/, /^seed\.ts$/],
  public: [/^favicon\.svg$/, /^models\//, /^vendor\//],
  docs: [/\.md$/, /^submission\/(?!_)/],
};

/** 根目录散落的文件 */
const FILES = [
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "postcss.config.mjs",
  "eslint.config.mjs",
  "next-env.d.ts",
  "README.md",
  ".env.example",
  ".gitignore",
  ".dockerignore",
  "Dockerfile",
  "docker-compose.yml",
  "Caddyfile",
  "Start MedAI.bat",
];

/** 提交材料里必须有的东西（缺哪个就提醒哪个，不阻断） */
const MATERIALS = [
  ["作品说明文档.pdf", "作品说明文档（PDF）"],
  ["演示视频.mp4", "演示视频（≤10 分钟 MP4）"],
  ["答辩PPT.pptx", "答辩 PPT"],
];

/* ------------------------------------------------------------ 复制 */

function copyPicked(fromDir, patterns, toDir) {
  const src = path.join(ROOT, fromDir);
  if (!existsSync(src)) return 0;
  let n = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(src, abs).split(path.sep).join("/");
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!patterns.some((re) => re.test(rel))) continue;
      const dest = path.join(toDir, rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      cpSync(abs, dest);
      n += 1;
    }
  };
  walk(src);
  return n;
}

if (existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true });

console.log("A: ready");const team = arg("team", "广东医科大学+陈妍萱+手机号待填");
const folder = "MedAI-作品源码";
const root = path.join(STAGE, folder);
mkdirSync(root, { recursive: true });

let count = 0;

for (const dir of DIRS) {
  const src = path.join(ROOT, dir);
  const dest = path.join(root, dir);
  if (!existsSync(src)) continue;
  cpSync(src, dest, { recursive: true });
  const stack = [dest];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) stack.push(path.join(d, e.name));
      else count += 1;
    }
  }
}

for (const [dir, patterns] of Object.entries(PICK)) {
  count += copyPicked(dir, patterns, path.join(root, dir));
}

for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!existsSync(src)) continue;
  cpSync(src, path.join(root, f));
  count += 1;
}

// 提交材料：PDF / 视频 / PPT 平铺在一个文件夹里，评委不用找
const matDir = path.join(root, "提交材料");
mkdirSync(matDir, { recursive: true });
for (const [file] of MATERIALS) {
  const src = path.join(ROOT, "docs", "submission", file);
  if (existsSync(src)) {
    cpSync(src, path.join(matDir, file));
    count += 1;
  }
}

/* ------------------------------------------------------------ 打包 */

console.log("B: copied", count);const outFile = path.join(DIST, `${team}.zip`);
const tar = spawnSync(TAR, ["-a", "-c", "-f", outFile, "-C", STAGE, folder], {
  stdio: ["ignore", "inherit", "inherit"],
});
if (tar.status !== 0) {
  console.error("❌ 打包失败（bsdtar 退出码 " + tar.status + "）");
  process.exit(1);
}

/* ------------------------------------------------------------ 复查 */

console.log("C: zipped");const listing = spawnSync(TAR, ["-tf", outFile], { encoding: "utf8" });
const entries = (listing.stdout || "").split("\n").filter(Boolean);

// 红线：这几类只要出现一条就中止（提交包是最不能出错的那个包）
const leaks = entries.filter((e) => {
  if (/(^|\/)\.env$/.test(e) || /(^|\/)\.env\.local$/.test(e)) return true;
  if (/dev\.db/.test(e)) return true;
  if (/(^|\/)node_modules\//.test(e)) return true;
  if (/(^|\/)\.next\//.test(e)) return true;
  if (/(^|\/)backups\//.test(e)) return true;
  if (/(^|\/)data\/uploads\//.test(e)) return true;
  if (/(^|\/)public\/uploads\/(?!\.gitkeep)/.test(e)) return true;
  if (/(^|\/)docs\/_/.test(e)) return true;          // 中间截图 / 评分表切片
  if (/(^|\/)\.chrome-doc\//.test(e)) return true;   // 生成 PDF 时留的浏览器配置
  return false;
});

if (leaks.length > 0) {
  console.error("⚠️  提交包里有不该交的东西，已中止：");
  for (const l of leaks.slice(0, 10)) console.error("   " + l);
  process.exit(1);
}

const mb = statSync(outFile).size / 1024 / 1024;
console.log("");
console.log(`✅ ${path.relative(ROOT, outFile)}  (${mb.toFixed(1)} MB, ${count} 个文件)`);
if (mb > MAX_MB) {
  console.error(`❌ 超过 ${MAX_MB}MB 上限，需要把视频压小或去掉部分素材`);
  process.exit(1);
}
console.log("   红线检查通过：无 .env / 数据库 / node_modules / .next / 上传文件");

const missing = MATERIALS.filter(
  ([file]) => !existsSync(path.join(ROOT, "docs", "submission", file)),
).map(([, label]) => label);
if (missing.length > 0) {
  console.log("");
  console.log("   ⚠️  还缺这些材料（放好再跑一次就会自动带进去）：");
  for (const m of missing) console.log(`      - ${m}  →  docs/submission/`);
}

// 暂存目录留着，方便临时再塞东西；清理用 --clean
if (process.argv.includes("--clean")) rmSync(STAGE, { recursive: true, force: true });
