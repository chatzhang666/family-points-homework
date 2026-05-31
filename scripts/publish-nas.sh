#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
REGISTRY="${NAS_REGISTRY:-127.0.0.1:5500}"
IMAGE_NAME="${NAS_IMAGE_NAME:-family-points}"
STABLE_TAG="${NAS_STABLE_TAG:-nas-stable}"
VERSION_TAG="${1:-$(date '+%Y%m%d-%H%M%S')}"

cd "$ROOT_DIR"

sqlite3 data/family-points.db "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null

LOCAL_IMAGE="$IMAGE_NAME:$VERSION_TAG"
REMOTE_VERSION_IMAGE="$REGISTRY/$IMAGE_NAME:$VERSION_TAG"
REMOTE_STABLE_IMAGE="$REGISTRY/$IMAGE_NAME:$STABLE_TAG"

docker buildx build --platform linux/amd64 --load -t "$LOCAL_IMAGE" .
docker tag "$LOCAL_IMAGE" "$REMOTE_VERSION_IMAGE"
docker tag "$LOCAL_IMAGE" "$REMOTE_STABLE_IMAGE"
docker push "$REMOTE_VERSION_IMAGE"
docker push "$REMOTE_STABLE_IMAGE"

cat <<EOF
已发布 NAS 镜像：
- 版本标签：$REMOTE_VERSION_IMAGE
- 稳定标签：$REMOTE_STABLE_IMAGE

后续更新步骤：
1. 在这台 Mac 运行：npm run nas:publish
2. 在威联通 Container Station 提取：$REMOTE_STABLE_IMAGE
3. 停止并删除旧的 family-points 容器（不要删除 /Public/family-points/data）
4. 用 docker-compose.nas.yml 或同样配置重新创建 family-points 容器
EOF
