#!/usr/bin/env bash
# Restore the original (pre-localization) files from the most recent backup.
# Run:  bash restore.sh
set -euo pipefail

INSTALL="${LOCALAPPDATA}/Programs/@codebufffreebuff-desktop"
BK="$(ls -1dt "${INSTALL}/resources"/hanhua-backup-* 2>/dev/null | head -1 || true)"

if [ -z "${BK}" ] || [ ! -f "${BK}/app.asar" ]; then
  echo "未找到任何备份（resources/hanhua-backup-*）。" >&2
  exit 1
fi

# 应用在跑时 resources 被占用：下面的 `rm -rf ui` 会把 ui 删掉一半、后面的 cp 再
# 失败（apply.sh 只覆盖不删，所以它没这问题），留下「asar 是英文 + ui 半套」的装机。
# 直接挡住，让用户先退出应用。tasklist 的 //FI 是 Git Bash 下避免路径转换的写法。
if tasklist //FI "IMAGENAME eq Freebuff.exe" 2>/dev/null | grep -q 'Freebuff\.exe'; then
  echo "ERROR: 检测到 Freebuff 正在运行。" >&2
  echo "  还原要删改 resources/orchestrator/ui，应用占着文件时可能只删一半，留下半英文装机。" >&2
  echo "  请先退出 Freebuff（含多开实例）再运行本脚本。" >&2
  exit 1
fi

cp "${BK}/app.asar" "${INSTALL}/resources/app.asar"
rm -rf "${INSTALL}/resources/orchestrator/ui"
cp -r "${BK}/ui" "${INSTALL}/resources/orchestrator/ui"
echo "已从 ${BK} 还原英文原版。重启应用生效。"
