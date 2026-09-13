#!/usr/bin/env bash
# 一键版本迁移：应用自动更新到新版本后跑一次，把能自动的都自动掉。
#
#   1/6 模板变量重映射：tools/remap.js 把 template 词典条目的 ${...} 变量名迁移到新 bundle
#   2/6 UI 行为补丁体检：锚点还能唯一命中吗？缺陷还在吗？（tools/apply_ui_code_patch.js + probe_stream_epoch.js）
#   3/6 可复现构建：bash build.sh（内含语法校验 + 构建产物自检）+ 构建后行为取证
#   4/6 残留扫描：leftover / prose / uipos / fieldscan / blindscan 扫描构建出的主 bundle
#   5/6 回归闸门：tools/regress.js 对比上一版汉化包，揪出「变回英文」的静默回归
#   6/6 汇总：打印剩余人工事项清单，扫描全文归档到 work/
#
# 之后只差两步：把报告里的新增文案补进 dict.json（重跑 build），再 bash apply.sh 安装。
#
# 用法：
#   bash tools/update.sh                     # 自动取安装目录最新的 hanhua-backup-* 作原版
#   bash tools/update.sh <app.asar> <ui-dir> # 显式指定原版
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL="${LOCALAPPDATA:-}/Programs/@codebufffreebuff-desktop"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="${HERE}/work/update-${STAMP}.txt"

mkdir -p "${HERE}/work"

# --- 解析原版（与 build.sh 相同的逻辑）----------------------------------------
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
      echo "  先 bash restore.sh 还原英文；或显式传入路径：bash tools/update.sh <app.asar> <ui-dir>" >&2
      exit 1
    fi
    PRISTINE_ASAR="${INSTALL}/resources/app.asar"
    PRISTINE_UI="${INSTALL}/resources/orchestrator/ui"
    echo "未找到 hanhua-backup-*，改用安装目录当前的英文原版作 pristine。"
  else
    echo "ERROR: 找不到原版。本机未安装 Freebuff 且没有备份，请显式传入路径：bash tools/update.sh <app.asar> <ui-dir>" >&2
    exit 1
  fi
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
echo "== 1/6 模板变量重映射 =="
REMAPPED=0
if [ -n "${UI_BUNDLE}" ]; then
  # remap.js --write only needs to inspect the pristine bundle. The installed
  # asset is never modified, which is important when the user runs update.sh
  # before applying a new pack.
  REMAP_LOG="$(node "${HERE}/tools/remap.js" "${UI_BUNDLE}" --write)"
  printf '%s\n' "${REMAP_LOG}" | tee -a "${REPORT}"
  REMAPPED="$(printf '%s' "${REMAP_LOG}" | sed -n 's/^  RENAMED[[:space:]]*\([0-9][0-9]*\).*/\1/p')"
  REMAPPED="${REMAPPED:-0}"
  # 歧义条目 = 没自动迁移的（下一版会变回英文），别只埋在报告里
  AMBIGUOUS="$(printf '%s' "${REMAP_LOG}" | sed -n 's/^  AMBIGUOUS[[:space:]]*\([0-9][0-9]*\).*/\1/p')"
  AMBIGUOUS="${AMBIGUOUS:-0}"
else
  echo "(无 ui 目录，跳过)"
fi

# --- 2/6 UI 行为补丁体检（原版）-----------------------------------------------------
# 在**花时间构建之前**先把两件事问清楚。它们与词典无关，但一旦不成立，构建要么硬失败、
# 要么白插一段桩：
#   ① 锚点还能唯一命中吗 —— 上游改写了这段代码时，build.sh 的补丁步会中止；在这里报
#      得更早、更清楚（知道是哪一条），并顺带把缺陷取证打出来供决策。
#   ② 缺陷还在吗 —— 原版必须仍能复现；若上游已自行修复，探针会直说，那就不该再插桩。
echo
echo "== 2/6 UI 行为补丁体检（原版）=="
PATCH_ANCHORS=skipped
PATCH_COUNT=0
PATCH_DEFECT=skipped
if [ -n "${UI_BUNDLE}" ] && [ -f "${UI_BUNDLE}" ]; then
  set +e
  ANCHOR_OUT="$(node "${HERE}/tools/apply_ui_code_patch.js" "${UI_BUNDLE}" 2>&1)"
  ANCHOR_RC=$?
  set -e
  PATCH_ANCHORS="${ANCHOR_RC}"
  printf '%s\n' "${ANCHOR_OUT}" | tee -a "${REPORT}"
  if [ "${ANCHOR_RC}" -ne 0 ]; then
    echo "ERROR: UI 行为补丁的锚点在新版原版 bundle 里匹配不上（明细见上）。" >&2
    echo "  上游改写了这段代码。两条路：" >&2
    echo "    · 缺陷仍在 —— 在新 bundle 里重新定位同一处语义，更新 tools/apply_ui_code_patch.js 的 find/apply；" >&2
    echo "    · 上游已自行修复 —— 把对应补丁从清单里移除（下面的取证会告诉你是不是这种）。" >&2
    node "${HERE}/tools/probe_stream_epoch.js" "${UI_BUNDLE}" || true
    exit 1
  fi
  PATCH_COUNT="$(printf '%s' "${ANCHOR_OUT}" | sed -n 's/^ui code patch: applied \([0-9][0-9]*\).*/\1/p')"
  PATCH_COUNT="${PATCH_COUNT:-0}"
  set +e
  DEFECT_OUT="$(node "${HERE}/tools/probe_stream_epoch.js" "${UI_BUNDLE}" --expect present 2>&1)"
  DEFECT_RC=$?
  set -e
  printf '%s\n' "${DEFECT_OUT}" | tee -a "${REPORT}"
  case "${DEFECT_RC}" in
    0) PATCH_DEFECT=present ;;
    1) PATCH_DEFECT=gone ;;
    *) PATCH_DEFECT=unknown ;;
  esac
  if [ "${PATCH_DEFECT}" = "gone" ]; then
    echo "  ! 原版里已复现不出该缺陷 —— 上游可能自行修复（或改写了时序），建议人工确认后将对应补丁退场" >&2
  fi
else
  echo "  (未记录原版主 bundle 路径，跳过)" | tee -a "${REPORT}"
fi
{
  echo
  echo "## UI 行为补丁体检（原版）：锚点 rc=${PATCH_ANCHORS} / 命中 ${PATCH_COUNT} 条 / 缺陷 ${PATCH_DEFECT}"
} >> "${REPORT}"

# --- 3/6 构建 --------------------------------------------------------------------
echo
echo "== 3/6 构建（含防呆自检）=="
if ! bash "${HERE}/build.sh" "${PRISTINE_ASAR}" "${PRISTINE_UI}" 2>&1 | tee -a "${REPORT}"; then
  echo "ERROR: build.sh 失败（详情见上方日志），中止。" >&2
  exit 1
fi

# 产物侧的行为取证在 tools/postbuild.js 里（build.sh 末尾调用，输出已 tee 进本报告）——
# 那里是「产物可不可信」的归属地，build.sh / release.sh 也一并覆盖。这里只补一个
# 已知路径的变量，供后面的残留扫描复用。
FINAL_BUNDLE="${HERE}/output/ui/assets/$(basename "${UI_BUNDLE:-__none__}")"

# --- 4/6 残留扫描 ------------------------------------------------------------------
echo
echo "== 4/6 残留扫描 =="
{
  echo
  echo "## 残留扫描（output 主 bundle）"
} >> "${REPORT}"
if [ -f "${FINAL_BUNDLE}" ]; then
  echo "-- uipos（界面属性位置英文）--"           | tee -a "${REPORT}"
  node "${HERE}/tools/uipos.js"    "${FINAL_BUNDLE}" | tee -a "${REPORT}"
  # 字段级扫描：uipos 只认属性锚点，description/tagline/hint 这类字段整片英文它看不见
  # （0.0.103.2 的 connectors 目录介绍就是这么藏了 100 条）。
  echo "-- fieldscan（description/tagline/hint… 字段英文）--" | tee -a "${REPORT}"
  node "${HERE}/tools/fieldscan.js" "${FINAL_BUNDLE}" | tee -a "${REPORT}" || true
  # 盲区扫描：原版里存在、产物里原样还在的英文片段——uipos / fieldscan / regress 都够不着的位置
  # （`children:[cond?"A":"B"]` 三元分支、模板插值内部、函数默认值），也只报告不拦构建：
  # 列表里本来就会混着 CodeMirror / shiki / React 这类库内部文案，人工挑出应用自己的文案。
  echo "-- blindscan（uipos / fieldscan 的盲区：三元分支、模板插值内部、默认值）--" | tee -a "${REPORT}"
  if [ -n "${UI_BUNDLE}" ] && [ -f "${UI_BUNDLE}" ]; then
    BLIND_OUT="$(node "${HERE}/tools/blindscan.js" "${UI_BUNDLE}" "${FINAL_BUNDLE}" || true)"
    printf '%s\n' "${BLIND_OUT}" >> "${REPORT}"
    printf '%s\n' "${BLIND_OUT}" | sed -n '1,40p'
  else
    echo "  (未记录原版主 bundle 路径，跳过)" | tee -a "${REPORT}"
  fi
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

# --- 4/5 回归闸门 ------------------------------------------------------------------
# 迁移的静默失败模式：remap 按「去变量的文字骨架」找对应位置，同一句话若有多种变体，
# 两条词条可能被指到同一处互相覆盖，剩下那处就变回英文而 build.sh 依旧全绿。
echo
echo "== 5/6 回归闸门（对比上一版汉化包）=="
CUR_VER="$(node -e 'const m = require(process.argv[1]); console.log(m.packVersion || m.targetVersion)' "${HERE}/manifest.json")"
BASE=""
for z in $(ls -1t "${HERE}"/dist/hanhua-pack-*.zip 2>/dev/null || true); do
  v="$(basename "$z" | sed 's/^hanhua-pack-//; s/\.zip$//')"
  [ "$v" = "${CUR_VER}" ] && continue
  BASE="$z"; break
done
if [ -z "${BASE}" ]; then
  CAND="$(ls -1dt "${HERE}"/output-*/ 2>/dev/null | head -1 || true)"
  [ -n "${CAND}" ] && BASE="${CAND%/}"
fi
{
  echo
  echo "## 回归闸门"
} >> "${REPORT}"
GATE_RC=2
if [ -n "${BASE}" ]; then
  echo "  基线：${BASE}"
  echo "  基线：${BASE}" >> "${REPORT}"
  set +e
  node "${HERE}/tools/regress.js" "${BASE}" "${HERE}/output" 2>&1 | tee -a "${REPORT}"
  GATE_RC=${PIPESTATUS[0]}
  set -e
else
  echo "  ! 本地没有上一版汉化包（dist/hanhua-pack-*.zip）也没有历史 output-*/，跳过"
  echo "    发布时 release.sh 会拉 GitHub 上已发布的包再比一次。"
fi

# --- 6/6 汇总 ----------------------------------------------------------------------
echo
echo "== 6/6 本次更新小结 =="
echo "  · 模板变量自动迁移：${REMAPPED} 条$( [ "${REMAPPED}" -gt 0 ] && echo '  → 建议人工抽查 git diff dict.json 后提交' )"
if [ "${AMBIGUOUS:-0}" -gt 0 ]; then
  echo "  · remap 歧义条目：${AMBIGUOUS} 条 ⚠ 未自动迁移（清单见报告）——不改就会在下个版本变回英文"
else
  echo "  · remap 歧义条目：0 条 ✓"
fi
case "${GATE_RC}" in
  0) echo "  · 回归闸门：未发现新增英文片段 ✓" ;;
  1) echo "  · 回归闸门：⚠ 发现新增英文片段（清单见报告）——补翻 dict.json 后重跑 build.sh" ;;
  *) echo "  · 回归闸门：跳过（本地缺上一版包，发布时还会再比一次）" ;;
esac
if [ "${PATCH_ANCHORS}" = "skipped" ]; then
  echo "  · UI 行为补丁锚点：跳过（未记录原版主 bundle）"
else
  echo "  · UI 行为补丁锚点：${PATCH_COUNT} 条全部唯一命中 ✓（rc=${PATCH_ANCHORS}）"
fi
case "${PATCH_DEFECT}" in
  present) echo "  · 缺陷取证（原版）：可复现 ✓ 补丁仍然必要" ;;
  gone)    echo "  · 缺陷取证（原版）：⚠ 已复现不出——上游可能自行修复，确认后应将该补丁退场" ;;
  unknown) echo "  · 缺陷取证（原版）：⚠ 无法取证（上游结构变化），需人工核对锚点与补丁去留" ;;
  *) echo "  · 缺陷取证（原版）：跳过" ;;
esac
echo "  · 产物侧行为取证：由 build.sh 末尾的 postbuild 执行（未达标会直接中止构建）"
echo "      结果见上面构建日志里的「主 bundle 行为取证」一行"
echo "  · 报告（MISSED 与残留扫描全文）：${REPORT}"
cat <<TIP

接下来的人工步骤：
  1) 打开上方报告，把 MISSED 列表里的**新版本改写过的文案**补进 dict.json
     （少量直接编辑 dict.json；保持 key 与 MISSED 原文逐字节一致）
  2) 重新构建验证全命中：bash build.sh
  3) 安装生效：bash apply.sh

报告里「UI 行为补丁体检」一节红了或带 ⚠ 时（与词典无关）：
  · 锚点匹配失败 → 上游改写了那段渲染进程代码，需重新定位锚点；
  · 原版已复现不出缺陷 → 上游自行修复，确认后把该补丁从 tools/apply_ui_code_patch.js 退场；
  · 产物侧行为取证未达标（构建日志里的「主 bundle 行为取证」）→ 别装机，先核对补丁是否真的生效。
  · 无法取证（两边都可能）→ 上游结构变化，探针拿不到证据，需人工核对后决定补丁去留。
TIP
