#!/usr/bin/env bash
# Rebuild the localized output/ from a pristine (English) Freebuff Desktop.
#
# Pipeline (verified byte-for-byte against the shipped output/):
#   1. extract pristine app.asar
#   2. apply the translation dictionary (dict.json) via tools/apply.js
#   3. apply the hand-written patches (patches/electron-*.patch) via git apply
#   4. repack app.asar; for ui/: patch index.html + apply the dictionary to the bundles
#
# Usage:
#   bash build.sh                          # auto-pick the newest resources/hanhua-backup-* in the install dir
#   bash build.sh <app.asar> <ui-dir>      # use explicit pristine sources
#
# Output goes to output/ (app.asar + ui/). Install with: bash apply.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL="${LOCALAPPDATA}/Programs/@codebufffreebuff-desktop"

# --- resolve pristine sources ------------------------------------------------
if [ -n "${1:-}" ]; then
  PRISTINE_ASAR="$1"
  PRISTINE_UI="${2:-}"
else
  BK="$(ls -1dt "${INSTALL}/resources"/hanhua-backup-* 2>/dev/null | head -1 || true)"
  if [ -z "${BK}" ] || [ ! -f "${BK}/app.asar" ]; then
    echo "ERROR: no pristine source found." >&2
    echo "  Pass them explicitly:  bash build.sh <app.asar> <ui-dir>" >&2
    echo "  Or apply the localization once so a backup exists under resources/hanhua-backup-*/." >&2
    exit 1
  fi
  PRISTINE_ASAR="${BK}/app.asar"
  PRISTINE_UI="${BK}/ui"
fi
if [ ! -f "${PRISTINE_ASAR}" ]; then
  echo "ERROR: ${PRISTINE_ASAR} not found." >&2
  exit 1
fi
if [ -n "${PRISTINE_UI}" ] && [ ! -d "${PRISTINE_UI}" ]; then
  echo "ERROR: ${PRISTINE_UI} is not a directory." >&2
  exit 1
fi
echo "Pristine app.asar: ${PRISTINE_ASAR}"
[ -n "${PRISTINE_UI}" ] && echo "Pristine ui dir:   ${PRISTINE_UI}"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo
echo "== 1/4 解包主进程 asar =="
npx -y @electron/asar extract "${PRISTINE_ASAR}" "${WORK}/main"

echo "== 2/4 套用翻译词典 (dict.json) =="
for f in "${WORK}/main/electron/"*.cjs "${WORK}/main/electron/"*.html "${WORK}/main/package.json"; do
  node "${HERE}/tools/apply.js" "$f" --write >/dev/null 2>&1 || true
done

echo "== 3/4 套用人工补丁 (patches/) =="
(cd "${WORK}/main" && for p in "${HERE}"/patches/electron-*.patch; do git apply -p2 "$p"; done)

echo "== 4/4 重打包 asar 并处理 ui =="
mkdir -p "${HERE}/output"
npx -y @electron/asar pack "${WORK}/main" "${HERE}/output/app.asar"

if [ -n "${PRISTINE_UI}" ]; then
  rm -rf "${HERE}/output/ui"
  mkdir -p "${HERE}/output/ui/assets"
  cp "${PRISTINE_UI}/index.html" "${HERE}/output/ui/index.html"
  (cd "${HERE}/output" && git apply -p2 "${HERE}/patches/ui-index.html.patch")
  cp -r "${PRISTINE_UI}/assets/." "${HERE}/output/ui/assets/"
  # apply the dictionary ONLY to the main bundle (the one index.html loads):
  # other assets are syntax-highlighting grammars whose keys ("Command", "move", …)
  # are internal identifiers and must stay English.
  MAIN_BUNDLE="$(sed -n 's/.*src="\.\/\(assets\/[^"]*\.js\)".*/\1/p' "${HERE}/output/ui/index.html" | head -1)"
  if [ -n "${MAIN_BUNDLE}" ] && [ -f "${HERE}/output/ui/${MAIN_BUNDLE}" ]; then
    node "${HERE}/tools/apply.js" "${HERE}/output/ui/${MAIN_BUNDLE}" --write >/dev/null 2>&1 || true
  else
    echo "  ! 未在 index.html 中找到主 bundle，跳过词典应用" >&2
  fi
else
  echo "  (no ui dir given — skipping ui)"
fi

echo
echo "完成：output/app.asar 与 output/ui/ 已生成。"
echo "安装：bash apply.sh"
echo "注意：asar 内容与 Release 产物一致；容器头部可能因 @electron/asar 版本不同有细微差异，不影响运行。"
