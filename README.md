# MedAI — 草地上的毛绒小球医生

给**患者本人**用的 AI 辅助问诊工具。每个账号管理自己和家人的健康档案，在草地上点开一份档案，绒球医生滚过来陪你聊完这次问诊。

技术栈锁定：Next.js 16（App Router）+ React 19 + TypeScript 5 + Tailwind 4 + Prisma 6 + SQLite + DeepSeek。认证只用 Node 内置 `crypto.scrypt` 与 HMAC 签名 Cookie，没有引入任何认证库。

## 跑起来

```bash
npm install
cp .env.example .env        # 填 DEEPSEEK_API_KEY、SESSION_SECRET
npm run db:push             # 建表，生成 prisma/dev.db
npm run db:seed             # 可选：写入演示账号
npm run dev                 # http://localhost:3000
```

演示账号（跑过 `db:seed` 才有）：`demo@medai.local` / `Medai@2026`（另有 `other@medai.local` 同密码，用来验证数据互不可见）。

`.env` 里 `MEDAI_DEMO_LOGIN=1` 时，登录页会多一个「用演示账号直接进去」的按钮 —— 现场演示不用敲密码，也避不开限流（它走的就是正常的登录接口，密码错了照样 401）。正式环境留空即可，页面上不会出现入口。

没有 DeepSeek Key 也能完整跑通：`.env` 里 `MEDAI_DEMO_AI=1` 时，AI 会走一条本地模拟流（协议与真实调用一致，用于演示与自测）。真要接模型，把 Key 填上并删掉这行。

## 几条命令

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | `tsc --noEmit`，零错误 |
| `npm run lint` | eslint，零 error |
| `npm run build` | `prisma generate && next build` |
| `npm run test:api` | 接口自测，见 `docs/api-selfcheck.md` |
| `npm run db:backup` | 数据库一致性备份 → `backups/`，见 `docs/deploy.md` §2.5 |
| `npm run pack` | 打离线分发包 → `dist/`，自动挡掉 `.env` / 数据库 / 上传文件 |
| `npm run pack:submission -- --team "学校+姓名+手机号"` | 打参赛提交包（源码 + 提交材料），见 `docs/submission/` |

## 数据库

SQLite 单文件，`prisma/dev.db`。`src/lib/db.ts` 在装配时做了两件容易被忽略的事：

- **连接池压到 1 条**（`connection_limit=1`）—— SQLite 写入本来就是整库串行，连接开多了只会更容易撞 `SQLITE_BUSY`（全家几台手机同时打卡就是这种场景）；
- **切 WAL** + `busy_timeout=5000` + `synchronous=NORMAL` —— 默认模式下一个写事务锁住整库、读只能等，WAL 下读走自己的快照。

两者都只在 `DATABASE_URL` 以 `file:` 开头时生效，换 Postgres 自动跳过。因为开了 WAL，**备份不能用 `cp`**，用 `npm run db:backup`（走 `VACUUM INTO`）。细节见 `docs/deploy.md` §2.7。

## 目录

```
src/
  app/
    page.tsx                     草地主页（服务端取自己的档案 → 交给客户端场景）
    login/                       登录 / 注册
    patients/new/                建档
    patients/[id]/               档案详情：用药 / 结论 / 问诊记录 / 时间轴 / 成长
    patients/[id]/edit/          编辑档案
    api/
      auth/{register,login,logout}
      patients, patients/[id]
      patients/[id]/{medications,consultations,notes}
      medications/[id], notes/[id], consultations/[id]
      consultations/[id]/{messages,summary,facts,sheet}
      growth, upload/avatar
  components/
    MeadowStage.tsx              开场蒲公英 + 3D 草地 + 档案栏 + 问诊面板（转场调度都在这）
    LoginForm.tsx  PatientForm.tsx  PatientDetail.tsx  SheetShell.tsx
    VisitSheet.tsx               就诊摘要那张纸（portal 到 body，打印时只留它）
    PatientTimeline.tsx          病程时间轴 + 投影视图（截图进 PPT 的那张）
    meadow/engine.js             Three.js 场景（纯 JS，配 engine.d.ts 给 TS 用）
  lib/
    auth.ts        scrypt 哈希 + HMAC 会话 + getCurrentUser / requireUser
    http.ts        HttpError、统一响应、错误收敛
    validate.ts    字段级校验（超长、空值、类型）
    ai.ts          DeepSeek 封装：流式 / 一次性 / parseJsonLoose / 演示模式
    medical-prompt.ts  个体化 System Prompt 装配（三个上限 + 合规三件套）
    facts.ts       diffFacts（代码判定冲突）+ applyFacts（重新校验后落库）
    consult-flow.ts     拼上下文、摘要、扫描候选、红旗落库、就诊摘要生成
    red-flags.ts   红旗症状的本地规则（11 条，纯正则，不调模型）
    visit-sheet.ts 就诊摘要的结构与清洗（纯函数）+ 本地模板 + 纯文本版
    patients/medications/consultations/notes/growth.ts  数据层与序列化
    medication-schedule.ts   一天一次的排程与依从性（纯函数，漏服封顶 7 天）
    medication-board.ts      「今天的药」木牌数据：按档案聚合今天的进度
    timeline.ts      病程时间轴：把建档/用药/问诊/结论合成一条轴（纯函数）
  lib/client/      浏览器侧 fetch 封装与 DTO 类型
```

## 数据隔离是怎么保证的

1. **归属只由服务端决定**：所有写入都用 `owner: { connect: { id: user.id } }`，请求体里的 `ownerId` 直接被忽略。
2. **越权用一条语句挡掉**：`findFirst({ where: { id, ownerId } })`。不做"先查再比对"——那会让攻击者从响应差异里确认某个 id 是否存在。别人的档案和真的不存在的档案，返回的都是同一个 404。
3. **接口顺序固定**：校验输入（400）→ 认门（404）→ 查配置（503）→ 干活。
4. **PATCH 只改请求里出现过的字段**：靠 `hasOwnProperty` 判断，没传的字段绝不会被擦成 `null`。
5. **写操作返回完整列表**：前端拿到就整体覆盖本地状态，不做增量拼装。

会话是无状态 HMAC 签名（7 天）。这意味着：登出会清掉浏览器里的 Cookie，但**旧 token 值本身在到期前仍然可用**——要做到即时吊销得加黑名单表，本项目按规格选择了无状态。

## AI 这一层

**个体化靠拼提示词，不做微调、不做向量库。** 每次对话前把四样东西拼成 System Prompt：

1. 档案（姓名 / 性别 / 年龄 / 体型 / 血型 / 体质 / 过敏史 / 病史 / 习惯 / 主诉）
2. 在服药物（`isActive` 的）
3. 最近 3 条问诊摘要
4. 星标优先的 8 条结论

token 靠三个上限恒定：历史 20 条、摘要 3 条、结论 8 条。

医疗合规三件套永远在场：不下诊断、不开处方；过敏史优先考虑并主动提醒；涉及处方药必须提示遵医嘱。

**失败不留孤儿数据**：`POST /messages` 先调 AI，流读完且内容非空，才把用户消息和回复一起写进库。Key 配错、上游 500、网络中断都不会攒出"只有提问没有回答"的记录。

**AI 提建议，患者点头**：`POST /facts` 只返回候选，一个字不写库；`PATCH /facts` 才落库。三类候选里，`fill`（档案为空可补）和 `add`（新增用药）默认勾选；`conflict`（与档案不一致）默认**不**勾选并红色高亮，必须患者亲手确认。冲突判定由代码 `diffFacts()` 完成，不交给模型。落库前每条都当不可信输入重新校验：字段白名单、长度上限、单次 ≤20 条、`medicationId` 按 ownerId 重查一次。

**结论（Note）不许自动生成**：客观事实可以让 AI 整理，但"哪句重要"是价值判断，只有患者知道。

## 前端这一摊

- 开场是一株 186 颗种子的蒲公英（内联 SVG），吹散后 3D 场景才显出来。
- 3D 场景是 `engine.js`：程序化地形 + 6 万株实例草（顶点着色器里做风摆和踩踏衰减）+ 点精灵做的花与蒲公英 + 一只毛绒绒的绒球医生。眼神跟鼠标，鼠标静止 2.5 秒回来看你。
- 点开档案：球向右滚 90°、抬头、缩小；左栏左滑消失；问诊面板从右滑到中间。三者共用 `--flow: 1100ms` 一条时间轴，同一刻停下，球正好趴在面板上边缘。
  - 球的落点不是写死的：用面板的 `offsetLeft/offsetTop` 反投影到 3D，换分辨率、换布局都准。
  - 转场进度用**墙钟**算，不累加 `dt`——低帧率设备上 `dt` 会被钳到 0.05，那样 1.1 秒会被拖成两三秒，球就和面板错开了。
- 移动端（≤860px）左栏变底部抽屉，球站在抽屉上边缘。
- **红旗症状不交给模型**：胸痛、呼吸困难、意识不清、大出血这类话一出现，本地规则当场中断问诊，
  画成红卡片而不是气泡，并把 `redflag.<kind>` 写进 `Message.flag` —— 刷新之后它还是红的。
  实测拦截 126ms，走模型 1646ms。见 `docs/red-flag.md`。
- **就诊摘要能带走**：一次问诊可以整理成一张纸（主诉 / 病程 / 在服药 + 过敏史 / 可以先做的 /
  何时必须就医 / 想问医生），支持打印存 PDF、复制文字。纸面上的字号和布局是单独重排的
  （A4 单页、不依赖 flex、色块用真边框，哪个工具转 PDF 都不容易变形），复制出去的纯文本
  同样带过敏史和既往病史。模型挂了或没配 Key 就退回本地模板，绝不空手。见 `docs/visit-sheet.md`。
- **关掉档案再打开，话还在**：打开时接着这个档案最近一次没归档、真的聊过的问诊继续，
  点「这次聊完了」才归档、下次重新开始。空问诊不进问诊记录列表，关面板时也会顺手删掉。
  见 `docs/consult-session.md`。
- **问诊记录是日历**：聊过的那天点一个小圆点（一天聊了两次就是两个点），点日期看当天的记录，
  再点「看聊天记录」读原文。对话只留 30 天，超期之后不假装还有原文 —— 直接读当时留下的
  小结，没留就照实说。见 `docs/visit-calendar.md`。
- 左上那片天上吊着一块**小木板**（两根铁链挂着），写全家今天吃了几次药（只统计设了用药跟踪的档案）。
  桌面是一块真的 3D 木板：锯口不齐的长条板 + 两根铁链吊着，微风吹着轻轻摆；木纹是代码现场算的
  四张贴图（颜色 / 法线 / 粗糙度 / 端面），高度场求导得法线，每圈年轮的粗细和深浅各自随机，
  端面另有横切的年轮弧；板子背后有太阳，所以单独给它补一盏只照板子的侧光；板面那层字是 HTML，
  每帧用单应矩阵贴到板子四角上，所以是真字体、缩放不糊。**点一下木牌**，卡片从板子下面长出来，
  每位家人一段、每颗药一行；**行本身就是打卡按钮**，点一下记为已服、再点一下撤销 —— 不用进档案页，
  打完三处同时变（行内状态、表头 2/5→3/5、板面上的字）。一个跟踪都没有时它**不会消失**，
  而是挂一块写着「今天还没有要吃的药」的空板子 —— 点开告诉你怎么用，功能才找得到。
  手机上换成档案栏顶上的一条（那块天放不下一块看得清的吊牌）。
  见 `docs/medication-sign.md`。
- **病程时间轴**：档案页第五个 tab，把建档 / 用药 / 问诊 / 结论排到同一条纵轴上，
  按「真发生时间」归日（用药看 `startDate`、问诊看 `lastMessageAt`，不看会被归档刷新的
  `updatedAt`）。右上角「投影视图」铺一张 880px 白纸，内容超一屏可以点「缩到一屏」，
  截一张图直接进 PPT；Ctrl+P 也能存 PDF。见 `docs/timeline.md`。
- **疾病科普 / 药品说明**：左栏顶上两个独立入口。**90 条**常见病（13 个科室全覆盖）+ **73 种**
  常用药（10 个药理大类），都按科室/大类浏览、也能直接搜症状——「拉肚子」「痘痘」「血压高吃什么药」
  都能命中（同义词归一 + 字段权重，纯函数跑在客户端）。疾病详情八节，其中
  **「去医院一般会做哪些检查」**和**「流传很广，但不对」**是最实用、别处又常讲不清的两节；
  药品详情除了六项正文，另有**起效 / 漏服 / 储存**三张卡。每条都带指南来源和整理月份，
  底部固定一句「科普不替代面诊」。列表和详情头都有插图：`DeptArt.tsx` 里 18 组自绘 SVG 线稿，
  矢量不糊、无图片版权问题。见 `docs/health-library.md`。
- **到点提醒先找兔子，再找系统**：开着提醒时，到点由兔子在草地上说一句、蹦一下，
  同时（有权限才）弹系统通知。不开通知权限也照样提醒 —— 以前只有系统通知这条通道，
  权限一拒整个功能就废了。人不在草地上的时候那句话会存着，回来再补上。

- **走错路也有出口**：`not-found.tsx` / `error.tsx` 换成中文奶油色面板 ——
  默认的 Next 404 是英文的「This page could not be found」，既不像产品也没有回头路；
  现在写清楚「怎么了」，并给「回到草地 / 再试一次」。错误详情只进控制台和 `digest`，不摊给用户。

## 已知取舍

- **会话无状态**，登出不吊销 token（见上）。
- **头像存本地磁盘** `public/uploads/avatars/`，服务器是多实例部署的话需要换成对象存储。
- **SQLite** 单文件，适合单机自用；并发写多了要换 Postgres。答辩演示**不建议**临时换库，
  三条路线的取舍和 Dockerfile 都在 `docs/deploy.md`，Postgres 版 schema 也已经备好。
- 只校验文件头魔数（PNG / JPEG / GIF / WebP），没有做图片解码与重编码；文件名由服务器用 `randomUUID` 生成，不采信用户文件名。
