/**
 * 本机登录过的账号列表（只存邮箱，不存密码）。
 *
 * 为什么要它：这是家庭共用一台手机/电脑的场景，「切换账号」如果每次都要
 * 重新敲一遍完整邮箱，实际用起来很烦。这里只记邮箱做预填，密码一次都不落地，
 * 换账号仍然要输密码 —— 便利性和安全性各退一步后的折中。
 */

const KEY = "medai.accounts";
const MAX = 6;

export type SavedAccount = {
  email: string;
  /** 最近一次用它登录的时间戳，用来排序 */
  at: number;
};

export function loadAccounts(): SavedAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is SavedAccount =>
          !!x &&
          typeof x === "object" &&
          typeof (x as SavedAccount).email === "string" &&
          typeof (x as SavedAccount).at === "number",
      )
      .slice(0, MAX);
  } catch {
    // localStorage 被禁用（隐私模式）时不该让页面炸掉
    return [];
  }
}

function save(list: SavedAccount[]): SavedAccount[] {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      /* 配额满或被禁用：忽略，只是少了个便利功能 */
    }
  }
  return list;
}

/** 登录成功后调用：把邮箱提到最前面 */
export function rememberAccount(email: string): SavedAccount[] {
  const v = email.trim().toLowerCase();
  if (!v) return loadAccounts();
  const rest = loadAccounts().filter((a) => a.email !== v);
  return save([{ email: v, at: Date.now() }, ...rest].slice(0, MAX));
}

export function forgetAccount(email: string): SavedAccount[] {
  return save(loadAccounts().filter((a) => a.email !== email));
}
