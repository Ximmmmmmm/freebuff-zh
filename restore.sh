#!/usr/bin/env bash
# Restore the original (pre-localization) files from the most recent backup.
# Also removes the "AI 默认中文回复" preference this pack wrote into ~/.AGENTS.md.
# Run:  bash restore.sh
set -euo pipefail

INSTALL="${LOCALAPPDATA}/Programs/@codebufffreebuff-desktop"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/lang_pref.sh
. "${HERE}/tools/lang_pref.sh"
BK="$(ls -1dt "${INSTALL}/resources"/hanhua-backup-* 2>/dev/null | head -1 || true)"

if [ -z "${BK}" ] || [ ! -f "${BK}/app.asar" ]; then
  echo "未找到任何备份（resources/hanhua-backup-*）。" >&2
  echo "若只想移除 ~/.AGENTS.md 里的语言偏好，运行： bash tools/lang_pref.sh uninstall" >&2
  exit 1
fi

cp "${BK}/app.asar" "${INSTALL}/resources/app.asar"
rm -rf "${INSTALL}/resources/orchestrator/ui"
cp -r "${BK}/ui" "${INSTALL}/resources/orchestrator/ui"
lang_pref_uninstall
echo "已从 ${BK} 还原英文原版。重启应用生效。"
