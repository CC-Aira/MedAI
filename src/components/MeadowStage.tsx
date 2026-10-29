"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Meadow } from "./meadow/engine";
import RabbitBubble from "./RabbitBubble";
import VisitSheetPanel from "./VisitSheet";
import { RED_FLAG_TITLE, readRedFlagMark } from "@/lib/red-flags";
import { acquireMeadow, releaseMeadow } from "./meadow/scene-cache";
import { quadOffscreen, quadTransform } from "@/lib/css-quad";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  rabbitRandom,
  rabbitSay,
  rabbitThinking,
  showBubble,
} from "@/lib/rabbit-speech";
import { playRabbitSqueak } from "@/lib/rabbit-sfx";
import type {
  Attachment,
  BoardDose,
  Message,
  Patient,
  FactCandidate,
  TodayBoard,
} from "@/lib/client/types";
import {
  ApiError,
  applyFacts,
  archiveConsultation,
  checkinMedication,
  createConsultation,
  deleteConsultation,
  generateSummary,
  getConsultation,
  getTodayBoard,
  listConsultations,
  scanFacts,
  streamMessage,
  undoMedicationCheckin,
  uploadAttachment,
  logout,
} from "@/lib/client/api";

/** 与 globals.css 里的 --flow 保持一致 */const FLOW = 1100;
/** 鼠标静止多久之后，眼神回到屏幕前的你 */
const IDLE_MS = 2500;
/** 和后端 CHAT_RETENTION_DAYS 保持一致，只用于界面提示 */
const RETENTION_DAYS = 30;

type ChatItem = {
  id: string;
  role: "user" | "assistant" | "note" | "typing";
  content: string;
  /** 服务端消息 id：只有它存在时这句话才能改 */
  messageId?: string;
  attachment?: Attachment | null;
  editedAt?: string | null;
  /** 非空表示这条不是模型回答，要画成红旗卡片 */
  flag?: string | null;
};

/** 服务端消息 → 气泡 */
function toItem(m: Message): ChatItem {
  return {
    id: m.id,
    messageId: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
    attachment: m.attachment ?? null,
    editedAt: m.editedAt ?? null,
    flag: m.flag ?? null,
  };
}

const OPENERS = ["我最近有点不舒服，想说说", "帮我看看这些药能不能一起吃", "想记一下今天的身体状况"];

/** 吊牌文字层的设计尺寸，实际大小交给 matrix3d 贴到板面上 */
const SIGN_PANEL_W = 262;
const SIGN_PANEL_H = 107;

function greeting(p: Patient): string {
  const bits: string[] = [];
  bits.push(`我是 MedAI。${p.name}，${p.age ? `${p.age} 岁` : "年龄还没填"}`);
  if (p.chiefComplaint) bits.push(`档案里写的主诉是「${p.chiefComplaint}」`);
  if (p.allergies) bits.push(`过敏史「${p.allergies}」，我会一直记着`);
  const active = p.medications.filter((m) => m.isActive);
  if (active.length) {
    bits.push(`在服 ${active.map((m) => m.drugName).join("、")}`);
  }
  return `${bits.join("。")}。\n\n先说最难受的那一处就行，慢慢讲，我会问清楚再往下说。`;
}

export default function MeadowStage({
  initialPatients,
  email,
  counts,
  board: initialBoard,
}: {
  initialPatients: Patient[];
  email: string;
  counts: { diseases: number; drugs: number };
  /** 草地上那块小木牌的内容：全家今天的用药 */
  board: TodayBoard;
}) {
  const router = useRouter();

  /**
   * 木牌的数据在页面里要能自己动：打卡就改一个人、改一次，整块板子跟着变。
   * 只有需要跨页面同步的才回服务端刷新，这里留着本地一份，打完卡重新拉一遍即可。
   */
  const [board, setBoard] = useState<TodayBoard>(initialBoard);
  const [boardSource, setBoardSource] = useState<TodayBoard>(initialBoard);

  /** 3D 画布的挂载点：场景本身是复用的，canvas 由 scene-cache 负责接上 / 摘下 */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const meadowRef = useRef<Meadow | null>(null);
  const consultRef = useRef<HTMLElement | null>(null);
  /** 问诊框右边界（CSS 像素）：气泡靠右摆放时用来避开框上的按钮 */
  const panelRightRef = useRef<number | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const seedHostRef = useRef<SVGGElement | null>(null);
  const idleTimer = useRef<number | null>(null);
  const overSignRef = useRef(false);
  const sessionRef = useRef(0);
  const soundRef = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
  /** 木牌内容不在 effect 依赖里 —— 场景只建一次，数据变了不该重建整片草地 */
  const boardRef = useRef<TodayBoard>(board);
  /** 木牌上的文字层：位置每帧跟着 3D 板子算，所以直接改 style，不走 state */
  const signPanelRef = useRef<HTMLDivElement | null>(null);

  const [sceneReady, setSceneReady] = useState(false);
  /** 木牌明细：点开时记下木牌在屏幕上的位置，卡片就贴在它旁边长出来 */
  const [signSheet, setSignSheet] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const signCardRef = useRef<HTMLElement | null>(null);
  /** 正在打卡的那一条（按 medicationId 记，只锁一行，别的照样能点） */
  const [doseBusy, setDoseBusy] = useState<string | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  /**
   * 卡片打开那一刻的人名顺序。打卡会改「谁还没吃」，排序跟着变，
   * 手指点下去的那一行就会跳到别处 —— 所以卡片里冻结顺序，等下次打开再重排。
   */
  const [sheetOrder, setSheetOrder] = useState<string[]>([]);
  const [blown, setBlown] = useState(false);
  const [done, setDone] = useState(false);
  /** 是「从疾病 / 药品页回来」，不是第一次进场：问候语要换一句，像是回到桌前，不是重新开始 */
  const [resumed, setResumed] = useState(false);

  // 同一次浏览里已经吹过蒲公英：从科普库 / 药品库返回时直接进草地，不再放一遍开场。
  // sessionStorage 只有浏览器里有，SSR 读不到，所以只能在挂载后同步这一次状态。
  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem("medai:intro") === "1";
    } catch {
      // 隐私模式下 sessionStorage 不可用，正常放开场
    }
    if (!seen) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setBlown(true);
    setDone(true);
    setResumed(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    document.body.classList.add("is-ready");
    document.documentElement.dataset.introSeen = "1";
  }, []);

  const [patients] = useState<Patient[]>(initialPatients);
  const [current, setCurrent] = useState<Patient | null>(null);
  const [consultId, setConsultId] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatItem[]>([]);
  /** chat 的影子：closeRecord 是 useCallback，直接读 state 会拿到旧值 */
  const chatRef = useRef<ChatItem[]>([]);
  useEffect(() => {
    chatRef.current = chat;
  }, [chat]);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [facts, setFacts] = useState<FactCandidate[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busyTool, setBusyTool] = useState(false);
  /** 就诊摘要面板：要带走的那张纸 */
  const [sheetOpen, setSheetOpen] = useState(false);

  /* 改错字：正在编辑哪一条、草稿是什么 */
  const [editing, setEditing] = useState<{ itemId: string; text: string } | null>(
    null,
  );
  /* 待发送的附件 */
  const [pending, setPending] = useState<Attachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /* ------------------------------------------------------- 3D 场景挂载 */

  useEffect(() => {
    const host = stageRef.current;
    if (!host) return;

    let raf = 0;
    let cancelled = false;

    /** 文字层跟着板子的四个角走：transform 写在 DOM 上，不触发 React 重渲染 */
    const paintSignPanel = (meadow: Meadow) => {
      const el = signPanelRef.current;
      if (!el) return;

      const quad = meadow.signQuad();
      if (!quad) {
        el.style.opacity = "0";
        return;
      }

      const tf = quadOffscreen(quad.pts)
        ? ""
        : quadTransform(quad.pts, SIGN_PANEL_W, SIGN_PANEL_H);
      if (!tf) {
        el.style.opacity = "0";
        return;
      }

      el.style.transform = tf;
      el.style.opacity = quad.opacity.toFixed(3);
    };

    acquireMeadow(host)
      .then((meadow) => {
        if (cancelled) return;
        meadowRef.current = meadow;
        // 有跟踪中的用药就写在那块板子上；一条都没有也是一块空板子
        meadow.setBoard(boardRef.current);

        let last = performance.now();
        const frame = (now: number) => {
          if (cancelled) return;
          const dt = Math.min((now - last) / 1000, 0.05);
          last = now;
          meadow.update(dt);
          paintSignPanel(meadow);
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        setSceneReady(true);
      })
      .catch((err) => {
        console.error("[medai] 3D 场景加载失败", err);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      meadowRef.current = null;
      // 只把 canvas 摘下来，场景留着：从档案 / 科普 / 药品页回来时直接接回去
      releaseMeadow(host);
    };
  }, []);

  /* ------------------------------------- 木牌数据变了 → 3D 板子跟着换 */

  // 打卡一次就 setBoard，板面上的「3/5 次」和每个人的行都要立刻变。
  // 场景本身不重建（只改它手里那份数据），所以这里单独同步一次。
  useEffect(() => {
    boardRef.current = board;
    meadowRef.current?.setBoard(board);
  }, [board]);

  // 服务端重新给了数据（刷新页面 / 从别的页面回来）就以它为准，本地那份只是打卡后的中间态。
  // 在渲染期比对而不是丢进 useEffect：effect 里同步 setState 会白跑一轮渲染，
  // React 的 lint 规则也明确把这种写法标成错误。
  if (initialBoard !== boardSource) {
    setBoardSource(initialBoard);
    setBoard(initialBoard);
  }

  /**
   * 卡片是「从板子下面长出来」的，位置在打开那一刻按板子锚点算 ——
   * 但行数多、屏幕矮的时候会长出视口底部。这里是开出来之后再量一次高度，
   * 超出就整体上提；提到头还放不下，就交给 `.signcard` 的 max-height 去滚。
   */
  useEffect(() => {
    if (!signSheet) return;
    const el = signCardRef.current;
    if (!el) return;
    const over = el.getBoundingClientRect().bottom - window.innerHeight + 12;
    if (over > 1) {
      setSignSheet((s) => {
        if (!s) return s;
        const next = Math.max(12, s.top - over);
        // 已经提到顶了就别再 setState —— 每次都造个新对象会让这个 effect 自己转不停
        return Math.abs(next - s.top) < 1 ? s : { ...s, top: next };
      });
    }
  }, [signSheet]);

  /* ------------------------------------------------------ 木牌上直接打卡 */

  /**
   * 打开明细卡：顺手冻结人名顺序。
   * 顺序一旦跟着「谁还没吃」实时重排，手指点下去的那一行会在原地换人 —— 那就没法连点了。
   */
  const openSignSheet = useCallback((pos: { left: number; top: number }) => {
    setSheetOrder(boardRef.current.entries.map((e) => e.patientId));
    setSignError(null);
    setSignSheet(pos);
  }, []);

  /**
   * 卡片里的人名顺序：按打开那一刻定下来。
   * `board.entries` 本身是按「谁还没吃」排的，打卡会让它现场重排 —— 卡片里不能跟着跳。
   */
  const sheetEntries = board.entries.slice().sort((a, b) => {
    const ia = sheetOrder.indexOf(a.patientId);
    const ib = sheetOrder.indexOf(b.patientId);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  /** 打卡 / 撤销：点一下就记下，不用再进档案 */
  const toggleDose = useCallback(
    async (d: BoardDose) => {
      if (doseBusy) return;
      setDoseBusy(d.medicationId);
      setSignError(null);
      try {
        if (d.done) await undoMedicationCheckin(d.medicationId);
        else await checkinMedication(d.medicationId);
        // 分子分母、过点计数、谁的排前面全都变了，重新拉一份最省心
        setBoard(await getTodayBoard());
      } catch (err) {
        setSignError(err instanceof ApiError ? err.message : "打卡没成功，再试一次");
      } finally {
        setDoseBusy(null);
      }
    },
    [doseBusy],
  );

  /* --------------------------------------------- 眼神：跟鼠标 / 看向你 */

  useEffect(() => {
    if (!sceneReady) return;

    let overRabbit = false;

    const onMove = (e: PointerEvent) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = -((e.clientY / window.innerHeight) * 2 - 1);
      meadowRef.current?.gazeAt(nx, ny);

      // 悬停在兔子身上时给个手型，暗示「可以点我」
      const hit = meadowRef.current?.hitRabbit(e.clientX, e.clientY) ?? false;
      if (hit !== overRabbit) {
        overRabbit = hit;
        document.body.classList.toggle("is-over-rabbit", hit);
      }

      // 木牌也要能点，同样是手型
      const overSign = meadowRef.current?.hitSign(e.clientX, e.clientY) ?? false;
      if (overSign !== overSignRef.current) {
        overSignRef.current = overSign;
        document.body.classList.toggle("is-over-sign", overSign);
      }

      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => {
        meadowRef.current?.gazeToViewer();
      }, IDLE_MS);
    };

    // 点兔子 → 跳一下、啾一声、随机一句关心话术
    const onDown = (e: PointerEvent) => {
      const meadow = meadowRef.current;
      if (!meadow) return;

      // 卡片自己身上的点击交给卡片，别在 window 上重复处理一遍
      const el = e.target as HTMLElement | null;
      if (el?.closest?.(".signcard")) return;

      // 点木牌 → 看看全家今天谁还差几颗，顺手就在这儿打卡
      if (meadow.hitSign(e.clientX, e.clientY)) {
        const a = meadow.signAnchor();
        if (a) {
          const W = 304;
          openSignSheet({
            left: Math.max(16, Math.min(a.cx - W / 2, window.innerWidth - W - 16)),
            // 牌子是吊在天上的，卡片只能往下长，往上会顶出画面
            top: Math.min(a.bottom + 12, window.innerHeight - 120),
          });
        }
        return;
      }

      if (!meadow.hitRabbit(e.clientX, e.clientY)) {
        // 点到草地上的别处，就把卡片收起来，别让它一直挂在画面里
        setSignSheet(null);
        return;
      }
      meadow.hop();
      playRabbitSqueak();
      rabbitRandom();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    idleTimer.current = window.setTimeout(() => {
      meadowRef.current?.gazeToViewer();
    }, IDLE_MS);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.body.classList.remove("is-over-rabbit");
      document.body.classList.remove("is-over-sign");
      overSignRef.current = false;
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [sceneReady, openSignSheet]);

  /* --------------------------------------------------- 开场：蒲公英种子 */

  useEffect(() => {
    const host = seedHostRef.current;
    if (!host) return;

    // 开发模式下 React 会把 effect 跑两遍：第一次已经把种子塞进 DOM，
    // 但排好的「一颗一颗亮起来」定时器在清理时被取消了，第二遍如果直接 return，
    // 种子就会一直停在 opacity:0 —— 开场只剩一根光秃秃的茎。这里直接补点亮。
    if (host.childElementCount > 0) {
      host.querySelectorAll("g.seed").forEach((g) => g.classList.add("is-on"));
      return;
    }

    const NS = "http://www.w3.org/2000/svg";
    const cx = 150;
    const cy = 146;
    const count = window.innerWidth < 640 ? 132 : 186;

    const frag = document.createDocumentFragment();
    const nodes: SVGGElement[] = [];

    for (let i = 0; i < count; i++) {
      const ring = i % 3;
      const band = ring === 0 ? [40, 68] : ring === 1 ? [54, 84] : [30, 56];
      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.24;
      const r = band[0] + Math.random() * (band[1] - band[0]);

      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 0.94;

      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "seed");
      g.style.setProperty("--dx", `${Math.cos(a) * (90 + Math.random() * 190)}px`);
      g.style.setProperty("--dy", `${Math.sin(a) * 80 - 60 - Math.random() * 170}px`);
      g.style.setProperty("--rot", `${(Math.random() - 0.5) * 200}deg`);
      g.style.setProperty("--delay", `${Math.random() * 240}ms`);

      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", String(cx));
      line.setAttribute("y1", String(cy));
      line.setAttribute("x2", String(x));
      line.setAttribute("y2", String(y));
      line.setAttribute("class", "seed__ray");
      g.appendChild(line);

      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(y));
      dot.setAttribute("r", String(1.5 + Math.random() * 1.5));
      dot.setAttribute("class", "seed__tip");
      g.appendChild(dot);

      frag.appendChild(g);
      nodes.push(g);
    }

    host.appendChild(frag);

    // 一颗一颗亮起来，比"啪"一下全出现更像蒲公英在长
    const timers = nodes.map((g, i) =>
      window.setTimeout(() => g.classList.add("is-on"), 60 + i * 3),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  /* ------------------------------------------------------------ 吹散开场 */

  const blow = useCallback(() => {
    if (blown) return;
    setBlown(true);
    try {
      sessionStorage.setItem("medai:intro", "1");
    } catch {
      // 存不了就算了，下次重新看开场
    }
    window.setTimeout(() => {
      setDone(true);
      document.body.classList.add("is-ready");
    }, 900);
  }, [blown]);

  useEffect(() => {
    if (!sceneReady || blown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") blow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sceneReady, blown, blow]);

  /* --------------------------------------------------- 转场：球滚到面板上 */

  const syncPerch = useCallback(() => {
    const meadow = meadowRef.current;
    const panel = consultRef.current;
    if (!meadow || !panel) return;

    // offsetLeft / offsetTop 不受 transform 影响，量到的就是面板停稳后的位置
    const w = panel.offsetWidth;
    const mobile = window.innerWidth < 860;
    // 桌面上停在框的右上角；手机上顶栏按钮和标志各占两边，改停正中，免得球压住它们
    // 桌面停在靠角一点的位置：气泡要挂在它右边、避开框上的按钮，贴太远小尖角就够不着了
    const x = mobile
      ? panel.offsetLeft + w * 0.5
      : panel.offsetLeft + w - Math.min(78, w * 0.13);
    meadow.setPerchPixel(x, panel.offsetTop);

    // 气泡要知道面板右边界，才能避开面板右上角的「档案详情 / 关闭」按钮
    panelRightRef.current = panel.offsetLeft + panel.offsetWidth;
  }, []);

  useEffect(() => {
    const meadow = meadowRef.current;
    if (!meadow) return;

    if (current) {
      syncPerch();
      meadow.startFlow();
      // 趴上框之后也继续看着鼠标，别再强制转眼珠
      const t = window.setTimeout(syncPerch, 120);

      // 窗口尺寸变了（转屏 / 拖窗口）面板会换位置，兔子得跟着重新停靠，
      // 否则它会按旧像素算出一个屏幕外的停点
      const onResize = () => window.setTimeout(syncPerch, 60);
      window.addEventListener("resize", onResize);

      return () => {
        window.clearTimeout(t);
        window.removeEventListener("resize", onResize);
      };
    }

    meadow.endFlow();
    return undefined;
  }, [current, syncPerch]);

  /* ------------------------------------------------------- 打开 / 关闭档案 */

  const openRecord = useCallback(
    async (patient: Patient) => {
      if (current) return;

      const mine = ++sessionRef.current;
      setCurrent(patient);
      setChat([]);
      setFacts(null);
      setNotice(null);
      setConsultId(null);
      // 趴到框沿的时候说一句，比"啪"地落下来自然
      rabbitSay("我趴在这儿听你说，慢慢来。", { tone: "greet", duration: 7000 });

      // 关掉面板不等于把刚才的话忘了。
      // 这个档案最近一次还没归档、而且真的聊过的问诊，直接接着聊；
      // 之前每次点开都新建一次，用户回来只看到一句开场白，以为记录没了。
      try {
        const { consultations } = await listConsultations(patient.id);
        if (mine !== sessionRef.current) return;
        const last = consultations.find(
          (c) => c.status !== "archived" && c.messageCount > 0,
        );
        if (last) {
          const { consultation } = await getConsultation(last.id);
          if (mine !== sessionRef.current) return;
          const restored = consultation.messages.map(toItem);
          // 上次点过「小结」的，把结论接在末尾，否则回来会以为没总结过
          if (consultation.summary) {
            restored.push({
              id: "summary-restored",
              role: "note",
              content: `这次的小结：${consultation.summary}`,
            });
          }
          setConsultId(consultation.id);
          setChat([
            { id: "resume", role: "note", content: "上次聊到这儿，接着说就行。" },
            ...restored,
          ]);
          rabbitSay("上次那些我还记着，接着说吧。", { tone: "greet", duration: 7000 });
          return;
        }
      } catch {
        // 读不到上次就往下走新建，别把人卡在这儿
      }
      if (mine !== sessionRef.current) return;

      try {
        const { consultation } = await createConsultation(patient.id);
        if (mine !== sessionRef.current) return;
        setConsultId(consultation.id);
        setChat([
          { id: "greet", role: "assistant", content: greeting(patient) },
        ]);
      } catch (err) {
        if (mine !== sessionRef.current) return;
        setChat([
          {
            id: "greet",
            role: "assistant",
            content: greeting(patient),
          },
        ]);
        setNotice(err instanceof ApiError ? err.message : "这次问诊没建成，可以先聊，稍后再试");
      }
    },
    [current],
  );

  const closeRecord = useCallback(() => {
    if (!current) return;

    // 一句话没说就关掉的空问诊，顺手删了 —— 留着只会把问诊记录列表塞满
    const cid = consultId;
    const spoke = chatRef.current.some((m) => m.role === "user");
    if (cid && !spoke) {
      void deleteConsultation(cid).catch(() => {});
    }

    sessionRef.current += 1;
    panelRightRef.current = null;
    // body 上的 is-consulting 交给下面那个跟随 current 的 effect 统一管
    setCurrent(null);
    setConsultId(null);
    setFacts(null);
    setNotice(null);
    setSheetOpen(false);
    setSending(false);
    // 关掉档案时如果还挂着"我看看呀"，用一句正常话术把它替换掉，不然会一直停在气泡里
    rabbitSay("那我先回草地啦，想我点我一下。", { tone: "care", duration: 6000 });
    const mine = sessionRef.current;
    window.setTimeout(() => {
      if (mine !== sessionRef.current) return;
      setChat([]);
    }, FLOW);
  }, [current, consultId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && current) closeRecord();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, closeRecord]);

  /**
   * 面板显隐只看 body 上的 is-consulting（CSS 靠它滑入），所以这个类必须跟着
   * current 走。之前只在 openRecord 加、在 closeRecord 删 —— 点「档案详情」
   * 用 Link 跳走时两条都没走到，类名就留在 body 上；从编辑页回来时组件重新挂载、
   * current 是 null，面板却照样浮出来，标题「档案」、内容一屏「—」，看着像卡死。
   */
  useEffect(() => {
    document.body.classList.toggle("is-consulting", Boolean(current));
    return () => document.body.classList.remove("is-consulting");
  }, [current]);

  /* -------------------------------------------------------------- 聊天 */

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const id = requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [chat]);

  const send = useCallback(
    async (
      text: string,
      opts: { attachment?: Attachment | null; editMessageId?: string } = {},
    ) => {
      const content = text.trim();
      const attachment = opts.attachment ?? null;
      if ((!content && !attachment) || !consultId || sending) return;

      const mine = sessionRef.current;
      setDraft("");
      setPending(null);
      setEditing(null);
      setNotice(null);
      setSending(true);
      // 等模型的时候先让兔子说一句，常驻到回答出来
      rabbitThinking();

      const typingId = `t-${Date.now()}`;
      const userId = `u-${Date.now()}`;

      setChat((prev) => {
        // 编辑：这条之前的保留；这条换成新文案；后面的问答全部让位给新的回答
        const idx = opts.editMessageId
          ? prev.findIndex((c) => c.messageId === opts.editMessageId)
          : -1;
        const before = idx >= 0 ? prev.slice(0, idx) : prev;

        return [
          ...before,
          {
            id: userId,
            messageId: opts.editMessageId,
            role: "user" as const,
            content: content || "（上传了一份资料）",
            attachment,
            editedAt: opts.editMessageId ? new Date().toISOString() : null,
          },
          { id: typingId, role: "typing" as const, content: "" },
        ];
      });

      let acc = "";
      await streamMessage(
        consultId,
        content,
        {
          onDelta: (delta) => {
            acc += delta;
            if (mine !== sessionRef.current) return;
            setChat((prev) =>
              prev.map((m) =>
                m.id === typingId ? { ...m, role: "assistant", content: acc } : m,
              ),
            );
          },
          onDone: ({ messages }) => {
            if (mine !== sessionRef.current) return;
            setChat((prev) => {
              // 开场白是本地生成的、服务端没有；小结提示也是本地项
              const greet = prev.filter((m) => m.id === "greet");
              const notes = prev.filter((m) => m.role === "note");
              const next = messages.map(toItem);
              return [...greet, ...next, ...notes];
            });
            setSending(false);

            // 回答落到气泡里：一句摘要 + 一句鼓励，完整内容仍在左侧对话
            const answer = [...messages].reverse().find((m) => m.role === "assistant");
            // 红旗拦截的回答不塞进气泡：那段话是给眼睛读的，不是给兔子说的
            if (readRedFlagMark(answer?.flag)) {
              rabbitSay("这个别在网上聊了，先去医院好不好？", {
                tone: "warn",
                duration: 9000,
              });
            } else if (answer?.content) {
              showBubble(answer.content);
            }
          },
          onError: (message) => {
            if (mine !== sessionRef.current) return;
            setChat((prev) =>
              prev.map((m) =>
                m.id === typingId
                  ? {
                      ...m,
                      role: "note",
                      content: message,
                    }
                  : m,
              ),
            );
            setSending(false);
            rabbitSay("刚刚没接上，再试一次好不好？我在的。", { tone: "warn" });
          },
        },
        {
          attachmentId: attachment?.id,
          editMessageId: opts.editMessageId,
        },
      );
    },
    [consultId, sending],
  );

  /* ---------------------------------------------------- 上传资料 / 改错字 */

  async function onPickFile(file: File) {
    if (!file || uploading || sending) return;
    setUploading(true);
    setNotice(null);
    try {
      const { attachment } = await uploadAttachment(file);
      setPending(attachment);
      if (!attachment.hasText) {
        setNotice(
          "这份资料里没读出文字（可能是纯照片），最好再补一句文字描述，我才能帮上忙",
        );
      }
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "文件没能传上去");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function startEdit(item: ChatItem) {
    if (!item.messageId || sending) return;
    setEditing({ itemId: item.id, text: item.content });
    setNotice(null);
  }

  async function saveEdit() {
    if (!editing) return;
    const item = chat.find((c) => c.id === editing.itemId);
    const text = editing.text.trim();
    if (!item?.messageId || !text) return;
    await send(text, { editMessageId: item.messageId });
  }


  /* ------------------------------------------------------- 摘要 / 整理档案 */

  async function onSummary() {
    if (!consultId || busyTool) return;
    setBusyTool(true);
    setNotice(null);
    try {
      const saved = await generateSummary(consultId);
      setChat((prev) => [
        ...prev,
        { id: `s-${Date.now()}`, role: "note", content: `这次的小结：${saved.summary}` },
      ]);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "摘要没生成出来");
    } finally {
      setBusyTool(false);
    }
  }

  async function onScanFacts() {
    if (!consultId || busyTool) return;
    setBusyTool(true);
    setNotice(null);
    try {
      const { candidates } = await scanFacts(consultId);
      if (candidates.length === 0) {
        setFacts(null);
        // 落在聊天里，而不是只在面板底部闪一行字 —— 用户点了按钮就该看到结果
        setChat((prev) => [
          ...prev,
          {
            id: `f-${Date.now()}`,
            role: "note",
            content: "这次没扫出要补的：档案里的信息已经和聊天对得上了。",
          },
        ]);
      } else {
        setFacts(candidates);
        setChecked(
          Object.fromEntries(candidates.map((c) => [c.id, c.defaultChecked])),
        );
      }
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "扫描没成功");
    } finally {
      setBusyTool(false);
    }
  }

  async function onApplyFacts() {
    if (!consultId || !facts || busyTool) return;
    const picked = facts.filter((f) => checked[f.id]);
    if (picked.length === 0) return;

    setBusyTool(true);
    setNotice(null);
    try {
      await applyFacts(consultId, picked);
      setFacts(null);
      // 写了什么要留在聊天里。只改进程里的 notice，用户很容易以为「什么都没发生」。
      const names = picked.map((f) => f.drug?.drugName ?? f.label ?? f.field ?? "一条");
      setChat((prev) => [
        ...prev,
        {
          id: `f-${Date.now()}`,
          role: "note",
          content: `已经写进档案：${names.join("、")}。打开档案详情就能看到。`,
        },
      ]);
      router.refresh();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "没能写进档案");
    } finally {
      setBusyTool(false);
    }
  }

  /**
   * 这次聊完了：把问诊归档，再关面板。
   * 不归档直接关 × 的话，下次点开会接着这次的记录继续聊 —— 这是故意的，
   * 否则关闭面板就等于把刚说的话丢了。
   */
  async function onFinishConsult() {
    if (!consultId || busyTool || sending) return;
    setBusyTool(true);
    setNotice(null);
    try {
      await archiveConsultation(consultId);
      closeRecord();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "没能归档，再试一次");
    } finally {
      setBusyTool(false);
    }
  }

  /* -------------------------------------------------------------- 风声 */

  function toggleSound() {
    if (!soundRef.current) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const len = Math.floor(ctx.sampleRate * 3);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.4;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 520;

      const gain = ctx.createGain();
      gain.gain.value = 0;

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.028;
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);

      src.connect(lp);
      lp.connect(gain);
      gain.connect(ctx.destination);
      src.start();
      lfo.start();

      soundRef.current = { ctx, gain };
    }

    const { ctx, gain } = soundRef.current;
    if (ctx.state === "suspended") void ctx.resume();
    const next = !soundOn;
    setSoundOn(next);
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(next ? 0.055 : 0, now, 0.8);
  }

  async function onLogout() {
    try {
      await logout();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  /* --------------------------------------------------------------- 渲染 */

  const count = patients.length;
  // 正在改第几条：它之后的回答都要作废，渲染时统一淡化
  const editingIndex = editing
    ? chat.findIndex((c) => c.id === editing.itemId)
    : -1;

  return (
    <>
      {/* ============ 开场：蒲公英 ============ */}
      <div
        className="boot"
        data-ready={sceneReady ? "" : undefined}
        data-blown={blown ? "" : undefined}
        data-done={done ? "" : undefined}
        hidden={done}
      >
        <div className="boot__glow" aria-hidden="true" />
        <div className="boot__motes" aria-hidden="true">
          {Array.from({ length: 9 }).map((_, i) => (
            <i key={i} />
          ))}
        </div>

        <div className="boot__stage">
          <svg className="dandelion" viewBox="0 0 300 300" aria-hidden="true">
            <g className="dandelion__seeds" ref={seedHostRef} />
            <circle className="dandelion__core" cx="150" cy="146" r="7.5" />
            <path
              className="dandelion__stem"
              d="M150 154 C 147 196, 154 226, 145 268"
            />
          </svg>
          <p className="sr-only">
            {sceneReady ? "草地准备好了" : "正在准备草地"}
          </p>
        </div>

        <div className="boot__word">
          <h1 className="boot__title">MedAI</h1>
          <p className="boot__sub">每一分身体状况，都值得被认真回应</p>
        </div>

        <div className="boot__meta">
          <span className="boot__label">
            {sceneReady ? "草地准备好了" : "正在准备草地"}
          </span>
          <div className="boot__bar">
            <i style={{ width: sceneReady ? "100%" : "38%" }} />
          </div>
        </div>

        <button
          className="boot__blow"
          type="button"
          onClick={blow}
          disabled={!sceneReady}
          autoFocus
        >
          <span className="boot__signal" />
          吹散蒲公英，去兔子那边
        </button>

        <button className="boot__skip" type="button" onClick={blow}>
          跳过开场
        </button>
      </div>

      {/* ============ 世界 ============ */}
      <div className="world">
        <div ref={stageRef} className="world__stage" />
      </div>
      <div className="world__wash" aria-hidden="true" />
      <div className="world__grain" aria-hidden="true" />

      {/* ============ 吊牌上的字：HTML 面板，每帧贴到 3D 板面 ============ */}
      <div className="medsign" ref={signPanelRef} aria-hidden="true">
        <div className="medsign__head">
          <span className="medsign__eyebrow">今天的药</span>
          <span className="medsign__score">
            <b>{board.done}</b>
            <i>/</i>
            {board.total}
            <em>次</em>
          </span>
        </div>

        {board.entries.length === 0 ? (
          <p className="medsign__empty">
            今天还没有要吃的药
            <span>去档案里加一条在服的药</span>
          </p>
        ) : (
          <ul className="medsign__rows">
            {board.entries.slice(0, 3).map((e) => (
              <li
                key={e.patientId}
                className={
                  e.overdue > 0 ? "is-late" : e.done >= e.total ? "is-done" : ""
                }
              >
                <span className="medsign__dot" />
                <span className="medsign__name">{e.patientName}</span>
                <span className="medsign__num">
                  {e.done}/{e.total}
                </span>
              </li>
            ))}
            {board.entries.length > 3 && (
              <li className="is-more">
                <span className="medsign__dot" />
                <span className="medsign__name">
                  还有 {board.entries.length - 3} 位
                </span>
              </li>
            )}
          </ul>
        )}
      </div>

      {/* ============ 木牌明细：点木牌，卡片就从木牌上面长出来 ============ */}
      {/* 空板子点开：说清楚这块板子是干什么的，别只给一块「今天 0/0」 */}
      {signSheet && board.entries.length === 0 && (
        <aside
          className="signcard signcard--empty signcard--below"
          ref={signCardRef}
          style={{
            left: signSheet.left,
            top: signSheet.top,
          }}
          role="dialog"
          aria-label="今天的药"
        >
          <header className="signcard__head">
            <div>
              <p className="signcard__eyebrow">今天的药</p>
              <p className="signcard__sum">板子上还空着</p>
            </div>
            <button
              className="signcard__close"
              type="button"
              onClick={() => setSignSheet(null)}
              aria-label="收起"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" />
              </svg>
            </button>
          </header>
          <p className="signcard__empty">
            在任一档案里加一条「在服」的药，把每天吃药的时间点填上（比如 08:00），
            这块木牌就开始记：今天谁吃了几次、谁过点了还没吃。
          </p>
          <p className="signcard__foot">只记今天 · 有药之后在这里直接打卡</p>
        </aside>
      )}

      {signSheet && board.entries.length > 0 && (
        <aside
          className="signcard signcard--below"
          ref={signCardRef}
          style={{
            left: signSheet.left,
            top: signSheet.top,
          }}
          role="dialog"
          aria-label="今天要吃的药"
        >
          <header className="signcard__head">
            <div>
              <p className="signcard__eyebrow">今天的药</p>
              <p className="signcard__sum">
                {board.done} / {board.total} 次
                {board.overdue > 0 && (
                  <span className="signcard__late">还有 {board.overdue} 次没吃</span>
                )}
              </p>
            </div>
            <button
              className="signcard__close"
              type="button"
              onClick={() => setSignSheet(null)}
              aria-label="收起"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" />
              </svg>
            </button>
          </header>

          <ul className="signcard__list">
            {sheetEntries.map((e) => (
              <li key={e.patientId} className="signcard__row">
                <div className="signcard__who">
                  <Link className="signcard__name" href={`/patients/${e.patientId}`}>
                    {e.patientName}
                  </Link>
                  <span
                    className={`signcard__count${
                      e.overdue > 0 ? " is-late" : e.done >= e.total ? " is-done" : ""
                    }`}
                  >
                    {e.done}/{e.total}
                  </span>
                </div>
                <ul className="signcard__doses">
                  {e.doses.map((d) => (
                    <li key={d.medicationId}>
                      <button
                        type="button"
                        className={`signcard__dose${d.done ? " is-done" : d.overdue ? " is-late" : ""}${
                          doseBusy === d.medicationId ? " is-busy" : ""
                        }`}
                        onClick={() => void toggleDose(d)}
                        disabled={doseBusy !== null}
                        aria-pressed={d.done}
                        aria-label={`${d.drugName} ${d.timeOfDay}，${
                          d.done ? "已服，点一下撤销" : "点一下打卡"
                        }`}
                        title={d.done ? "点一下撤销" : "点一下打卡"}
                      >
                        <span className="signcard__tick" aria-hidden="true">
                          <svg viewBox="0 0 16 16">
                            <path d="M3.4 8.5l3.2 3.2 6-7" />
                          </svg>
                        </span>
                        <span className="signcard__time">{d.timeOfDay}</span>
                        <span className="signcard__drug">{d.drugName}</span>
                        <span className="signcard__state">
                          {d.done ? "已服" : d.overdue ? "没吃" : "待吃"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          {signError && (
            <p className="signcard__err" role="status">
              {signError}
            </p>
          )}

          <p className="signcard__foot">点一行就打卡，再点一下撤销 · 只记今天</p>
        </aside>
      )}

      {/* ============ 兔子头顶的对话气泡 ============ */}
      <RabbitBubble
        meadowRef={meadowRef}
        panelRightRef={panelRightRef}
        ready={done}
        resumed={resumed}
      />

      {/* ============ 顶栏 ============ */}
      <header className="hud">
        <div className="wordmark">
          <span className="wordmark__name">MedAI</span>
          <span className="wordmark__dot" />
          <span className="wordmark__tail">档案 · 科普 · 药品</span>
        </div>

        <div className="hud__actions">
          <Link className="clay clay--pill hud__new" href="/patients/new">
            <span className="clay__text">新建档案</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </Link>

          <button
            className="clay clay--icon"
            type="button"
            aria-pressed={soundOn}
            title="风声"
            onClick={toggleSound}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9v6h3l4 4V5L7 9H4z" />
              <path d="M16 8.5c1.4 1 2 2.2 2 3.5s-.6 2.5-2 3.5" />
            </svg>
          </button>

          <button
            className="clay clay--icon"
            type="button"
            title={`${email} · 退出登录`}
            onClick={onLogout}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5h3a2 2 0 012 2v10a2 2 0 01-2 2h-3" />
              <path d="M10 8l-4 4 4 4M6 12h9" />
            </svg>
          </button>
        </div>
      </header>

      {/* ============ 左栏：档案（占三分之一） ============ */}
      <main className="records">
        <div className="records__scroll">
          {/* 三个入口：档案是当前页，另两个去科普库和药品库 */}
          <nav className="portal" aria-label="功能入口">
            <span className="portal__item is-on" aria-current="page">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 5.5A2.5 2.5 0 016.5 3H19v18H6.5A2.5 2.5 0 014 18.5z" />
                <path d="M8 3v18" />
              </svg>
              <b>档案</b>
              <i>{count} 份</i>
            </span>

            <Link className="portal__item" href="/library">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4.5h6a2 2 0 012 2V20a2 2 0 00-2-2H4z" />
                <path d="M20 4.5h-6a2 2 0 00-2 2V20a2 2 0 012-2h6z" />
              </svg>
              <b>疾病科普</b>
              <i>{counts.diseases} 条</i>
            </Link>

            <Link className="portal__item" href="/drugs">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3.2" y="8.4" width="17.6" height="7.2" rx="3.6" />
                <path d="M12 8.4v7.2" />
              </svg>
              <b>药品说明</b>
              <i>{counts.drugs} 种</i>
            </Link>
          </nav>

          {/* 手机上立不住木牌（地和字都不够），换成档案栏顶上的这一条 */}
          {board.entries.length > 0 && (
            <button
              className="medtoday"
              type="button"
              onClick={() => {
                const W = 304;
                openSignSheet({
                  left: Math.max(12, (window.innerWidth - W) / 2),
                  // 让开兔子头顶的气泡
                  top: 176,
                });
              }}
            >
              <span
                className={`medtoday__dot${board.overdue > 0 ? " is-late" : ""}`}
                aria-hidden="true"
              />
              <span className="medtoday__label">今天的药</span>
              <span
                className={`medtoday__count${board.overdue > 0 ? " is-late" : ""}`}
              >
                {board.done}/{board.total}
              </span>
              {board.overdue > 0 && (
                <span className="medtoday__late">{board.overdue} 次没吃</span>
              )}
              <svg className="medtoday__go" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 3.5L10.5 8 6 12.5" />
              </svg>
            </button>
          )}

          <header className="records__head">
            <p className="eyebrow">
              <span className="eyebrow__dot" />
              档案 · archive
            </p>
            <h2 className="records__title">
              今天有 <em>{count}</em> 份档案
            </h2>
          </header>

          <ul className="record-list">
            {patients.map((p, i) => (
              <li className="record" key={p.id}>
                <button
                  type="button"
                  className="record__btn"
                  onClick={() => void openRecord(p)}
                  aria-label={`打开档案 ${p.name}，开始 AI 问诊`}
                >
                  <span className="record__no">
                    {i < 9 ? `0${i + 1}` : i + 1}
                  </span>
                  <span className="record__body">
                    <span className="record__row">
                      <b className="record__name">{p.name}</b>
                      <i
                        className={`record__level${
                          p.allergies ? "" : " record__level--calm"
                        }`}
                        title={p.allergies ? `过敏史：${p.allergies}` : "档案里没有记过敏史"}
                      >
                        {p.allergies ? "过敏" : "平稳"}
                      </i>
                    </span>
                    <span className="record__meta">
                      {p.age ? `${p.age} 岁` : "年龄未填"} ·{" "}
                      {p.gender === "male" ? "男" : "女"} ·{" "}
                      {p.counts.consultations} 次问诊 ·{" "}
                      {p.medications.filter((m) => m.isActive).length} 种在服药
                    </span>
                    <span className="record__complaint">
                      {p.chiefComplaint || "还没有填写主诉"}
                    </span>
                  </span>
                  <span className="record__go">→</span>
                </button>
              </li>
            ))}

            {count === 0 && (
              <li className="record">
                <Link className="record__btn" href="/patients/new">
                  <span className="record__no">00</span>
                  <span className="record__body">
                    <span className="record__row">
                      <b className="record__name">还没有档案</b>
                    </span>
                    <span className="record__complaint">
                      先给自己（或家人）建一份，问诊才有依据。
                    </span>
                  </span>
                  <span className="record__go">→</span>
                </Link>
              </li>
            )}
          </ul>

          <footer className="records__foot">
            <p className="records__demo">
              档案、用药与问诊记录只有你自己能看见。MedAI
              的回答用于健康科普与就诊前的梳理，不能替代执业医师的诊断。
            </p>
          </footer>
        </div>
      </main>

      {/* ============ 右侧滑入：AI 问诊 ============ */}
      <section
        ref={consultRef}
        className={`consult${current ? "" : " is-closed"}`}
        aria-hidden={!current}
        aria-label="AI 问诊"
      >
        <header className="consult__head">
          <div className="consult__who">
            <span className="consult__tag">
              {current ? `档案 · ${current.name}` : "档案"}
            </span>
            <h3 className="consult__name">
              {current
                ? `${current.name}${current.age ? ` · ${current.age} 岁` : ""}`
                : "—"}
            </h3>
            <p className="consult__meta">
              {current
                ? current.chiefComplaint ||
                  `${current.gender === "male" ? "男" : "女"} · 还没有填主诉`
                : "—"}
            </p>
          </div>

          <div className="consult__acts">
            {current && (
              <Link
                className="clay clay--icon consult__open"
                href={`/patients/${current.id}`}
                title="档案详情"
                // 跳走前先把面板收好：不然回来时 body 上还挂着 is-consulting
                onClick={closeRecord}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5.5A2.5 2.5 0 016.5 3H19v18H6.5A2.5 2.5 0 014 18.5z" />
                  <path d="M8 3v18" />
                </svg>
              </Link>
            )}
            <button
              className="clay clay--icon consult__close"
              type="button"
              title="返回档案"
              aria-label="返回档案"
              onClick={closeRecord}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </header>

        <div className="consult__log" ref={logRef} aria-live="polite">
          {chat.map((m, index) => {
            if (m.role === "typing") {
              return (
                <p className="msg msg--bot msg--typing" key={m.id}>
                  <i />
                  <i />
                  <i />
                </p>
              );
            }

            const flagKind = readRedFlagMark(m.flag);
            if (flagKind) {
              return (
                <div className={`redcard redcard--${flagKind}`} key={m.id}>
                  <div className="redcard__head">
                    <span className="redcard__mark" aria-hidden="true">
                      !
                    </span>
                    <span className="redcard__title">{RED_FLAG_TITLE[flagKind]}</span>
                    <span className="redcard__tag">本地规则拦截</span>
                  </div>
                  <p className="redcard__text">{m.content}</p>
                </div>
              );
            }

            const isUser = m.role === "user";
            const isEditing = editing?.itemId === m.id;
            // 正在改的这句话之后的回答都会被作废，先视觉上淡掉，别让人以为还能用
            const isStale = editingIndex >= 0 && index > editingIndex;

            if (isEditing) {
              return (
                <div className="edit" key={m.id}>
                  <textarea
                    className="edit__box"
                    value={editing.text}
                    autoFocus
                    rows={Math.min(7, Math.max(2, Math.ceil(editing.text.length / 26)))}
                    onChange={(e) =>
                      setEditing({ ...editing, text: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditing(null);
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void saveEdit();
                      }
                    }}
                  />
                  <div className="edit__acts">
                    <button
                      className="clay clay--pill"
                      type="button"
                      onClick={() => void saveEdit()}
                      disabled={sending || !editing.text.trim()}
                    >
                      <span className="clay__text">改好重发</span>
                    </button>
                    <button
                      className="edit__cancel"
                      type="button"
                      onClick={() => setEditing(null)}
                    >
                      取消
                    </button>
                    <span className="edit__hint">
                      Ctrl+Enter 保存 · 之后的回答会重新生成
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <p
                className={`msg msg--${isUser ? "me" : m.role === "note" ? "note" : "bot"}${
                  isUser && m.messageId ? " msg--editable" : ""
                }${isStale ? " msg--stale" : ""}`}
                key={m.id}
              >
                {m.content}

                {m.attachment && (
                  <span className="msg__file">
                    <span className="msg__file-name">{m.attachment.filename}</span>
                    <span className="msg__file-meta">
                      {m.attachment.hasText
                        ? `已读取 ${m.attachment.textLength} 字`
                        : "没读出文字"}
                    </span>
                  </span>
                )}

                {m.editedAt && <span className="msg__edited">已修改</span>}

                {isUser && m.messageId && !sending && !editing && (
                  <button
                    className="msg__edit"
                    type="button"
                    title="改一下，让 MedAI 重新回答"
                    onClick={() => startEdit(m)}
                  >
                    修改
                  </button>
                )}
              </p>
            );
          })}

          {facts && (
            <div className="facts">
              <p className="facts__title">
                MedAI 从这次对话里读到 {facts.length} 条可以补进档案的内容
              </p>
              <ul className="facts__list">
                {facts.map((f) => (
                  <li
                    key={f.id}
                    className={`facts__item facts__item--${f.kind}`}
                  >
                    <label className="facts__check">
                      <input
                        type="checkbox"
                        checked={!!checked[f.id]}
                        onChange={(e) =>
                          setChecked((prev) => ({ ...prev, [f.id]: e.target.checked }))
                        }
                      />
                      <span>
                        <b className="facts__kind">
                          {f.kind === "fill"
                            ? "补充"
                            : f.kind === "add"
                              ? "新增用药"
                              : "与档案不一致"}
                        </b>
                        <span className="facts__label">
                          {f.label || f.drug?.drugName || ""}
                        </span>
                      </span>
                    </label>
                    <p className="facts__value">
                      {f.kind === "add"
                        ? [f.drug?.drugName, f.drug?.dosage, f.drug?.frequency]
                            .filter(Boolean)
                            .join(" · ")
                        : f.value}
                    </p>
                    {f.kind === "conflict" && (
                      <p className="facts__current">档案里现在是：{f.current || "（空）"}</p>
                    )}
                    <p className="facts__reason">{f.reason}</p>
                  </li>
                ))}
              </ul>
              <div className="facts__acts">
                <button className="clay clay--pill" type="button" onClick={() => void onApplyFacts()}>
                  <span className="clay__text">写进档案</span>
                </button>
                <button className="facts__cancel" type="button" onClick={() => setFacts(null)}>
                  先不写
                </button>
              </div>
            </div>
          )}

          {notice && <p className="consult__notice">{notice}</p>}
        </div>

        <div className="consult__chips">
          {chat.length <= 1 &&
            OPENERS.map((text) => (
              <button
                className="chip"
                type="button"
                key={text}
                onClick={() => void send(text)}
                disabled={sending || !consultId}
              >
                {text}
              </button>
            ))}

          {chat.length > 1 && (
            <>
              <button
                className="chip chip--tool"
                type="button"
                onClick={() => void onSummary()}
                disabled={busyTool || sending}
              >
                小结这次问诊
              </button>
              <button
                className="chip chip--tool"
                type="button"
                onClick={() => void onScanFacts()}
                disabled={busyTool || sending}
              >
                整理进档案
              </button>
              <button
                className="chip chip--tool chip--sheet"
                type="button"
                onClick={() => setSheetOpen(true)}
                disabled={busyTool || sending || !consultId}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 3.6h6.4L18 8.2v12.2H7z" />
                  <path d="M13.4 3.6v4.6H18" />
                </svg>
                带走就诊摘要
              </button>
              <button
                className="chip chip--tool chip--done"
                type="button"
                onClick={() => void onFinishConsult()}
                disabled={busyTool || sending || !consultId}
                title="这次聊完了：归档后下次打开档案会重新开始"
              >
                这次聊完了
              </button>
            </>
          )}
        </div>

        {pending && (
          <div className="attach">
            <span className="attach__name">{pending.filename}</span>
            <span className="attach__meta">
              {pending.hasText
                ? `已读取 ${pending.textLength} 字`
                : "没读出文字，建议补一句描述"}
            </span>
            <button
              className="attach__x"
              type="button"
              title="不发这份资料"
              onClick={() => setPending(null)}
            >
              ×
            </button>
          </div>
        )}

        <form
          className="consult__form"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft, { attachment: pending });
          }}
        >
          <input
            ref={fileRef}
            type="file"
            className="consult__file"
            accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.docx,.txt,.md,.csv,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickFile(f);
            }}
          />
          <button
            className="clay clay--icon consult__attach"
            type="button"
            title="上传病历、化验单或报告"
            aria-label="上传资料"
            disabled={!consultId || uploading || sending}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <i className="consult__spin" />
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            )}
          </button>
          <input
            className="consult__input"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              uploading ? "正在读这份资料…" : "也可以自己描述一下，或传一张病历照片…"
            }
            aria-label="输入你的描述"
            disabled={!consultId}
          />
          <button
            className="clay clay--pill consult__send"
            type="submit"
            disabled={sending || !consultId || (!draft.trim() && !pending)}
          >
            <span className="clay__text">发送</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>

        <p className="consult__boundary">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.6v5.2M12 16.4v.2" />
          </svg>
          胸痛、呼吸困难、意识不清、大出血这类情况，别在这儿聊 —— 直接打 120 或去急诊。
        </p>

        <p className="consult__foot">
          不是诊断，只是把该注意的地方慢慢说清楚。
          <span className="consult__retention">
            对话记录 {RETENTION_DAYS} 天后自动清除，不会永久保存。
          </span>
        </p>
      </section>

      {/* 这张纸用 portal 挂到 body 上，打印时才能只留下它 */}
      {sheetOpen && current && consultId && (
        <VisitSheetPanel
          consultationId={consultId}
          patient={current}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
}
