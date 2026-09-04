#!/usr/bin/env bash
# Apply the 汉化 (Chinese localization) build to the installed Freebuff Desktop.
# - Backs up the current app.asar and ui/ to <install>/resources/hanhua-backup-<timestamp>/
# - Replaces resources/app.asar and resources/orchestrator/ui/
# Run from anywhere:  bash apply.sh
set -euo pipefail

INSTALL="${LOCALAPPDATA}/Programs/@codebufffreebuff-desktop"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# optional: source dir of the localized build (defaults to this repo's output/)
OUT="${1:-${HERE}/output}"

if [ ! -f "${OUT}/app.asar" ] || [ ! -d "${OUT}/ui" ]; then
  echo "ERROR: ${OUT}/app.asar or ${OUT}/ui missing — run the localization build first." >&2
  exit 1
fi
if [ ! -f "${INSTALL}/resources/app.asar" ]; then
  echo "ERROR: installed app not found at ${INSTALL}" >&2
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
BK="${INSTALL}/resources/hanhua-backup-${TS}"
# 备份链必须保持英文原版——build.sh / remap 的回归测试都拿最新备份当 pristine。
# 装机已是汉化版时不再重复备份，否则汉化产物会被当成"原版"污染备份链。
if grep -q '<html lang="zh-CN">' "${INSTALL}/resources/orchestrator/ui/index.html" 2>/dev/null; then
  echo "当前装机已是汉化版，跳过备份（保留既有英文原版备份，避免污染备份链）。"
else
  mkdir -p "${BK}"
  cp "${INSTALL}/resources/app.asar" "${BK}/app.asar"
  cp -r "${INSTALL}/resources/orchestrator/ui" "${BK}/ui"
  echo "Backed up current files to: ${BK}"
fi

cp "${OUT}/app.asar" "${INSTALL}/resources/app.asar"
# 覆盖式更新，避免在应用运行中删除整目录被占用（device busy）
cp "${OUT}/ui/index.html" "${INSTALL}/resources/orchestrator/ui/index.html"
mkdir -p "${INSTALL}/resources/orchestrator/ui/assets"
cp -r "${OUT}/ui/assets/." "${INSTALL}/resources/orchestrator/ui/assets/"
echo "汉化已应用：app.asar 与 ui/ 已替换。"
echo "重启 Freebuff 桌面应用即可看到中文界面。"
