#!/usr/bin/env bash
# 陶朱簿部署与更新脚本，放在服务器的 /opt/taozhubu/。
#   手动：bash /opt/taozhubu/deploy.sh [标签]      标签默认 edge
#   CI：经 SSH 强制命令调用，标签取自 SSH_ORIGINAL_COMMAND（如 sha-1a2b3c4）
# 流程：校验标签 → 拉镜像 → 重建容器 → 等健康检查 → 不通过就回滚到上一个标签 → 清理旧镜像。
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

# Web 前端和后端 API 两个镜像，标签相同
IMAGES=(ghcr.io/deletexiumu/personal-bookkeeping ghcr.io/deletexiumu/personal-bookkeeping-api)
CONTAINERS=(taozhubu-web taozhubu-api)
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

# 后端内嵌数据库的数据目录，容器里以 uid 1000（node）运行
install -d -o 1000 -g 1000 -m 700 data

up() {
  echo "TAOZHUBU_TAG=$1" > .env
  docker compose pull -q
  docker compose up -d --remove-orphans
}

wait_healthy() {
  local c s
  for c in "${CONTAINERS[@]}"; do
    s=missing
    for _ in $(seq 1 30); do
      s="$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null || echo missing)"
      [[ "$s" == healthy ]] && break
      sleep 3
    done
    if [[ "$s" != healthy ]]; then
      echo "$c 健康检查未通过，当前状态：$s" >&2
      docker logs --tail 50 "$c" >&2 || true
      return 1
    fi
  done
}

echo "部署 $tag（上一个：$prev）"
up "$tag"
if ! wait_healthy; then
  if [[ "$prev" != "$tag" ]]; then
    echo "回滚到 $prev" >&2
    up "$prev"
    wait_healthy || true
  fi
  exit 1
fi

# 只保留当前和上一个标签的镜像
for image in "${IMAGES[@]}"; do
  docker images "$image" --format '{{.Tag}}' \
    | grep -vxF -e "$tag" -e "$prev" -e '<none>' \
    | xargs -r -I{} docker rmi "$image:{}" >/dev/null 2>&1 || true
done
docker image prune -f \
  --filter "label=org.opencontainers.image.source=https://github.com/deletexiumu/personal-bookkeeping" \
  >/dev/null 2>&1 || true

for c in "${CONTAINERS[@]}"; do
  echo "部署完成：$(docker inspect -f '{{.Config.Image}} {{.State.Health.Status}}' "$c")"
done
