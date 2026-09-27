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
# ==== 近似模式 ==================================================================
# 版本刚 bump、本版还没发 Release 时，本版英文原版谁都拿不到（本地没装过新版、Release 上还没有
# 它的快照资产），而「本版要翻什么」恰恰是这时候出现的。以前这里整批跳过，bump 那次 PR 上等于
# 一道闸门都没有。现在退一步：**拿上一版快照当替身**重建产物，四道闸门照跑，但替身与原版不是
# 同一个版本，判据必须分开——哪一道是判定、哪一道只是列清单，输出里逐条写明：
#   · 能判定：闸四字面量占用、镜像能否重建（词典 / 补丁 / 快照是否自洽）、补丁文件在不在；
#   · 只能列差异：闸一 / 闸二 / 闸三。本版词典相对上一版「下线 / 改写」的词条，在替身上那个
#     位置仍是上一版的原文，于是必然出现在差异里；它是新版上游真删了句（正常适配），还是我们
#     误删（静默漏翻），替身上无从判断——那正是 update.sh 第 6 步的对差报告要人看的东西。
#     差异照打（CI 上还写进 job summary），逐条核对清单，但**不作判定、不拦 CI**；
#   · 看不到：本版**新增**的英文文案（替身里还没有这些句子）。这一部分由发布前的 release.sh
#     四道闸门（真实产物）把关，所以近似模式不是「这次没人把关」，而是「把能提前的提前」。
# 因此近似模式**不会**打印「全部通过」：它逐条说明哪一道判定了、哪一道只列了差异。想强制跑一次
# （排障 / 预演下一次 bump）：--approx <版本|目录>。
# ================================================================================
#
# 跳过策略（都打 ::warning:: 出声，不静默）：本版快照取不到、连替身也找不到（首次发布 / 网络不通）
# → 整批跳过并 rc 0；取不到上一版包（首次发布 / 网络不通）→ 闸二标「未执行」、闸三退回「看全量」，
# 其余闸门照跑。本地 update.sh 的 6b 步与 release.sh 的四道闸门用的是真实产物，那才是最终把关。
#
# 用法：bash tools/ci_gates.sh [--snapshot <目录>] [--patches <目录>] [--prev <包 zip|目录>]
#                              [--approx <版本|目录>] [--no-baseline] [--keep]
#   --snapshot / --patches / --prev 与其它工具同名同义（--prev 同 regress.js / uipos_gap.js，
#   可给 pack zip 也可给目录）；给了 --prev 就不再联网取基线（离线跑 / 自测用）；
#   --approx 显式指定「替身快照」（版本号或目录），强制跑近似模式——与 --snapshot 互斥；
#   --no-baseline 明确声明「这次没有基线」；--keep 保留临时镜像与下载目录（排障用）
# 退出码：0 全过（或按上面的理由跳过）；1 有闸门失败；2 用法 / 环境不对
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="Ximmmmmmm/freebuff-zh"
KEEP=0
SNAP_OPT=""
PATCH_OPT=""
PREV_OPT=""
APPROX_OPT=""
APPROX_OPT_SET=0
NO_BASELINE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --snapshot) SNAP_OPT="$2"; shift ;;
    --patches)  PATCH_OPT="$2"; shift ;;
    --prev)     PREV_OPT="$2"; shift ;;
    --approx)   APPROX_OPT="$2"; APPROX_OPT_SET=1; shift ;;
    --no-baseline) NO_BASELINE=1 ;;
    *)
      echo "未知参数：$1（支持 --snapshot <目录> / --patches <目录> / --prev <包 zip|目录> / --approx <版本|目录> / --no-baseline / --keep）" >&2
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
if [ -n "${SNAP_OPT}" ] && [ "${APPROX_OPT_SET}" -eq 1 ]; then
  echo "ERROR: --snapshot 与 --approx 互斥（前者给本版原版快照，后者给上一版替身）" >&2
  exit 2
fi
# GITHUB_TOKEN 只为匿名限额；没它也照跑（仓库公开）
CURL_AUTH=()
[ -n "${GITHUB_TOKEN:-}" ] && CURL_AUTH=(-H "Authorization: Bearer ${GITHUB_TOKEN}")

TMP="$(mktemp -d)"
cleanup() { [ "${KEEP}" -eq 1 ] || rm -rf "${TMP}"; }
trap cleanup EXIT

TARGET="$(node -e 'const m = require(process.argv[1]); console.log(m.targetVersion || m.packVersion)' "${HERE}/manifest.json")"
PACKVER="$(node -e 'const m = require(process.argv[1]); console.log(m.packVersion || m.targetVersion)' "${HERE}/manifest.json")"
echo "CI 闸门：目标版本 v${TARGET}，本次汉化包版本 ${PACKVER}（manifest.json）"

# --- Release 列表：上一版基线要用，近似模式的替身也要用（只取列表，不下载 30 MB 的包）---------
TAGS=""
TAGS_TRIED=0
fetch_tags() {
  [ "${TAGS_TRIED}" -eq 1 ] && return 0
  TAGS_TRIED=1
  if command -v gh >/dev/null 2>&1; then
    # gh 优先（理由同 release.sh：curl 直连 browser_download_url 在部分网络下会静默留下空文件）
    TAGS="$(gh release list -R "${REPO}" -L 30 --json tagName --jq '.[].tagName' 2>/dev/null || true)"
  fi
  if [ -z "${TAGS}" ]; then
    TAGS="$(curl -fsSL "${CURL_AUTH[@]}" "https://api.github.com/repos/${REPO}/releases?per_page=30" 2>/dev/null |
      node -e 'let s="";process.stdin.on("data",(d)=>s+=d);process.stdin.on("end",()=>{try{for(const r of JSON.parse(s)) if(r.tag_name && !r.draft) console.log(r.tag_name)}catch{/* 解析失败＝取不到，交给调用方报 */}})' || true)"
  fi
}
# 最新一个不是本版 packVersion 的 Release（本版已发布时它就是「上一版」）
prev_tag() {
  fetch_tags
  [ -n "${TAGS}" ] || return 0
  printf '%s\n' "${TAGS}" | grep -vx "pack-v${PACKVER}" | head -1 || true
}
# 取一个小资产（pack-manifest.json）：它带着该 Release 的 targetVersion——packVersion 可能带第四段
# （0.0.103.1），快照资产名用的是 targetVersion，光看 tag 后缀会取错版本。
fetch_release_asset() { # <tag> <资产名> <输出目录>
  local tag="$1" name="$2" dir="$3"
  mkdir -p "${dir}"
  if command -v gh >/dev/null 2>&1; then
    gh release download "${tag}" -R "${REPO}" -p "${name}" --clobber -D "${dir}" >/dev/null 2>&1 || true
  fi
  [ -s "${dir}/${name}" ] && return 0
  local url
  url="$(curl -fsSL "${CURL_AUTH[@]}" "https://api.github.com/repos/${REPO}/releases/tags/${tag}" 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",(d)=>s+=d);process.stdin.on("end",()=>{const n=process.argv[1];try{const a=(JSON.parse(s).assets||[]).find((x)=>x.name===n); if(a) console.log(a.url)}catch{/* 同上 */}})' "${name}" || true)"
  [ -n "${url}" ] || return 1
  curl -fsSL "${CURL_AUTH[@]}" -H 'Accept: application/octet-stream' "${url}" -o "${dir}/${name}" || return 1
}
# 快照仓库里「低于 v<TARGET> 的最高一版」——近似模式的替身；没有就打印空
local_standin() {
  local store="${HANHUA_PRISTINE_DIR:-${HERE}/work/pristine}"
  [ -d "${store}" ] || return 0
  node -e '
    const fs = require("fs"), path = require("path")
    const { cmpVersion } = require(process.argv[1])
    const store = process.argv[2], target = process.argv[3]
    let best = null
    for (const n of fs.readdirSync(store)) {
      if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(n)) continue
      if (cmpVersion(n, target) >= 0) continue
      const d = path.join(store, n)
      if (!fs.existsSync(path.join(d, "electron")) || !fs.existsSync(path.join(d, "ui"))) continue
      if (!best || cmpVersion(n, best) > 0) best = n
    }
    if (best) console.log(best)
  ' "${HERE}/tools/pristine.js" "${store}" "${TARGET}"
}
snap_path() { node "${HERE}/tools/pristine.js" path "$1" --require-electron 2>/dev/null || true; }
snap_version() { node -e 'try{console.log(require(process.argv[1]).version || "?")}catch{console.log("?")}' "$1/snapshot.json"; }

# --- 本版英文原版快照：显式 --snapshot > 本地快照仓库 > 从 Release 导入 ------------------------
SNAP=""
if [ -n "${SNAP_OPT}" ]; then
  [ -d "${SNAP_OPT}/electron" ] || { echo "ERROR: --snapshot 指向的目录不存在或不含 electron/：${SNAP_OPT}" >&2; exit 2; }
  SNAP="$(cd "${SNAP_OPT}" && pwd)"
  echo "快照：${SNAP}（--snapshot 显式指定）"
else
  SNAP="$(snap_path "${TARGET}")"
fi
if [ -z "${SNAP}" ]; then
  echo "仓库里没有 v${TARGET} 的完整快照，尝试从 Release 取…"
  set +e
  node "${HERE}/tools/pristine.js" import --from-release "${TARGET}"
  IMPORT_RC=$?
  set -e
  [ "${IMPORT_RC}" -eq 0 ] && SNAP="$(snap_path "${TARGET}")"
fi

# --- 近似模式：本版原版拿不到时，用上一版快照当替身（判据按上面「近似模式」那段分开）-------------
APPROX=0
APPROX_VER=""
APPROX_WHY=""
if [ "${APPROX_OPT_SET}" -eq 1 ]; then
  if [ -d "${APPROX_OPT}" ]; then
    [ -d "${APPROX_OPT}/electron" ] || { echo "ERROR: --approx 目录不含 electron/：${APPROX_OPT}" >&2; exit 2; }
    SNAP="$(cd "${APPROX_OPT}" && pwd)"
    APPROX_VER="$(snap_version "${SNAP}")"
  else
    SNAP="$(snap_path "${APPROX_OPT}")"
    [ -n "${SNAP}" ] || { echo "ERROR: --approx 指定的版本没有可用快照（要含 electron/ 与 ui/）：${APPROX_OPT}" >&2; exit 2; }
    APPROX_VER="${APPROX_OPT}"
  fi
  APPROX=1
  APPROX_WHY="--approx 显式指定"
elif [ -z "${SNAP}" ]; then
  ST="$(local_standin)"
  if [ -n "${ST}" ]; then
    SNAP="$(snap_path "${ST}")"
    APPROX=1
    APPROX_VER="${ST}"
    APPROX_WHY="本版原版还没发布，用快照仓库里的上一版当替身"
  else
    echo "本地没有可当替身的上一版快照，尝试从 Release 取上一版的快照…"
    PREV_TAG="$(prev_tag)"
    if [ -n "${PREV_TAG}" ]; then
      PREV_MANIFEST_DIR="${TMP}/prev-snapshot-manifest"
      rm -rf "${PREV_MANIFEST_DIR}"
      fetch_release_asset "${PREV_TAG}" pack-manifest.json "${PREV_MANIFEST_DIR}" || true
      PREV_TARGET="$(node -e 'try{console.log(require(process.argv[1]).targetVersion || "")}catch{console.log("")}' "${PREV_MANIFEST_DIR}/pack-manifest.json" 2>/dev/null || true)"
      [ -n "${PREV_TARGET}" ] || PREV_TARGET="${PREV_TAG#pack-v}" # 读不到清单就退回 tag 后缀（四段版本号的包会取不到）
      set +e
      node "${HERE}/tools/pristine.js" import --from-release "${PREV_TARGET}"
      ST_RC=$?
      set -e
      if [ "${ST_RC}" -eq 0 ] && [ -n "$(snap_path "${PREV_TARGET}")" ]; then
        SNAP="$(snap_path "${PREV_TARGET}")"
        APPROX=1
        APPROX_VER="${PREV_TARGET}"
        APPROX_WHY="本版原版还没发布，从 Release 取上一版 v${PREV_TARGET}（${PREV_TAG}）当替身"
      fi
    fi
  fi
fi

if [ -z "${SNAP}" ]; then
  echo "::warning::取不到 v${TARGET} 的英文原版快照（Release 上还没有 / 网络不通），也没有可当替身的上一版快照，四道闸门整批跳过。"
  echo "  · 本地仍会在 update.sh 的 6b 步与 release.sh 的四道闸门 上跑同名闸门（用真实产物）；"
  echo "  · 想让 CI 也跑起来：先发布一次（release.sh 会把本版快照作为资产附上）；"
  echo "  · 或者用上一版快照预演近似模式：bash tools/ci_gates.sh --approx <上一版版本号>。"
  exit 0
fi
echo "快照：${SNAP}"

FAILED=0
SKIPPED=""
APPROX_LISTED=""
run_gate() { # run_gate <名字> <命令...>  —— 硬判定：有差异就是失败
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
# 近似模式专用：命令照跑、明细照打，但差异只当核对清单（替身与原版的差别没法归因，见文件头）
run_gate_approx() { # run_gate_approx <名字> <差异从哪来> <命令...>
  local name="$1" why="$2"
  shift 2
  echo
  echo "== ${name}（近似模式：只列差异，不判定）=="
  local log
  log="$(mktemp "${TMP}/gate-XXXXXX.log")"
  if "$@" >"${log}" 2>&1; then
    echo "   ✓ ${name}：在替身上一处差异都没有"
    gate_summary "${name}" "在替身上一处差异都没有。" "${log}"
  else
    echo "   -- 差异清单（近似模式只作核对清单，不判定）--"
    sed -e 's/^/   | /' "${log}"
    echo "::warning::${name} 在替身上报出差异：${why}"
    APPROX_LISTED="${APPROX_LISTED}${APPROX_LISTED:+、}${name%%：*}"
    gate_summary "${name}" "${why}" "${log}" "differences"
  fi
}
# 近似模式的差异清单写进 CI 的 job summary（本地跑时只在 stdout，就上面那份）。无差异的闸门只
# 写一行结论：日志倒进 summary 会把它要看的清单淹掉（完整输出在 job 日志里）
gate_summary() { # <名字> <说明> <日志> [differences]
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] || return 0
  {
    echo "### ${1}（近似模式）"
    echo
    echo "${2}"
    echo
    if [ "${4:-}" = "differences" ]; then
      echo '```'
      cat "${3}"
      echo '```'
      echo
    fi
  } >> "${GITHUB_STEP_SUMMARY}"
}
skip_gate() { # skip_gate <名字> <原因>
  local name="$1" why="$2"
  echo
  echo "== ${name} =="
  echo "::warning::${name} 未执行：${why}"
  echo "  （本道闸门这次没有给出结论——别把它读成通过。release.sh 上的同名闸门用真实产物，仍是最终把关）"
  SKIPPED="${SKIPPED}${SKIPPED:+、}${name%%：*}"
}

if [ "${APPROX}" -eq 1 ]; then
  cat <<EOF

============================================================
近似模式：本版原版 v${TARGET} 还没发布，用替身 v${APPROX_VER} 重建产物
============================================================
  替身：${SNAP}（${APPROX_WHY}）
  做法：替身 electron/ + 本版词典 + 本版补丁 → 主进程镜像；替身主 bundle + 本版词典 → UI 镜像
  能判定：闸四·字面量占用（词典的字面量会不会在替身的 electron/ 里当路径 / 比较值 / IPC 通道名）、
          镜像能否重建（词典 / 补丁 / 快照是否自洽）、补丁文件在不在
  只列差异：闸一 / 闸二 / 闸三——本版词典相对上一版下线或改写的词条，在替身上那个位置仍是上一版
          的原文，于是必然出现在差异里；是上游真删了句还是我们误删，替身上判断不了。差异照打、
          CI 上还写进 job summary，供逐条核对，但不作判定、不拦 CI
  看不到：本版**新增**的英文文案（替身里还没有这些句子）——发布前的 release.sh 四道闸门
          （真实产物）才是最终把关
============================================================
EOF
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "# CI 闸门：近似模式（替身 v${APPROX_VER}）"
      echo
      echo "本版原版 **v${TARGET}** 还没发布，用**上一版 v${APPROX_VER}** 的快照当替身重建产物跑四道闸门。"
      echo "差别的处置：**闸四 / 镜像重建 / 补丁文件**是判定；**闸一 / 闸二 / 闸三**只列差异清单（替身上"
      echo "下线词条必然露英文，无法归因），本版新增的英文文案这里看不到——最终把关是发布前的 "
      echo "\`release.sh\` 四道闸门（真实产物）。"
      echo
    } >> "${GITHUB_STEP_SUMMARY}"
  fi
fi

# --- 附加：补丁锚点预检（先跑：闸一要用补丁建镜像，它失败时这里的分诊最清楚）---------------
# 近似模式下补丁是按**本版原版**手写的，套在替身上报行号漂移 / 上游改写属预期，于是只列差异。
if [ "${APPROX}" -eq 1 ]; then
  run_gate_approx "附加·补丁锚点预检（行号漂移 vs 上游改写）" \
    "补丁是按本版原版手写的，套在替身上报漂移 / 改写属预期（上游在两地之间动过行）" \
    node "${HERE}/tools/patch_preflight.js" --snapshot "${SNAP}" --patches "${PATCH_DIR}"
else
  run_gate "附加·补丁锚点预检（行号漂移 vs 上游改写）" \
    node "${HERE}/tools/patch_preflight.js" --snapshot "${SNAP}" --patches "${PATCH_DIR}"
fi

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
    if [ "${APPROX}" -eq 1 ]; then
      # 近似模式：替身不是补丁的锚定版本，套不上是预期（真正套不上时闸一/闸二/闸三的差异会点出来）
      echo "::warning::近似模式：补丁没能套在替身上（$(tr '\n' ' ' < "${TMP}/patch-failed.txt")）——替身与原版差着版本，属预期。"
      echo "  受影响的是「补丁翻好的那些句子」：闸一 / 闸二 / 闸三 在近似模式下只列差异，不据此判定。"
      echo "  补丁相对**本版原版**的锚点正不正，由发布前的 release.sh 四道闸门（真实产物）把关。"
    else
      echo "::error::主进程镜像建不出来：补丁未干净套用（$(tr '\n' ' ' < "${TMP}/patch-failed.txt")）"
      echo "  分诊与修法见上面的「附加·补丁锚点预检」；补丁没套上就比对，会把「补丁翻好的那句」误报成漏翻。"
      FAILED=1
      MIRROR_MAIN_OK=0
    fi
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
  fetch_tags
  if [ -z "${TAGS}" ]; then
    PREV_WHY="取不到 Release 列表（网络 / 权限），上一版基线拿不到"
  else
    PREV_TAG="$(prev_tag)"
    if [ -z "${PREV_TAG}" ]; then
      PREV_WHY="远端只有本版一个 Release（首次发布），没有可比的上一版"
    else
      # 资产名 hanhua-pack-<packVersion>.zip 与 tag 后缀同源（release.sh：ASSET="hanhua-pack-${VER}.zip"，
      # tag=pack-v${VER}），所以 tag 后缀就是资产名里的版本
      PREV_DIR="${TMP}/prev"
      fetch_release_asset "${PREV_TAG}" "hanhua-pack-${PREV_TAG#pack-v}.zip" "${PREV_DIR}" || true
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
elif [ "${APPROX}" -eq 1 ]; then
  run_gate_approx "闸一：主进程英文扫描（替身 electron/ vs 替身+词典+补丁 镜像）" \
    "本版词典相对上一版下线 / 改写的词条，在替身上那个位置会露出英文；补丁相对替身的行号漂移同理" \
    node "${HERE}/tools/mainscan.js" "${SNAP}" "${TMP}/main"
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
elif [ "${APPROX}" -eq 1 ]; then
  run_gate_approx "闸二：回归闸门（$(basename "${PREV}") vs 替身+词典 镜像主 bundle）" \
    "上一版有中文、替身上变回英文的位置——多半就是本版撤掉的词条（上游删句的正常适配），逐条核对" \
    node "${HERE}/tools/regress.js" "${PREV}" "${BUNDLE}"
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
elif [ "${APPROX}" -eq 1 ]; then
  if [ -n "${PREV}" ]; then
    run_gate_approx "闸三：单词级界面文案（替身镜像 bundle − 上一版基线 − 登记表）" \
      "与闸二同源：界面位置露出的英文多半是本版撤掉的词条；这里的结论同样只作核对清单" \
      node "${HERE}/tools/uipos_gap.js" --bundle "${BUNDLE}" --prev "${PREV}"
  else
    run_gate_approx "闸三：单词级界面文案（替身镜像 bundle 全量，减登记表）" \
      "与闸二同源：界面位置露出的英文多半是本版撤掉的词条；这里的结论同样只作核对清单" \
      node "${HERE}/tools/uipos_gap.js" --bundle "${BUNDLE}"
  fi
elif [ -n "${PREV}" ]; then
  run_gate "闸三：单词级界面文案（镜像 bundle − 上一版基线 − 登记表）" \
    node "${HERE}/tools/uipos_gap.js" --bundle "${BUNDLE}" --prev "${PREV}"
else
  run_gate "闸三：单词级界面文案（镜像 bundle 全量，减登记表）" \
    node "${HERE}/tools/uipos_gap.js" --bundle "${BUNDLE}"
fi

# --- 闸四：字面量占用（词典 × 快照的 electron/）-----------------------------------------
# 近似模式下也照判定：它看的是「词典里的字面量会不会在 electron/ 里当路径 / 比较值 / IPC 通道名」，
# 与词条对不对得上本版原文无关（底本是替身的代码，本版新增的代码还没在里面——这一条写在横幅里）。
run_gate "闸四：字面量占用（词条会不会在 electron/*.cjs 里当路径 / 比较值 / IPC 通道名）" \
  node "${HERE}/tools/lint_collisions.js" --electron "${SNAP}/electron"

[ "${KEEP}" -eq 1 ] && {
  echo
  echo "（--keep）镜像与下载目录保留在：${TMP}"
}

echo
if [ "${FAILED}" -ne 0 ]; then
  echo "ERROR: 有闸门未通过。本地复现：bash tools/ci_gates.sh${APPROX:+ --approx ${APPROX_VER}}" >&2
  exit 1
fi
if [ "${APPROX}" -eq 1 ]; then
  # 不打印「全部通过」：替身上闸一 / 闸二 / 闸三 只列差异，本版新增的文案这里看不到
  echo "近似模式（替身 v${APPROX_VER}）小结："
  echo "  已判定：闸四·字面量占用、镜像重建（词典 + 补丁 + 快照是否自洽）、补丁文件在不在"
  if [ -n "${APPROX_LISTED}" ]; then
    echo "  只列差异、未判定：${APPROX_LISTED}（清单见上，CI 上同时写进 job summary）"
  else
    echo "  只列差异的闸一 / 闸二 / 闸三：在替身上一处差异都没有"
  fi
  [ -n "${SKIPPED}" ] && echo "  未执行：${SKIPPED}（原因见上）"
  echo "  看不到本版新增的英文文案——发布前的 release.sh 四道闸门（真实产物）把关。"
elif [ -n "${SKIPPED}" ]; then
  # 不打印「全部通过」：有闸门没给出结论时，这句话就是假绿灯
  echo "四道发布闸门 + 补丁锚点预检：通过（未执行：${SKIPPED}，原因见上）"
else
  echo "四道发布闸门 + 补丁锚点预检全部通过 ✓"
fi
