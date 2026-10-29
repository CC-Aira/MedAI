# MedAI 生产镜像
#
# 用 bookworm-slim 而不是 alpine：tesseract.js / pdf-parse 这些包依赖 glibc，
# alpine(musl) 上出现过 worker 起不来的问题，省那点体积不值。
#
# 分三段：装依赖 → 构建 → 只带运行需要的东西。

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# prisma 引擎需要 openssl
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# build 阶段不连库，但 prisma generate 需要这个变量存在
ENV DATABASE_URL="file:/app/data/dev.db"
RUN npx prisma generate && npx next build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    DATABASE_URL="file:/app/data/dev.db"

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 运行时要的东西：node_modules（含 prisma CLI）、构建产物、静态资源、
# schema、以及 OCR 的中文语言包（离线识别用，不挂卷也能跑）
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/data/tesseract ./data/tesseract
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts

RUN mkdir -p /app/data/uploads /app/public/uploads/avatars
VOLUME ["/app/data", "/app/public/uploads"]

EXPOSE 3100

# db push 是幂等的：表已经在了就什么都不做，第一次跑自动建表
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx next start -p 3100"]
