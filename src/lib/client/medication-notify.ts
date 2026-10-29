/**
 * 浏览器通知（本地提醒通道）。
 *
 * 只有一个职责：页面开着的时候，到点弹一条系统通知，点一下就打卡。
 * 页面关掉就收不到 —— 那需要 Service Worker + 服务端推送，不是这一层能解决的。
 *
 * 状态存 localStorage：
 *   medai:med-remind:on            用户是否开启了提醒（"1" / "0"）
 *   medai:med-remind:seen:{日期}:{药id}   今天这条已经弹过，避免每 25 秒重复弹
 */

const ENABLED_KEY = "medai:med-remind:on";
const SEEN_PREFIX = "medai:med-remind:seen";
const CHANGE_EVENT = "medai:med-remind-change";

export type NotifyPermission = "unsupported" | "default" | "granted" | "denied";

/** 开关变化时广播，让监听者立刻检查一次，而不是等下一个轮询周期 */
export const REMIND_CHANGE_EVENT = CHANGE_EVENT;

export function notifyPermission(): NotifyPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  // 非安全上下文（http 且非 localhost）下 Notification 存在但不可用
  if (typeof window.isSecureContext === "boolean" && !window.isSecureContext) return "unsupported";
  return Notification.permission as NotifyPermission;
}

export function isReminderEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setReminderEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
  } catch {
    // 隐私模式下写不进去：仍然广播，让界面按当前状态刷新
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { on } }));
}

/**
 * 申请通知权限。必须在用户点击里调用 —— 浏览器会拒绝没有手势的申请。
 * 返回申请之后的状态。
 */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (notifyPermission() === "unsupported") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    return "denied";
  }
}

/* ------------------------------------------------------------------ 去重 */

function seenKey(day: string, medicationId: string): string {
  return `${SEEN_PREFIX}:${day}:${medicationId}`;
}

export function wasNotifiedToday(day: string, medicationId: string): boolean {
  try {
    return localStorage.getItem(seenKey(day, medicationId)) === "1";
  } catch {
    return false;
  }
}

export function markNotifiedToday(day: string, medicationId: string): void {
  try {
    localStorage.setItem(seenKey(day, medicationId), "1");
  } catch {
    // 写不进去就退化成"可能重复弹"，不影响主流程
  }
}

/** 清掉不是今天的记录，别让 localStorage 一直长 */
export function pruneOldMarks(day: string): void {
  try {
    const keep = `${SEEN_PREFIX}:${day}:`;
    const drop: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(SEEN_PREFIX) && !key.startsWith(keep)) drop.push(key);
    }
    for (const key of drop) localStorage.removeItem(key);
  } catch {
    // 忽略
  }
}

/* -------------------------------------------------------------- 弹通知 */

export interface NotifiableDose {
  medicationId: string;
  patientId: string;
  drugName: string;
  notice: string;
  timeOfDay: string;
}

export interface DoseNotifyOptions {
  /**
   * 点击通知后怎么打开档案页。必须由调用方用 Next 的 router.push 实现：
   * 这里不能用 window.location，那会整页刷新、白白重建一次 3D 场景。
   */
  onOpen: (patientId: string) => void;
}

/**
 * 弹一条用药通知。返回 null 表示没弹（权限不够 / 不支持）。
 * 点击通知：打卡 + 打开这个档案页。
 */
export function showDoseNotification(
  dose: NotifiableDose,
  opts: DoseNotifyOptions,
): Notification | null {
  if (notifyPermission() !== "granted") return null;

  let n: Notification;
  try {
    n = new Notification("该吃药啦", {
      body: dose.notice,
      // 同一条药同一天用固定 tag：浏览器会替换而不是堆积
      tag: `medai-med-${dose.medicationId}`,
      // 别自动消失，用户可能正在忙，一会儿再看
      requireInteraction: true,
    });
  } catch {
    return null;
  }

  n.onclick = () => {
    window.focus();
    n.close();

    // 点通知就算吃了；记错了可以在档案页点「今天已服」撤销
    void fetch(`/api/medications/${dose.medicationId}/checkin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => {
      // 打卡失败也让用户进页面手动处理
    });

    opts.onOpen(dose.patientId);
  };

  return n;
}

/** 页面里提示当前能不能用（做开关文案用） */
export function notifySupportHint(state: NotifyPermission): string {
  switch (state) {
    case "unsupported":
      return "这个浏览器不支持系统通知（或不是 https / localhost），提醒只在页面里显示";
    case "denied":
      return "通知权限被拒绝了，去浏览器地址栏左边的站点设置里改回「允许」";
    case "default":
      return "开启后，到点会弹一条系统通知";
    case "granted":
      return "已允许通知，到点会弹出来";
  }
}
