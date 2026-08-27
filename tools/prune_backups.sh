#!/usr/bin/env bash
# 清理装机目录里累积的 hanhua-backup-*（每次 apply.sh 都会新建一份）。
# 默认保留最近 3 份；只打印将删除的列表，加 --yes 才真删。
#
# 用法：
#   bash tools/prune_backups.sh             # 预览（保留最近 3 份）
#   bash tools/prune_backups.sh 5           # 预览（保留最近 5 份）
#   bash tools/prune_backups.sh 3 --yes     # 实际删除
set -euo pipefail

RES="${LOCALAPPDATA}/Programs/@codebufffreebuff-desktop/resources"
KEEP="${1:-3}"
YES="${2:-}"

if ! [[ "${KEEP}" =~ ^[0-9]+$ ]]; then
  echo "用法: bash tools/prune_backups.sh [保留份数=3] [--yes]" >&2
  exit 1
fi

dirs=()
while IFS= read -r d; do
  [ -n "$d" ] && dirs+=("$d")
done < <(ls -1dt "${RES}"/hanhua-backup-* 2>/dev/null || true)

total=${#dirs[@]}
if [ "$total" -le "$KEEP" ]; then
  echo "共 ${total} 份备份，不超过保留上限 ${KEEP}，无事可做。"
  exit 0
fi

echo "共 ${total} 份，保留最新 ${KEEP} 份，以下将删除:"
rc=0
for d in "${dirs[@]:${KEEP}}"; do
  echo "  $(basename "$d")  ($(du -sh "$d" 2>/dev/null | cut -f1))"
  if [ "${YES}" = "--yes" ]; then
    rm -rf "$d" || rc=1
  fi
done
if [ "${YES}" = "--yes" ]; then
  [ "$rc" -eq 0 ] && echo "已删除。" || { echo "部分删除失败。" >&2; exit 1; }
else
  echo "（预览模式，未删除。确认无误后追加 --yes 执行）"
fi
