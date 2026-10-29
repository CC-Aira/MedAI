import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./http";
import { LIMITS } from "./constants";

/** 头像目录：public/uploads/avatars（运行时写入，Next 直接当静态资源服务） */
const AVATAR_DIR = path.join(process.cwd(), "public", "uploads", "avatars");
const AVATAR_URL_PREFIX = "/uploads/avatars/";

/** 只看文件头，不信 MIME —— MIME 是客户端嘴上说的，魔数是文件自己招的 */
const SIGNATURES: { ext: string; match: (b: Buffer) => boolean }[] = [
  {
    ext: "png",
    match: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    ext: "jpg",
    match: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: "gif",
    match: (b) =>
      b.length >= 6 && b.toString("ascii", 0, 4) === "GIF8",
  },
  {
    ext: "webp",
    match: (b) =>
      b.length >= 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP",
  },
];

export function sniffImageExt(buffer: Buffer): string | null {
  for (const sig of SIGNATURES) {
    if (sig.match(buffer)) return sig.ext;
  }
  return null;
}

/**
 * 保存头像：后缀由魔数决定，文件名由服务器生成。
 * 用户传来的文件名、扩展名一概不用，防止 `../` 穿越和伪装成图片的脚本。
 */
export async function saveAvatar(buffer: Buffer): Promise<{ url: string; ext: string }> {
  if (buffer.length === 0) throw new HttpError(400, "文件是空的");
  if (buffer.length > LIMITS.avatarBytes) {
    throw new HttpError(400, "头像不能超过 2MB");
  }

  const ext = sniffImageExt(buffer);
  if (!ext) throw new HttpError(400, "只支持 PNG / JPEG / GIF / WebP 图片");

  await mkdir(AVATAR_DIR, { recursive: true });
  const filename = `${randomUUID().replace(/-/g, "")}.${ext}`;
  await writeFile(path.join(AVATAR_DIR, filename), buffer);

  return { url: `${AVATAR_URL_PREFIX}${filename}`, ext };
}

/**
 * 删旧头像。只认自己生成的目录，路径穿越的一律不碰。
 * 删失败不影响主流程（文件可能已经不存在）。
 */
export async function removeAvatarFile(url: string | null | undefined): Promise<void> {
  if (!url) return;
  if (!url.startsWith(AVATAR_URL_PREFIX)) return;

  const filename = url.slice(AVATAR_URL_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+\.(png|jpe?g|gif|webp)$/.test(filename)) return;

  const target = path.join(AVATAR_DIR, filename);
  if (!target.startsWith(AVATAR_DIR)) return;

  try {
    await unlink(target);
  } catch {
    // 文件不在就算了，删除档案不该因为少一张图失败
  }
}
