import type { ReactNode } from "react";

/**
 * 知识库配图：每个科室 / 药理分类一张同风格的矢量插画。
 *
 * 为什么自己画而不是找图片：
 *   1. 一百多条科普配一百多张照片，风格很难统一，加载也慢；
 *   2. 网上下载的医学图多半有授权问题；
 *   3. 矢量图跟着屏幕缩放不糊，还能随主题换色。
 * 统一模板：低饱和渐变圆底 + 白色描边图形 + 左上高光，保证放在一起像一套。
 */

type Tone = { from: string; to: string };

const TONE: Record<string, Tone> = {
  respiratory: { from: "#8fd3d0", to: "#3f9d9a" },
  cardio: { from: "#f7a7a2", to: "#d9695f" },
  digestive: { from: "#f6c98c", to: "#dc9a44" },
  endocrine: { from: "#b7c8f2", to: "#7d92cf" },
  neuro: { from: "#c3b4ea", to: "#8b76c9" },
  nephro: { from: "#9fc7e8", to: "#5b8fbe" },
  skin: { from: "#f4c3a8", to: "#d38f6d" },
  ortho: { from: "#cfd8ca", to: "#93a48c" },
  pediatric: { from: "#fbd0a6", to: "#e29b62" },
  gyneco: { from: "#f3bcd1", to: "#cf7e9c" },
  ent: { from: "#a8d5ea", to: "#5f9ec2" },
  psych: { from: "#c9b8e8", to: "#8f78c4" },
  infectious: { from: "#c9df9f", to: "#89b05a" },
  analgesic: { from: "#f8bfae", to: "#d97e64" },
  antiinfective: { from: "#a9dcc2", to: "#5fa47f" },
  nutrition: { from: "#f5d6a0", to: "#d4a552" },
  derm: { from: "#f0c2bd", to: "#c9847c" },
  eye: { from: "#a9d8e8", to: "#5c9fbb" },
  other: { from: "#c8d0d8", to: "#8d99a5" },
};

const STROKE = {
  fill: "none",
  stroke: "#ffffff",
  strokeWidth: 3.1,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** 每个 key 一组白色线稿，画在 64×64 的画布中间 */
const SHAPE: Record<string, ReactNode> = {
  respiratory: (
    <>
      <path d="M32 13v23" {...STROKE} />
      <path d="M30 21c-7 0-13 7-13 15 0 6 3.6 9.6 8 9.6 3.4 0 5-2.6 5-6.4V23" {...STROKE} />
      <path d="M34 21c7 0 13 7 13 15 0 6-3.6 9.6-8 9.6-3.4 0-5-2.6-5-6.4V23" {...STROKE} />
    </>
  ),
  cardio: (
    <>
      <path
        d="M32 50C20 42 13 34 13 26.5 13 21 17 17 22 17c4 0 7 2.2 10 6 3-3.8 6-6 10-6 5 0 9 4 9 9.5C51 34 44 42 32 50z"
        {...STROKE}
      />
      <path d="M13 30h7l3-6 4 12 4-9 3 3h6" {...STROKE} strokeWidth={2.4} />
    </>
  ),
  digestive: (
    <>
      <path d="M26 13v9c0 4-9 6-9 16 0 9 7 14 15 14 10 0 17-6 17-14" {...STROKE} />
      <path d="M20 42c2.5 1.4 5 2 8 2" {...STROKE} strokeWidth={2.4} />
      <path d="M42 13v6" {...STROKE} />
    </>
  ),
  endocrine: (
    <>
      <path d="M32 32c-3-4-6-6-9-6-4 0-7 3-7 7 0 6 6 11 10 11 3 0 5-2.6 6-6" {...STROKE} />
      <path d="M32 32c3-4 6-6 9-6 4 0 7 3 7 7 0 6-6 11-10 11-3 0-5-2.6-6-6" {...STROKE} />
      <path d="M32 28v8" {...STROKE} strokeWidth={2.4} />
    </>
  ),
  neuro: (
    <>
      <path
        d="M32 15c-7 0-11 4-11 9-4.5 1-8 4.6-8 9.5 0 5.4 4.4 9.5 10 9.5h18c5.6 0 10-4.1 10-9.5 0-4.9-3.5-8.5-8-9.5 0-5-4-9-11-9z"
        {...STROKE}
      />
      <path d="M32 16v27" {...STROKE} strokeWidth={2.2} />
      <path d="M26 26c2 0 3 1.4 3 3.4M38 33c2 0 3 1.4 3 3.4" {...STROKE} strokeWidth={2.2} />
    </>
  ),
  nephro: (
    <>
      <path
        d="M41 15c-11-2-19 8-19 17.5S30 49 37.5 47.5c6-1.2 8-7 4.5-11.5-3-4-6-6-4.4-11.4 1-3.4 5-8.6 3.4-9.6z"
        {...STROKE}
      />
      <path d="M36 24c-3 2-4 6-2 9" {...STROKE} strokeWidth={2.2} />
    </>
  ),
  skin: (
    <>
      <path d="M14 22c6-5 12 5 18 0s12 5 18 0" {...STROKE} />
      <path d="M14 32c6-5 12 5 18 0s12 5 18 0" {...STROKE} />
      <path d="M14 42c6-5 12 5 18 0s12 5 18 0" {...STROKE} />
      <circle cx="24" cy="27" r="1.4" fill="#fff" />
      <circle cx="42" cy="37" r="1.4" fill="#fff" />
    </>
  ),
  ortho: (
    <>
      <path d="M22 42L42 22" {...STROKE} strokeWidth={4} />
      <circle cx="19.5" cy="44.5" r="4.4" {...STROKE} />
      <circle cx="44.5" cy="19.5" r="4.4" {...STROKE} />
      <circle cx="26" cy="38" r="3.4" {...STROKE} strokeWidth={2.4} />
      <circle cx="38" cy="26" r="3.4" {...STROKE} strokeWidth={2.4} />
    </>
  ),
  pediatric: (
    <>
      <circle cx="32" cy="24" r="9" {...STROKE} />
      <path d="M27 23.5c.6-.8 1.6-.8 2.2 0M35 23.5c.6-.8 1.6-.8 2.2 0" {...STROKE} strokeWidth={2.2} />
      <path d="M29.5 28.5c1.4 1.4 3.6 1.4 5 0" {...STROKE} strokeWidth={2.2} />
      <path d="M22 51c0-6 4.4-10 10-10s10 4 10 10" {...STROKE} />
    </>
  ),
  gyneco: (
    <>
      <path d="M26 15c0 7-8 8.6-8 17 0 8 6 14 14 14s14-6 14-14c0-8.4-8-10-8-17" {...STROKE} />
      <path d="M26 15c2 2.6 10 2.6 12 0" {...STROKE} strokeWidth={2.4} />
      <path d="M32 32v10" {...STROKE} strokeWidth={2.2} />
    </>
  ),
  ent: (
    <>
      <path d="M12 32c5-8 12-12 20-12s15 4 20 12c-5 8-12 12-20 12s-15-4-20-12z" {...STROKE} />
      <circle cx="32" cy="32" r="6.6" {...STROKE} />
      <circle cx="32" cy="32" r="2.2" fill="#fff" />
    </>
  ),
  psych: (
    <>
      <path d="M17 20h20a5 5 0 015 5v10a5 5 0 01-5 5H29l-7 6v-6h-5a5 5 0 01-5-5V25a5 5 0 015-5z" {...STROKE} />
      <path d="M27 30c-2-1.6-4-3-4-4.8 0-1.4 1.2-2.4 2.6-2.4 1 0 1.8.6 2.4 1.6.6-1 1.4-1.6 2.4-1.6 1.4 0 2.6 1 2.6 2.4 0 1.8-2 3.2-4 4.8z" {...STROKE} strokeWidth={2.2} />
    </>
  ),
  infectious: (
    <>
      <circle cx="32" cy="32" r="11" {...STROKE} />
      <path
        d="M32 13v6M32 45v6M13 32h6M45 32h6M19 19l4.2 4.2M40.8 40.8L45 45M45 19l-4.2 4.2M23.2 40.8L19 45"
        {...STROKE}
        strokeWidth={2.6}
      />
      <circle cx="28" cy="30" r="1.6" fill="#fff" />
      <circle cx="36" cy="35" r="1.6" fill="#fff" />
    </>
  ),
  analgesic: (
    <>
      <circle cx="32" cy="32" r="15" {...STROKE} />
      <path d="M23 32h18" {...STROKE} />
      <path d="M32 23v5" {...STROKE} strokeWidth={2.2} />
    </>
  ),
  antiinfective: (
    <>
      <rect x="15" y="24" width="34" height="16" rx="8" transform="rotate(-32 32 32)" {...STROKE} />
      <path d="M23.5 40.5l17-17" {...STROKE} strokeWidth={2.6} />
    </>
  ),
  nutrition: (
    <>
      <path d="M25 20h14v-4a2 2 0 00-2-2h-10a2 2 0 00-2 2v4z" {...STROKE} />
      <path d="M24 20h16a3 3 0 013 3v22a3 3 0 01-3 3H24a3 3 0 01-3-3V23a3 3 0 013-3z" {...STROKE} />
      <path d="M26 31h12M26 37h8" {...STROKE} strokeWidth={2.4} />
    </>
  ),
  derm: (
    <>
      <path d="M22 22h20v6H22z" {...STROKE} />
      <path d="M22 28h20l-3 22a3 3 0 01-3 2.6H28a3 3 0 01-3-2.6L22 28z" {...STROKE} />
      <path d="M28 38h8" {...STROKE} strokeWidth={2.4} />
    </>
  ),
  eye: (
    <>
      <path d="M24 18h16v7a4 4 0 01-2 3.4V46a3 3 0 01-3 3h-6a3 3 0 01-3-3V28.4a4 4 0 01-2-3.4v-7z" {...STROKE} />
      <path d="M28 37h6" {...STROKE} strokeWidth={2.4} />
      <path d="M44 38c2.6 3 2.6 6 0 9-2.6-3-2.6-6 0-9z" {...STROKE} strokeWidth={2.4} />
    </>
  ),
  other: (
    <>
      <rect x="16" y="22" width="32" height="24" rx="3" {...STROKE} />
      <path d="M32 28v12M26 34h12" {...STROKE} />
    </>
  ),
};

export function DeptArt({
  id,
  size = 44,
  className,
}: {
  id: string;
  size?: number;
  className?: string;
}) {
  const tone = TONE[id] ?? TONE.other;
  const shape = SHAPE[id] ?? SHAPE.other;
  const gid = `art-${id}`;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={tone.from} />
          <stop offset="1" stopColor={tone.to} />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill={`url(#${gid})`} />
      <path
        d="M8 22c6-9 16-14 27-14"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.34"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {shape}
    </svg>
  );
}
