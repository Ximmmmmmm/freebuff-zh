#!/usr/bin/env bash
# CI 上的三道闸门：不装 Freebuff、不解 app.asar，只靠「本版英文原版快照 + 词典 + 补丁」。
#
#   A 字面量占用   tools/lint_collisions.js   ← 词典 × 快照的 electron/
#   B 补丁锚点预检 tools/patch_preflight.js   ← 补丁 × (快照 + 词典) 镜像
#   C 单词级文案   tools/uipos_gap.js         ← (快照 ui + 词典) 当本版产物，登记表之外不得有未覆盖项
#
# 为什么能脱离装机产物：这三道都只依赖「本版英文原版快照」（Release 资产
# `pristine-<版本>.json.gz`）加仓库里的词典与补丁——同一个快照 build.sh 每次也登记一份。
# `npm` / `@electron/asar` / 装机目录都不需要，因此能在 PR 上跑。
# 快照从我们自己的 Release 取（pristine.js import --from-release），仓库公开、匿名可取；
# 带上 GITHUB_TOKEN 只是为了不吃共享出口 IP 的 API 限额。
#
# 取不到本版快照时（版本刚 bump、还没发 Release）打 GitHub 的 ::warning:: 注解并 rc 0：
# 本地 update.sh（6b 步）与 release.sh（闸三 / 闸四）上跑的是同名闸门且更严格（有真实产物），
# CI 这一道是把「词典/补丁在 PR 阶段就被写坏」提前暴露，不是最终把关。
#
# 用法：bash tools/ci_gates.sh [--snapshot <含 ui/ 与 electron/ 的目录>] [--patches <目录>] [--keep]
#   --snapshot / --patches 与其它工具同名同义，用于排障与自测（跳过按版本解析快照）；
#   --keep 保留临时镜像目录（排障用）
# 退出码：0 全过（或按上面的理由跳过）；1 有闸门失败；2 用法/环境不对
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEEP=0
SNAP_OPT=""
PATCH_OPT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --snapshot) SNAP_OPT="$2"; shift ;;
    --patches)  PATCH_OPT="$2"; shift ;;
    *) echo "未知参数：$1（支持 --snapshot <目录> / --patches <目录> / --keep）" >&2; exit 2 ;;
  esac
  shift
done
PATCH_ARGS=()
[ -n "${PATCH_OPT}" ] && PATCH_ARGS=(--patches "${PATCH_OPT}")

TARGET="$(node -e 'const m = require(process.argv[1]); console.log(m.targetVersion || m.packVersion)' "${HERE}/manifest.json")"
echo "CI 闸门：目标版本 v${TARGET}（manifest.json）"

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
    echo "::warning::取不到 v${TARGET} 的英文原版快照（Release 上还没有 / 网络不通），三道闸门跳过。"
    echo "  · 本地仍会在 update.sh 的 6b 步与 release.sh 的闸三 / 闸四 上跑同名闸门；"
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
echo

FAILED=0
run_gate() { # run_gate <名字> <命令...>
  local name="$1"
  shift
  echo "== ${name} =="
  if "$@"; then
    echo "   ✓ ${name} 通过"
  else
    echo "::error::${name} 失败（明细见上）"
    FAILED=1
  fi
  echo
}

# --- 闸门 A：字面量占用（词典 × 快照的 electron/）-------------------------------------
run_gate "闸门 A：字面量占用（词条会不会在 electron/*.cjs 里当路径 / 比较值 / IPC 通道名）" \
  node "${HERE}/tools/lint_collisions.js" --electron "${SNAP}/electron"

# --- 闸门 B：补丁锚点预检（补丁 × 快照 + 词典镜像）------------------------------------
run_gate "闸门 B：补丁锚点预检（行号漂移 vs 上游改写）" \
  node "${HERE}/tools/patch_preflight.js" --snapshot "${SNAP}" "${PATCH_ARGS[@]}"

# --- 闸门 C：单词级界面文案差集（快照 ui + 词典 当本版产物）---------------------------
# 只套词典、不跑 UI 代码补丁：那几组改的是行为而不是文案，不会新增界面位置的英文；
# 没有上一版基线，所以这里按「看全量减登记表」判定——`--prev` 那一档由 release.sh 闸三覆盖。
MIRROR="$(mktemp -d)"
cleanup() { [ "${KEEP}" -eq 1 ] || rm -rf "${MIRROR}"; }
trap cleanup EXIT
mkdir -p "${MIRROR}/ui"
cp -R "${SNAP}/ui/." "${MIRROR}/ui/"
BUNDLE="$(ls -1 "${MIRROR}"/ui/assets/index-*.js 2>/dev/null | head -1 || true)"
if [ -z "${BUNDLE}" ]; then
  echo "::error::快照里找不到主 bundle（ui/assets/index-*.js）"
  FAILED=1
else
  node "${HERE}/tools/apply.js" "${BUNDLE}" --write --quiet
  run_gate "闸门 C：单词级界面文案（快照 ui + 词典 的界面位置英文，不得有未登记项）" \
    node "${HERE}/tools/uipos_gap.js" --bundle "${BUNDLE}"
  [ "${KEEP}" -eq 1 ] && echo "（--keep）镜像保留在：${MIRROR}"
fi

if [ "${FAILED}" -ne 0 ]; then
  echo "ERROR: 有闸门未通过。本地复现：bash tools/ci_gates.sh" >&2
  exit 1
fi
echo "三道闸门全部通过 ✓"
