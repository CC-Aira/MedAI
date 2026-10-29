/**
 * 兔子的语录库 —— 气泡专用，分三类说话场景 + 一句问候。
 *
 *  welcome  欢迎语   页面第一次加载时随机挑一句
 *  comfort  焦虑安抚 紧张、害怕、反复查症状的人
 *  health   健康提醒 喝水、睡觉、久坐、按时吃药这类日常动作
 *  medical  就医提示 什么情况该去医院、该挂什么科
 *
 * 点兔子时从「全部分类」里随机抽，所以四类都要写得能独立成立。
 * 不出现诊断结论；就医提示只给"什么时候去、去哪个科"。
 */

export type RabbitCategory = "welcome" | "comfort" | "health" | "medical";

/** 气泡的语气，只影响尾句色相，不显示文字标签 */
export type RabbitTone = "greet" | "care" | "remind" | "visit" | "reply" | "warn";

export interface QuoteLine {
  text: string;
  category: RabbitCategory;
  tone: RabbitTone;
}

interface QuoteItem {
  text: string;
  tone?: RabbitTone;
}

/** 欢迎语：不写具体时段，早上晚上念都自然 */
const WELCOME: QuoteItem[] = [
  { text: "嘿，我在呢。今天感觉怎么样？" },
  { text: "你来啦。哪里不舒服，慢慢跟我说。" },
  { text: "先坐一会儿，深呼吸一次，再说说哪里不舒服。" },
  { text: "我在这儿陪着你，想问什么都可以。" },
  { text: "不用急着说清楚，想到哪儿说到哪儿就行。" },
  { text: "今天有好好照顾自己吗？我陪你聊聊。" },
  { text: "别客气，把不舒服的地方都告诉我。" },
  { text: "你的身体最近有什么想说的吗？我在听。" },
  { text: "来了就好，先说说最难受的是哪里。" },
  { text: "我一直在草地上等你，现在可以开始了。" },
];

/** 焦虑安抚：等结果、反复搜症状、越查越怕的时候 */
const COMFORT: QuoteItem[] = [
  { text: "别急，一次说不清也没关系，我们可以慢慢来。", tone: "care" },
  { text: "网上查到的多半是别人的情况，你的要具体看。", tone: "care" },
  { text: "紧张会让心跳变快，这不是病，先喝口水。", tone: "care" },
  { text: "不舒服的时候容易往坏处想，这很正常。", tone: "care" },
  { text: "你现在已经比刚才多知道一点了，这就是进展。", tone: "care" },
  { text: "慢慢呼吸，四秒吸气、六秒呼气，做三轮试试。", tone: "care" },
  { text: "别一个人扛着，说出来会轻一点。", tone: "care" },
  { text: "担心就写下来，很多担心写出来就没那么大了。", tone: "care" },
  { text: "如果今晚睡不着，别硬躺着数时间，起来喝口水。", tone: "care" },
  { text: "先别反复量，一天量三次已经够了。", tone: "care" },
  { text: "体检报告上的箭头不一定有事，得看具体数值。", tone: "care" },
];

/** 健康提醒：日常能马上做的小动作 */
const HEALTH: QuoteItem[] = [
  { text: "记得喝口水，别让嗓子一直干着。", tone: "remind" },
  { text: "坐久了站起来伸个懒腰，腰会谢谢你。", tone: "remind" },
  { text: "今天吃饭了吗？空着肚子更容易头晕。", tone: "remind" },
  { text: "睡不够，人就更容易难受，今晚早点放下手机。", tone: "remind" },
  { text: "别一边刷手机一边揉眼睛，让眼睛歇一会儿。", tone: "remind" },
  { text: "天气凉了，脖子和脚踝先护住。", tone: "remind" },
  { text: "有在按时吃药吗？这件事比什么都重要。", tone: "remind" },
  { text: "一顿饭吃七分饱，胃会舒服很多。", tone: "remind" },
  { text: "饭后别马上躺下，给它一点消化的时间。", tone: "remind" },
  { text: "今天走够三千步了吗？走一走就比坐着强。", tone: "remind" },
  { text: "空调房待久了，起来活动一下肩膀。", tone: "remind" },
  { text: "吃药期间别喝酒，肝脏会累。", tone: "remind" },
];

/** 就医提示：什么时候别在家等 */
const MEDICAL: QuoteItem[] = [
  { text: "胸口压着疼、出冷汗、喘不上气，别等，直接去急诊。", tone: "visit" },
  { text: "突然说话不清、一侧手脚没力气，马上打 120。", tone: "visit" },
  { text: "发烧超过三天不退，或者烧到 39℃ 以上，去看看医生。", tone: "visit" },
  { text: "肚子疼到直不起腰，尤其右下腹，别自己吃药扛。", tone: "visit" },
  { text: "伤口越来越红、发热、流脓，别等它自己好。", tone: "visit" },
  { text: "咳血、便血、尿血，任何一处出血都要去查。", tone: "visit" },
  { text: "体重莫名其妙掉了好几斤，值得去做个检查。", tone: "visit" },
  { text: "头疼得突然、像被重物砸了一下，尽快去医院。", tone: "visit" },
  { text: "孩子精神差、一直想睡、叫不太醒，别拖。", tone: "visit" },
  { text: "喘不上气、嘴唇发紫，先打 120，别自己开车。", tone: "visit" },
  { text: "症状反复两周以上没好转，就别再自己试了。", tone: "visit" },
];

const POOLS: Record<RabbitCategory, QuoteItem[]> = {
  welcome: WELCOME,
  comfort: COMFORT,
  health: HEALTH,
  medical: MEDICAL,
};

export const CATEGORY_NAMES: Record<RabbitCategory, string> = {
  welcome: "欢迎语",
  comfort: "焦虑安抚",
  health: "健康提醒",
  medical: "就医提示",
};

/**
 * 从疾病科普 / 药品说明页回到草地时说的那句。
 * 不是"第一次见面"的欢迎语，所以单独一组，不占 welcome 分类。
 */
const BACK: string[] = [
  "回来啦，刚才看到哪儿了？",
  "回来啦，我一直在草地上。",
  "坐下歇会儿吧，想问什么都可以。",
  "看到你回来，我就放心了。",
  "回来啦，刚刚那些看完，心里大概有数了吧。",
];

/** 尾巴上那句鼓励，从这些话里挑 */
const CHEER: string[] = [
  "不舒服的日子会过去的，我陪着你。",
  "今天能照顾自己一点点，就很好。",
  "别太责怪身体，它也在努力。",
  "你比自己以为的更有耐心。",
  "慢一点也没关系，好的事情都需要时间。",
  "别担心，我们一步一步来。",
  "你描述得很清楚，这对判断很有帮助。",
  "先照着做几天，有变化随时跟我说。",
  "记得吃东西、多喝水，我今天就在这儿。",
  "如果变得更难受，别等，直接去医院。",
];

/* --------------------------- 随机抽取（不连着重复） --------------------------- */

const recent: string[] = [];

function pick(pool: string[]): string {
  if (pool.length === 0) return "";
  if (pool.length === 1) return pool[0];

  // 最近说过的几条不再抽，避免"怎么又是这句"
  const fresh = pool.filter((s) => !recent.includes(s));
  const from = fresh.length > 0 ? fresh : pool;
  const text = from[Math.floor(Math.random() * from.length)];

  recent.push(text);
  if (recent.length > 4) recent.shift();
  return text;
}

const DEFAULT_TONE: Record<RabbitCategory, RabbitTone> = {
  welcome: "greet",
  comfort: "care",
  health: "remind",
  medical: "visit",
};

/** 页面加载时的欢迎语：只从「欢迎语」这一类里随机 */
export function welcomeLine(): QuoteLine {
  const text = pick(WELCOME.map((q) => q.text));
  return { text, category: "welcome", tone: "greet" };
}

/** 点兔子：从全部分类里随机（欢迎 / 安抚 / 提醒 / 就医都会出现） */
export function randomLine(): QuoteLine {
  const pool = (Object.keys(POOLS) as RabbitCategory[]).flatMap((key) =>
    POOLS[key].map((q) => ({ ...q, category: key })),
  );
  const text = pick(pool.map((q) => q.text));
  const hit = pool.find((q) => q.text === text);
  const category = hit?.category ?? "health";
  return { text, category, tone: hit?.tone ?? DEFAULT_TONE[category] };
}

/** 指定分类抽一句（留给以后的「换一句安抚」之类） */
export function lineFrom(category: RabbitCategory): QuoteLine {
  const text = pick(POOLS[category].map((q) => q.text));
  return { text, category, tone: DEFAULT_TONE[category] };
}

/** 从科普库 / 药品库返回时的一句「回来啦」 */
export function backLine(): QuoteLine {
  return { text: pick(BACK), category: "welcome", tone: "greet" };
}

export function cheerLine(): string {
  return pick(CHEER);
}

/** 每个分类各几句，给自检和文档用 */
export function categoryStats(): Record<RabbitCategory, number> {
  return {
    welcome: WELCOME.length,
    comfort: COMFORT.length,
    health: HEALTH.length,
    medical: MEDICAL.length,
  };
}
