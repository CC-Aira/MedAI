#!/usr/bin/env node
/**
 * 打一个可分发的离线包。
 *
 *   node scripts/pack.mjs                 # 产物 dist/medai-<版本>-<日期>.tar.gz
 *   node scripts/pack.mjs --name medai-demo
 *
 * 包里放的是「拿到就能跑」的东西：构建产物、静态资源、schema、OCR 语言包、
 * 启动脚本、文档。目标机器解压后 `npm ci --omit=dev` + `npm start` 即可。
 *
 * 三样东西**绝对不能进包**，这里用规则硬挡：
 *   .env          —— 有模型 Key 和会话签名密钥，泄露等于把账号交出去
 *   prisma/dev.db —— 真实档案、就诊记录，属于隐私数据
 *   data/uploads  —— 用户上传的病历照片、化验单
 * 同理，`backups/`（就是数据库副本）也不进包。
 *
 * 不打包 node_modules：体积几百 MB，且本机是 Windows，拿到 Linux 上也用不了。
 * 用 package-lock.json 在目标机器上重装才是对的做法。
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const name = arg("name", `medai-${pkg.version}-${stamp}`);
const distDir = path.join(ROOT, "dist");
const outFile = path.join(distDir, `${name}.tar.gz`);

/* ------------------------------------------------------------ 排除规则 */

/** 目录名命中就整棵剪掉（node_modules 单独处理，见 walk） */
const SKIP_DIRS = new Set(["dist", "backups", ".git", ".workbuddy"]);

/** `.next` 里只有这两个是纯开发缓存（dev 模式跑过就长出来两百多 MB，`next start` 用不到） */
const SKIP_NEXT_CACHE = new Set([".next/dev", ".next/cache"]);

/** 相对项目根的路径命中就跳过（正则） */
const SKIP_PATHS = [
  /^\.env$/, // 密钥，红线
  /^\.env\.local$/,
  // 数据库的**任何**衍生文件：本体、-wal/-shm、以及历史上手工留的 .bak-*
  // 早先这里只写了 `dev\.db(-.*)?`，漏掉 `dev.db.bak-20261022` 这种点号命名的，
  // 结果真档案被打进了分发包 —— 宁可匹配宽一点。
  /^prisma\/dev\.db/,
  /^data\/dev\.db/,
  /^data\/uploads\//, // 用户上传的病历照片
  /^public\/uploads\/(?!\.gitkeep)/, // 头像（保留占位文件）
  /\.log$/,
  /^tsconfig\.tsbuildinfo$/,
  /^build\.log$/,
  /^docs\/preview-.*\.png$/, // 截图是给人看的，进包只是白占体积
];

function skipped(rel) {
  return SKIP_PATHS.some((re) => re.test(rel));
}

/** 递归收集，返回相对项目根的路径 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");

    /**
     * 符号链接必须**跟进去**，不能跳过。
     *
     * `.next/node_modules/` 里放的是 `@prisma/client-<hash>`、`tesseract.js-<hash>`
     * 这类链接，指向项目里的真实包 —— 这是 Turbopack 处理 `serverExternalPackages`
     * 的方式，构建产物靠这些名字去 require 外部包。只打链接本身的话，到目标机器上
     * 链接指向的绝对路径不存在，`next start` 一访问就报 Cannot find module。
     * 所以这里按目标的内容打包，等同于把包体实体化。
     */
    if (entry.isSymbolicLink()) {
      let st;
      try {
        st = statSync(abs); // 跟随链接
      } catch {
        continue; // 断链，跳过
      }
      if (st.isDirectory()) walk(abs, out);
      else out.push(rel);
      continue;
    }

    if (entry.isDirectory()) {
      // 依赖一律不打包，**但 `.next/node_modules` 除外** ——
      // 那是构建产物引用 external 包的入口，缺了它 `next start` 直接 500。
      // 只认这一个例外，其余任何层级的 node_modules 都剪掉。
      if (entry.name === "node_modules" && rel !== ".next/node_modules") continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_NEXT_CACHE.has(rel)) continue;
      walk(abs, out);
    } else if (entry.isFile()) {
      if (skipped(rel)) continue;
      out.push(rel);
    }
  }
  return out;
}

if (!existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
  console.error("❌ 没有构建产物（.next/BUILD_ID 不存在）。先跑：npx next build");
  process.exit(1);
}

console.log("收集文件…");
const files = walk(ROOT);

/* --------------------------------------------------------- 写清单再打包 */

if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

const listFile = path.join(distDir, ".packlist");
writeFileSync(listFile, files.join("\n"), "utf8");

console.log(`共 ${files.length} 个文件，开始压缩…`);

// GNU tar：-T 读清单，-C 定基准目录，压缩后解压出来是 <name>/ 一层目录。
// `--force-local` 必须有：否则 tar 把 Windows 的 `E:\...` 当成远程主机 `E` 去连 rsh。
const tar = spawnSync(
  "tar",
  [
    "-czf",
    outFile,
    "--force-local",
    "--transform",
    // 清单里是相对路径（不带 ./），所以直接给每一条加一层目录前缀，
    // 解压出来就是干净的 <name>/，不会散落到当前目录
    `s,^,${name}/,`,
    "-C",
    ROOT,
    "-T",
    listFile,
  ],
  { stdio: ["ignore", "inherit", "inherit"] },
);

if (tar.status !== 0) {
  console.error("❌ 打包失败（tar 退出码 " + tar.status + "）");
  process.exit(1);
}

/* ------------------------------------------------------------- 收尾核对 */

const sizeMb = (statSync(outFile).size / 1024 / 1024).toFixed(1);
console.log(`✅ ${path.relative(ROOT, outFile)}  (${sizeMb} MB, ${files.length} 个文件)`);

// 打包后复查：红线文件一个都不能在里面。
// 这里也故意放宽（任何路径里出现 dev.db 就算），因为它的作用是**兜底**，
// 排除规则写窄了正是靠它拦住。
const listing = spawnSync("tar", ["-tzf", outFile, "--force-local"], { encoding: "utf8" });
const entries = (listing.stdout || "").split("\n");
const leaks = entries.filter((entry) => {
  // 剥掉顶层目录前缀，按「相对项目根」判断
  const e = entry.replace(new RegExp(`^${name}/`), "");
  if (/(^|\/)\.env(\.local)?$/.test(e)) return true;
  if (/dev\.db/.test(e)) return true;
  if (/(^|\/)backups\//.test(e)) return true;
  // `.next/node_modules` 是构建产物的一部分，必须留；其余 node_modules 一律不许
  if (/(^|\/)node_modules\//.test(e) && !e.startsWith(".next/node_modules/")) return true;
  if (/(^|\/)data\/uploads\//.test(e)) return true;
  return false;
});
if (leaks.length > 0) {
  console.error("⚠️  包里有不该带的东西，已中止分发：");
  for (const l of leaks.slice(0, 10)) console.error("   " + l);
  process.exit(1);
}

console.log("   红线检查通过：无 .env / 数据库 / 备份 / node_modules");
console.log("");
console.log("   目标机器上解压后：");
console.log(`     tar -xzf ${name}.tar.gz && cd ${name}`);
// 不能用 --omit=dev：首次建表要跑 `prisma` CLI，它在 devDependencies 里。
// 装上之后跑 `npm start` 用的仍是生产物，多出来的只是开发依赖。
console.log("     npm ci                 # 装依赖（不能 --omit=dev，建表要用 prisma CLI）");
console.log("     cp .env.example .env   # 填 DATABASE_URL / SESSION_SECRET / DEEPSEEK_API_KEY");
console.log("     npx prisma generate    # 生成客户端：npm ci 之后不会自动生成，缺了会「登录 500」");
console.log("     npx prisma db push     # 首次建表");
console.log("     npm start              # 或双击 Start MedAI.bat（它会把上面几步都补齐）");

// 清单是中间产物，不留
unlinkSync(listFile);
