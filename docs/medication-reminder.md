# 档案里的用药与提醒文案

每个档案的「用药」页可以登记药品，并给每一条生成两段提醒：**站内通知（≤30 字）**和
**邮件正文（≤80 字）**。文案全部由模板拼装，不调用模型，也不会给出任何用药建议。

## 一、用药现在能记什么

| 字段 | 说明 |
| --- | --- |
| 药名 | 必填 |
| 单次剂量 | 如 `5mg`、`一次两粒` |
| 时间点 | `08:00`，24 小时制，提醒里会用到 |
| 饭前 / 饭后 | 饭前 / 饭后 / 不限 |
| 频率 | 自由文本，如"每日一次"（仅展示用） |
| 疗程（天） | 总天数；留空就用开始~结束日期推算 |
| 备注 | 医生嘱咐这类自由文本 |

打卡：卡片上有「打卡」按钮，点一下记今天已服，再点撤销。历史漏服是算出来的，
不需要手动补记录。

## 二、数据模型

```prisma
model Medication {
  timeOfDay  String?   // "08:00"
  mealTiming String?   // before | after | any
  courseDays Int?
  logs       MedicationLog[]
}

model MedicationLog {
  medicationId String
  scheduledFor DateTime   // 哪一天（当地 00:00），一天一条
  takenAt      DateTime?
  status       String     // taken | skipped
  @@unique([medicationId, scheduledFor])
}
```

迁移：`npx prisma db push`（新增列 + 新表，不动已有数据）。执行前备份 `prisma/dev.db`。

## 三、文案怎么拼

`src/lib/medication-reminder.ts`（纯函数）：

```
站内通知：💊 该吃{drug}了，{dose}，记得{meal}服用～
邮件正文：您好，
          提醒您该服用{drug}了（{dose}，{meal}）。
          今天是疗程第X天，还剩Y天，请按时服药。
          [连续漏服 ≥2 次时追加：最近两次未打卡，记得按时服药哦，身体最重要～]
          如有不适请及时就医。
```

**长度是硬约束**，所以每段都有降级顺序：

- 站内通知：`药名+剂量+饭前饭后` → `药名+饭前饭后` → `药名+剂量` → `药名`，
  取第一个 ≤30 字的；还超就按字符截断加省略号。
- 邮件：进度写全 → 进度精简（`疗程第X天，还剩Y天。`）→ 去掉进度。
  无论怎么降级，问候、核心提醒、"如有不适请及时就医"都在，不会为了凑字数把它们删掉。

几处刻意的取舍：

- **饭前饭后选「不限」就不写**，不硬编"记得服用"以外的措辞。
- **没有起始日就不写"第几天"**，免得写出"今天是疗程第 1 天"这种假信息。
- **英文缩写、emoji 按字符算**（`Array.from`），"💊" 只算 1 个，不是 2 个。
- 关怀句只在**邮件**里出现，站内通知保持一句话说完。

实际长度：常见数据下站内通知 25~28 字、邮件 56~60 字；带上关怀句是 72~77 字，仍在 80 以内。

## 四、「连续漏服 2 次」怎么算

`src/lib/medication-schedule.ts` 里的 `computeSchedule()`，规则很简单：

1. **一天一次**。`frequency` 是自由文本（"每日一次""每晚一次"都有人写），
   与其解析它，不如按「一天一次 + 时间点」处理，对提醒文案够用，也不会因为写得奇怪就算不出进度。
2. **起始日** = `startDate`，没填就用 `createdAt` —— 否则今天刚加的药会立刻被判成漏服。
3. **漏服** = 起始日之后、今天之前，没有打卡的日期。
4. **连续** = 从昨天往回数，一旦遇到打过卡的日期就停；最多往回数 30 天。
5. 今天不算漏服（提醒是发给"还没吃"的今天的）。

所以：昨天和前天都没打卡 → `missedStreak = 2` → 邮件里追加关怀句。

## 五、接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/medications/[id]/reminder` | 返回 `{ notice, email, noticeChars, emailChars, careAdded, facts }` |
| POST | `/api/medications/[id]/checkin` | 打卡，body 可选 `{ date: "2026-10-24" }`，默认今天 |
| DELETE | `/api/medications/[id]/checkin?date=…` | 撤销打卡 |
| POST | `/api/patients/[id]/medications` | 新建用药，接受 `timeOfDay/mealTiming/courseDays` |
| PATCH | `/api/medications/[id]` | 改字段、停用 / 恢复 |

列表接口（`GET /api/patients/[id]/medications`、档案详情 SSR）会把进度一起算好返回：
`courseDay / remainingDays / todayTaken / missedStreak`，前端不用再算一遍。

## 六、界面上

- 表单：药名、单次剂量、时间点、饭前/饭后、频率、疗程（天）、备注，一行放不下会自动换行
- 卡片：`药名 剂量 · 频率 08:00 · 饭后 疗程第 3 天 · 还剩 12 天`，
  连续漏服 ≥2 次时多一个红色小标「连续 N 次没打卡」
- 按钮：`打卡 / 今天已服 ✓`、`提醒文案 / 收起提醒`、`停用`、`删除`
- 点「提醒文案」在卡片下方展开两块：站内通知、邮件正文，各带字数标注（`28/30 字`）和复制按钮，
  底部一行说明当前是"已追加关怀提醒"还是"未触发（需连续漏服 2 次）"

## 七、自检

```bash
# 文案规则（纯函数，不用起服务）
npx tsx scripts/reminder-test.ts        # 32 项

# 页面流程：加药 → 打卡 → 生成 → 漏服关怀 → 清理
node scripts/check-reminder.mjs http://127.0.0.1:3100   # 20 项
```

`check-reminder.mjs` 会自己建测试用药并在结束时删掉，不会污染演示数据。
它等 React hydrate 完成后再操作（空表单点提交应报"药名不能空着"），否则受控输入会白填。
