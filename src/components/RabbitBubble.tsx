"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { Meadow } from "./meadow/engine";
import {
  installRabbitBridge,
  onRabbitSpeech,
  rabbitBack,
  rabbitGreet,
  rabbitRandom,
  type RabbitLine,
} from "@/lib/rabbit-speech";

/** 气泡与兔子之间的间隙（CSS 像素） */
const GAP = 10;
/** 视口边缘留白 */
const EDGE = 10;

type Side = "top" | "right" | "left";

export default function RabbitBubble({
  meadowRef,
  panelRightRef,
  ready,
  resumed = false,
}: {
  meadowRef: RefObject<Meadow | null>;
  /** 问诊框右边界：靠右摆放时用来避开框右上角的按钮 */
  panelRightRef?: RefObject<number | null>;
  /** 开场蒲公英吹散之后再说话，别抢开场 */
  ready: boolean;
  /** 从疾病 / 药品页回来：说「回来啦」，不是重新做一遍自我介绍 */
  resumed?: boolean;
}) {
  const [line, setLine] = useState<RabbitLine | null>(null);
  const [on, setOn] = useState(false);
  const [side, setSide] = useState<Side>("top");

  const nodeRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const safeTopRef = useRef(70);
  const sideRef = useRef<Side>("top");
  const hideTimer = useRef<number | null>(null);
  /** 已经说过话了 —— 用药提醒抢在欢迎语前面时，欢迎语要让位，不能盖掉它 */
  const spokeRef = useRef(false);

  /* --------------------------------------------------- 定位：摆到兔子旁边 */

  const place = useCallback(() => {
    const el = nodeRef.current;
    const a = meadowRef.current?.rabbitAnchor?.() ?? null;
    if (!el || !a) return;

    const { w, h } = sizeRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top0 = safeTopRef.current;

    const roomAbove = a.y - GAP - h;
    // 面板右边界往内 20px 就是那两个按钮（档案详情 / 关闭）的外沿：
    // 气泡靠右摆放时不能比这条线更左，否则高一点的回复气泡会把按钮盖住
    const panelRight = panelRightRef?.current ?? null;
    const sideLeft = Math.max(
      a.cx + a.rx + GAP,
      panelRight === null ? -Infinity : panelRight - 20,
    );
    const leftLeft = a.cx - a.rx - GAP - w;
    const fitsRight = sideLeft + w <= vw - EDGE;
    const fitsLeft = leftLeft >= EDGE;
    const squeezed = roomAbove < top0 && !fitsRight && !fitsLeft;

    // 转场飞行中先躲起来，落定后再出现，免得气泡横穿整个屏幕；
    // 手机上开着问诊框时头顶只剩几十像素，硬塞会把兔子整个盖住 —— 这段干脆不显示，
    // 回答本来就在对话框里，气泡不抢戏。
    const away = a.flowing || (squeezed && vw < 700) ? "1" : "0";
    if (el.dataset.away !== away) el.dataset.away = away;
    if (away === "1" && squeezed && vw < 700 && !a.flowing) return;

    let next: Side;
    let left: number;
    let top: number;

    if (roomAbove >= top0) {
      // 首选的「正上方」：站在草地上时头顶就是一片天
      next = "top";
      left = a.cx - w / 2;
      top = roomAbove;
    } else if (fitsRight) {
      // 趴在面板右上沿时头顶没有空间，改挂右侧（贴着面板边、但不碰按钮）
      next = "right";
      left = sideLeft;
      top = a.cy - h * 0.58;
    } else if (fitsLeft) {
      next = "left";
      left = leftLeft;
      top = a.cy - h * 0.58;
    } else {
      // 都挤（手机上有问诊框时）：还是贴上方，压回安全区内
      next = "top";
      left = a.cx - w / 2;
      top = Math.max(top0, roomAbove);
    }

    left = Math.min(Math.max(left, EDGE), Math.max(EDGE, vw - w - EDGE));
    top = Math.min(Math.max(top, top0), Math.max(top0, vh - h - EDGE));

    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;

    // 小尖角始终指向兔子：横向/纵向被夹住时也不会飘到边上
    if (next === "top") {
      const tx = Math.min(Math.max(a.cx - left, 22), Math.max(22, w - 22));
      el.style.setProperty("--tail-x", `${Math.round(tx)}px`);
    } else {
      const ty = Math.min(Math.max(a.cy - top, 20), Math.max(20, h - 20));
      el.style.setProperty("--tail-y", `${Math.round(ty)}px`);
      // 小尖角要伸到兔子身边：气球离得远时把尖角拉长，别悬在半空
      const reach =
        next === "right" ? left - (a.cx + a.rx) : a.cx - a.rx - (left + w);
      el.style.setProperty(
        "--tail-reach",
        `${Math.round(Math.min(Math.max(reach + 4, 9), 46))}px`,
      );
    }

    if (next !== sideRef.current) {
      sideRef.current = next;
      setSide(next);
    }
  }, [meadowRef, panelRightRef]);

  /* ------------------------------------------------ 收话：谁都能让兔子说话 */

  useEffect(() => {
    installRabbitBridge();

    return onRabbitSpeech((next) => {
      spokeRef.current = true;
      setLine(next);
      setOn(true);

      // 到点吃药的提醒：光说话容易被当成装饰，让它蹦一下
      if (next.hop) {
        meadowRef.current?.hop(1.2);
      }

      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (!next.sticky) {
        const ms = next.duration || 9000;
        hideTimer.current = window.setTimeout(() => setOn(false), ms);
      }
    });
  }, [meadowRef]);

  /* ------------------------------------------------------------ 欢迎语 */

  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => {
      // 气泡已经开口了（比如到点提醒补发过来），就不要再自报家门把它顶掉
      if (!spokeRef.current) resumed ? rabbitBack() : rabbitGreet();
    }, 460);
    return () => window.clearTimeout(t);
  }, [ready, resumed]);

  /* ------------------------------------------- 量尺寸：内容变了 / 视口变了 */

  const measure = useCallback(() => {
    const el = nodeRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    sizeRef.current = { w: box.width, h: box.height };

    const hud = document.querySelector(".hud");
    const hudBottom = hud ? hud.getBoundingClientRect().bottom : 0;
    safeTopRef.current = Math.max(12, hudBottom + 6);
  }, []);

  // 先量再摆，避免新内容出现在上一句的位置上
  useLayoutEffect(() => {
    measure();
    place();
  }, [line, measure, place]);

  useEffect(() => {
    const onResize = () => {
      measure();
      place();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure, place]);

  /* --------------------------------------------------- 每帧跟随（转场时会移动） */

  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const tick = () => {
      place();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, place]);

  /* -------------------------------------------------------------- 渲染 */

  if (!line) return <div ref={nodeRef} className="rbubble" aria-hidden="true" />;

  return (
    <div
      ref={nodeRef}
      className={`rbubble${on ? " is-on" : ""}`}
      data-side={side}
      data-tone={line.tone}
      data-cat={line.category ?? "reply"}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        // key 变了才重播入场动画：同一句话再看一次也有反应
        key={line.id}
        className="rbubble__box"
        onClick={() => rabbitRandom()}
        title="再听一句"
      >
        <span className="rbubble__text">{line.text}</span>
        {line.tail ? <span className="rbubble__tail">{line.tail}</span> : null}
        <span className="rbubble__spine" aria-hidden="true" />
      </button>
    </div>
  );
}
