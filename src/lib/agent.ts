import { askWithTools, type AgentMessage, type AssistantToolCall } from "./ai";
import { CONSULT_TOOLS, TOOL_LABELS, runTool, type ToolContext } from "./tools";
import { retrieveKnowledge, type KnowledgeDoc } from "./rag";

/**
 * 问诊的 Agent 循环：先让模型判断"这一轮要不要查东西"，查完再流式作答。
 *
 * 为什么分成两段而不是让模型边聊边调工具：
 * 1. 工具结果必须回到上下文里，模型才可能"基于查到的数据"回答 —— 这需要在
 *    生成最终回答之前落地，而不是塞进同一条流里；
 * 2. 前端的"正在查今日用药"这类状态必须能在回答开始前推出去，用户才知道
 *    这几秒在干什么，而不是盯着三个点发呆。
 *
 * 上限两轮：常见问题一轮就够（查用药 / 查科普），两轮能覆盖"先查药，发现
 * 有冲突再查一下那个冲突药"这种。再多就是在烧 token 换不来质量。
 */

const MAX_TOOL_ROUNDS = 2;

/**
 * 意图门控：先花 0 毫秒判断"这句话值不值得让模型查库"。
 *
 * 工具决策那一轮要多等 2~4 秒（模型得先想、再吐 JSON）。对"你好""我最近压力大"
 * 这种纯聊天，这几秒纯属浪费；而"今天吃药了吗""这个药能不能吃"又必须查。
 * 用一组关键词 + 药名命中做前置筛选，把昂贵的思考留给真正需要它的问题。
 *
 * 门控只决定"要不要进 Agent"，进了之后具体调哪个工具仍然由模型自己定。
 */
const LIVE_PATTERNS: RegExp[] = [
  /吃(药|了)|服药|用药|打卡|漏服|漏了[几很]?[次天]?|依从|按时|停药|加量|减量|换药|自行(吃|用)/,
  /今天|昨天|前天|这周|上周|上周|最近几天|这几天|这个月/,
  /(能|可以|要不要|该不该|适合|能不能).{0,8}(吃|用|喝|停)/,
  /过敏|相互作用|冲突|一起吃|同时吃|配伍/,
  /上次|之前(说|聊|问)过|历史|记录/,
];

export function needsLiveData(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (LIVE_PATTERNS.some((re) => re.test(t))) return true;
  // 明确提到一个药名（高分命中才认），就值得核一下禁忌与相互作用
  return retrieveKnowledge(t, { kind: "drug", topK: 1, minScore: 8 }).length > 0;
}

export type ToolEvent = {
  name: string;
  label: string;
  status: "running" | "done";
  detail?: string;
  ms?: number;
};

/**
 * 引用编号登记表。
 *
 * 预检索的条目先登记（编号 1..k，和注入 system 的那段完全一致），
 * 之后工具再检索到新条目就接着往后排。回答末尾的脚注按这张表输出，
 * 模型标的 [3] 和用户看到的第 3 条永远是同一份文档。
 */
export class CitationIndex {
  private docs: KnowledgeDoc[] = [];
  private seen = new Map<string, number>();

  constructor(seed: KnowledgeDoc[] = []) {
    this.add(seed);
  }

  add(list: KnowledgeDoc[]): number[] {
    return list.map((doc) => {
      const hit = this.seen.get(doc.id);
      if (hit !== undefined) return hit;
      this.docs.push(doc);
      const index = this.docs.length;
      this.seen.set(doc.id, index);
      return index;
    });
  }

  get all(): KnowledgeDoc[] {
    return this.docs;
  }

  get size(): number {
    return this.docs.length;
  }
}

export type PlanResult = {
  /** 已经拼好工具往返的完整消息（含 system），可直接拿去流式调用 */
  messages: AgentMessage[];
  /** 这一轮实际用到的工具名，便于日志与测试断言 */
  used: string[];
};

function withRefs(result: { content: string; docs?: KnowledgeDoc[] }, registry: CitationIndex): string {
  if (!result.docs || result.docs.length === 0) return result.content;
  const refs = registry.add(result.docs);
  try {
    const parsed = JSON.parse(result.content) as Record<string, unknown>;
    parsed.refs = result.docs.map((doc, i) => ({
      ref: refs[i],
      title: doc.title,
      subtitle: doc.subtitle,
      updatedAt: doc.updatedAt,
    }));
    return JSON.stringify(parsed);
  } catch {
    return result.content;
  }
}

export async function planWithTools(input: {
  system: string;
  messages: AgentMessage[];
  context: ToolContext;
  registry: CitationIndex;
  model?: string | null;
  signal?: AbortSignal;
  onTool?: (event: ToolEvent) => void;
}): Promise<PlanResult> {
  const { system, messages, context, registry, model, signal, onTool } = input;

  // 决策轮也带完整档案：模型得知道"哪些信息已经有了"，才不会为了查在服药物
  // 白调一次工具；同时工具说明单独成一条 system，正事那一段保持不动。
  const working: AgentMessage[] = [
    { role: "system", content: system },
    {
      role: "system",
      content: `【关于工具】
你可以调用工具查询实时数据（今天的服药状态、最近几天的依从率、科普库检索、药物安全核对、历史问诊）。
规则：
1. 用户的话里涉及"今天吃药了吗""最近漏没漏""这个病/这个药要注意什么""这个药能不能吃"时，必须先查再说，不要凭印象。
2. 档案、在服药物已经在上面的提示词里，重复查询没有意义。
3. 工具返回里带 refs 的条目有编号，回答中引用时用 [编号] 标注。
4. 这一轮不要直接回答用户，只决定要不要调用工具；如果不需要查，就输出空字符串。`,
    },
    ...messages,
  ];

  const used: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    let decision: { content: string; toolCalls: AssistantToolCall[] };
    try {
      decision = await askWithTools({
        messages: working,
        tools: CONSULT_TOOLS,
        model,
        maxTokens: 200,
        temperature: 0,
        signal,
      });
    } catch (err) {
      // 模型不支持 function calling（上游 4xx）或网络抖动：降级成普通问答。
      // 工具的缺席不该让这一轮问诊失败。
      console.error("[medai] 工具决策失败，本轮降级为纯对话", err);
      return { messages: working.slice(2), used };
    }

    if (decision.toolCalls.length === 0) break;

    working.push({
      role: "assistant",
      content: decision.content || null,
      tool_calls: decision.toolCalls,
    });

    for (const call of decision.toolCalls) {
      const name = call.function.name;
      const label = TOOL_LABELS[name] ?? name;
      const startedAt = Date.now();
      used.push(name);
      onTool?.({ name, label, status: "running" });

      const result = await runTool(name, call.function.arguments, context);
      const content = withRefs(result, registry);

      working.push({ role: "tool", tool_call_id: call.id, content });

      onTool?.({
        name,
        label,
        status: "done",
        detail: result.detail,
        ms: Date.now() - startedAt,
      });
    }
  }

  return { messages: working.slice(2), used };
}
