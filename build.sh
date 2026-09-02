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
#   bash build.sh                          # auto-pick pristine: newest hanhua-backup-*,
#                                          # or the installed English files when no backup exists
#   bash build.sh <app.asar> <ui-dir>      # use explicit pristine sources
#
# Output goes to output/ (app.asar + ui/). Install with: bash apply.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL="${LOCALAPPDATA}/Programs/@codebufffreebuff-desktop"

# --- resolve pristine sources ------------------------------------------------
# Priority: explicit args > newest hanhua-backup-* > installed English files.
# The last case is what makes a first-ever build work (no backup exists before
# the first apply). It is refused when the installed ui is already localized:
# without a backup there is no proof the installed files are pristine English.
if [ -n "${1:-}" ]; then
  PRISTINE_ASAR="$1"
  PRISTINE_UI="${2:-}"
else
  BK="$(ls -1dt "${INSTALL}/resources"/hanhua-backup-* 2>/dev/null | head -1 || true)"
  if [ -n "${BK}" ] && [ -f "${BK}/app.asar" ]; then
    PRISTINE_ASAR="${BK}/app.asar"
    PRISTINE_UI="${BK}/ui"
  elif [ -f "${INSTALL}/resources/app.asar" ]; then
    if grep -q '<html lang="zh-CN">' "${INSTALL}/resources/orchestrator/ui/index.html" 2>/dev/null; then
      echo "ERROR: 安装目录已是汉化版且没有 hanhua-backup-* 备份，无法确定英文原版。" >&2
      echo "  先 bash restore.sh 还原英文再构建；或显式指定原版：bash build.sh <app.asar> <ui-dir>" >&2
      exit 1
    fi
    PRISTINE_ASAR="${INSTALL}/resources/app.asar"
    PRISTINE_UI="${INSTALL}/resources/orchestrator/ui"
    echo "未找到 hanhua-backup-*，改用安装目录当前的英文原版作 pristine。"
  else
    echo "ERROR: no pristine source found." >&2
    echo "  本机未安装 Freebuff 且没有备份。请显式指定原版：bash build.sh <app.asar> <ui-dir>" >&2
    exit 1
  fi
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
  node "${HERE}/tools/apply.js" "$f" --write --quiet
done

echo "== 3/4 套用人工补丁 (patches/) =="
(cd "${WORK}/main" && for p in "${HERE}"/patches/electron-*.patch; do
  if ! git apply -p1 "$p"; then
    echo "ERROR: 补丁未干净套用：$(basename "$p")（原版文件与补丁预期不符？需重新 gen_patches）" >&2
    exit 1
  fi
done)

echo "== 语法校验补丁后的主进程文件 =="
for f in "${WORK}/main/electron/"*.cjs; do
  if ! node --check "$f"; then
    echo "ERROR: 主进程文件存在语法错误：$(basename "$f") —— 补丁悬空模板等会引发 v0.0.72 式启动崩溃，已中止构建" >&2
    exit 1
  fi
done

echo "== 4/4 重打包 asar 并处理 ui =="
mkdir -p "${HERE}/output"
npx -y @electron/asar pack "${WORK}/main" "${HERE}/output/app.asar"

if [ -n "${PRISTINE_UI}" ]; then
  rm -rf "${HERE}/output/ui"
  mkdir -p "${HERE}/output/ui/assets"
  cp "${PRISTINE_UI}/index.html" "${HERE}/output/ui/index.html"
  # Apply UI translations directly (git apply has CRLF issues on Windows with .gitattributes)
  node "${HERE}/tools/apply_ui_patch.js" "${HERE}/output/ui/index.html"
  # 汉化包版本戳：控制器用 instaled/output 产物里的这个 meta 比对是否需要更新
  PACK_VERSION="$(node -e 'const m = require(process.argv[1]); console.log(m.packVersion || m.targetVersion)' "${HERE}/manifest.json")"
  PACK_VERSION="${PACK_VERSION}" node -e 'const fs = require("fs"); const f = process.argv[1]; let s = fs.readFileSync(f, "utf8"); if (!s.includes("hanhua-pack")) { s = s.replace(/<head>/i, "<head>\n<meta name=\"hanhua-pack\" content=\"" + process.env.PACK_VERSION + "\">"); fs.writeFileSync(f, s); }' "${HERE}/output/ui/index.html"
  cp -r "${PRISTINE_UI}/assets/." "${HERE}/output/ui/assets/"
  # apply the dictionary ONLY to the main bundle (the one index.html loads):
  # other assets are syntax-highlighting grammars whose keys ("Command", "move", …)
  # are internal identifiers and must stay English.
  MAIN_BUNDLE="$(sed -n 's/.*src="\.\/\(assets\/[^"]*\.js\)".*/\1/p' "${HERE}/output/ui/index.html" | head -1)"
  if [ -n "${MAIN_BUNDLE}" ] && [ -f "${HERE}/output/ui/${MAIN_BUNDLE}" ]; then
    APPLY_LOG="$(node "${HERE}/tools/apply.js" "${HERE}/output/ui/${MAIN_BUNDLE}" --write)"
    printf '%s\n' "${APPLY_LOG}"
    REPLACED="$(printf '%s' "${APPLY_LOG}" | sed -n 's/^replaced \([0-9][0-9]*\) occurrences.*/\1/p')"
    if [ -z "${REPLACED}" ] || [ "${REPLACED}" -eq 0 ]; then
      echo "ERROR: 词典对主 bundle 的替换次数为 0 —— 词典应用未生效（v0.0.70 式静默失败），已中止构建" >&2
      exit 1
    fi
    MISSED="$(printf '%s' "${APPLY_LOG}" | sed -n 's/^MISSED (\([0-9][0-9]*\) keys.*/\1/p')"
    if [ -n "${MISSED}" ] && [ "${MISSED}" -gt 0 ]; then
      echo "ERROR: 词典有 ${MISSED} 条未命中（MISSED 明细见上方日志）——原文可能随版本改写，请核对 dict.json 后重试，已中止构建" >&2
      exit 1
    fi
  else
    echo "  ! 未在 index.html 中找到主 bundle，跳过词典应用" >&2
  fi
else
  echo "  (no ui dir given — skipping ui)"
fi

echo
node "${HERE}/tools/postbuild.js" "${HERE}/output" --main-src "${WORK}/main" || {
  echo "ERROR: 构建产物自检未通过，output/ 不可靠。请勿安装。" >&2
  exit 1
}

echo
echo "完成：output/app.asar 与 output/ui/ 已生成。"
echo "安装：bash apply.sh"
echo "注意：asar 内容与 Release 产物一致；容器头部可能因 @electron/asar 版本不同有细微差异，不影响运行。"
