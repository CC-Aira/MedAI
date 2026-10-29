# 到点提醒：先找兔子，再找系统

用药提醒有两条通道，主次分得很清楚：

| 通道 | 需要什么 | 什么情况生效 |
| --- | --- | --- |
| **兔子说话**（主） | 页面开着 | 一定会说，不看任何权限 |
| 系统通知（辅） | 用户点过「开启」并给了通知权限 | 有权限才弹，能盖在其他窗口上 |

## 改之前是什么样

`MedicationReminderWatcher` 一开始只跑一条通道，而且门槛写在最前面：

```ts
if (!isReminderEnabled()) return;
if (notifyPermission() !== "granted") return;   // ← 权限一拒，整个功能不跑
```

结果是：用户不开权限（浏览器弹窗默认被拒、或者 http 下 `Notification` 不可用），
到点什么都不发生 —— 功能看着在，实际是死的。而「开启」按钮还写着「已开启」。

## 现在怎么跑

```ts
if (!isReminderEnabled()) return;        // 只留开关，不再用权限当前置条件
...
for (const dose of data.due) {
  if (wasNotifiedToday(day, dose.medicationId)) continue;

  if (!rabbitSaid) { rabbitMedReminder(...); rabbitSaid = true; }   // 一轮只说得了一句
  showDoseNotification(dose, ...);                                 // 没权限就返回 null，不报错
  markNotifiedToday(day, dose.medicationId);                       // 兔子说过了也算提醒过
}
```

几个刻意的决定：

- **一轮只让兔子说一句**。三条药同时到点，连说三句只会被当成噪音；剩下的交给系统通知。
- **没用系统通知也要记「今天提醒过」**。否则每 25 秒重复说同一句话。
- **权限检查留在 `showDoseNotification` 里面**（它自己 `return null`），不挡主流程。

## 说了什么

```
林小满，08:00 那颗氨氯地平片还没打卡哦
点木牌就能给全家人打卡
```

语气走 `tone: "care"`（不是告警色），停留 24 秒 —— 比普通闲聊长，因为可能有人正忙着。
同时 `hop: true`，气泡一出现兔子蹦一下：光说话容易被当成装饰。

## 人不在草地上怎么办（pending）

提醒的发动机挂在根布局，人可能在档案页、科普库、药品库 —— 那些页面没有兔子气泡，
`emit()` 时一个监听者都没有。所以 `rabbit-speech.ts` 里存了**最后一句**：

- 只留最近一句，新的覆盖旧的（旧提醒过期了说出来反而添乱）；
- 有效期 2 分钟（`PENDING_TTL`）；
- 气泡挂载时会问一句「刚才有人说话吗」，有就补发一次，**并且只补一次**（补完清空，
  第二个监听者不会重复收到）。

## 一个容易忽略的冲突：欢迎语

气泡挂载 460ms 后会自报家门（`rabbitGreet`）。如果补发的提醒抢在这之前，
欢迎语会把提醒顶掉 —— 用户只看到「你好呀我是 MedAI」，最要紧的那句没了。

所以 `RabbitBubble` 记了一个 `spokeRef`：说过话就不再打招呼。

## 已知限制

- **只有首页有兔子**。其他页面到点的提醒先存着，回到草地才补 —— 页面标题/图标没有做未读标记。
- **手机上没有 3D 兔子**，也没有气泡；手机端靠系统通知，没权限就只剩档案页里的木牌明细。
- **页面关掉就全没了**。真要后台推送得上 Service Worker + Web Push，那是另一套东西。
- 提醒的是「今天还没打卡的药」，不是「必须现在吃」：宽限窗口 180 分钟，迟到太久的当天不再提醒。

## 测试

```bash
npx tsx scripts/notice-test.ts             # 纯逻辑 14 项：文案、pending 补发、hop
node scripts/check-rabbit-notify.mjs       # 端到端 10 项：权限 denied + 造一颗到点的药
node scripts/check-medication-notify.mjs   # 系统通知那条通道（16 项，没动过）
```

`check-rabbit-notify.mjs` 会把 `Notification` 换成一个计数器，然后断言两件事同时成立：
**气泡里说的是这颗药**、**系统通知一次都没构造**。这正是改动的意义所在。
