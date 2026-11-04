#!/usr/bin/env bash
# 陶朱簿部署与更新脚本，放在服务器的 /opt/taozhubu/。
#   手动：bash /opt/taozhubu/deploy.sh [标签]      标签默认 edge
#   CI：经 SSH 强制命令调用，标签取自 SSH_ORIGINAL_COMMAND（如 sha-1a2b3c4）
# 流程：校验标签 → 拉镜像 → 重建容器 → 等健康检查 → 不通过就回滚到上一个标签 → 清理旧镜像。
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

IMAGE=ghcr.io/deletexiumu/personal-bookkeeping
CONTAINER=taozhubu-web
tag="${1:-${SSH_ORIGINAL_COMMAND:-edge}}"

if [[ ! "$tag" =~ ^(edge|latest|sha-[0-9a-f]{7,40}|[0-9]+\.[0-9]+(\.[0-9]+)?)$ ]]; then
  echo "拒绝部署：标签不合法：$tag" >&2
  exit 2
fi

# 同一时间只跑一次部署
exec 9>/run/lock/taozhubu-deploy.lock
flock -w 300 9

prev="$tag"
if [[ -f .env ]]; then
  prev="$(sed -n 's/^TAOZHUBU_TAG=//p' .env)"
  prev="${prev:-$tag}"
fi

up() {
  echo "TAOZHUBU_TAG=$1" > .env
  docker compose pull -q
  docker compose up -d --remove-orphans
}

wait_healthy() {
  local s=missing
  for _ in $(seq 1 30); do
    s="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo missing)"
    [[ "$s" == healthy ]] && return 0
    sleep 3
  done
  echo "健康检查未通过，当前状态：$s" >&2
  return 1
}

echo "部署 $IMAGE:$tag（上一个：$prev）"
up "$tag"
if ! wait_healthy; then
  docker logs --tail 50 "$CONTAINER" >&2 || true
  if [[ "$prev" != "$tag" ]]; then
    echo "回滚到 $prev" >&2
    up "$prev"
    wait_healthy || true
  fi
  exit 1
fi

# 只保留当前和上一个标签的镜像
docker images "$IMAGE" --format '{{.Tag}}' \
  | grep -vxF -e "$tag" -e "$prev" -e '<none>' \
  | xargs -r -I{} docker rmi "$IMAGE:{}" >/dev/null 2>&1 || true
docker image prune -f \
  --filter "label=org.opencontainers.image.source=https://github.com/deletexiumu/personal-bookkeeping" \
  >/dev/null 2>&1 || true

echo "部署完成：$(docker inspect -f '{{.Config.Image}} {{.State.Health.Status}}' "$CONTAINER")"
