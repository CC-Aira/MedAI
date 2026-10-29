"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  isReminderEnabled,
  markNotifiedToday,
  pruneOldMarks,
  REMIND_CHANGE_EVENT,
  showDoseNotification,
  wasNotifiedToday,
} from "@/lib/client/medication-notify";
import { rabbitMedReminder } from "@/lib/rabbit-speech";

/** 25 秒一轮：比一分钟细，又不会把服务端压出压力；后台标签被节流时最多迟一分钟 */
const POLL_MS = 25_000;

type TodayReminders = {
  day: string;
  due: {
    medicationId: string;
    patientId: string;
    patientName?: string;
    drugName: string;
    notice: string;
    timeOfDay: string;
  }[];
};

/**
 * 到点提醒的「发动机」：挂在根布局里，登录后的每个页面都在跑。
 *
 * 两条通道，主次分得很清楚：
 *   1. **站内**：兔子在草地上说一句、蹦一下 —— 不需要权限，页面开着就一定有；
 *   2. **系统通知**：有权限才弹，能盖在别的窗口上，但可能被系统静音。
 *
 * 以前只有第 2 条，且不开权限就整个不跑，等于提醒形同虚设。
 * 现在权限只决定「要不要额外弹窗」，不决定「提不提醒」。
 */
export default function MedicationReminderWatcher() {
  const router = useRouter();

  useEffect(() => {
    let stopped = false;
    let busy = false;

    const check = async () => {
      if (stopped || busy) return;
      if (!isReminderEnabled()) return;

      busy = true;
      try {
        const res = await fetch("/api/medications/today", { cache: "no-store" });
        // 401（没登录）和 5xx 都安静跳过，下一轮再试
        if (!res.ok) return;

        const data = (await res.json()) as TodayReminders;
        pruneOldMarks(data.day);

        // 一轮里可能有好几条到点：兔子只说得了一句，其余的交给系统通知
        let rabbitSaid = false;

        for (const dose of data.due ?? []) {
          // 同一条药今天已经提醒过就不再来 —— 否则每 25 秒打扰一次
          if (wasNotifiedToday(data.day, dose.medicationId)) continue;

          if (!rabbitSaid) {
            rabbitMedReminder({
              drugName: dose.drugName,
              timeOfDay: dose.timeOfDay,
              patientName: dose.patientName,
            });
            rabbitSaid = true;
          }

          // 点通知：用路由跳，保住 3D 场景的复用，不整页刷新
          showDoseNotification(dose, {
            onOpen: (patientId) => {
              const target = `/patients/${patientId}`;
              if (window.location.pathname !== target) router.push(target);
            },
          });

          // 没权限时 showDoseNotification 会返回 null，但兔子已经说过了，
          // 所以照样记「今天提醒过」，别让下一轮再唠叨一遍
          markNotifiedToday(data.day, dose.medicationId);
        }
      } catch {
        // 网络抖动，下一轮再说
      } finally {
        busy = false;
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);

    // 从后台切回来时立刻检查一次，别干等下一轮
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    // 刚在档案页打开提醒 → 马上生效
    const onSetting = () => void check();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(REMIND_CHANGE_EVENT, onSetting);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(REMIND_CHANGE_EVENT, onSetting);
    };
  }, [router]);

  return null;
}
