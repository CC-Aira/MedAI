/**
 * 红旗症状拦截 —— 这一步不经过模型。
 *
 * 为什么不交给模型判断：
 * 1. 延迟：真出事的时候，多等 8 秒的流式回答没有意义；
 * 2. 一致：同一句话必须得到同一个结论，不能被采样温度影响；
 * 3. 可演示：没配 API Key 也能跑，评委会直接看到这条边界。
 *
 * 判定原则：宁可多拦一点，也不能漏。所以「否定」和「假设」会显式排除，
 * 但排除窗口只取命中词前面几个字 ——「没有胸痛」不拦，「刚才胸痛」照拦。
 */

export type RedFlagLevel = "emergency" | "urgent";

/** 兜底的紧急程度说明 */
export const LEVEL_TEXT: Record<RedFlagLevel, string> = {
  emergency: "现在就去急诊",
  urgent: "尽快看一次医生",
};

export type RedFlagHit = {
  id: string;
  /** 卡片标题用的短名，如「胸痛 / 胸口压榨感」 */
  label: string;
  level: RedFlagLevel;
  /** 实际命中的原话，展示给用户看，让他知道是哪句触发的 */
  hit: string;
};

type Rule = {
  id: string;
  label: string;
  level: RedFlagLevel;
  patterns: RegExp[];
  /** 命中词前面出现这些字时不算（避免「疼得想死」这种口语误伤） */
  unlessBefore?: RegExp;
};

/* ------------------------------------------------------------- 规则表 */

const RULES: Rule[] = [
  {
    id: "chest",
    label: "胸痛 / 胸口压榨感",
    level: "emergency",
    patterns: [
      /胸(?:口|部|前|膛|骨后)?\s*(?:疼|痛)/,
      /心(?:口|前区|窝)\s*(?:疼|痛)/,
      /压榨(?:性|样)(?:的)?(?:疼|痛|闷)/,
      /胸(?:口)?(?:有)?(?:压迫感|压着|压得|堵得)/,
      /胸口(?:像|好像|像是).{0,6}(?:压|堵|石头)/,
    ],
  },
  {
    id: "breath",
    label: "呼吸困难",
    level: "emergency",
    patterns: [
      /呼吸(?:困难|急促|不过来)/,
      /喘不[上过]来?气/,
      /上不来气/,
      /喘不过气/,
      /窒息/,
      /(?:憋|闷)得(?:喘不|上不来)/,
    ],
  },
  {
    id: "conscious",
    label: "意识不清 / 晕倒 / 抽搐",
    level: "emergency",
    patterns: [
      /意识(?:不清|模糊|丧失|障碍)/,
      /昏迷/,
      /(?:晕|昏)倒/,
      /晕厥/,
      /(?:晕|昏)过去/,
      /抽搐/,
      /叫不醒/,
      /不省人事/,
    ],
  },
  {
    id: "stroke",
    label: "中风样表现（一侧无力 / 说话不清）",
    level: "emergency",
    patterns: [
      /(?:一侧|一边|半边|半身|单侧)(?:肢体|身子|手脚)?\s*(?:无力|发麻|麻木|没力气|不能动|动不了)/,
      /说话(?:不清|含糊|大舌头|不利索)/,
      /(?:嘴|口)角歪/,
      /口齿不清/,
    ],
  },
  {
    id: "bleeding",
    label: "大出血 / 呕血 / 黑便",
    level: "emergency",
    patterns: [
      /大出血/,
      /(?:血)?流(?:个)?不止/,
      /止不住(?:的)?血/,
      /呕血/,
      // 「吐了一口血」「咳出血丝」都要接住，所以中间允许多几个字
      /吐[^，。！？]{0,4}血/,
      /[咯咳][^，。！？]{0,4}血/,
      /黑便/,
      /柏油(?:样)?便/,
    ],
  },
  {
    id: "anaphylaxis",
    label: "过敏反应（喉咙肿 / 全身起疹）",
    level: "emergency",
    patterns: [
      /喉咙(?:发紧|肿|堵|紧)/,
      /喉头水肿/,
      /(?:嘴唇|舌头|脸)(?:肿|发麻|麻)/,
      /过敏性休克/,
      /全身(?:起)?(?:疹|风团|荨麻疹)/,
    ],
  },
  {
    id: "self_harm",
    label: "伤害自己的想法",
    level: "emergency",
    patterns: [/不想活/, /自杀/, /轻生/, /活不下去/, /想死/],
    // 「疼得想死」「累得想死」是口头语，不是这个意思
    unlessBefore: /(?:疼|痛|累|热|冷|饿|困|烦|难受|苦|丑|吵|闷)得$/,
  },
  {
    id: "chest_tight",
    label: "胸闷",
    level: "urgent",
    patterns: [/胸闷/, /胸口(?:发)?闷/, /胸(?:部|口)?(?:发)?紧/],
  },
  {
    id: "headache",
    label: "剧烈头痛",
    level: "urgent",
    patterns: [
      /(?:剧烈|炸裂[样]?|要炸[了开]?)(?:的)?(?:头)?痛/,
      /头痛(?:得|的)(?:厉害|剧烈|受不了)/,
    ],
  },
  {
    id: "stool_blood",
    label: "便血",
    level: "urgent",
    patterns: [/便血/, /大便(?:带血|有血)/, /血便/],
  },
  {
    id: "belly",
    label: "剧烈腹痛",
    level: "urgent",
    patterns: [
      /(?:肚子|腹)(?:疼|痛)(?:得|的)(?:厉害|受不了|打滚|直不起腰)/,
      /(?:肚子|腹)(?:疼|痛)得(?:厉害|要命)/,
    ],
  },
];

/* --------------------------------------------------------- 否定 / 假设 */

/** 命中词前面出现这些，说明是否认：「没有胸痛」「否认胸痛」 */
const NEG_BEFORE = /(?:没有|并没有|没|无|未见|未|否认|不是|并不|不|别|非)$/;
/** 命中词前面出现这些，说明是假设或提问：「如果胸痛」「会不会胸痛」 */
const HYP_BEFORE = /(?:如果|要是|假如|万一|假设|是否|会不会|需不需要|用不用|有没有)$/;
/**
 * 命中词前面出现这些，说明是过去的事：「上个月胸痛过」「以前晕倒过一次」。
 * 已经过去、现在没事的，急着喊 120 只会让人关掉页面 —— 降一档说「今天去看一次」。
 * 注意只降「程度」，不取消拦截：晕过一次本身就值得看医生。
 */
const PAST_BEFORE = /(?:以前|之前|上次|上个月|去年|前年|小时候|当时|那次|曾经|过去|当年)$/;

/** 往命中词前面回看几个字；再长就会把「不」字凑到无关的位置 */
const WINDOW = 6;
/** 同一小句里最多回看多少字（找「否认」这类修饰语用） */
const CLAUSE_MAX = 16;
/** 小句开头的整体否定：「否认胸痛、呼吸困难」——「否认」管的是整个并列短语 */
const CLAUSE_NEG = /^(?:否认|没有出现|未出现|没出现)/;
/** 在问「什么样才算」：「什么时候算呼吸困难」「算不算胸痛」——这是求解释，不是报症状 */
const CLAUSE_ASK = /(?:什么叫|什么是|什么时候算|怎样算|怎么算|如何判断|怎么判断|算不算|是否属于)/;
const SENTENCE_STOP = /[。！？!?；;\n]/;

/** 去掉末尾的标点，否则「没有胸痛、呼吸困难」里的顿号会让否定词够不着 */
function trimTail(s: string): string {
  return s.replace(/[、，,。;；:：\s"'“”‘’（）()]+$/g, "");
}

/**
 * 取命中词前面的上下文：
 * - tail  紧挨着的前几个字，用来判否定 / 假设 / 过去时
 * - clause 同一小句里的前缀，用来判「否认……」这类整体否定
 */
function beforeOf(src: string, start: number) {
  let i = start - 1;
  const limit = Math.max(0, start - CLAUSE_MAX);
  while (i >= limit && !SENTENCE_STOP.test(src[i])) i -= 1;
  return {
    tail: trimTail(src.slice(Math.max(0, start - WINDOW), start)),
    clause: src.slice(i + 1, start),
  };
}

/**
 * 扫一段话，返回命中的红旗信号（按紧急程度排序，同一类只报一次）。
 *
 * 注意：不做分词、不调用模型。宁可漏掉绕圈子的说法，
 * 也要保证常见的直白说法不会误伤。
 */
export function detectRedFlags(text: string, limit = 3): RedFlagHit[] {
  const src = (text || "").replace(/\s+/g, "");
  if (!src) return [];

  const hits: RedFlagHit[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    if (hits.length >= limit) break;
    if (seen.has(rule.id)) continue;

    for (const pattern of rule.patterns) {
      const m = pattern.exec(src);
      if (!m) continue;

      const { tail, clause } = beforeOf(src, m.index);
      // 否定 + 假设：都不拦，否则「我没有胸痛」会被当成急诊
      if (NEG_BEFORE.test(tail) || HYP_BEFORE.test(tail)) continue;
      if (CLAUSE_NEG.test(clause) || CLAUSE_ASK.test(clause)) continue;
      if (rule.unlessBefore && rule.unlessBefore.test(tail)) continue;

      seen.add(rule.id);
      // 已经是过去的事就降一档；自伤类不降，那句话说的是现在
      const past = rule.id !== "self_harm" && PAST_BEFORE.test(tail);
      hits.push({
        id: rule.id,
        label: rule.label,
        level: past ? "urgent" : rule.level,
        hit: m[0],
      });
      break;
    }
  }

  // emergency 排在 urgent 前面 —— 卡片上先看到的得是要紧的那条
  return hits.sort(
    (a, b) => Number(a.level === "urgent") - Number(b.level === "urgent"),
  );
}

/** 是不是自伤类：这类要走完全不同的安抚话术，不能只喊「去急诊」 */
function isSelfHarm(hits: RedFlagHit[]): boolean {
  return hits.some((h) => h.id === "self_harm");
}

function topLevel(hits: RedFlagHit[]): RedFlagLevel {
  return hits.some((h) => h.level === "emergency") ? "emergency" : "urgent";
}

/* ------------------------------------------------------------- 话术 */

/**
 * 三种卡片的标题。前端也要用，所以放在这里当唯一来源 ——
 * 服务端写进话术、界面上写成卡片头，两处不能各写一份。
 */
export const RED_FLAG_TITLE = {
  emergency: "先别在这儿聊了",
  urgent: "这个程度别拖",
  care: "这句话我认真对待",
} as const;

/** 卡片种类：急诊 / 门诊 / 心理危机 */
export type RedFlagKind = keyof typeof RED_FLAG_TITLE;

/**
 * 消息上的标记。存成 "redflag.<kind>"，前端 split 一下就知道画哪种卡片；
 * 刷新后照样是红卡片，不会退化成普通气泡。
 */
export function redFlagMark(kind: RedFlagKind): string {
  return `redflag.${kind}`;
}

/** "redflag.urgent" → "urgent"；不是红旗消息就返回 null */
export function readRedFlagMark(flag: string | null | undefined): RedFlagKind | null {
  if (!flag || !flag.startsWith("redflag.")) return null;
  const kind = flag.slice("redflag.".length);
  return kind in RED_FLAG_TITLE ? (kind as RedFlagKind) : null;
}

export type RedFlagReply = {
  /** 卡片顶部的大字，一句话把人按住 */
  headline: string;
  /** 正文：做什么、别做什么、到医院怎么说 */
  content: string;
  /** 卡片种类 */
  kind: RedFlagKind;
  /** 紧急程度：care 也按 emergency 处理 */
  level: RedFlagLevel;
};

/**
 * 生成拦截话术。
 * 三条硬规矩：不解释病因（不然就成了隔着屏幕下判断）、不给药、必须给下一步动作。
 */
export function buildRedFlagReply(
  name: string,
  hits: RedFlagHit[],
): RedFlagReply {
  // 连着写更顺：「胸口疼」「喘不上气」，中间不加顿号
  const quoted = hits.map((h) => `「${h.hit}」`).join("");
  const who = (name || "").trim() || "你";

  if (isSelfHarm(hits)) {
    return {
      level: "emergency",
      kind: "care",
      headline: RED_FLAG_TITLE.care,
      content: `${who}，你刚说的${quoted}，我很在意。这种情况不适合在这儿继续聊，但你现在最需要的是有人陪着。

1. 先给一个信得过的人打电话，让他来陪你，别一个人待着。
2. 全国心理援助热线 12356，24 小时有人接，可以直接打。
3. 如果已经有伤害自己的念头或计划，请立刻去最近的急诊，或者拨打 120。

这不是诊断。你愿意打这几个电话，比在这儿把话说完更重要。`,
    };
  }

  if (topLevel(hits) === "urgent") {
    return {
      level: "urgent",
      kind: "urgent",
      headline: RED_FLAG_TITLE.urgent,
      content: `${who}，你提到的${quoted}我记下了。这类情况可以等，但别拖成"过几天再说"。

1. 尽快去门诊看一次 —— 今天方便就今天，不然这周内；别自己先加药、换药或停药。
2. 如果同时出现出汗、心慌、疼痛往左肩或下巴放射，或者喘不上气、说话不清，别再等门诊，直接打 120。
3. 去医院前把两件事写在纸上：什么时候开始的、什么情况下更明显。

我不能在这里判断它是什么，这几步只是让你别错过该看的时机。`,
    };
  }

  return {
    level: "emergency",
    kind: "emergency",
    headline: RED_FLAG_TITLE.emergency,
    content: `${who}，先停一下。你刚说的${quoted}，是需要马上让医生当面看的情况，我不能在这儿继续问下去。

1. 现在就打 120，或者让身边的人送你去最近的急诊；别自己开车去。
2. 一个人在家的话，先把门打开，手机放在手边。
3. 见到医生，把这句话原样告诉对方：${quoted}，什么时候开始的、持续多久、有没有出汗。

这不是诊断，是这类信号必须先让医生看到。`,
  };
}
