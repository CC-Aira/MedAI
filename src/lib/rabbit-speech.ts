/**
 * 兔子气泡的「说话」接口 —— 问诊表单 / 其他模块的对接点。
 *
 * 最简单的用法（表单拿到大模型回复后，直接把文本丢进来）：
 *   import { showBubble } from "@/lib/rabbit-speech";
 *   showBubble(回复全文);
 *
 * 非 React 代码 / 控制台里：
 *   window.showBubble("回复全文")
 *   window.medaiRabbit.showBubble("回复全文")
 *
 * 其它：
 *   rabbitSay("…")        原样说一句话
 *   rabbitGreet()         欢迎语（只在「欢迎语」分类里抽）
 *   rabbitBack()          从科普库/药品库回来时的「回来啦」
 *   rabbitRandom()        全部分类随机一句（点兔子时用）
 *   rabbitThinking()      等模型时先占位
 *
 * 气泡只负责展示，不参与业务：谁都能说，说的人不需要知道气泡挂在哪。
 */

import {
  backLine,
  cheerLine,
  randomLine,
  welcomeLine,
  type RabbitCategory,
  type RabbitTone,
} from "@/data/rabbit-quotes";

export interface RabbitLine {
  /** 每条递增，用来让气泡重播入场动画（同样的话再说一次也能弹） */
  id: number;
  text: string;
  /** 第二段小字：问诊回复后面的鼓励话术 */
  tail?: string;
  tone: RabbitTone;
  /** 语录分类；模型回复 / 占位语没有分类 */
  category?: RabbitCategory;
  /** 常驻不自动消失（等回复时用），下一句来了就替换 */
  sticky: boolean;
  /** 毫秒；0 表示用默认时长 */
  duration: number;
  /** 说完蹦一下（用药到点提醒用，让人注意到草地上有动静） */
  hop?: boolean;
}

type Listener = (line: RabbitLine) => void;

const listeners = new Set<Listener>();
let seq = 0;

/**
 * 没有气泡在听时说的话先存着。
 *
 * 用药提醒跑在根布局里，人可能正待在档案页 / 科普页 —— 那些页面没有兔子气泡。
 * 等回到草地、气泡挂上来，再把刚才那句补出来，比直接丢掉强。
 * 只留最后一句，且超过两分钟就过期：过时的提醒说出来反而添乱。
 */
let pending: { line: RabbitLine; at: number } | null = null;
const PENDING_TTL = 120_000;

function emit(line: Omit<RabbitLine, "id" | "sticky" | "duration"> & {
  sticky?: boolean;
  duration?: number;
}) {
  const full: RabbitLine = {
    id: ++seq,
    sticky: line.sticky ?? false,
    duration: line.duration ?? 0,
    ...line,
  };
  if (listeners.size === 0) pending = { line: full, at: Date.now() };
  listeners.forEach((fn) => {
    try {
      fn(full);
    } catch (err) {
      console.warn("[medai] 气泡渲染失败", err);
    }
  });
  return full;
}

export function onRabbitSpeech(fn: Listener): () => void {
  listeners.add(fn);
  // 刚才没人在听的话，现在补上
  if (pending && Date.now() - pending.at < PENDING_TTL) {
    const { line } = pending;
    pending = null;
    try {
      fn(line);
    } catch (err) {
      console.warn("[medai] 气泡补发失败", err);
    }
  } else {
    pending = null;
  }
  return () => {
    listeners.delete(fn);
  };
}

/** 原样说一句话 */
export function rabbitSay(
  text: string,
  opts: {
    tone?: RabbitTone;
    tail?: string;
    sticky?: boolean;
    duration?: number;
    category?: RabbitCategory;
  } = {},
): RabbitLine {
  return emit({
    text: clean(text),
    tail: opts.tail,
    tone: opts.tone ?? "care",
    category: opts.category,
    sticky: opts.sticky,
    duration: opts.duration,
  });
}

/**
 * 【对外主接口】把一段回复显示在气泡里。
 *
 * 大模型返回的通常是一整段带 markdown 的长文，气泡只放得下两行，
 * 所以这里取第一句压成 ≤46 字，再自动配一句鼓励话术；完整内容仍留在对话里。
 */
export function showBubble(
  reply: string,
  opts: { tail?: string; duration?: number } = {},
): RabbitLine {
  const short = excerptReply(reply);
  return emit({
    text: short || "我看过了，细节都记在左边的对话里了。",
    tail: opts.tail ?? cheerLine(),
    tone: "reply",
    duration: opts.duration ?? 14000,
  });
}

/** 兼容旧名字 */
export const rabbitSayReply = showBubble;

/** 页面加载完：只在「欢迎语」分类里随机 */
/** 从疾病科普 / 药品说明页回到草地：不说"初次见面"那套，只说一句「回来啦」 */
export function rabbitBack(): RabbitLine {
  const line = backLine();
  return emit({
    text: line.text,
    tone: line.tone,
    category: line.category,
    duration: 7000,
  });
}

export function rabbitGreet(): RabbitLine {
  const line = welcomeLine();
  return emit({
    text: line.text,
    tone: line.tone,
    category: line.category,
    duration: 11000,
  });
}

/** 点兔子：全部分类随机一句 */
export function rabbitRandom(): RabbitLine {
  const line = randomLine();
  return emit({
    text: line.text,
    tone: line.tone,
    category: line.category,
    duration: 9000,
  });
}

/** 思考中：等模型回答时先说一句，常驻到下一句来 */
export function rabbitThinking(text = "我看看呀，稍等我一下…"): RabbitLine {
  return emit({ text, tone: "reply", sticky: true });
}

/**
 * 到点吃药：兔子替系统通知跑一趟腿。
 *
 * 系统通知需要权限，还可能被浏览器/系统静音；兔子说话不需要任何权限，
 * 所以它才是站内提醒的主通道，弹窗只是锦上添花。
 */
export function rabbitMedReminder(dose: {
  drugName: string;
  timeOfDay: string;
  patientName?: string;
}): RabbitLine {
  const who = dose.patientName ? `${dose.patientName}，` : "";
  return emit({
    text: `${who}${dose.timeOfDay} 那颗${dose.drugName}还没打卡哦`,
    tail: "点木牌就能给全家人打卡",
    tone: "care",
    duration: 24_000,
    hop: true,
  });
}

/* ------------------------------- 文本处理 ------------------------------- */

const MAX_CHARS = 46;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 从一段回答里取「第一句能独立成立的话」。
 * 回答通常是 markdown + 长段落，气泡只放两行，所以按句号切、按字数兜底。
 */
export function excerptReply(reply: string, max = MAX_CHARS): string {
  const flat = clean(
    reply
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/^[#>\-*\s]+/gm, "")
      .replace(/\*\*|__|`|~~/g, "")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1"),
  );
  if (!flat) return "";

  // 先剥掉开头常见的自我介绍，气泡里不需要重复「我是 MedAI」
  const stripped = flat.replace(/^(您好|你好|我是\s*MedAI[^，,。]*[，,。]\s*)/i, "");

  const sentences = stripped.split(/(?<=[。！？；!?;])/);
  let out = "";
  for (const s of sentences) {
    if (!s.trim()) continue;
    if (out && out.length + s.length > max) break;
    out += s;
    if (out.length >= Math.min(22, max)) break;
  }
  out = out.trim() || stripped;

  if (out.length > max) {
    // 超长就在最后一个逗号处断开，别把词劈成两半
    const cut = out.slice(0, max);
    const at = Math.max(cut.lastIndexOf("，"), cut.lastIndexOf("、"), cut.lastIndexOf(","));
    out = `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[，,、：:]$/, "")}…`;
  }
  return out;
}

/* --------------------------- 非 React 的调用入口 --------------------------- */

declare global {
  interface Window {
    medaiRabbit?: {
      showBubble: typeof showBubble;
      /** showBubble 的别名 */
      reply: typeof showBubble;
      say: typeof rabbitSay;
      greet: typeof rabbitGreet;
      random: typeof rabbitRandom;
      thinking: typeof rabbitThinking;
    };
    /** 挂一个同名的全局函数，表单那边不用记命名空间 */
    showBubble?: typeof showBubble;
  }
}

/** 由气泡组件挂载时调用：控制台和外部脚本也能让兔子说话 */
export function installRabbitBridge() {
  if (typeof window === "undefined") return;
  window.medaiRabbit = {
    showBubble,
    reply: showBubble,
    say: rabbitSay,
    greet: rabbitGreet,
    random: rabbitRandom,
    thinking: rabbitThinking,
  };
  window.showBubble = showBubble;
}
