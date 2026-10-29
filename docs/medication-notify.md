# 到点提醒（浏览器通知）

用药卡片上「提醒文案」是**手动**看文案；这个功能是**自动**：到点弹一条系统通知，
点通知就记作已服用。

```
用药记录 ──▶ /api/medications/today ──▶ 每 25 秒问一次 ──▶ 弹 Notification
   ▲                                                          │
   └──────────────── 点通知：POST checkin + 打开档案页 ◀───────┘
```

**页面必须开着**。关掉标签页就收不到——那需要 Service Worker + 服务端推送，
是另一套东西，这里没做。

## 一、判定：现在该不该弹

`src/lib/medication-today.ts` 里的 `listTodayReminders()`，逐条判断：

| 条件 | 说明 |
| --- | --- |
| `isActive` | 停用的药不提醒 |
| `timeOfDay` 非空 | 没填时间点就不知道该几点弹 |
| 今天没打卡 | 打过卡立刻从列表里消失 |
| `remainingDays !== 0` | 疗程走完（第 N+1 天）不再提醒 |
| 时间点已过，且迟到 ≤ 180 分钟 | **超过 3 小时就不弹了**，晚上十点弹早上八点的药只会让人烦 |
| 时间点还没到 | 放进 `upcoming`，前端可以显示「下一个 14:30」 |

宽限窗口 `GRACE_MINUTES = 180` 是我拍的一个值：覆盖「忙着忘了、午休起来」的常见情况，
再久就没有提醒的意义了。想改就改这一个常量。

## 二、接口

`GET /api/medications/today`

```json
{
  "now": "2026-10-24T15:20:00.000Z",
  "day": "2026-10-24",
  "graceMinutes": 180,
  "due": [
    {
      "medicationId": "cmvg...",
      "patientId": "cmvf...",
      "patientName": "陈妍萱",
      "drugName": "布洛芬缓释胶囊",
      "dosage": "300mg",
      "timeOfDay": "23:10",
      "mealTiming": "after",
      "notice": "💊 该吃布洛芬缓释胶囊了，300mg～",
      "minutesLate": 10,
      "courseDay": null,
      "remainingDays": null
    }
  ],
  "upcoming": [
    { "medicationId": "...", "drugName": "甲钴胺片", "timeOfDay": "21:00", "minutesUntil": 60 }
  ]
}
```

`notice` 直接复用 `buildReminder()` 的站内通知那一行（≤30 字），
所以弹窗里的文案和档案页点「提醒文案」看到的完全一致。

## 三、前端怎么跑

`MedicationReminderWatcher` 挂在 `layout.tsx`，登录后的每个页面都在跑，但：

- 没开提醒 → 直接 return，**一个请求都不发**
- 没给通知权限 → 同样不发请求
- 接口 401 / 5xx → 静默跳过，下一轮再试

轮询 25 秒一次；另外两个时机立刻检查一次（不等下一轮）：

- `visibilitychange`：从别的标签页切回来
- `medai:med-remind-change`：刚在档案页把开关打开

### 去重

localStorage：

```
medai:med-remind:seen:{YYYY-MM-DD}:{medicationId} = "1"
```

同一个药同一天只弹一次。每轮顺手把不是今天的 key 删掉，避免一直堆积。
没有这层，开着页面会被每 25 秒弹一次。

### 点击通知

```ts
n.onclick = () => {
  POST /api/medications/{id}/checkin   // 点一下就算吃了
  router.push(`/patients/{patientId}`) // 用路由跳，不整页刷新
};
```

用 `router.push` 而不是 `window.location`：后者会整页刷新，把 3D 场景重建一遍
（见 `docs/scene-reuse.md`，重建从 78ms 变 5 秒）。

记错了可以在档案页点「今天已服 ✓」撤销。

## 四、开关在哪

档案详情 → 「用药」标签 → 表单上方的「到点提醒」。

打开时按顺序做三件事：申请通知权限 → 记住开关 → 广播事件（watcher 立刻查一次）。

三种失败情况都有文案：

| 状态 | 提示 |
| --- | --- |
| `unsupported` | 这个浏览器不支持系统通知（或不是 https / localhost），提醒只在页面里显示 |
| `denied` | 通知权限被拒绝了，去浏览器地址栏左边的站点设置里改回「允许」 |
| `granted` | 已允许通知，到点会弹出来 |

权限申请**必须发生在点击里**，这是浏览器规范，所以没有「默认开启」。

## 五、自检

```bash
node scripts/check-medication-notify.mjs http://127.0.0.1:3100
```

16 项（临近零点会跳过其中 1 项）：

```
[1] 该不该提醒
  ✓ 没设时间点的药不提醒
  ✓ 到点后出现在 due 里            迟到 10 分钟
  ✓ 通知文案不是空的且 ≤30 字       💊 该吃布洛芬缓释胶囊了，300mg～
  ✓ 超过宽限（4 小时前）不再提醒
  ✓ 还没到点的进 upcoming
  ✓ 今天打过卡就不再提醒
  ✓ 撤销打卡后重新回到 due
  ✓ 疗程已经走完的药不提醒
  ✓ 未登录访问被拒（401）

[2] 浏览器通知
  ✓ 页面加载后弹出了通知
  ✓ 通知正文就是那条药的文案
  ✓ 通知带了 tag（同一条药不会堆成一片）
  ✓ 同一天不会重复弹
  ✓ 点通知后自动打卡
  ✓ 接口里也显示今天已服
```

测试里用替身替换了 `window.Notification`（无头浏览器弹不出系统通知），
记录「弹了什么」再断言；点击也是直接调 `onclick`。测试会**修改真实用药数据**，
结束时在 `finally` 里把 `timeOfDay / courseDays / startDate` 还原、打卡撤销。

**坑**：时间点是「今天这一刻」，临近零点时构造不出今天未来的时刻，
跨日就变成「已过很久」。所以「还没到点」那条在 23:00 之后会跳过。

## 六、没做的部分

- **关掉页面也能收到**：需要 Service Worker + Web Push + 服务端定时，还涉及 VAPID 密钥，
  不是前端能单独完成的。
- **邮件**：文案已经生成好了（`buildReminder().email`），但没有发信通道，
  要接 SMTP / 邮件服务。
- **系统通知里的按钮**（「已服用」「稍后」）：普通 `Notification` 不支持 `actions`，
  那是 Service Worker 的 `showNotification` 才有的能力。

按投入产出，下一步最值得做的是邮件——它不需要页面开着，也不用用户授权。
