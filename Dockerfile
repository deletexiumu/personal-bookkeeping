# syntax=docker/dockerfile:1

# ---- 构建阶段：编译 Web 前端 ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
# 可选：部署在子路径时传入，例如 --build-arg BASE_PATH=/ledger/
ARG BASE_PATH=/
ENV BASE_PATH=${BASE_PATH}
RUN pnpm build

# ---- 运行阶段：非 root 的 nginx 托管静态文件 ----
FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
