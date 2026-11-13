import { prisma } from "./db";

/**
 * 系统配置：键值对存在 Setting 表里，后台「系统参数 / AI 模型配置」都写这里。
 *
 * 为什么不用环境变量：这些是运营能改的东西（平台名、联系方式、问诊规则、模型参数），
 * 改一次就重启服务不现实。环境变量留给"部署时才该定"的密钥和连接串。
 *
 * 密钥不放数据库：API Key 只从 .env 读，界面上做掩码展示。
 * 数据库一旦被拿走，不该顺带把模型账号也送出去。
 */

export const SETTING_KEYS = {
  platformName: "platform.name",
  platformContact: "platform.contact",
  platformNotice: "platform.notice",
  consultRules: "consult.rules",
  aiModel: "ai.model",
  aiTemperature: "ai.temperature",
  aiMaxTokens: "ai.maxTokens",
  aiPrompt: "ai.prompt",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export const DEFAULT_SETTINGS: Record<string, string> = {
  [SETTING_KEYS.platformName]: "MedAI",
  [SETTING_KEYS.platformContact]: "",
  [SETTING_KEYS.platformNotice]: "",
  [SETTING_KEYS.consultRules]: "",
  /** 留空表示沿用 .env 里的 DEEPSEEK_MODEL */
  [SETTING_KEYS.aiModel]: "",
  [SETTING_KEYS.aiTemperature]: "0.6",
  [SETTING_KEYS.aiMaxTokens]: "900",
  [SETTING_KEYS.aiPrompt]: "",
};

/** 允许后台改写的键（白名单，避免任意键写进来） */
export const WRITABLE_KEYS: SettingKey[] = Object.values(SETTING_KEYS);

const TTL_MS = 10_000;
let cache: { at: number; data: Record<string, string> } | null = null;

/** 读全部配置（带 10 秒缓存：后台每次请求都查库没必要） */
export async function getSettings(force = false): Promise<Record<string, string>> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const rows = await prisma.setting.findMany({ select: { key: true, value: true } });
  const data: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in DEFAULT_SETTINGS) data[r.key] = r.value;
  }
  cache = { at: Date.now(), data };
  return data;
}

/** 数值型配置：前端以 number 提交，入库前统一转成字符串并夹到安全区间 */
const NUMERIC_KEYS = new Set<string>([SETTING_KEYS.aiTemperature, SETTING_KEYS.aiMaxTokens]);

/** 写配置：只接受白名单键，返回变更了的键（用于写日志） */
export async function updateSettings(patch: Record<string, unknown>): Promise<string[]> {
  const changed: string[] = [];
  const ops = [];

  for (const key of WRITABLE_KEYS) {
    if (!(key in patch)) continue;
    const raw = patch[key];

    // 数字型字段（温度、maxTokens）前端传的是 number，不能因为不是 string 就丢掉
    let value: string;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      value = String(raw);
    } else if (typeof raw === "string") {
      value = raw.trim();
    } else {
      continue;
    }

    if (NUMERIC_KEYS.has(key)) {
      // 字段被清空时保持原值，不要悄悄写进 0
      if (value === "") continue;
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      value =
        key === SETTING_KEYS.aiTemperature
          ? String(Math.min(1.5, Math.max(0, n)))
          : String(Math.round(Math.min(4000, Math.max(100, n))));
    } else {
      value = value.slice(0, key === SETTING_KEYS.aiPrompt ? 4000 : 500);
    }

    ops.push(
      prisma.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      }),
    );
    changed.push(key);
  }

  if (ops.length > 0) {
    await prisma.$transaction(ops);
    cache = null;
  }
  return changed;
}

/** 前端展示用的平台名：后台改了「平台名称」全站跟着变；配置为空回落 MedAI */
export async function getPlatformName(): Promise<string> {
  const s = await getSettings();
  return s[SETTING_KEYS.platformName]?.trim() || "MedAI";
}

/** 对话链路要用的运行时参数 */
export async function getAiRuntime(): Promise<{
  model: string | null;
  temperature: number;
  maxTokens: number;
  promptExtra: string;
  consultRules: string;
}> {
  const s = await getSettings();
  const temp = Number(s[SETTING_KEYS.aiTemperature]);
  const maxTokens = Number(s[SETTING_KEYS.aiMaxTokens]);

  return {
    model: s[SETTING_KEYS.aiModel] || null,
    // 参数越界会让上游直接 400，这里先夹住
    temperature: Number.isFinite(temp) ? Math.min(1.5, Math.max(0, temp)) : 0.6,
    maxTokens: Number.isFinite(maxTokens) ? Math.min(4000, Math.max(100, maxTokens)) : 900,
    promptExtra: s[SETTING_KEYS.aiPrompt] || "",
    consultRules: s[SETTING_KEYS.consultRules] || "",
  };
}

/**
 * 密钥掩码：只留前 6 位和后 4 位。
 * 太短的密钥整体打码，避免"掩码等于明文"。
 */
export function maskKey(key: string | undefined | null): string {
  const v = (key || "").trim();
  if (!v) return "（未配置）";
  if (v.length <= 12) return "•".repeat(v.length);
  return `${v.slice(0, 6)}${"•".repeat(Math.min(12, v.length - 10))}${v.slice(-4)}`;
}
