#!/usr/bin/env node
/**
 * 打省赛提交包（.zip）。
 *
 *   node scripts/pack-submission.mjs --team "广东医科大学+陈妍萱+18612345678"
 *
 * 与 `pack.mjs` 的分工：
 *   pack.mjs            —— 部署包，给「拿到就能跑」的机器用（含 .next 构建产物）
 *   pack-submission.mjs —— 提交包，给评委看（源码 + 说明文档 + 视频 + PPT）
 *
 * 提交包用**白名单**而不是黑名单：只收明确列出来的东西。
 * 提交是单向操作 —— 漏掉一个文件最多扣分，多带一个 .env 就是把模型 Key 和
 * 会话签名密钥一起交出去。
 *
 * 两个实现上的坑：
 *   1. Node 的 `fs.cpSync(..., {recursive:true})` 在本机一跑就被静默杀掉（退出码 127，
 *      连 try/catch 都进不去），所以这里自己写递归复制（readdir + copyFile）。
 *   2. Windows 自带的是精简版 bsdtar，**不支持 `-s`**（路径重写），
 *      所以先复制到暂存目录，再 `-C 暂存目录 <顶层目录名>` 打包。
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const STAGE = path.join(DIST, "submission");

/** Windows 自带 bsdtar，`-a` 会按扩展名选 zip */
const TAR = "C:/Windows/System32/tar.exe";

/** 压缩包上限：组委会要求 zip ≤ 200MB */
const MAX_MB = 200;

/** 包里那一层目录名 */
const FOLDER = "MedAI-作品源码";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/* ------------------------------------------------------------ 白名单 */

/** 整个目录都要 */
const FULL_DIRS = ["src", "scripts"];

/** 目录里只挑这些（相对该目录的正则） */
const PICKED = {
  prisma: [/^schema.*\.prisma$/, /^seed\.ts$/],
  public: [/^favicon\.svg$/, /^models\//, /^vendor\//],
  docs: [/^[^_.][^/]*\.md$/, /^submission\/(?!\.)/],
};

/** 根目录散落的文件 */
const ROOT_FILES = [
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

/** 提交材料：放好就会自动带进去，缺哪个就提醒哪个 */
const MATERIALS = [
  ["作品说明文档.pdf", "作品说明文档（PDF）"],
  ["演示视频.mp4", "演示视频（≤10 分钟 MP4）"],
  ["答辩PPT.pptx", "答辩 PPT"],
];

/* ------------------------------------------------------------ 复制 */

/** 手工递归复制（不能用 cpSync，见文件头注释） */
function copyTree(srcAbs, destAbs, filter, baseAbs) {
  const st = statSync(srcAbs);
  if (st.isDirectory()) {
    // 目录本身不预建：只有真的复制到文件时才建父目录，
    // 免得把 public/uploads/ 这种空目录也带进包里
    let n = 0;
    for (const name of readdirSync(srcAbs)) {
      n += copyTree(path.join(srcAbs, name), path.join(destAbs, name), filter, baseAbs);
    }
    return n;
  }
  if (filter) {
    const inner = path.relative(baseAbs, srcAbs).split(path.sep).join("/");
    if (!filter.some((re) => re.test(inner))) return 0;
  }
  mkdirSync(path.dirname(destAbs), { recursive: true });
  copyFileSync(srcAbs, destAbs);
  return 1;
}

/* ------------------------------------------------------------ 开始 */

if (existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true });
const root = path.join(STAGE, FOLDER);
mkdirSync(root, { recursive: true });

let count = 0;
for (const dir of FULL_DIRS) {
  const src = path.join(ROOT, dir);
  if (existsSync(src)) count += copyTree(src, path.join(root, dir), null, src);
}
for (const [dir, patterns] of Object.entries(PICKED)) {
  const src = path.join(ROOT, dir);
  if (existsSync(src)) count += copyTree(src, path.join(root, dir), patterns, src);
}
for (const f of ROOT_FILES) {
  const src = path.join(ROOT, f);
  if (!existsSync(src)) continue;
  copyFileSync(src, path.join(root, f));
  count += 1;
}

// 提交材料平铺在一个文件夹里，评委不用翻
const matDir = path.join(root, "提交材料");
mkdirSync(matDir, { recursive: true });
for (const [file] of MATERIALS) {
  const src = path.join(ROOT, "docs", "submission", file);
  if (existsSync(src)) {
    copyFileSync(src, path.join(matDir, file));
    count += 1;
  }
}

/* ------------------------------------------------------------ 打包 */

if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });
const team = arg("team", "广东医科大学+陈妍萱+手机号待填");
const outFile = path.join(DIST, `${team}.zip`);

console.log(`白名单 ${count} 个文件，开始压缩…`);

/**
 * 用 Python 的 zipfile 打包，而不是 Windows 自带的 tar.exe。
 * 后者按本机 ANSI 代码页（GBK）写条目名，评委用 Mac 解开就是一堆乱码；
 * zipfile 会自动给非 ASCII 名字打 UTF-8 标记。找不到 Python 时退回 bsdtar，
 * 并明确提示"中文名可能在其他系统上乱码"。
 */
const PY_CANDIDATES = [
  "python",
  "python3",
  "py",
  process.env.MEDAI_PYTHON, // 需要时可以用环境变量指定解释器
].filter(Boolean);

let packer = null;
for (const py of PY_CANDIDATES) {
  const probe = spawnSync(py, ["-c", "import sys;print(sys.version_info[0])"], {
    encoding: "utf8",
  });
  if (probe.status === 0 && (probe.stdout || "").trim() === "3") {
    packer = py;
    break;
  }
}

let ok = false;
if (packer) {
  const r = spawnSync(packer, [path.join(ROOT, "scripts", "zipdir.py"), STAGE, outFile], {
    encoding: "utf8",
  });
  ok = r.status === 0;
  if (!ok) console.error(r.stderr || "");
} else {
  console.warn("   ⚠️  没找到 Python 3，改用 bsdtar：中文文件名在其他系统上可能乱码");
  const r = spawnSync(TAR, ["-a", "-c", "-f", outFile, "-C", STAGE, FOLDER], {
    encoding: "utf8",
  });
  ok = r.status === 0;
  if (!ok) console.error(r.stderr || "");
}

if (!ok) {
  console.error("❌ 打包失败");
  process.exit(1);
}

/* ------------------------------------------------------------ 复查 */

// 清单也用 Python 读：bsdtar 在控制台里会把中文名打成乱码，没法核对
let entries = [];
if (packer) {
  const r = spawnSync(
    packer,
    ["-c", "import zipfile,sys;[print(n) for n in zipfile.ZipFile(sys.argv[1]).namelist()]", outFile],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  entries = (r.stdout || "").split("\n").filter(Boolean);
} else {
  const r = spawnSync(TAR, ["-tf", outFile], { encoding: "utf8" });
  entries = (r.stdout || "").split("\n").filter(Boolean);
}

// 红线：只要出现一条就中止（提交包是最不能出错的那个包）
const leaks = entries.filter((e) => {
  if (/(^|\/)\.env$/.test(e) || /(^|\/)\.env\.local$/.test(e)) return true;
  if (/dev\.db/.test(e)) return true;
  if (/(^|\/)node_modules\//.test(e)) return true;
  if (/(^|\/)\.next\//.test(e)) return true;
  if (/(^|\/)backups\//.test(e)) return true;
  if (/(^|\/)data\/uploads\//.test(e)) return true;
  if (/(^|\/)public\/uploads\/(?!\.gitkeep)/.test(e)) return true;
  if (/(^|\/)docs\/_/.test(e)) return true; // 中间截图 / 评分表切片
  if (/(^|\/)\.chrome-doc\//.test(e)) return true; // 生成 PDF 时留的浏览器配置
  return false;
});

if (leaks.length > 0) {
  console.error("⚠️  提交包里有不该交的东西，已中止：");
  for (const l of leaks.slice(0, 10)) console.error("   " + l);
  process.exit(1);
}

const mb = statSync(outFile).size / 1024 / 1024;
console.log("");
console.log(`✅ ${path.relative(ROOT, outFile)}  (${mb.toFixed(1)} MB, ${entries.length} 个条目)`);
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

// 暂存目录默认留着，方便临时再塞东西；清理时加 --clean
if (process.argv.includes("--clean")) rmSync(STAGE, { recursive: true, force: true });
