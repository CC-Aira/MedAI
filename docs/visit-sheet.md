# 就诊摘要（一张能带走的纸）

问诊聊完，价值不该只留在屏幕上。患者真正要拿给医生的，是一张能读懂、能打印、
能带进诊室的东西 —— 这是整个系统里**唯一能证明「AI 到底帮到了人」的证据链**。

```
Consultation（对话 + 档案 + 用药 + 红旗记录）
        │
        ├─ 没配 Key / 模型失败 ──▶ buildLocalSheet()   纯本地模板
        │
        └─ 正常 ──▶ 模型整理 ──▶ normalizeSheet() 洗成定长结构
                              │
                              └─ 模型给的太差 ──▶ 退回本地模板

                    落库 Consultation.visitSheet（JSON）
                              │
        ┌─────────────────────┴─────────────────────┐
    问诊面板里的「带走就诊摘要」              档案页问诊记录里「看就诊摘要」
                              │
                        .paperlayer（portal 到 body）
                     ┌────────┼────────┐
                  打印      复制文字    重新整理
```

## 一、两条路，谁都不许空手

| 路径 | 什么时候走 | 出什么 |
| --- | --- | --- |
| 模型整理 | 默认 | `source: "ai"`，病程/建议/就医时机由模型写 |
| 本地模板 | 按钮「用本地模板整理」、或模型失败时自动退回 | `source: "local"`，只有主诉、原话、通用问题清单 |

关键约定：**生成摘要失败，永远不该让用户拿不到纸**。所以 `generateVisitSheet()` 里
模型那段是 `try/catch`，catch 里不往上抛，直接把本地模板存了。

反过来也有一条：模型返回了空对象、或者全是空数组，`normalizeSheet` 会检测
`contributed`（有没有任何一段真的写了内容），没有就退回本地模板。
**一张标着「AI 整理」却全是默认值的纸，比一张老实说「本地模板」的纸更糟** ——
纸的底部会把来源写出来。

## 二、结构固定，字段有限

一页纸，五个位置，不随模型心情变化：

| 字段 | 上限 | 谁写 |
| --- | --- | --- |
| `chiefComplaint` 主诉 | 60 字 | 模型 / 档案优先 |
| `course` 病程 | 5 条 × 80 字 | 模型，缺了用对话原话补 |
| `ruledOut` 已排除 | 3 条 × 40 字 | 模型 |
| `advice` 可以先做的 | 4 条 × 80 字 | 模型 |
| `whenToGo` 什么时候必须去医院 | 120 字 | 模型 |
| `questions` 想问医生 | 3 条 × 60 字 | 模型，缺了给三条通用的 |

**药物清单、过敏史、红旗记录不进模型。** 这三样全部由代码从库里取 ——
让模型复述药名，就有编错的余地，而这是纸面上最不能被编错的部分。

## 三、区块编号是排完才给的

一开始编号写死在 JSX 里（`n={1}`、`n={2}`…），结果「已排除」为空时，
纸上直接出现 1、2、4、5 —— 医生会以为自己少看了一页。

现在改成先排成 `sheetBlocks[]`，空区块根本不进数组，编号取 `index + 1`：

```tsx
{sheetBlocks(sheet, patient, activeMeds).map((block, i) => (
  <Section key={block.title} n={i + 1} title={block.title}>{block.node}</Section>
))}
```

## 四、同一句话不能说两遍

模型很爱这么写：

- 主诉：`胸口疼，喘不上气，出冷汗`
- 病程第一条：`自述：我胸口疼，喘不上气，出冷汗` —— 多一个「我」

医生扫一眼就知道这张纸是凑出来的。所以有 `dropRepeatOfChief()`：

```
bare() 先去前缀（自述/主诉/说）和所有标点
sameSaying() 短的被长的完整包含、且长度差 ≤ 40% → 当成同一句
```

两个边界都写进测试了：`自述：我胸口疼…` 要删，`胸口疼的时候会出冷汗`（只是沾边）不能删。

## 五、打印：只留这张纸

`VisitSheet.tsx` 用 `createPortal` 挂到 `document.body`，CSS 里：

```css
@media print {
  body > * { display: none !important; }
  body > #paper-print-root { display: block !important; }
  .paperlayer__mask, .paper__bar, .paper__close { display: none !important; }
}
```

不这么做的话，打印出来会是「一张纸 + 背后的草地 + 顶栏 + 兔子气泡」。

### 字号：屏幕上的 px 到 A4 上会缩水

屏幕 13.6px 落到 A4 只有 10pt 出头，副文本 10.5px 连 8pt 都不到 ——
诊室灯下看这种纸很吃力。所以 `@media print` 里全量重设字号（pt 为单位）：

| 元素 | 屏幕 | 纸上 |
| --- | --- | --- |
| 姓名 | 25px | 22pt |
| 主诉 | 17.5px | 14pt |
| 正文 / 列表 | 13.6px | 11pt |
| 过敏史 / 红旗 | 13px | 11pt |
| 序言 / 页脚 | 9.5px、10.5px | 9pt |

### 纸面上不依赖现代布局

这条是被真实打印结果逼出来的。屏幕上 `.paper__head`、`.paper__h3`、`.paper__flag`、
`.paper__allergy` 都是 flex，而**打印链路对 flex 的支持参差不齐** —— 浏览器打印、
各种「网页转 PDF」工具、PDF 阅读器二次排版，只要中间有一环把 flex 降级成 block，
就会出现背景色块塌陷、边框上下错位、色块压在文字上的情况。

所以 `@media print` 里一律退回块级流：

```css
.paper__head, .paper__h3, .paper__flag, .paper__allergy { display: block; }
.paper__flag b, .paper__flag span { display: block; }
.paper__h3 i { display: inline-block; margin-right: 7px; }  /* 编号改行内，不再用圆形底 */
.paper__allergy b { display: inline-block; margin-right: 8px; }
```

同理，**inset box-shadow 换成真边框 + 不透明底色**：

```css
.paper__flag, .paper__alert {
  box-shadow: none;
  border: 1px solid #e2b7a4;
  background: #fdf2ec;   /* 不用 rgba，半透明底在部分工具里会被丢掉或转灰 */
}
```

### 怎么验证纸面效果

光在浏览器里 `Emulation.setEmulatedMedia({ media: "print" })` 截图不够 ——
那只是换了媒体查询，没走真正的打印管线。要验就得真出 PDF：

```bash
node scripts/shot-paper-pdf.mjs http://localhost:3100
# docs/preview-sheet-sample.pdf 就是产物，用 PyMuPDF 转 PNG 肉眼看
```

`docs/preview-sheet-print-a4.png` 是当前版本的纸面样子（单页 A4，无折页、无压字）。

## 六、过敏史要能一眼看到

「过敏史」原来只是跟在药物表格后面的一行灰色小字：

```
档案里没有登记在服药物
过敏史：蛋白质过敏 · 既往病史：低血糖
```

问题在于它和「没有登记药物」这种空信息同色同号 —— 医生扫过去，眼里只有一句
「没在吃药」。可过敏史恰恰是整张纸上仅次于红旗的重要信息。

现在拆成独立一块 `.paper__allergy`：

- 有记录 → 琥珀底色 + 左侧竖条 + 「过敏史」胶囊标签，内容加粗（`is-marked`）
- 没记录 → 退成灰块、写「未记录」（`is-none`），不假装有信息

```tsx
<p className={`paper__allergy${patient.allergies?.trim() ? " is-marked" : " is-none"}`}>
  <b>过敏史</b>
  <span>{patient.allergies?.trim() || "未记录"}</span>
</p>
```

**纯文本版（复制到微信那份）也必须带上。** 这是同一轮里发现的更严重的漏洞：
屏幕上有的信息，`sheetText()` 里漏了 —— 复制出去的文字没有过敏史，
读的人会默认「没提到就是没有过敏」。现在 `sheetText()` 输出：

```
【过敏史】青霉素
【既往病史】慢性胃炎
```

没记录时写「【过敏史】未记录」，既往病史为空就整行不出。这两条都进了 `sheet-test.ts`。

## 七、类名的坑（踩过）

这一套最初叫 `.sheet` / `.sheet__head`，而 `PatientForm`、`/drugs`、`/library`
早就在用 `.sheet` 做页面卡片。结果：

- `.paper` 之前的 `.sheet` 规则被我后面的块覆盖 → 药物库、资料库、建档页三页版式全变
- 移动端 `.sheet__head { flex-direction: column-reverse }`（建档页的媒体查询）串到
  就诊摘要上 → 关闭按钮跑到左上角
- `@keyframes sheet-in` 被重定义 → 那三页的入场动画也跟着换了

全部改成 `paper__*` / `paperlayer` / `paper-in` 之后才对。**新组件别复用大路货类名。**

改名时还漏了一处，隔了很久才被发现：CSS 改成了 `.paper__list`，而 `VisitSheet.tsx`
里两个列表还写着 `sheet__list` —— 这个类名在 CSS 里根本不存在，于是「可以先做的」
和「想问医生的问题」两段一直没有列表样式（缩进、marker、打印字号全丢）。
改名之后一定要两边一起查：

```bash
grep -rn "sheet__" src/          # 看还有谁在用旧名
grep -n "paper__list" src/app/globals.css   # 确认新名真的定义了
```

注意 `PatientForm` 的 `sheet__head/title/save` 是**合法**的（建档页在用），别一把梭全改。

## 八、自检

`scripts/sheet-test.ts`（纯函数，37 项）：本地模板、模型结果清洗、胡说时退回、
去重、纯文本版、时间格式。

`scripts/check-flow.mjs` 第 [3][4] 段（端到端，含浏览器）：两条路都能出纸、
红旗写进纸里、点开能看、区块编号连续、主诉不在病程里重复、打印时只剩纸一层、
手机上铺满屏宽、控制台无报错。
