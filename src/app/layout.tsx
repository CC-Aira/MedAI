import type { Metadata, Viewport } from "next";
import MedicationReminderWatcher from "@/components/MedicationReminderWatcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedAI — 草地上的小兔子 · 档案与问诊",
  description:
    "MedAI：草地上一只认真听你说话的小兔子。每一分身体状况，都值得被认真回应。",
  icons: { icon: "/favicon.svg" },
};

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
