# 问诊会话：关掉再打开，话不能没

## 一句话

打开档案时，如果这个档案还有一次没归档、而且真的聊过的问诊，就接着那次聊；
点「这次聊完了」才会归档，下次打开重新开始。

## 为什么改

原来的实现每次点开档案都 `POST /api/patients/[id]/consultations` 新建一次。
于是：

- 用户关掉面板去改个档案、再回来，屏幕上一句开场白，刚才说的话全没了
- 每次点开都留一条「一句话没说」的空问诊，实测一个档案堆了 **207 条**，
  把真正的问诊记录挤到看不见
- 档案页「问诊记录」tab 点进去，一屏空壳

## 现在的行为

`MeadowStage.openRecord()` 里：

```ts
const { consultations } = await listConsultations(patient.id);
const last = consultations.find((c) => c.status !== "archived" && c.messageCount > 0);
if (last) {
  const { consultation } = await getConsultation(last.id);
  setConsultId(consultation.id);
  setChat([
    { id: "resume", role: "note", content: "上次聊到这儿，接着说就行。" },
    ...consultation.messages.map(toItem),
    ...(consultation.summary ? [{ id: "summary-restored", role: "note", content: `这次的小结：${consultation.summary}` }] : []),
  ]);
  return;
}
// 没有就往新建走
```

三个判断缺一不可：

| 条件 | 为什么 |
| --- | --- |
| `status !== "archived"` | 归档 = 这次聊完了。下次打开应该是干净的一页 |
| `messageCount > 0` | 空问诊没有接续的价值，直接跳过（历史遗留的就是这类） |
| 至少一条消息真的读回来 | 列表和详情之间可能有时间差，读空就当没有 |

## 空问诊不进列表

`listConsultations()` 加了 `where: { patientId, messages: { some: {} } }`。
只看「有没有过消息」，不看当前条数 —— 归档会清消息，但那条问诊本身是有内容的记录。

同时 `closeRecord()` 会顺手删掉「一句话没说就关掉」的那次：

```ts
const spoke = chatRef.current.some((m) => m.role === "user");
if (cid && !spoke) void deleteConsultation(cid).catch(() => {});
```

`chatRef` 是 `chat` 的影子 —— `closeRecord` 是 `useCallback`，直接读 state 会拿到旧值。

## 「这次聊完了」

面板里和小结、整理进档案、带走就诊摘要并排的一个轻量按钮，点了会：

1. `PATCH /api/consultations/[id] { status: "archived" }`
2. `closeRecord()`

归档不删任何消息，摘要和历史仍然参与后续问诊的长期记忆。

## 踩过的坑：面板以「全是 —」的空状态浮在草地上

**症状**：从档案面板点「档案详情」→ 编辑档案 → 返回，草地上浮着一个面板，
标题「档案」、内容一屏「—」，挡着点不到兔子，看着像卡死。

**原因**：面板的显示完全靠 `body.is-consulting`（CSS 靠它滑入），
而这个类只在 `openRecord()` 里加、只在 `closeRecord()` 里删。
点「档案详情」是 `<Link>` 直接跳转，两条都没走到，类名就永久留在 body 上。
组件重新挂载时 `current` 是 `null`，面板却照样显示 —— 因为 CSS 根本不看 `current`。

**修法**（三层，缺一层都可能复发）：

1. 类名跟着状态走，并在卸载时清理：

```ts
useEffect(() => {
  document.body.classList.toggle("is-consulting", Boolean(current));
  return () => document.body.classList.remove("is-consulting");
}, [current]);
```

2. 跳转到档案详情前先 `closeRecord()`。
3. 兜底：没有 `current` 时面板自己也不显示 ——

```tsx
<section className={`consult${current ? "" : " is-closed"}`} />
```

```css
.consult.is-closed,
body.is-consulting .consult.is-closed {
  opacity: 0; transform: translateX(118vw) scale(0.985); pointer-events: none;
}
```

只靠类名的话，任何一次「跳走但没走 closeRecord」都会重演。

## 小结不能整个塞进字符串

`POST /api/consultations/[id]/summary` 返回的是 `{ id, summary, updatedAt }`。
原来外面又包了一层 `ok({ summary })`，前端 `const { summary } = ...` 拿到的其实是**整个对象**，
拼进模板字符串就成了 `这次的小结：[object Object]`。

现在接口直接返回上面那个对象，前端也声明成：

```ts
export type GeneratedSummary = { id: string; summary: string; updatedAt: string };
const saved = await generateSummary(consultId);
// 用 saved.summary
```

**规则**：接口返回的对象里再套一个同名字段，几乎一定会被误用。

## 整理进档案：为什么说过药名却看不到

两个原因叠在一起：

1. 提示词原来写着「add 只在患者明确提到**正在吃**某种药时使用」。患者说「我使用过」「以前吃过」
   这种过去时就被模型直接丢掉了 —— 而用户根本不知道这条规则。
   现在改成：**任何具体药名都要列进 add**，写不写由患者勾选；
   用 `longTerm` 区分「每天吃」和「过去吃过」，后者默认不勾。

2. 写进档案之后只有面板底部一行 notice，很容易被当成「按钮没反应」，
   而且关掉面板就再也看不到。现在会在聊天里留一条：

```
已经写进档案：二甲双胍。打开档案详情就能看到。
```

扫不出候选时同样落一条「这次没扫出要补的」—— 让按钮永远有回应。

## 自检

```bash
node scripts/check-resume.mjs        http://localhost:3100   # 关掉再打开 / 开新的一次
node scripts/check-consult-fixes.mjs http://localhost:3100   # 编辑返回不卡 / 整理进档案
node scripts/check-summary.mjs       http://localhost:3100   # 小结不再是 [object Object]
node scripts/probe-facts.mjs         http://localhost:3100   # 直接看扫描接口返回了什么
node scripts/clean-empty-consultations.mjs [--apply]         # 清历史空问诊
```
