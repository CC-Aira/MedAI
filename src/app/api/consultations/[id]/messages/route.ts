import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  HttpError,
  readJson,
  toErrorResponse,
  unauthorized,
} from "@/lib/http";
import { LIMITS } from "@/lib/constants";
import { optionalText } from "@/lib/validate";
import {
  askDeepSeek,
  assertAiReady,
  readDeepSeekStream,
  type ChatMessage,
} from "@/lib/ai";
import { buildChatContext, saveRedFlagTurn } from "@/lib/consult-flow";
import { requireOwnedConsultation } from "@/lib/consultations";
import { detectRedFlags } from "@/lib/red-flags";
import { requireOwnedAttachment } from "@/lib/attachment-store";
import { purgeExpiredMessages, retentionCutoff } from "@/lib/retention";
import { serializeMessage } from "@/lib/consultations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 带附件的那一轮要先读上下文，给足时间 */
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

function sse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * 不经过模型的那一类回答，用同一个 SSE 协议一次性吐完。
 * 前端不需要知道这次有没有走模型 —— 它只认 delta / done。
 */
function immediateReply(turn: {
  reply: { content: string };
  userMessage: unknown;
  assistantMessage: unknown;
  messages: unknown[];
}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sse({ type: "delta", text: turn.reply.content })));
      controller.enqueue(
        encoder.encode(
          sse({
            type: "done",
            userMessage: turn.userMessage,
            assistantMessage: turn.assistantMessage,
            messages: turn.messages,
          }),
        ),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      // 标明这次回答没经过模型，方便排查，也不给缓存层留余地
      "x-medai-flag": "redflag",
    },
  });
}

const ATTACHMENT_SELECT = {
  select: {
    id: true,
    filename: true,
    kind: true,
    sizeBytes: true,
    text: true,
  },
} as const;

/**
 * POST /api/consultations/[id]/messages
 *
 * 三种用法：
 * 1. 普通发消息：{ content }
 * 2. 带附件发消息：{ content?, attachmentId }   ← content 可以为空
 * 3. 改一句话重发：{ editMessageId, content }   ← 删掉它之后的所有消息，重新生成回答
 *
 * 顺序严格按规格：校验输入 400 → 认门 404 → 查配置 503 → 干活。
 *
 * 落库策略：先调 AI，流全部读完且内容非空，才写「提问 + 回答」。
 * 这样 Key 配错、上游 500、网络中断都不会攒下一堆"只有提问没有回答"的孤儿消息。
 * 编辑模式例外：用户改的那句话先落库，否则流一断，改动就白改了。
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const { id } = await ctx.params;
    const body = await readJson(req);

    // 1. 校验输入
    const content = optionalText(body.content, "消息内容", LIMITS.message) ?? "";
    const editMessageId =
      typeof body.editMessageId === "string" && body.editMessageId.trim()
        ? body.editMessageId.trim()
        : null;
    const attachmentId =
      typeof body.attachmentId === "string" && body.attachmentId.trim()
        ? body.attachmentId.trim()
        : null;

    await purgeExpiredMessages();

    // 2. 编辑模式：先认清目标，再动手
    let editingId: string | null = null;
    /** 被编辑那条消息的时间戳，用来保证新回答排在它后面 */
    let editedAtMs = 0;
    if (editMessageId) {
      if (!content) throw new HttpError(400, "修改后不能是一句空话");

      const target = await prisma.message.findFirst({
        where: {
          id: editMessageId,
          consultationId: id,
          consultation: { patient: { ownerId: user.id } },
          createdAt: { gte: retentionCutoff() },
        },
        select: { id: true, role: true, createdAt: true },
      });
      if (!target) throw new HttpError(404, "没有找到要修改的这句话");
      if (target.role !== "user") {
        throw new HttpError(400, "只能修改自己说过的话");
      }

      editingId = target.id;
      editedAtMs = target.createdAt.getTime();

      // 改完之后，这句话之后的问答全部作废 —— 它们回答的都是错的那个问题。
      // 用 gte 而不是 gt：同一次写入里提问和回答的 createdAt 可能是同一毫秒，
      // 用 gt 就删不掉那条旧回答（这个坑实测踩到过）。
      await prisma.$transaction([
        prisma.message.update({
          where: { id: target.id },
          data: { content, editedAt: new Date() },
        }),
        prisma.message.deleteMany({
          where: {
            consultationId: id,
            id: { not: target.id },
            createdAt: { gte: target.createdAt },
          },
        }),
      ]);
    } else if (!content && !attachmentId) {
      throw new HttpError(400, "说一句话，或者传一份资料");
    }

    // 3. 附件必须是自己的
    if (attachmentId) {
      await requireOwnedAttachment(user.id, attachmentId);
    }

    // 4. 红旗拦截：这一步不经过模型，也不建上下文。
    //    真出事的时候，回答必须是「立刻就有」的，还得每次一模一样。
    const hits = detectRedFlags(content);
    if (hits.length > 0) {
      // 先认门（404），再落库；这里不查 AI 配置 —— 没配 Key 也该拦得住
      const owned = await requireOwnedConsultation(user.id, id);
      const turn = await saveRedFlagTurn({
        consultationId: id,
        patientName: owned.patient.name,
        content,
        attachmentId,
        editingId,
        editedAtMs,
        hits,
        previousRedFlag: owned.redFlag,
      });
      return immediateReply(turn);
    }

    // 5. 认门 + 装配上下文（顺带 404）
    const { system, messages } = await buildChatContext(user.id, id, content, {
      attachmentId: attachmentId ?? undefined,
      // 编辑时不要把它自己的旧版本再塞回历史，否则模型会以为"同一句话说了两遍"
      excludeMessageId: editingId ?? undefined,
    });

    // 6. 查配置：没配 Key 且没开演示模式就是 503，别去连上游
    assertAiReady();

    const payload: ChatMessage[] = [
      { role: "system", content: system },
      ...messages,
    ];
    const upstream = await askDeepSeek({
      messages: payload,
      temperature: 0.6,
      maxTokens: 900,
    });

    const encoder = new TextEncoder();
    let full = "";

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const push = (obj: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(sse(obj)));
        };

        try {
          await readDeepSeekStream(upstream, (delta) => {
            full += delta;
            push({ type: "delta", text: delta });
          });

          const answer = full.trim();
          if (!answer) throw new HttpError(502, "AI 没有返回内容");

          // 编辑模式下 user 消息上面已经更新过，这里只补回答。
          // 顺序很关键：必须"先提问、后回答"，两次写入放进同一个事务，
          // 既保证 createdAt 的先后关系，也不会在中间失败时留下孤儿提问。
          // 时间戳要显式错开 1ms：同一个事务里 @default(now()) 会给出完全相同的毫秒数，
          // 那样按时间排序就不稳定，编辑时按时间删旧回答也删不干净。
          const assistantCreatedAt = editingId
            ? new Date(Math.max(Date.now(), editedAtMs + 1))
            : new Date();

          const ops = [];
          if (!editingId) {
            ops.push(
              prisma.message.create({
                data: {
                  consultationId: id,
                  role: "user",
                  content: content || "（上传了一份资料）",
                  attachmentId,
                  createdAt: new Date(assistantCreatedAt.getTime() - 1),
                },
                include: { attachment: ATTACHMENT_SELECT },
              }),
            );
          }
          ops.push(
            prisma.message.create({
              data: {
                consultationId: id,
                role: "assistant",
                content: answer,
                createdAt: assistantCreatedAt,
              },
              include: { attachment: ATTACHMENT_SELECT },
            }),
          );

          const saved = await prisma.$transaction(ops);
          const assistantMessage = saved[saved.length - 1];

          await prisma.consultation.update({
            where: { id },
            data: { updatedAt: new Date() },
          });

          const userMessage = editingId
            ? await prisma.message.findUnique({
                where: { id: editingId },
                include: { attachment: ATTACHMENT_SELECT },
              })
            : saved[0];

          // 整段回传：编辑会删掉后续消息，前端只有全量替换才不会残留旧气泡
          const all = await prisma.message.findMany({
            where: { consultationId: id, createdAt: { gte: retentionCutoff() } },
            orderBy: { createdAt: "asc" },
            include: { attachment: ATTACHMENT_SELECT },
          });

          push({
            type: "done",
            userMessage: userMessage ? serializeMessage(userMessage) : null,
            assistantMessage: serializeMessage(assistantMessage),
            messages: all.map(serializeMessage),
          });
        } catch (err) {
          const message =
            err instanceof HttpError ? err.message : "回答中断了，请再试一次";
          push({ type: "error", message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
