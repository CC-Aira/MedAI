# 接口自测清单

自测脚本：`scripts/api-test.ts`。它不是单元测试，而是把服务真正跑起来，用真实 HTTP 打一遍边界。

```bash
npm run build
npx next start -p 3100
API_BASE=http://127.0.0.1:3100 npm run test:api
```

最近一次运行：**68 / 68 通过**。

脚本会注册两个临时账号 A 和 B（邮箱带时间戳，互不干扰），然后用 A 建数据、用 B 去撞，最后把 A 的东西删干净。

## 四类必须成立的边界

### 未登录 → 401

| 请求 | 期望 |
|---|---|
| `GET /api/patients` | 401 |
| `POST /api/patients` | 401 |
| `GET /api/growth` | 401 |
| `GET /api/patients/:id` | 401 |
| `POST /api/upload/avatar` | 401 |

### 跨账号 → 404（不区分"不存在"和"不是你的"）

| 请求 | 期望 |
|---|---|
| `GET /api/patients/:id`（A 的 id） | 404 |
| `PATCH /api/patients/:id` | 404 |
| `DELETE /api/patients/:id` | 404 |
| `POST /api/patients/:id/medications` | 404 |
| `PATCH /api/medications/:id` | 404 |
| `GET /api/consultations/:id` | 404 |
| `PATCH /api/notes/:id` | 404 |
| `GET /api/patients/does-not-exist` | 404（与跨账号同码） |
| B 的 `GET /api/patients` | 200，但列表里没有 A 的档案 |

### 自己的数据 → 200

| 请求 | 期望 |
|---|---|
| `GET /api/patients` | 200，`patients[]` 里有刚建的档案 |
| `GET /api/patients/:id` | 200 |
| `GET /api/growth` | 200，`growth.patients === 1`（只统计自己） |

### 非法输入 → 400

| 场景 | 期望 |
|---|---|
| 注册：邮箱格式非法 | 400 |
| 注册：密码 < 8 位 | 400 |
| 重复注册同一邮箱 | 409（也接受 400） |
| 登录：密码错误 | 401 |
| 请求体不是 JSON / 空 body | 400 |
| 建档：姓名为空 | 400 |
| 建档：性别不在 `male\|female` | 400 |
| 建档：姓名超 20 字 | 400 |
| 用药：药名超 50 字 | 400 |
| 用药：剂量超 30 字 | 400 |
| 消息：空内容 | 400 |
| 消息：超 2000 字 | 400 |
| 应用整理：单次超 20 条 | 400 |
| 应用整理：字段不在白名单（如 `ownerId`） | 400 |
| 结论：标题超 40 字 | 400 |

## 其它关键约定

| 约定 | 验证方式 |
|---|---|
| `ownerId` 只能由服务端决定 | 建档时故意传 `ownerId: "hacker-tries-to-steal"`，响应里不含 ownerId，且 B 查不到 |
| PATCH 只改请求里出现的字段 | 只传 `age: 32`，`allergies` 和 `chiefComplaint` 必须原样保留 |
| 写操作返回完整列表 | 建档 / 加药 / 停用药 / 建结论 / 星标 / 删除 都返回整份 `patients[]` / `medications[]` / `notes[]` |
| 停用是主操作 | `PATCH {isActive:false}` 后该条仍在列表里（前端把它排到列表底部、划线） |
| 删除幂等 | 第二次 `DELETE` 返回 404 而不是 500 |
| 失败不留孤儿数据 | `POST /messages` 先调 AI，流读完且内容非空才落库；流里有 `delta` 才有 `done` |
| 扫描档案是只读的 | `POST /facts` 只返回 `candidates[]`，不写库；`PATCH /facts` 才落库 |
| SSE 协议 | 流里出现 `{"type":"delta"}` 与 `{"type":"done"}`，落库后 `GET /api/consultations/:id` 能看到 user + assistant 两条 |

## 一个需要说明的取舍

会话 Cookie 是 **HMAC 无状态签名**，服务端不存白名单。登出会下发 `max-age=0` 让浏览器删掉 Cookie，但如果有人事先复制了那串 token，它在 7 天到期前仍然可用。

这是"无状态会话"的固有代价。要做到即时吊销，需要额外一张 token 黑名单表（或给 User 加 `sessionEpoch`，登录时自增，校验时比对）。本项目按规格选择了前者，自测脚本里对应两项是：

- `登出下发清空 Cookie（max-age=0）` → 通过
- `登出后带清空值访问 → 401` → 通过

而不是"旧 token 立即失效"。
