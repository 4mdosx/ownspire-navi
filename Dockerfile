# node:24-bookworm-slim as of 2026-09-24. Manifest list digest; amd64 image is
# sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && npm prune --omit=dev

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runner

WORKDIR /app

ARG OWNSPIRE_NAVI_VERSION=dev
ENV NODE_ENV=production
ENV PORT=5500
ENV OWNSPIRE_NAVI_VERSION=$OWNSPIRE_NAVI_VERSION

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/next.config.js ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
# ⚠️ 迁移文件是**运行时**读的（`getDatabase()` 里 `migrate()`），不是构建期资源
# —— 少了这一层，容器起来第一次请求就会在 migrate 上 500。
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public

USER node

EXPOSE 5500

CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "5500"]
