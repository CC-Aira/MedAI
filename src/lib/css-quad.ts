/**
 * 把一块矩形 HTML 贴到屏幕上的任意四边形（CSS `matrix3d`）。
 *
 * 3D 木牌是斜着立在草地上的，四角投到屏幕上不是标准的矩形 —— 直接按中心点
 * 摆一个 div 会差出一条边的错位。这里用四点求单应矩阵，文字的每一角都落在
 * 板子的对应角上。
 *
 * 点顺序固定为：左上 → 右上 → 右下 → 左下。
 */

export type QuadPoint = { x: number; y: number };

export function quadTransform(pts: QuadPoint[], w: number, h: number): string {
  const [p0, p1, p2, p3] = pts;
  const dx1 = p1.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dx2 = p3.x - p2.x;
  const dy2 = p3.y - p2.y;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  const affine = Math.abs(dx3) < 1e-6 && Math.abs(dy3) < 1e-6;
  const den = dx1 * dy2 - dx2 * dy1;

  let g = 0;
  let k = 0;
  if (!affine) {
    if (Math.abs(den) < 1e-6) return "";
    g = (dx3 * dy2 - dx2 * dy3) / den;
    k = (dx1 * dy3 - dx3 * dy1) / den;
  }

  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + k * p3.x;
  const c = p0.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + k * p3.y;
  const f = p0.y;

  // 单应矩阵作用在 0..1 的单位方块上，元素是 w×h，先除回去
  return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${k / h},0,0,1,0,${c},${f},0,1)`;
}

/** 四角全都跑到屏幕外（且不在同一侧绕回来）就别渲染了 */
export function quadOffscreen(pts: QuadPoint[]): boolean {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const p of pts) {
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  }
  const w = typeof window === "undefined" ? 1920 : window.innerWidth;
  const h = typeof window === "undefined" ? 1080 : window.innerHeight;
  return right < -40 || left > w + 40 || bottom < -40 || top > h + 40;
}
