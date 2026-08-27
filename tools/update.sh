#!/usr/bin/env bash
# 一键版本迁移：应用自动更新到新版本后跑一次，把能自动的都自动掉。
#
#   1/4 模板变量重映射：tools/remap.js 把 template 词典条目的 ${...} 变量名迁移到新 bundle
#   2/4 可复现构建：bash build.sh（内含语法校验 + 构建产物自检）
#   3/4 残留扫描：leftover / prose / uipos 扫描构建出的主 bundle
#   4/4 汇总：打印剩余人工事项清单，扫描全文归档到 work/
#
# 之后只差两步：把报告里的新增文案补进 dict.json（重跑 build），再 bash apply.sh 安装。
#
# 用法：
#   bash tools/update.sh                     # 自动取安装目录最新的 hanhua-backup-* 作原版
#   bash tools/update.sh <app.asar> <ui-dir> # 显式指定原版
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL="${LOCALAPPDATA}/Programs/@codebufffreebuff-desktop"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="${HERE}/work/update-${STAMP}.txt"

mkdir -p "${HERE}/work"

# --- 解析原版（与 build.sh 相同的逻辑）----------------------------------------
if [ -n "${1:-}" ]; then
  PRISTINE_ASAR="$1"
  PRISTINE_UI="${2:-}"
else
  BK="$(ls -1dt "${INSTALL}/resources"/hanhua-backup-* 2>/dev/null | head -1 || true)"
  if [ -z "${BK}" ] || [ ! -f "${BK}/app.asar" ]; then
    echo "ERROR: 找不到原版。先更新应用并跑一次 apply.sh 生成备份，或显式传入路径。" >&2
    exit 1
  fi
  PRISTINE_ASAR="${BK}/app.asar"
  PRISTINE_UI="${BK}/ui"
fi
[ -f "${PRISTINE_ASAR}" ] || { echo "ERROR: ${PRISTINE_ASAR} 不存在" >&2; exit 1; }
if [ -n "${PRISTINE_UI}" ]; then
  [ -d "${PRISTINE_UI}" ] || { echo "ERROR: ${PRISTINE_UI} 不是目录" >&2; exit 1; }
fi

echo "原版 app.asar: ${PRISTINE_ASAR}"
echo "本次更新报告:  ${REPORT}"
{
  echo "# hanhua 更新报告 ${STAMP}"
  echo "pristine_asar=${PRISTINE_ASAR}"
  echo "pristine_ui=${PRISTINE_UI}"
} > "${REPORT}"

UI_BUNDLE=""
if [ -n "${PRISTINE_UI}" ] && [ -f "${PRISTINE_UI}/index.html" ]; then
  UI_BUNDLE="$(sed -n 's/.*src="\.\/\(assets\/[^"]*\.js\)".*/\1/p' "${PRISTINE_UI}/index.html" | head -1)"
  [ -n "${UI_BUNDLE}" ] && UI_BUNDLE="${PRISTINE_UI}/${UI_BUNDLE}"
fi

# --- 1/4 重映射 -----------------------------------------------------------------
echo
echo "== 1/4 模板变量重映射 =="
REMAPPED=0
if [ -n "${UI_BUNDLE}" ]; then
  REMAP_LOG="$(node "${HERE}/tools/remap.js" "${UI_BUNDLE}" --write)"
  printf '%s\n' "${REMAP_LOG}" | tee -a "${REPORT}"
  REMAPPED="$(printf '%s' "${REMAP_LOG}" | sed -n 's/^  RENAMED[[:space:]]*\([0-9][0-9]*\).*/\1/p')"
  REMAPPED="${REMAPPED:-0}"
else
  echo "(无 ui 目录，跳过)"
fi

# --- 2/4 构建 --------------------------------------------------------------------
echo
echo "== 2/4 构建（含防呆自检）=="
if ! bash "${HERE}/build.sh" "${PRISTINE_ASAR}" "${PRISTINE_UI}" 2>&1 | tee -a "${REPORT}"; then
  echo "ERROR: build.sh 失败（详情见上方日志），中止。" >&2
  exit 1
fi

# --- 3/4 残留扫描 ------------------------------------------------------------------
echo
echo "== 3/4 残留扫描 =="
FINAL_BUNDLE="${HERE}/output/ui/assets/$(basename "${UI_BUNDLE:-__none__}")"
{
  echo
  echo "## 残留扫描（output 主 bundle）"
} >> "${REPORT}"
if [ -f "${FINAL_BUNDLE}" ]; then
  echo "-- uipos（界面属性位置英文）--"           | tee -a "${REPORT}"
  node "${HERE}/tools/uipos.js"    "${FINAL_BUNDLE}" | tee -a "${REPORT}"
  echo "-- prose（多词英文片段，控制台截前 40 行，全文在报告）--" | tee -a "${REPORT}"
  PROSE_OUT="$(node "${HERE}/tools/prose.js" "${FINAL_BUNDLE}" || true)"
  printf '%s\n' "${PROSE_OUT}" >> "${REPORT}"
  # 控制台只预览前 40 行；用 sed 而非 head——head 会提前关管道让上游吃 SIGPIPE，
  # 配合 pipefail 直接杀掉本脚本
  printf '%s\n' "${PROSE_OUT}" | sed -n '1,40p'
  echo "-- leftover 全量输出见报告文件 --"         | tee -a "${REPORT}"
  node "${HERE}/tools/leftover.js" "${FINAL_BUNDLE}" >> "${REPORT}" 2>&1 || true
else
  echo "(未找到 output 主 bundle，跳过)" | tee -a "${REPORT}"
fi

# --- 4/4 汇总 ----------------------------------------------------------------------
echo
echo "== 4/4 本次更新小结 =="
echo "  · 模板变量自动迁移：${REMAPPED} 条$( [ "${REMAPPED}" -gt 0 ] && echo '  → 建议人工抽查 git diff dict.json 后提交' )"
echo "  · 报告（MISSED 与残留扫描全文）：${REPORT}"
cat <<TIP

接下来的人工步骤：
  1) 打开上方报告，把 MISSED 列表里的**新版本改写过的文案**补进 dict.json
     （少量直接编辑；批量可用 node tools/addl10n.js <bundle> --dry 参考 docs/汉化流程.md）
  2) 重新构建验证全命中：bash build.sh
  3) 安装生效：bash apply.sh
TIP
