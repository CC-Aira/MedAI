/**
 * 化验单：从模型输出里抽出结构化指标，并和上一份同类单据做逐项对比。
 *
 * 两个纯函数 + 一个解析器，全部不碰数据库 —— 与 facts.ts / visit-sheet.ts 一致，
 * 这样对比逻辑能被脚本直接测，不用起服务。
 */

export type LabAbnormal = "" | "high" | "low";

export type LabItem = {
  name: string;
  /** 原样保留模型看到的结果，可能是 "5.2"、"<0.01"、"阴性" */
  value: string;
  unit: string;
  /** 参考区间原文，如 "3.5–9.5"、"阴性" */
  refText: string;
  abnormal: LabAbnormal;
};

export type LabTrend = "up" | "down" | "flat";

/** 一项指标相比上一份单子的变化 */
export type LabDiff = {
  name: string;
  unit: string;
  prevValue: string | null;
  curValue: string;
  /** 数值差（当前 − 上次）；任一侧不是数字时为 null */
  delta: number | null;
  /** 变化百分比；上次为 0 时无意义，取 null */
  pct: number | null;
  trend: LabTrend;
  /**
   * improved：上次异常、这次正常，或在往参考区间里走
   * worsened：上次正常、这次异常，或异常还在往外走
   * new：上一份单子里没有这一项
   * same：没有实质变化
   */
  status: "improved" | "worsened" | "new" | "same";
};

export type LabReportDTO = {
  id: string;
  patientId: string;
  takenAt: string;
  hospital: string;
  kind: string;
  items: LabItem[];
  summary: string;
  abnormalCount: number;
  createdAt: string;
  /** 与上一份单子的逐项对比；第一份单子为空数组 */
  diffs: LabDiff[];
};

export type LabReportRow = {
  id: string;
  patientId: string;
  takenAt: Date;
  hospital: string;
  kind: string;
  items: string;
  summary: string;
  abnormalCount: number;
  createdAt: Date;
};

const MAX_ITEMS = 80;

/** 指标名归一：去括号里的英文缩写、去空白与标点，用于跨单据对齐 */
export function normalizeItemName(name: string): string {
  return name
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[\s·・.、,，:：;；\-—_/\\]/g, "")
    .toLowerCase();
}

/** 从 "5.2"、"5.2 ↑"、"<0.01"、"1.2×10^9" 里取出数字；取不到返回 null */
export function toNumber(value: string): number | null {
  const m = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** 从 "3.5–9.5"、"3.5-9.5"、"≤10" 里取出区间；取不到返回 null */
export function parseRange(refText: string): { low: number | null; high: number | null } | null {
  const t = refText.replace(/,/g, "");
  const both = t.match(/(-?\d+(?:\.\d+)?)\s*[–—~-]\s*(-?\d+(?:\.\d+)?)/);
  if (both) return { low: Number(both[1]), high: Number(both[2]) };
  const upper = t.match(/[≤<]\s*(-?\d+(?:\.\d+)?)/);
  if (upper) return { low: null, high: Number(upper[1]) };
  const lower = t.match(/[≥>]\s*(-?\d+(?:\.\d+)?)/);
  if (lower) return { low: Number(lower[1]), high: null };
  return null;
}

/**
 * 判定异常方向。
 *
 * 优先级刻意反过来：能算的用算术，不能算的才采信模型/单据上的标记。
 * 实测模型会把箭头贴错行（白细胞 6.2 在 3.5–9.5 之内，它标了个"偏低"），
 * 而"数值有没有超出区间"是纯算术，不需要谁来猜。只有定性项目（阴性/阳性）
 * 或单据没印参考区间时，才退回模型读到的标记。
 */
function inferAbnormal(item: LabItem): LabAbnormal {
  const n = toNumber(item.value);
  const range = parseRange(item.refText);

  if (n !== null && range && (range.low !== null || range.high !== null)) {
    if (range.high !== null && n > range.high) return "high";
    if (range.low !== null && n < range.low) return "low";
    return "";
  }

  return item.abnormal;
}

function asString(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * 把模型返回的 JSON 收成干净的结构。
 *
 * 模型会超范围发挥：多给项目、把单位写进 name、给一个不存在的 abnormal 值。
 * 这里逐条收口，宁可少一条脏数据，也不要让前端拿到渲染不了的东西。
 */
export function parseLabPayload(raw: string): {
  takenAt: Date | null;
  hospital: string;
  kind: string;
  items: LabItem[];
  summary: string;
} {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // 模型偶尔会包一层 ```json，兜一下
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { takenAt: null, hospital: "", kind: "其他", items: [], summary: "" };
    data = JSON.parse(m[0]) as Record<string, unknown>;
  }

  const list = Array.isArray(data.items) ? data.items : [];
  const items: LabItem[] = [];
  for (const entry of list.slice(0, MAX_ITEMS)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const name = asString(row.name, 40);
    if (!name) continue;
    const value = asString(row.value, 40);
    if (!value) continue;

    const abnormalRaw = asString(row.abnormal, 8).toLowerCase();
    const abnormal: LabAbnormal =
      abnormalRaw === "high" || abnormalRaw === "高"
        ? "high"
        : abnormalRaw === "low" || abnormalRaw === "低"
          ? "low"
          : "";
    items.push({
      name,
      value,
      unit: asString(row.unit, 20),
      refText: asString(row.refText ?? row.ref, 40),
      abnormal,
    });
  }

  const forItems = items.map((item) => ({ ...item, abnormal: inferAbnormal(item) }));

  const takenRaw = asString(data.takenAt, 40);
  const taken = takenRaw ? new Date(takenRaw) : null;

  return {
    takenAt: taken && !Number.isNaN(taken.getTime()) ? taken : null,
    hospital: asString(data.hospital, 60),
    kind: asString(data.kind, 20) || "其他",
    items: forItems,
    summary: asString(data.summary, 400),
  };
}

export function countAbnormal(items: LabItem[]): number {
  return items.filter((item) => item.abnormal !== "").length;
}

/**
 * 小结由代码合成，不用模型自己写的那句。
 *
 * 实测模型会数错 —— 明明异常的是红细胞，它写成白细胞；8 项里 3 项异常也能说成 2 项。
 * "几项异常、哪几项"是完全能算的，交给模型只会引入不必要的不一致：
 * 表格里标红 3 项，上面一句小结说 2 项，患者第一反应是"这系统不靠谱"。
 */
export function composeSummary(items: LabItem[]): string {
  if (items.length === 0) return "";
  const bad = items.filter((item) => item.abnormal !== "");
  if (bad.length === 0) {
    return `共 ${items.length} 项，全部在参考区间内。`;
  }
  const names = bad
    .map((item) => `${item.name}${item.abnormal === "high" ? "偏高" : "偏低"}`)
    .join("、");
  return `共 ${items.length} 项，其中 ${bad.length} 项超出参考区间：${names}。`;
}

/** 指标离参考区间有多远（0 表示在区间内），用于判断"变好还是变差" */
function distanceFromRange(item: LabItem): number | null {
  const n = toNumber(item.value);
  const range = parseRange(item.refText);
  if (n === null || !range) return null;
  if (range.high !== null && n > range.high) return n - range.high;
  if (range.low !== null && n < range.low) return range.low - n;
  return 0;
}

/**
 * 逐项对比。
 *
 * 判断顺序很重要：先看"异常状态是否翻转"，翻转优先于数值方向 ——
 * 血糖从 7.8 降到 6.9（仍偏高）是"变好"，从 6.9 升到 7.8 是"变差"，
 * 但只看箭头会得出相反结论。
 */
export function diffLabItems(prev: LabItem[], cur: LabItem[]): LabDiff[] {
  const byName = new Map<string, LabItem>();
  for (const item of prev) byName.set(normalizeItemName(item.name), item);

  return cur.map((item) => {
    const old = byName.get(normalizeItemName(item.name));
    if (!old) {
      return {
        name: item.name,
        unit: item.unit,
        prevValue: null,
        curValue: item.value,
        delta: null,
        pct: null,
        trend: "flat",
        status: "new",
      };
    }

    const a = toNumber(old.value);
    const b = toNumber(item.value);
    const delta = a !== null && b !== null ? Number((b - a).toFixed(3)) : null;
    const pct =
      a !== null && b !== null && a !== 0
        ? Number((((b - a) / Math.abs(a)) * 100).toFixed(1))
        : null;
    const trend: LabTrend = delta === null || delta === 0 ? "flat" : delta > 0 ? "up" : "down";

    let status: LabDiff["status"] = "same";
    if (old.abnormal === "" && item.abnormal !== "") {
      status = "worsened";
    } else if (old.abnormal !== "" && item.abnormal === "") {
      status = "improved";
    } else if (old.abnormal !== "" && item.abnormal !== "") {
      const before = distanceFromRange(old);
      const now = distanceFromRange(item);
      if (before !== null && now !== null && before !== now) {
        status = now < before ? "improved" : "worsened";
      }
    }

    return {
      name: item.name,
      unit: item.unit,
      prevValue: old.value,
      curValue: item.value,
      delta,
      pct,
      trend,
      status,
    };
  });
}

/** 整份单子相对上一份的走向：给列表卡片上一个概括 */
export function overallDirection(diffs: LabDiff[]): "better" | "worse" | "flat" {
  let better = 0;
  let worse = 0;
  for (const diff of diffs) {
    if (diff.status === "improved") better += 1;
    if (diff.status === "worsened") worse += 1;
  }
  if (better > worse) return "better";
  if (worse > better) return "worse";
  return "flat";
}

export function buildLabReport(row: LabReportRow, prev: LabReportRow | null): LabReportDTO {
  const items = (() => {
    try {
      const parsed = JSON.parse(row.items) as LabItem[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  let diffs: LabDiff[] = [];
  if (prev) {
    try {
      const prevItems = JSON.parse(prev.items) as LabItem[];
      if (Array.isArray(prevItems)) diffs = diffLabItems(prevItems, items);
    } catch {
      diffs = [];
    }
  }

  return {
    id: row.id,
    patientId: row.patientId,
    takenAt: row.takenAt.toISOString(),
    hospital: row.hospital,
    kind: row.kind,
    items,
    summary: row.summary,
    abnormalCount: row.abnormalCount,
    createdAt: row.createdAt.toISOString(),
    diffs,
  };
}
