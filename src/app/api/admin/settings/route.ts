import fs from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { HttpError, readJson, ok, toErrorResponse, unauthorized } from "@/lib/http";
import { writeAdminLog } from "@/lib/admin-log";
import { getSettings, maskKey, updateSettings } from "@/lib/settings";

/**
 * PATCH /api/admin/settings
 *
 * 两件事：
 * 1. 普通配置（平台名、联系方式、问诊规则、模型参数）写 Setting 表，立即生效；
 * 2. API Key 不写数据库 —— 直接改 .env，避免数据库里躺着明文的模型账号。
 *    改 .env 需要重启进程才生效，接口会把 restartRequired 一起返回。
 */
export async function PATCH(req: NextRequest) {
  try {
    const admin = await getCurrentAdmin();
    if (!admin) return unauthorized();

    const body = await readJson(req);

    // 1. 普通配置
    const changed = await updateSettings(body);
    if (changed.length > 0) {
      await writeAdminLog({
        actorId: admin.id,
        actorEmail: admin.email,
        action: "settings.update",
        target: "系统配置",
        detail: `修改：${changed.join("、")}`,
      });
    }

    // 2. 密钥
    let restartRequired = false;
    let keyChanged = false;

    const textKey = typeof body.aiApiKey === "string" ? body.aiApiKey.trim() : "";
    if (textKey) {
      if (textKey.length < 16) throw new HttpError(400, "这个 Key 看起来不完整");
      writeEnv("DEEPSEEK_API_KEY", textKey);
      writeEnv("VISION_API_KEY", textKey);
      keyChanged = true;
      restartRequired = true;
      await writeAdminLog({
        actorId: admin.id,
        actorEmail: admin.email,
        action: "aiKey.update",
        // 只记掩码，日志里绝不能出现完整密钥
        target: `模型密钥 ${maskKey(textKey)}`,
        detail: "写入 .env，需重启服务生效",
      });
    }

    const visionKey = typeof body.visionApiKey === "string" ? body.visionApiKey.trim() : "";
    if (visionKey) {
      if (visionKey.length < 16) throw new HttpError(400, "这个 Key 看起来不完整");
      writeEnv("VISION_API_KEY", visionKey);
      keyChanged = true;
      restartRequired = true;
      await writeAdminLog({
        actorId: admin.id,
        actorEmail: admin.email,
        action: "aiKey.update",
        target: `视觉模型密钥 ${maskKey(visionKey)}`,
        detail: "写入 .env，需重启服务生效",
      });
    }

    if (!keyChanged && changed.length === 0) {
      throw new HttpError(400, "没有要保存的内容");
    }

    const settings = await getSettings(true);
    return ok({
      settings,
      changed,
      keyChanged,
      restartRequired,
      keys: publicKeys(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** 只读地看一眼当前密钥（掩码）与生效模型 */
export async function GET() {
  try {
    const admin = await getCurrentAdmin();
    if (!admin) return unauthorized();
    const settings = await getSettings(true);
    return ok({ settings, keys: publicKeys(), meta: runtimeMeta() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function publicKeys() {
  return {
    textKey: maskKey(process.env.DEEPSEEK_API_KEY),
    visionKey: maskKey(process.env.VISION_API_KEY),
  };
}

function runtimeMeta() {
  return {
    envModel: process.env.DEEPSEEK_MODEL || "glm-4-flash",
    envBaseUrl: process.env.DEEPSEEK_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
    envVisionModel: process.env.VISION_MODEL || "glm-4v-flash",
    demoMode: process.env.MEDAI_DEMO_AI === "1",
  };
}

/**
 * 改 .env 的单行值：保留其它行与注释，只替换目标键。
 * 文件不存在时创建；写失败就抛 500，让管理员知道没写进去而不是"看起来成功了"。
 */
function writeEnv(key: string, value: string): void {
  const file = path.join(process.cwd(), ".env");
  let content = "";
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    content = "";
  }

  const line = `${key}="${value}"`;
  const re = new RegExp(`^${key}\\s*=.*$`, "m");
  const next = re.test(content)
    ? content.replace(re, line)
    : `${content}${content.endsWith("\n") || content === "" ? "" : "\n"}${line}\n`;

  try {
    fs.writeFileSync(file, next, "utf8");
  } catch (err) {
    console.error("[medai] 写 .env 失败", err);
    throw new HttpError(500, "没能写入 .env，请检查文件权限");
  }
}
