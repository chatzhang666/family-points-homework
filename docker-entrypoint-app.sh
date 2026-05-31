#!/bin/sh
set -eu

SEED_DB="/app/seed/family-points.db"
TARGET_DIR="/app/data"
TARGET_DB="$TARGET_DIR/family-points.db"

mkdir -p "$TARGET_DIR"

should_seed=0
if [ ! -f "$TARGET_DB" ]; then
  should_seed=1
else
  size=$(wc -c < "$TARGET_DB")
  if [ "${size:-0}" -le 32768 ]; then
    should_seed=1
  fi
fi

if [ "$should_seed" -eq 1 ] && [ -f "$SEED_DB" ]; then
  rm -f "$TARGET_DIR/family-points.db" "$TARGET_DIR/family-points.db-shm" "$TARGET_DIR/family-points.db-wal"
  cp "$SEED_DB" "$TARGET_DB"
fi

exec "$@"
