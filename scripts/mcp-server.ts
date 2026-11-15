#!/usr/bin/env tsx
/**
 * MedAI 的 MCP server（stdio）。
 *
 * 把问诊里那 5 个工具原样暴露成 MCP 工具，让任何支持 MCP 的客户端
 * （Claude Desktop / Cursor / Cherry Studio…）都能直接问"我妈今天吃药了吗"。
 *
 * 为什么值得单独做一层：
 * 1. 工具的 JSON Schema 只写一份（src/lib/tools.ts 的 CONSULT_TOOLS），
 *    模型侧和 MCP 侧共用，不会出现"对话里能查、客户端里查不了"的两套实现；
 * 2. 权限边界不变 —— 仍然是 ownerId + patientId 两道，只是 ownerId 换成
 *    由本机环境变量指定（stdio 是本机进程，不存在跨用户访问）；
 * 3. 只读。这一层不提供任何写操作（不改档案、不加药、不落结论），
 *    外部客户端接进来也改不了患者的数据。
 *
 * 启动：
 *   MEDAI_MCP_USER=demo@medai.local npm run mcp
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { prisma } from "../src/lib/db";
import { CONSULT_TOOLS, runTool } from "../src/lib/tools";

// stdio 上跑的是 JSON-RPC，任何一句 console.log 都会把协议打乱。
// 库里有零星的调试输出，这里统一改道到 stderr（客户端不会读它）。
console.log = (...args: unknown[]) => console.error(...args);

const SERVER_NAME = "medai";
const SERVER_VERSION = "1.0.0";

/** 本机账号：stdio 进程只代表一个人，用邮箱认身份 */
const OWNER_EMAIL = (process.env.MEDAI_MCP_USER || "").trim();

type Owner = { id: string; email: string };

async function resolveOwner(): Promise<Owner> {
  if (!OWNER_EMAIL) {
    throw new Error(
      "缺少 MEDAI_MCP_USER。启动时指定一个本机账号，例如 MEDAI_MCP_USER=demo@medai.local npm run mcp",
    );
  }
  const user = await prisma.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: { id: true, email: true },
  });
  if (!user) throw new Error(`这个账号不存在：${OWNER_EMAIL}`);
  return user;
}

/**
 * 工具参数里的 patient_name 是可选的：不填就用这个账号下最早建的那份档案。
 * 一人多档是 MedAI 的常态，但外部客户端只问"我妈"时，得有个默认落点。
 */
async function resolvePatient(ownerId: string, name?: unknown): Promise<{ id: string; name: string }> {
  const wanted = typeof name === "string" ? name.trim() : "";
  const patient = wanted
    ? await prisma.patient.findFirst({
        where: { ownerId, name: { contains: wanted } },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      })
    : await prisma.patient.findFirst({
        where: { ownerId },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      });

  if (!patient) {
    throw new Error(
      wanted ? `这个账号下没有叫「${wanted}」的档案` : "这个账号下还没有档案，先去网站建一份",
    );
  }
  return patient;
}

/** 每个工具都允许带一个 patient_name，声明成统一的可选字段 */
const PATIENT_FIELD = {
  patient_name: {
    type: "string",
    description: "家庭成员的名字（可选）。不填用默认档案",
  },
} as const;

const TOOL_SCHEMAS = CONSULT_TOOLS.map((tool) => ({
  name: tool.function.name,
  description: tool.function.description,
  inputSchema: {
    type: "object" as const,
    properties: {
      ...(tool.function.parameters as { properties?: Record<string, unknown> }).properties,
      ...PATIENT_FIELD,
    },
    required: (tool.function.parameters as { required?: string[] }).required ?? [],
  },
}));

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_SCHEMAS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const patientName = args.patient_name;

  try {
    const owner = await resolveOwner();
    const patient = await resolvePatient(owner.id, patientName);

    // patient_name 只是这一层的路由参数，不要漏给工具执行器
    const toolArgs = { ...args };
    delete toolArgs.patient_name;

    const result = await runTool(name, JSON.stringify(toolArgs), {
      ownerId: owner.id,
      patientId: patient.id,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: result.content,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "这个查询失败了";
    return {
      content: [{ type: "text" as const, text: `查询失败：${message}` }],
      isError: true,
    };
  }
});

async function main() {
  // 启动即校验身份：配置错了立刻报错，别等第一次调用才暴露
  const owner = await resolveOwner();
  const count = await prisma.patient.count({ where: { ownerId: owner.id } });
  console.error(
    `[medai-mcp] 已连接账号 ${owner.email}（${count} 份档案），工具 ${TOOL_SCHEMAS.length} 个：${TOOL_SCHEMAS.map(
      (t) => t.name,
    ).join("、")}`,
  );

  await server.connect(new StdioServerTransport());
  console.error("[medai-mcp] stdio 就绪，等待客户端调用");
}

main().catch((err) => {
  console.error("[medai-mcp] 启动失败：", err instanceof Error ? err.message : err);
  process.exit(1);
});
