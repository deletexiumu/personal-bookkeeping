# syntax=docker/dockerfile:1
# 陶朱簿后端镜像。构建上下文是仓库根目录：docker build -f server/Dockerfile .

# ---- 构建阶段：编译 TypeScript，并打出只含生产依赖的目录 ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @taozhubu/server
COPY server/ server/
RUN pnpm --filter @taozhubu/server build
# deploy 只装生产依赖（hono、drizzle、postgres、pglite、zod），不带前端的依赖
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm --filter @taozhubu/server deploy --prod /out

# ---- 运行阶段 ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/drizzle ./drizzle
COPY --from=build /out/dist ./dist
# 不配 DATABASE_URL 时，内嵌数据库的数据存在 /data，需要挂载持久化目录（属主 uid 1000）
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:8787/api/healthz || exit 1
CMD ["node", "dist/main.js"]
