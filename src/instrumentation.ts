/**
 * Next.js instrumentation：服务启动时跑一次。
 *
 * 这里只做一件事 —— 把 OCR 引擎预热好。
 * 不预热的话，用户第一次上传图片时的请求里要现加载引擎和语言包，
 * 实测等了 90 秒；预热之后同一张图只要 0.7 秒。
 *
 * 失败也不影响启动：OCR 不可用时上传接口会如实返回"没读出文字"，
 * 纯文本/PDF/Word 的解析完全不受影响。
 */
export async function register() {
  // 只在 Node 服务端跑，edge / build 阶段都跳过
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { warmUpOcr } = await import("./lib/attachments");
    const ok = await warmUpOcr();
    console.log(ok ? "[medai] OCR 引擎已预热" : "[medai] OCR 引擎不可用，图片将读不出文字");
  } catch (err) {
    console.error("[medai] OCR 预热失败", err);
  }
}
