import { HttpError } from "./http";

/** 只认真实存在过的 key：PATCH 绝不能把没传的字段擦成 null */
export function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function asText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** 必填文本 */
export function requireText(
  v: unknown,
  label: string,
  max: number,
  min = 1,
): string {
  const text = asText(v);
  if (text.length < min) throw new HttpError(400, `${label}不能为空`);
  if (text.length > max) throw new HttpError(400, `${label}最多 ${max} 个字`);
  return text;
}

/** 选填文本：空串 / null / undefined 一律归 null */
export function optionalText(v: unknown, label: string, max: number): string | null {
  if (v === null || v === undefined) return null;
  const text = asText(v);
  if (!text) return null;
  if (text.length > max) throw new HttpError(400, `${label}最多 ${max} 个字`);
  return text;
}

export function optionalNumber(
  v: unknown,
  label: string,
  min: number,
  max: number,
  integer = false,
): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(asText(v));
  if (!Number.isFinite(n)) throw new HttpError(400, `${label}必须是数字`);
  if (n < min || n > max) throw new HttpError(400, `${label}要在 ${min}~${max} 之间`);
  return integer ? Math.round(n) : n;
}

export function optionalBool(v: unknown, label: string): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1" || v === 1) return true;
  if (v === "false" || v === "0" || v === 0) return false;
  throw new HttpError(400, `${label}只能是 true 或 false`);
}

/** 日期：接受 YYYY-MM-DD 或 ISO 字符串；格式不对直接 400，不静默变 Invalid Date */
export function optionalDate(v: unknown, label: string): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const text = asText(v);
  if (!text) return null;

  const plain = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00.000Z` : text;
  const d = new Date(plain);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label}格式不对，应该像 1998-04-21`);

  // 拒绝 2024-02-31 这类会被 Date 自动进位的日期
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) && d.toISOString().slice(0, 10) !== text) {
    throw new HttpError(400, `${label}不是一个真实存在的日期`);
  }
  return d;
}

export function oneOf<T extends string>(
  v: unknown,
  label: string,
  allowed: readonly T[],
): T {
  const text = asText(v);
  if (!allowed.includes(text as T)) {
    throw new HttpError(400, `${label}只能是 ${allowed.join(" / ")}`);
  }
  return text as T;
}

export function optionalOneOf<T extends string>(
  v: unknown,
  label: string,
  allowed: readonly T[],
): T | null {
  if (v === null || v === undefined || "") return null;
  const text = asText(v);
  if (!text) return null;
  return oneOf(v, label, allowed);
}

/** 数组参数：不是数组就 400 */
export function asArray(v: unknown, label: string): unknown[] {
  if (!Array.isArray(v)) throw new HttpError(400, `${label}必须是数组`);
  return v;
}

/** 分页参数：limit 1~100，默认 30 */
export function parseLimit(url: URL, fallback = 30): number {
  const raw = url.searchParams.get("limit");
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 100) {
    throw new HttpError(400, "limit 要在 1~100 之间");
  }
  return Math.floor(n);
}
