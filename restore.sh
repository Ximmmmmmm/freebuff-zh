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

cp "${BK}/app.asar" "${INSTALL}/resources/app.asar"
rm -rf "${INSTALL}/resources/orchestrator/ui"
cp -r "${BK}/ui" "${INSTALL}/resources/orchestrator/ui"
echo "已从 ${BK} 还原英文原版。重启应用生效。"
