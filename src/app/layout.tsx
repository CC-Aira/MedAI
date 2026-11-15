import type { Metadata, Viewport } from "next";
import MedicationReminderWatcher from "@/components/MedicationReminderWatcher";
import { getPlatformName } from "@/lib/settings";
import { warmUpOcr } from "@/lib/attachments";
import "./globals.css";

/**
 * OCR 引擎预热。
 *
 * 放在这个模块的顶层，是因为它只在 Node 侧编译 —— instrumentation.ts 会被
 * 同时编译成 node 与 edge 两份，在那里 import 本模块会把 fs / node:crypto /
 * pdf-parse 拖进 edge 那份，edge 不认 `node:` 协议，编译直接失败。
 *
 * 模块只加载一次，所以这里天然只跑一次；失败不影响任何功能，
 * 只是第一次上传图片要多等一会儿。
 */
if (process.env.NEXT_PHASE !== "phase-production-build") {
  void warmUpOcr().catch(() => {});
}

/** 浏览器标签页标题也用后台配置的平台名；各子页自己的 title 不受影响 */
export async function generateMetadata(): Promise<Metadata> {
  let name = "MedAI";
  try {
    name = await getPlatformName();
  } catch {
    // 构建期静态生成时可能连不上库，回落默认名，绝不能让标签页标题把页面弄挂
  }
  return {
    title: `${name} — 草地上的小兔子 · 档案与问诊`,
    description: `${name}：草地上一只认真听你说话的小兔子。每一分身体状况，都值得被认真回应。`,
    icons: { icon: "/favicon.svg" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#a8d4f4",
};

/**
 * 本次浏览里已经看过开场（吹过蒲公英）时，在 HTML 解析阶段就把标记打到 <html> 上。
 * 这样从疾病 / 药品页返回时，服务端渲染出来的蒲公英开场会在第一帧就被 CSS 隐藏，
 * 不会出现「回到开始页」的闪屏 —— 这个脚本必须排在 <body> 最前面、同步执行。
 */
const INTRO_SEEN_SCRIPT = `try{if(sessionStorage.getItem("medai:intro")==="1"){document.documentElement.dataset.introSeen="1"}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: INTRO_SEEN_SCRIPT }} />
        {children}
        {/* 到点提醒：只在用户开启且有通知权限时才会真的请求接口 */}
        <MedicationReminderWatcher />
      </body>
    </html>
  );
}
