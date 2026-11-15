/**
 * 服务启动后要做的初始化。
 *
 * 唯一一件事：把 OCR 引擎预热好 —— 但真正的预热挪到了 layout.tsx 的模块顶层。
 *
 * 原因：instrumentation 会被 Next 编译成 node 与 edge 两份。这里只要写一句
 * `import("@/lib/attachments")`，fs / node:crypto / pdf-parse 就会一起进 edge 那份，
 * 而 edge 目标不认 `node:` 协议 —— 编译期报错，整个 dev server 直接 500，
 * 页面上什么都打不开（生产 build 同样会挂）。
 *
 * layout 只在 Node 侧编译，import 一个 Node-only 模块是安全的，
 * 模块缓存保证那段预热只跑一次。
 *
 * 这里只留一行日志：确认 instrumentation 这条通路是通的，出问题也好排查。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  console.log("[medai] instrumentation ready");
}
