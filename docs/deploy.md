# 部署方案（答辩演示 / 小规模上线）

> 这份文档只回答一个问题：**答辩要在线上演示，现在这套东西该怎么落地。**
> 结论先给：单人答辩用「一台小云服务器 + Node 进程 + SQLite 挂盘」，不要碰 PostgreSQL。

---

## 0. 先说结论

| 方案 | 适用 | 成本 | 改动量 | 建议 |
| --- | --- | --- | --- | --- |
| A. 本机跑 + 内网穿透 | 现场在自己电脑演示，老师扫码/点链接看 | 0 元 | 0 | 最稳，兜底用 |
| B. 云服务器 + Node + SQLite | 需要「随时能打开的链接」，1~10 人同时看 | 60~100 元/月（2C2G） | 小（本仓库已带 Dockerfile） | **推荐** |
| C. Vercel / Serverless + PostgreSQL | 要长期运营、要多人协作、要多副本 | 免费额度起 | 大（换库 + 换文件存储） | 现在不要 |

**为什么现在不急着换 SQLite：**

1. 答辩演示的真实并发是个位数，Next 生产进程是**单进程 Node**；
   即便如此 `src/lib/db.ts` 仍把连接池压到 1 条并开了 WAL —— 因为单进程内的**多条连接**
   同样会互相抢写锁（Prisma 默认按 CPU 核数开连接），全家几台手机同时打卡就能撞上；
2. `prisma/dev.db` 是一个文件，挂到宿主机目录就持久化了，容器重建也不丢；
3. 换 PostgreSQL 要改 `provider`、重跑 `prisma migrate`、重测全部 40+ 条接口测试和 6 套 e2e，**收益（并发）远小于风险（答辩前一周改库）**。

**什么时候必须换：** 需要多副本 / Serverless 部署（Vercel 无持久磁盘，SQLite 写不进去）、多人同时编辑同一份档案、或者要继续做产品而不只是答辩。换的时候按 §5 走，仓库里已经准备好了 `prisma/schema.postgres.prisma`。

---

## 1. 方案 A：本机 + 内网穿透（最省事，答辩兜底）

```bash
npm run build
npx next start -p 3100            # 或者直接双击 Start MedAI.bat
```

穿透（二选一）：

```bash
# Cloudflare Tunnel：不用注册域名，临时地址，稳定
cloudflared tunnel --url http://localhost:3100

# ngrok
ngrok http 3100
```

**注意：**

- 通知权限要求 **https 或 localhost**。用 http 的临时地址打开时，`Notification` 会不可用，界面会显示「这个浏览器不支持系统通知」——**这时候到点提醒走的是兔子说话那条路，功能不丢**。
- 演示前把 `.env` 里的 `MEDAI_DEMO_AI=1` 确认一下：断网也能答，别现场等大模型超时。

---

## 2. 方案 B：云服务器 + Docker（推荐）

### 2.1 机器

- 2 核 2G，系统盘 40G，Ubuntu 22.04 / Debian 12
- 开放 80 / 443（不要开 3100 到公网，让 Caddy 反代）

### 2.2 目录约定（关键：别把数据放在镜像里）

```
/opt/medai/
├── app/                 # 代码（git clone）
├── data/
│   ├── dev.db           # SQLite 数据库（挂给容器）
│   └── uploads/         # 用户上传的病历/化验单（挂给容器）
└── public-uploads/      # 头像（挂给容器）
```

`docker-compose.yml` 已经把这三处挂出来了。**这三处丢了 = 数据没了**，备份只需要 `tar` 这三个路径。

### 2.3 起服务

```bash
git clone <repo> /opt/medai/app && cd /opt/medai/app
cp .env.example .env && vim .env      # 填 SESSION_SECRET / DEEPSEEK_API_KEY
docker compose up -d --build
docker compose logs -f app
```

首次启动会自动 `prisma db push`（见 Dockerfile 的 CMD）并建表；想灌演示数据再单独跑 `docker compose exec app npx tsx prisma/seed.ts`。

### 2.4 HTTPS（Caddy 两行）

```caddyfile
medai.example.com {
    reverse_proxy app:3100
    encode gzip
}
```

Caddy 会自动申请证书。用 Nginx 也行，记得：

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
client_max_body_size 20m;     # 上传病历照片，别用默认 1m
proxy_read_timeout 300s;      # 流式回答会跑很久，超时别设太短
```

### 2.5 备份（答辩前一天一定要做一次）

数据库现在是 **WAL 模式**，真实数据可能还在 `dev.db-wal` 里没落盘 —— 这时候 `cp dev.db`
拷出来的库看着完整、其实丢了最近写入，**不能用来备份**。

用项目自带的脚本，它走 SQLite 的 `VACUUM INTO`，导出的是**一致性快照**，服务运行中也能跑：

```bash
npm run db:backup                 # → backups/medai-<时间戳>.db，默认留最近 10 份
npm run db:backup -- --keep 20    # 改保留份数
npm run db:backup -- --dir D:/bak # 换目录
```

脚本会顺手校验：导出的库能打开、表都在，并打印「几个账号 / 几份档案 / 几条用药」。

容器部署时，再补一份上传文件的归档（脚本只管数据库）：

```bash
docker compose exec app node scripts/backup-db.mjs
tar czf medai-uploads-$(date +%F).tgz data/uploads/ public-uploads/
```

> 早先 `prisma/` 目录里躺着一批 `dev.db.bak-<时间>` 手工备份，那是历史遗留。
> 它们同时也是**隐私风险**：分发包和 Docker 镜像都不允许带上（见 2.6 的红线检查）。

### 2.6 打个离线包带走

```bash
npm run pack          # → dist/medai-<版本>-<日期>.tar.gz（约 14 MB）
```

包里是「解压就能跑」的东西：生产构建产物、静态资源、`prisma/schema.prisma`、
OCR 中文语言包、自检脚本、文档、`Start MedAI.bat`。**不含** `node_modules`
（几百 MB，且 Windows 装的在 Linux 上不能用），目标机器按提示 `npm ci` 重装。

打包脚本有三条硬规则，写成代码而不是靠记性：

| 不进包 | 原因 |
| --- | --- |
| `.env` | 模型 Key + 会话签名密钥，泄露等于把账号交出去 |
| `prisma/dev.db*` | 真实档案、就诊记录；连 `.bak-*` 一起挡 |
| `data/uploads/` | 用户上传的病历照片、化验单 |

打完还会**再扫一遍压缩包**做兜底（任何路径里出现 `dev.db`、`backups/`、
`node_modules/` 都直接判定失败）。这条兜底不是摆设 —— 第一版排除正则只写了
`dev\.db(-.*)?`，漏掉点号命名的 `dev.db.bak-20261022`，真实档案被打进了包，
就是靠复查拦下来的。

### 2.7 单进程 SQLite 为什么扛得住

`src/lib/db.ts` 在装配 Prisma 时做了两件事，都不是「理论上更优雅」而是有具体场景：

1. **连接池压到 1 条**（`connection_limit=1`）。SQLite 的写入本来就是整库串行的，
   连接开得越多越容易撞 `SQLITE_BUSY`。全家几台手机同时点打卡就是撞这个。
   压到一条，写入在进程内排队，反而更少报错。
2. **切 WAL** + `busy_timeout=5000` + `synchronous=NORMAL`。默认的 DELETE 模式下一个
   写事务锁住整库，读只能等；WAL 让读走自己的快照，打卡和翻档案能同时进行。
   `synchronous=NORMAL` 在 WAL 下断电最多丢最后一个事务，比 FULL 快很多。

这些设置**只在 `DATABASE_URL` 以 `file:` 开头时生效**，换成 Postgres 会自动跳过。

另一个加固：登录接口按「IP 8 次 / 账号 5 次每 15 分钟」限流（`src/lib/rate-limit.ts`）。
scrypt 校验一次要几十毫秒，没有上限时每一发都在烧 CPU。限流表在进程内存里，
**单进程部署够用；一旦起多实例必须换成 Redis 或库表计数**，否则每个实例各算各的。

---

## 3. 环境变量清单

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | 默认 `file:./prisma/dev.db`；容器里用 `file:/data/dev.db` |
| `SESSION_SECRET` | 是 | 会话签名密钥，**上线必须换**，`openssl rand -base64 32` |
| `DEEPSEEK_API_KEY` | 是 | 不填就只能用演示模式 |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | 否 | 换供应商时用 |
| `MEDAI_DEMO_AI` | 否 | `1` = 不调模型，走本地话术（断网演示用） |
| `MEDAI_CHAT_RETENTION_DAYS` | 否 | 聊天原文保留天数，默认 30；**小结和结论不受影响** |

---

## 4. 答辩前 checklist

- [ ] `npm run build` 通过，`next start` 能起
- [ ] 演示账号能登录，档案、用药、问诊记录都在
- [ ] 木牌上有数据（没有就说明演示账号的药都被停用了）
- [ ] 「投影视图」截一张图存进 PPT —— 现场网络抽风时的备用素材
- [ ] 就诊摘要能导出 PDF（Chrome 打印 → 另存为 PDF）
- [ ] 提醒功能：点「开启」后等一个到点时间，看兔子是否说话（系统通知被拒也不影响）
- [ ] `npm run db:backup` 存一份（**不要用 `cp` 拷 `dev.db`**，WAL 下会丢最近写入）
- [ ] 要换机器演示：`npm run pack`，把 `dist/` 那个 tar.gz 拷走

---

## 5. 真要换 PostgreSQL 的时候

仓库里有两份 schema，区别只在 `provider`：

```bash
# 1. 生成 Postgres 版客户端
npx prisma generate --schema=prisma/schema.postgres.prisma

# 2. 指向新库并建表
DATABASE_URL="postgresql://user:pass@host:5432/medai" \
  npx prisma db push --schema=prisma/schema.postgres.prisma

# 3. 导数据（Prisma 不给跨库迁移，用脚本逐表读 SQLite 写 Postgres）
npx tsx scripts/migrate-to-pg.ts

# 4. 代码侧：把 import 的 @prisma/client 指向新生成目录，或临时改 schema.prisma
#    的 provider 为 postgresql 后重新 generate —— 二选一，别同时存在两份客户端
```

需要注意的字段差异（都已规避，但迁移时要确认）：

- 日期：本项目统一存 `DateTime`，SQLite 里实际是整数时间戳，Postgres 是 `timestamp`，转换脚本里按 `new Date(x)` 传；
- `String` 上没加 `@db.Text`，Postgres 里默认 `varchar(191)` 会截断长文本 —— **迁移前必须给 `Message.content`、`Consultation.summary`、`Attachment.text`、`Note.content` 补 `@db.Text`**；
- 大小写敏感：SQLite 的 `LIKE` 默认不区分大小写，Postgres 区分，知识库搜索要做 `mode: "insensitive"`。

`scripts/migrate-to-pg.ts` 目前**没有写**——真到那一步再补，别提前造一个没测过的迁移脚本。
