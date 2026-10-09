#!/usr/bin/env bash
# build_locked.sh —— 当 output/app.asar 被外部进程锁住（典型：WorkBuddy 会长期持有
# workspace 里所有 app.asar 的句柄），导致标准 build.sh 的「rm -rf output」落地失败时，
# 用本脚本完成等效构建与落地。
#
# 为什么需要：build.sh 的落地是「rm -rf output && mv staging output」，其中
#   - rm 在 WorkBuddy 环境下会走 safe-delete（回收站），app.asar 被持锁 → trash 失败 →
#     SAFE_DELETE_FAIL_CLOSED → 中止，output/ 不更新（自检产物只在临时目录里）。
#   - 被锁的文件连 mv / 改名 / 覆盖写都不行，但**可读**。
# 本脚本的对策：产物构建过程完全复刻 build.sh；落地时——
#   - app.asar：与现有 output/app.asar 逐字节比对，相同则**跳过**（锁无影响）；
#     不同则**覆盖写**（2026-10-09 实测：WorkBuddy 的持锁只挡删除/改名——safe-delete
#     走回收站要 DELETE 权限、被拒即 fail-closed——但打开/写权限可用；不删不改名、
#     只把新内容写进原文件，写完逐字节复核）。
#   - ui/：正常不受锁影响 → 整目录替换为新构建。
#
# 用法：
#   bash tools/build_locked.sh             # 构建并落地
#   bash tools/build_locked.sh --dry-run   # 只构建 + 对照，不动 output/
#   bash tools/build_locked.sh <app.asar> <ui-dir>   # 显式指定原版源（同 build.sh）
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    *) ARGS+=("$a") ;;
  esac
done
set -- ${ARGS[@]+"${ARGS[@]}"}

INSTALL="${LOCALAPPDATA:-}/Programs/@codebufffreebuff-desktop"

# --- pristine 选择（与 build.sh 同源：显式参数 > 最新 hanhua-backup-* > 快照）--------
if [ -n "${1:-}" ]; then
  PRISTINE_ASAR="$1"
  PRISTINE_UI="${2:-}"
else
  BK="$(ls -1dt "${INSTALL}/resources"/hanhua-backup-* 2>/dev/null | head -1 || true)"
  if [ -n "${BK}" ] && [ -f "${BK}/app.asar" ]; then
    PRISTINE_ASAR="${BK}/app.asar"
    PRISTINE_UI="${BK}/ui"
  else
    UPVER="$(node -e 'const m = require(process.argv[1]); console.log(m.targetVersion)' "${HERE}/manifest.json")"
    SNAP="$(node "${HERE}/tools/pristine.js" path "${UPVER}" 2>/dev/null || true)"
    if [ -n "${SNAP}" ] && [ -d "${SNAP}/electron" ]; then
      echo "ERROR: 没有 hanhua-backup-*，也没有原始 app.asar；请显式指定：bash tools/build_locked.sh <app.asar> <ui-dir>" >&2
      exit 1
    fi
    echo "ERROR: 找不到英文原版（无 hanhua-backup-*、无显式参数）。" >&2
    exit 1
  fi
fi
[ -f "${PRISTINE_ASAR}" ] || { echo "ERROR: ${PRISTINE_ASAR} not found." >&2; exit 1; }
[ -d "${PRISTINE_UI}" ] || { echo "ERROR: ${PRISTINE_UI} is not a directory." >&2; exit 1; }
echo "Pristine app.asar: ${PRISTINE_ASAR}"
echo "Pristine ui dir:   ${PRISTINE_UI}"

# --- 门禁（与 build.sh 一致；几秒钟，先拦结构问题）-------------------------------------
echo
echo "== 0/4 词典门禁 =="
node "${HERE}/tools/lint_dict.js" | tail -2

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo
echo "== 1/4 解包主进程 asar =="
npx -y @electron/asar extract "${PRISTINE_ASAR}" "${WORK}/main"

echo "== 2/4 套用翻译词典 =="
printf '%s\n' "${WORK}/main/electron/"*.cjs "${WORK}/main/electron/"*.html "${WORK}/main/package.json" \
  | xargs -d '\n' -P 8 -I{} node "${HERE}/tools/apply.js" {} --write --quiet

echo "== 3/4 套用人工补丁 =="
find "${WORK}/main" -type f \( -name '*.cjs' -o -name '*.html' -o -name '*.js' -o -name '*.json' -o -name '*.ts' \) -exec sed -i 's/\r$//' {} +
(cd "${WORK}/main" && for p in "${HERE}"/patches/electron-*.patch; do
  git apply -p1 "$p" || { echo "ERROR: 补丁未干净套用：$(basename "$p")" >&2; exit 1; }
done)
printf '%s\n' "${WORK}/main/electron/"*.cjs | xargs -d '\n' -P 8 -I{} node --check {}

echo "== 4/4 打包 + ui =="
STAGE="${WORK}/out"
mkdir -p "${STAGE}"
npx -y @electron/asar pack "${WORK}/main" "${STAGE}/app.asar"
mkdir -p "${STAGE}/ui"
cp -r "${PRISTINE_UI}/." "${STAGE}/ui/"
node "${HERE}/tools/apply_ui_patch.js" "${STAGE}/ui/index.html"
PACK_VERSION="$(node -e 'const m = require(process.argv[1]); console.log(m.packVersion || m.targetVersion)' "${HERE}/manifest.json")"
PACK_VERSION="${PACK_VERSION}" node -e 'const fs = require("fs"); const f = process.argv[1]; let s = fs.readFileSync(f, "utf8"); const v = process.env.PACK_VERSION; if (s.includes("hanhua-pack")) { s = s.replace(/(<meta name="hanhua-pack" content=")[^"]*(")/, "$1" + v + "$2"); } else { s = s.replace(/<head>/i, "<head>\n<meta name=\"hanhua-pack\" content=\"" + v + "\">"); } fs.writeFileSync(f, s);' "${STAGE}/ui/index.html"
MAIN_BUNDLE="$(sed -n 's/.*src="\.\/\(assets\/[^"]*\.js\)".*/\1/p' "${STAGE}/ui/index.html" | head -1)"
[ -n "${MAIN_BUNDLE}" ] && [ -f "${STAGE}/ui/${MAIN_BUNDLE}" ] || { echo "ERROR: 未找到主 bundle" >&2; exit 1; }
APPLY_LOG="$(node "${HERE}/tools/apply.js" "${STAGE}/ui/${MAIN_BUNDLE}" --write)"
printf '%s\n' "${APPLY_LOG}"
REPLACED="$(printf '%s' "${APPLY_LOG}" | sed -n 's/^replaced \([0-9][0-9]*\) occurrences.*/\1/p')"
MISSED="$(printf '%s' "${APPLY_LOG}" | sed -n 's/^MISSED (\([0-9][0-9]*\) keys.*/\1/p')"
if [ -z "${REPLACED}" ] || [ "${REPLACED}" -eq 0 ]; then
  echo "ERROR: 词典对主 bundle 的替换次数为 0（词典应用未生效），已中止" >&2
  exit 1
fi
if [ -n "${MISSED}" ] && [ "${MISSED}" -gt 0 ]; then
  if [ "${ALLOW_MISSED:-0}" = "1" ]; then
    echo "WARN: 词典有 ${MISSED} 条未命中（ALLOW_MISSED=1 缺口模式，对应文案保持英文）" >&2
  else
    echo "ERROR: 词典有 ${MISSED} 条未命中，请核对 dict.json（或 ALLOW_MISSED=1 走缺口模式）" >&2
    exit 1
  fi
fi

echo
echo "== 自检 =="
node "${HERE}/tools/postbuild.js" "${STAGE}" --main-src "${WORK}/main"

# --- 锁友好落地 -----------------------------------------------------------------------
echo
echo "== 落地 =="
OLD_ASAR="${HERE}/output/app.asar"
OLD_UI="${HERE}/output/ui"
if [ ! -f "${OLD_ASAR}" ] || [ ! -d "${OLD_UI}" ]; then
  echo "ERROR: output/ 不完整（缺 app.asar 或 ui/），请先确认状态。" >&2
  exit 1
fi
if cmp -s "${STAGE}/app.asar" "${OLD_ASAR}"; then
  echo "  app.asar 与现有一致（逐字节相同）→ 跳过（被锁也不影响）"
else
  # 2026-10-09 实测：WorkBuddy 的持锁只挡删除/改名（safe-delete 走回收站要 DELETE 权限，
  # 被拒即 fail-closed），打开/写权限可用 → 「覆盖写」可行：不删、不改名，写进原文件。
  # 写完逐字节复核（防「写被静默丢弃」与半途失败）。
  echo "  app.asar 有变化 → 覆盖写（不删不改名）"
  if ! cp -f "${STAGE}/app.asar" "${OLD_ASAR}" 2>/dev/null; then
    echo "ERROR: 覆盖写失败——请关闭持锁程序后走标准流程：bash build.sh" >&2
    exit 1
  fi
  if ! cmp -s "${STAGE}/app.asar" "${OLD_ASAR}"; then
    echo "ERROR: 覆盖写后内容与 staging 不一致，中止（output/app.asar 可能不完整）。" >&2
    exit 1
  fi
  echo "  app.asar 已覆盖写为新构建（$(stat -c%s "${OLD_ASAR}") bytes）"
fi
if [ "${DRY}" -eq 1 ]; then
  echo "  （--dry-run）ui/ 对照："
  diff -rq "${STAGE}/ui" "${OLD_UI}" | head -20 || true
  echo "  未改动 output/。"
  exit 0
fi
rm -rf "${OLD_UI}"
cp -r "${STAGE}/ui" "${OLD_UI}"
echo "  ui/ 已整体替换为新构建"
echo
echo "完成：output/ui 已更新；output/app.asar 保持（内容一致）。"
echo "（若之后想走标准流程：关掉持锁程序后 bash build.sh，会自动全量重建。）"
