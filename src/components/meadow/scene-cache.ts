"use client";

import type { Meadow } from "./engine";

/**
 * 场景复用：把 WebGL 场景留在内存里，切去档案 / 科普 / 药品页时只把 canvas 从 DOM 上摘下来，
 * 回到首页再接回同一个 canvas —— 不用重建草地、重编着色器，返回是「瞬间」的。
 *
 * 为什么要这么做：`new Meadow()` 实测要 500~700ms（云层贴图约 470、环境贴图 15~150、草叶 50），
 * 加上首帧编译着色器，从档案页返回首页要等将近 5 秒才看到兔子 —— 用户感知就是「卡」。
 *
 * 注意两点：
 * 1. 开发模式下 React 会把 effect 跑两遍，两边会并发调用 acquire —— 这里用 pending 去重，
 *    否则会建出两份场景，其中一份成了孤儿（画面看得见、但不在缓存里）。
 * 2. canvas 每次都要显式 append 到当前容器上：两次挂载的 DOM 容器不是同一个。
 *
 * 整页刷新时浏览器会回收这份场景，不需要手动处理。
 */

type Stored = {
  canvas: HTMLCanvasElement;
  meadow: Meadow;
};

let stored: Stored | null = null;
let pending: Promise<Meadow> | null = null;

/** 上下文丢了（切走很久、显存不足）就当没有，重新建一份 */
function alive(meadow: Meadow): boolean {
  const ctx = meadow.renderer?.getContext?.() as WebGL2RenderingContext | null | undefined;
  if (!ctx) return false;
  return !ctx.isContextLost?.();
}

async function getOrCreate(host: HTMLElement): Promise<Meadow> {
  if (stored && !alive(stored.meadow)) {
    stored.meadow.dispose();
    stored.canvas.remove();
    stored = null;
  }
  if (stored) return stored.meadow;

  // 已经有人在建了，等同一份结果，别重复建
  if (pending) return pending;

  const canvas = document.createElement("canvas");
  canvas.className = "world__canvas";
  canvas.id = "scene";
  host.appendChild(canvas);

  pending = (async () => {
    const { Meadow: Ctor } = await import("./engine");
    // 等模块的这段时间里，另一路可能已经建好了（await 之后 TS 不会自动放宽收窄，这里显式取一次）
    const already = stored as Stored | null;
    if (already) {
      canvas.remove();
      return already.meadow;
    }
    const meadow = new Ctor(canvas);
    stored = { canvas, meadow };
    return meadow;
  })();

  try {
    return await pending;
  } finally {
    pending = null;
  }
}

/** 挂到当前容器上；没有就新建一份 */
export async function acquireMeadow(host: HTMLElement): Promise<Meadow> {
  const meadow = await getOrCreate(host);
  const canvas = meadow.renderer.domElement;
  // 两次挂载的容器不是同一个，必须显式接过来
  if (canvas.parentElement !== host) host.appendChild(canvas);
  // 离开这段时间窗口可能被拖动 / 转过屏，接回来先按当前视口重排
  meadow.resize();
  return meadow;
}

/** 只把 canvas 从 DOM 上摘下来，不销毁场景 —— 下次还能接回去 */
export function releaseMeadow(host: HTMLElement): void {
  const canvas = stored?.canvas;
  if (canvas && canvas.parentElement === host) host.removeChild(canvas);
}

/** 自检用：这一份场景是不是复用的、上次建了多久 */
export function sharedScene(): { canvas: HTMLCanvasElement; buildMs: Record<string, number> } | null {
  if (!stored) return null;
  const buildMs = (stored.meadow as unknown as { buildMs?: Record<string, number> }).buildMs;
  return { canvas: stored.canvas, buildMs: buildMs ?? {} };
}
