#!/usr/bin/env bash
# CI 上的四道发布闸门（与 release.sh 同名、同判据）+ 一道补丁锚点预检：
# 不装 Freebuff、不解 app.asar、不需要 npm。
#
#   闸一 主进程英文扫描 tools/mainscan.js        ← 原版 electron/ vs（快照 + 词典 + 补丁）镜像
#   闸二 回归闸门       tools/regress.js         ← 上一版已发布包 vs 镜像主 bundle
#   闸三 单词级文案     tools/uipos_gap.js       ← 镜像主 bundle（有基线时带 --prev）
#   闸四 字面量占用     tools/lint_collisions.js ← 词典 × 快照的 electron/
#   附加 补丁锚点预检   tools/patch_preflight.js ← 补丁 ×（快照 + 词典）镜像
#
# 与 release.sh 的四道闸门差别只在「本版产物」的来源：CI 里没有 app.asar / ui 产物，于是按
# build.sh 的同一条链在前置步骤把它重建出来——主进程侧 = 快照 electron/ + 词典（tools/apply.js）
# + 人工补丁（git apply，与 build.sh 同一命令、同一工作目录口径），UI 侧 = 快照 ui 主 bundle
# + 词典。文本口径与真实产物一致：主进程补丁只改文案与外观，UI 行为补丁改的是表达式不是文案
# （后者还会被 semantic_guard 拦「补丁里不许出现英文文案」）。
#
# 为什么值得提前到 PR 阶段：这四道原本只在 release.sh 上跑，也就是说词典被写坏 / 补丁漏翻 /
# 某句因词条合并变回英文，都要等到「准备发布」那一刻才暴露——而那时已经是版本 bump + 构建 +
# 装机之后了。PR 上跑一遍，问题是随改动一起出现的。
#
# 依赖：闸门所需的「本版英文原版快照」（Release 资产 pristine-<版本>.json.gz）从我们自己的
# Release 取（pristine.js import --from-release），仓库公开、匿名可取；带 GITHUB_TOKEN 只是
# 为了不吃共享出口 IP 的 API 限额。闸二 / 闸三的上一版基线同样从 Release 取（release.sh 同源）。
#
# 跳过策略（都打 ::warning:: 出声，不静默）：取不到本版快照（版本刚 bump、还没发 Release）→
# 整批跳过并 rc 0；取不到上一版包（首次发布 / 网络不通）→ 闸二标「未执行」、闸三退回「看全量」，
# 其余闸门照跑。本地 update.sh 的 6b 步与 release.sh 的四道闸门用的是真实产物，那才是最终把关。
#
# 用法：bash tools/ci_gates.sh [--snapshot <目录>] [--patches <目录>] [--prev <包 zip|目录>]
#                              [--no-baseline] [--keep]
#   --snapshot / --patches / --prev 与其它工具同名同义（--prev 同 regress.js / uipos_gap.js，
#   可给 pack zip 也可给目录）；给了 --prev 就不再联网取基线（离线跑 / 自测用）；
#   --no-baseline 明确声明「这次没有基线」，同样不联网；--keep 保留临时镜像与下载目录（排障用）
# 退出码：0 全过（或按上面的理由跳过）；1 有闸门失败；2 用法 / 环境不对
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="Ximmmmmmm/freebuff-zh"
KEEP=0
SNAP_OPT=""
PATCH_OPT=""
PREV_OPT=""
NO_BASELINE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --snapshot) SNAP_OPT="$2"; shift ;;
    --patches)  PATCH_OPT="$2"; shift ;;
    --prev)     PREV_OPT="$2"; shift ;;
    --no-baseline) NO_BASELINE=1 ;;
    *)
      echo "未知参数：$1（支持 --snapshot <目录> / --patches <目录> / --prev <包 zip|目录> / --no-baseline / --keep）" >&2
      exit 2
      ;;
  esac
  shift
done
PATCH_DIR="${PATCH_OPT:-${HERE}/patches}"
if [ ! -d "${PATCH_DIR}" ]; then
  echo "ERROR: 补丁目录不存在：${PATCH_DIR}" >&2
  exit 2
fi
# GITHUB_TOKEN 只为匿名限额；没它也照跑（仓库公开）
CURL_AUTH=()
[ -n "${GITHUB_TOKEN:-}" ] && CURL_AUTH=(-H "Authorization: Bearer ${GITHUB_TOKEN}")

TARGET="$(node -e 'const m = require(process.argv[1]); console.log(m.targetVersion || m.packVersion)' "${HERE}/manifest.json")"
PACKVER="$(node -e 'const m = require(process.argv[1]); console.log(m.packVersion || m.targetVersion)' "${HERE}/manifest.json")"
echo "CI 闸门：目标版本 v${TARGET}，本次汉化包版本 ${PACKVER}（manifest.json）"

# --- 取快照：显式给了就用，本地已有就用，否则从 Release 导入 -------------------------
SNAP=""
if [ -n "${SNAP_OPT}" ]; then
  [ -d "${SNAP_OPT}/electron" ] || { echo "ERROR: --snapshot 指向的目录不存在或不含 electron/：${SNAP_OPT}" >&2; exit 2; }
  SNAP="$(cd "${SNAP_OPT}" && pwd)"
  echo "快照：${SNAP}（--snapshot 显式指定）"
else
  SNAP="$(node "${HERE}/tools/pristine.js" path "${TARGET}" --require-electron 2>/dev/null || true)"
fi
if [ -z "${SNAP}" ]; then
  echo "仓库里没有 v${TARGET} 的完整快照，尝试从 Release 取…"
  set +e
  node "${HERE}/tools/pristine.js" import --from-release "${TARGET}"
  IMPORT_RC=$?
  set -e
  if [ "${IMPORT_RC}" -ne 0 ]; then
    echo "::warning::取不到 v${TARGET} 的英文原版快照（Release 上还没有 / 网络不通），四道闸门整批跳过。"
    echo "  · 本地仍会在 update.sh 的 6b 步与 release.sh 的四道闸门 上跑同名闸门（用真实产物）；"
    echo "  · 想让 CI 也跑起来：先发布一次（release.sh 会把本版快照作为资产附上）。"
    exit 0
  fi
  SNAP="$(node "${HERE}/tools/pristine.js" path "${TARGET}" --require-electron 2>/dev/null || true)"
fi
if [ -z "${SNAP}" ]; then
  echo "ERROR: 导入后仍找不到含 electron/ 的 v${TARGET} 快照" >&2
  exit 2
fi
echo "快照：${SNAP}"

FAILED=0
SKIPPED=""
run_gate() { # run_gate <名字> <命令...>
  local name="$1"
  shift
  echo
  echo "== ${name} =="
  if "$@"; then
    echo "   ✓ ${name} 通过"
  else
    echo "::error::${name} 失败（明细见上）"
    FAILED=1
  fi
}
skip_gate() { # skip_gate <名字> <原因>
  local name="$1" why="$2"
  echo
  echo "== ${name} =="
  echo "::warning::${name} 未执行：${why}"
  echo "  （本道闸门这次没有给出结论——别把它读成通过。release.sh 上的同名闸门用真实产物，仍是最终把关）"
  SKIPPED="${SKIPPED}${SKIPPED:+、}${name%%：*}"
}

TMP="$(mktemp -d)"
cleanup() { [ "${KEEP}" -eq 1 ] || rm -rf "${TMP}"; }
trap cleanup EXIT

# --- 附加：补丁锚点预检（先跑：闸一要用补丁建镜像，它失败时这里的分诊最清楚）---------------
run_gate "附加·补丁锚点预检（行号漂移 vs 上游改写）" \
  node "${HERE}/tools/patch_preflight.js" --snapshot "${SNAP}" --patches "${PATCH_DIR}"

# --- 建镜像：闸一 / 闸二 / 闸三 共用（与 build.sh 第 2-3 步同链）-------------------------
# 主进程侧用 reanchor_patch.js 的 buildMirror（快照 electron/ + 词典 + 统一 LF），它就是
# patch_preflight / regen_patch 判断「补丁目标」时用的那一份，口径不会各家一个样。
echo
echo "-- 建镜像：主进程（快照 electron + 词典 + 补丁）与 UI（快照主 bundle + 词典）--"
MIRROR_MAIN_OK=1
if ! node -e 'const { buildMirror } = require(process.argv[1]); buildMirror(process.argv[2], process.argv[3])' \
  "${HERE}/tools/reanchor_patch.js" "${SNAP}" "${TMP}/main"; then
  echo "::error::主进程镜像建不出来（快照 electron/ + 词典这一步失败）"
  FAILED=1
  MIRROR_MAIN_OK=0
fi
PATCH_FILES=("${PATCH_DIR}"/electron-*.patch)
if [ "${MIRROR_MAIN_OK}" -eq 1 ] && [ ! -f "${PATCH_FILES[0]}" ]; then
  # 没补丁就没有可信的主进程产物：补丁翻好的那些句子会在镜像里保持英文，闸一会把它们全报成漏翻
  echo "::error::${PATCH_DIR} 里没有 electron-*.patch——镜像不可信（补丁翻好的那句会被误报成漏翻）"
  FAILED=1
  MIRROR_MAIN_OK=0
fi
if [ "${MIRROR_MAIN_OK}" -eq 1 ]; then
  : > "${TMP}/patch-failed.txt"
  (
    cd "${TMP}/main"
    for p in "${PATCH_FILES[@]}"; do
      git apply -p1 "$p" || printf '%s\n' "$(basename "$p")" >> "${TMP}/patch-failed.txt"
    done
  ) || true
  if [ -s "${TMP}/patch-failed.txt" ]; then
    echo "::error::主进程镜像建不出来：补丁未干净套用（$(tr '\n' ' ' < "${TMP}/patch-failed.txt")）"
    echo "  分诊与修法见上面的「附加·补丁锚点预检」；补丁没套上就比对，会把「补丁翻好的那句」误报成漏翻。"
    FAILED=1
    MIRROR_MAIN_OK=0
  fi
fi

mkdir -p "${TMP}/ui"
cp -R "${SNAP}/ui/." "${TMP}/ui/"
BUNDLE="$(ls -1 "${TMP}"/ui/assets/index-*.js 2>/dev/null | head -1 || true)"
MIRROR_UI_OK=1
if [ -z "${BUNDLE}" ]; then
  echo "::error::快照里找不到主 bundle（ui/assets/index-*.js）"
  FAILED=1
  MIRROR_UI_OK=0
else
  node "${HERE}/tools/apply.js" "${BUNDLE}" --write --quiet
fi

# --- 上一版基线：显式 --prev > 从 Release 取 ------------------------------------------
# 与 release.sh 闸二同源（那里也是「最新一个 tag != 本版 packVersion」）：版本 bump 后拿到的是
# 上一版已发布的包；没 bump（如发布后修词典）时拿到的仍是线上那一版——两种情况都正是该比的基线。
PREV=""
PREV_WHY=""
if [ -n "${PREV_OPT}" ]; then
  [ -e "${PREV_OPT}" ] || { echo "ERROR: --prev 指向的路径不存在：${PREV_OPT}" >&2; exit 2; }
  PREV="${PREV_OPT}"
  echo "上一版基线：${PREV}（--prev 显式指定，不联网）"
elif [ "${NO_BASELINE}" -eq 1 ]; then
  PREV_WHY="按 --no-baseline 跳过（本次声明没有基线）"
else
  echo "上一版基线：从 ${REPO} 的 Release 取…"
  TAGS=""
  if command -v gh >/dev/null 2>&1; then
    # gh 优先（理由同 release.sh：curl 直连 browser_download_url 在部分网络下会静默留下空文件）
    TAGS="$(gh release list -R "${REPO}" -L 30 --json tagName --jq '.[].tagName' 2>/dev/null || true)"
  fi
  if [ -z "${TAGS}" ]; then
    TAGS="$(curl -fsSL "${CURL_AUTH[@]}" "https://api.github.com/repos/${REPO}/releases?per_page=30" 2>/dev/null |
      node -e 'let s="";process.stdin.on("data",(d)=>s+=d);process.stdin.on("end",()=>{try{for(const r of JSON.parse(s)) if(r.tag_name && !r.draft) console.log(r.tag_name)}catch{/* 解析失败＝取不到，交给上面的分支报 */}})')" || true
  fi
  if [ -z "${TAGS}" ]; then
    PREV_WHY="取不到 Release 列表（网络 / 权限），上一版基线拿不到"
  else
    PREV_TAG="$(printf '%s\n' "${TAGS}" | grep -vx "pack-v${PACKVER}" | head -1 || true)"
    if [ -z "${PREV_TAG}" ]; then
      PREV_WHY="远端只有本版一个 Release（首次发布），没有可比的上一版"
    else
      PREV_DIR="${TMP}/prev"
      mkdir -p "${PREV_DIR}"
      if command -v gh >/dev/null 2>&1; then
        gh release download "${PREV_TAG}" -R "${REPO}" -p 'hanhua-pack-*.zip' --clobber -D "${PREV_DIR}" >/dev/null 2>&1 || true
      fi
      if [ ! -s "$(ls -1 "${PREV_DIR}"/hanhua-pack-*.zip 2>/dev/null | head -1)" ]; then
        PREV_URL="$(curl -fsSL "${CURL_AUTH[@]}" "https://api.github.com/repos/${REPO}/releases/tags/${PREV_TAG}" 2>/dev/null |
          node -e 'let s="";process.stdin.on("data",(d)=>s+=d);process.stdin.on("end",()=>{try{const a=(JSON.parse(s).assets||[]).find((x)=>/^hanhua-pack-.*\.zip$/.test(x.name)); if(a) console.log(a.url)}catch{/* 同上传给下面的分支 */}})')" || true
        if [ -n "${PREV_URL}" ]; then
          curl -fsSL "${CURL_AUTH[@]}" -H 'Accept: application/octet-stream' "${PREV_URL}" \
            -o "${PREV_DIR}/hanhua-pack-${PREV_TAG#pack-v}.zip" || true
        fi
      fi
      PREV="$(ls -1 "${PREV_DIR}"/hanhua-pack-*.zip 2>/dev/null | head -1 || true)"
      if [ -z "${PREV}" ]; then
        PREV_WHY="下载 ${PREV_TAG} 的汉化包失败（gh 与 curl 都不通）"
      else
        echo "上一版基线：${PREV_TAG} → ${PREV}"
      fi
    fi
  fi
fi

# --- 闸一：主进程英文扫描（原版 electron/ vs 镜像）--------------------------------------
if [ "${MIRROR_MAIN_OK}" -ne 1 ]; then
  echo
  echo "== 闸一：主进程英文扫描（原版 electron/ vs 快照+词典+补丁 镜像）=="
  echo "::error::闸一未执行：主进程镜像建不出来（原因见上）"
  FAILED=1
else
  run_gate "闸一：主进程英文扫描（原版 electron/ vs 快照+词典+补丁 镜像）" \
    node "${HERE}/tools/mainscan.js" "${SNAP}" "${TMP}/main"
fi

# --- 闸二：回归闸门（上一版已发布包 vs 镜像主 bundle）-----------------------------------
if [ "${MIRROR_UI_OK}" -ne 1 ]; then
  echo
  echo "== 闸二：回归闸门（上一版已发布产物 vs 本次构建）=="
  echo "::error::闸二未执行：镜像主 bundle 不存在"
  FAILED=1
elif [ -z "${PREV}" ]; then
  skip_gate "闸二：回归闸门" "${PREV_WHY}"
else
  run_gate "闸二：回归闸门（$(basename "${PREV}") vs 镜像主 bundle）" \
    node "${HERE}/tools/regress.js" "${PREV}" "${BUNDLE}"
fi

# --- 闸三：单词级界面文案差集（镜像主 bundle；有基线时与 release.sh 一样带 --prev）--------
if [ "${MIRROR_UI_OK}" -ne 1 ]; then
  echo
  echo "== 闸三：单词级界面文案（界面位置英文）=="
  echo "::error::闸三未执行：镜像主 bundle 不存在"
  FAILED=1
elif [ -n "${PREV}" ]; then
  run_gate "闸三：单词级界面文案（镜像 bundle − 上一版基线 − 登记表）" \
    node "${HERE}/tools/uipos_gap.js" --bundle "${BUNDLE}" --prev "${PREV}"
else
  run_gate "闸三：单词级界面文案（镜像 bundle 全量，减登记表）" \
    node "${HERE}/tools/uipos_gap.js" --bundle "${BUNDLE}"
fi

# --- 闸四：字面量占用（词典 × 快照的 electron/）-----------------------------------------
run_gate "闸四：字面量占用（词条会不会在 electron/*.cjs 里当路径 / 比较值 / IPC 通道名）" \
  node "${HERE}/tools/lint_collisions.js" --electron "${SNAP}/electron"

[ "${KEEP}" -eq 1 ] && {
  echo
  echo "（--keep）镜像与下载目录保留在：${TMP}"
}

echo
if [ "${FAILED}" -ne 0 ]; then
  echo "ERROR: 有闸门未通过。本地复现：bash tools/ci_gates.sh" >&2
  exit 1
fi
if [ -n "${SKIPPED}" ]; then
  # 不打印「全部通过」：有闸门没给出结论时，这句话就是假绿灯
  echo "四道发布闸门 + 补丁锚点预检：通过（未执行：${SKIPPED}，原因见上）"
else
  echo "四道发布闸门 + 补丁锚点预检全部通过 ✓"
fi
