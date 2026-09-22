#!/usr/bin/env bash
# 一键版本迁移：应用自动更新到新版本后跑一次，把能自动的都自动掉。
#
#   1/7 模板变量重映射：tools/remap.js 把 template 词典条目的 ${...} 变量名迁移到新 bundle
#   2/7 补丁体检：UI 行为补丁该保留 / 该重维护 / 该退场？（tools/ui_patch_status.js，退场时附删除
#       清单）；主进程补丁的锚点与分诊（tools/patch_preflight.js：行号漂移 vs 上游改写）
#   3/7 可复现构建：bash build.sh（内含语法校验 + 构建产物自检）+ 构建后行为取证
#   4/7 UI 残留扫描：leftover / prose / uipos / fieldscan / blindscan 扫描构建出的主 bundle
#   5/7 主进程英文扫描：tools/mainscan.js 对差 electron/*.cjs——词典只替换双引号字面量，
#       单引号 / 模板里的文案（菜单、原生对话框、openIn 报错、MCP 同意窗口）全靠 patches/，
#       漏了不会有任何构建报错；这一步就是盯「原版有、产物里还是英文」的那些。
#   6/7 上游新增文案 + 回归闸门：两个基线、两个视角——
#       tools/upstreamdiff.js 比**上一版英文原版 vs 本版英文原版**（不依赖汉化包，本版原版由
#       build.sh 每次构建登记成快照 work/pristine/<版本>/），先给出「本版上游新写了哪些文案」
#       的待翻清单；tools/regress.js 比**上一版汉化包 vs 本版产物**，揪出「变回英文」的静默回归。
#   6b/7 单词级界面文案差集 + 字面量占用：uipos_gap 拿本版产物减上一版产物减登记表，捞两
#        道对差通道（有词数下限）看不见的单词文案；lint_collisions 查词条会不会在
#        electron/*.cjs 里当路径 / 比较值 / IPC 通道名用（翻掉就静默改行为）
#   7/7 汇总：打印剩余人工事项清单，扫描全文归档到 work/（报告里含上游新增文案清单）
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

# --- 1/7 重映射 -----------------------------------------------------------------
echo
echo "== 1/7 模板变量重映射 =="
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

# --- 2/7 UI 行为补丁体检（原版）-----------------------------------------------------
# 在**花时间构建之前**先问清楚：这些补丁该保留、该重维护、还是该退场？（与词典无关，
# 但如果不成立，构建要么硬失败、要么白插一段修一个上游已经没有的缺陷的桩。）
# 判定交给 tools/ui_patch_status.js：锚点维度（能不能套用）× 缺陷维度（原版还能不能复现
# 出缺陷），逐组给出 KEEP / REWRITE / RETIRE / UNKNOWN，退场时附上删除清单。
echo
echo "== 2/7 补丁体检（UI 行为：该保留还是退场）=="
PATCH_STATUS=skipped
if [ -n "${UI_BUNDLE}" ] && [ -f "${UI_BUNDLE}" ]; then
  set +e
  STATUS_OUT="$(node "${HERE}/tools/ui_patch_status.js" "${UI_BUNDLE}" 2>&1)"
  STATUS_RC=$?
  set -e
  printf '%s\n' "${STATUS_OUT}" | tee -a "${REPORT}"
  case "${STATUS_RC}" in
    0) PATCH_STATUS=keep ;;
    1) PATCH_STATUS=retire ;;
    3) PATCH_STATUS=unknown ;;
    *) # rc 2：锚点失配（缺陷仍在，需重新定位）+ 原版路径不可用等配置问题，两者都该停下
       echo "ERROR: UI 行为补丁体检需要人工介入（rc=${STATUS_RC}）：锚点已失配（构建也会在中途中止），或原版 bundle 不可用。" >&2
       echo "  明细见上方输出。重新定位锚点后重跑；若上游已自行修复，则按清单把那组补丁退场。" >&2
       exit 1 ;;
  esac
  if [ "${PATCH_STATUS}" = "retire" ]; then
    echo "  ! 有补丁可以退场（上游已复现不出缺陷，删除清单见上方与报告）——确认后删，不要在缺陷仍在时删" >&2
  fi
  if [ "${PATCH_STATUS}" = "unknown" ]; then
    echo "  ! 补丁去留无法自动判定（探针拿不到证据）——请人工核对上游是否改写了这段代码" >&2
  fi
else
  echo "  (未记录原版主 bundle 路径，跳过)" | tee -a "${REPORT}"
fi
{
  echo
  echo "## UI 行为补丁体检（原版）：${PATCH_STATUS}"
} >> "${REPORT}"

# 主进程补丁的锚点预检：build.sh 第 3 步套不上时只会说「补丁未干净套用」，而「行号漂移」
# （上游在前面插了几行，一条命令重锚定就好）与「上游改写」（上下文真的没了，只能人工重维护）
# 处置完全不同。这一步在动 build 之前就把两者分开——0.0.131 适配时是我临时写脚本才做到的，
# 而且当时还把 consent-window.html 的「空上下文行」误判成改写。顺便把补丁体检统一在本步骤。
echo
echo "== 2b/7 主进程补丁锚点预检（该重锚定还是人工重维护）=="
PATCH_ANCHOR=skipped
{
  echo
  echo "## 主进程补丁锚点预检（patches/electron-*.patch vs 快照 + 词典）"
} >> "${REPORT}"
set +e
ANCHOR_OUT="$(node "${HERE}/tools/patch_preflight.js" --verbose 2>&1)"
ANCHOR_RC=$?
set -e
printf '%s\n' "${ANCHOR_OUT}" | tee -a "${REPORT}"
case "${ANCHOR_RC}" in
  0) PATCH_ANCHOR=ok ;;
  1) PATCH_ANCHOR=broken ;;
  *) PATCH_ANCHOR=skip ;;
esac

# --- 3/7 构建 --------------------------------------------------------------------
echo
echo "== 3/7 构建（含防呆自检）=="
if ! bash "${HERE}/build.sh" "${PRISTINE_ASAR}" "${PRISTINE_UI}" 2>&1 | tee -a "${REPORT}"; then
  echo "ERROR: build.sh 失败（详情见上方日志），中止。" >&2
  exit 1
fi

# 产物侧的行为取证在 tools/postbuild.js 里（build.sh 末尾调用，输出已 tee 进本报告）——
# 那里是「产物可不可信」的归属地，build.sh / release.sh 也一并覆盖。这里只补一个
# 已知路径的变量，供后面的残留扫描复用。
FINAL_BUNDLE="${HERE}/output/ui/assets/$(basename "${UI_BUNDLE:-__none__}")"

# --- 4/7 UI 残留扫描 ---------------------------------------------------------------
echo
echo "== 4/7 UI 残留扫描 =="
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

# --- 5/7 主进程英文扫描 ---------------------------------------------------------------
# 为什么单独一步：上面那堆扫描（uipos / fieldscan / blindscan / regress）**全都只看 UI bundle**。
# 主进程的界面文案（标签页右键菜单、原生对话框、`shell:openIn` 的报错、MCP 同意窗口）
# 既不在词典的 exact（只替双引号字面量）也不在任何扫描的视野里，只能靠 patches/electron-*.patch
# 手工覆盖——于是「某条文案没写进补丁」可以在每一版都静静躺着（0.0.113 适配时一次扫出 29 处，
# 其中有些从 0.0.104 之前就在）。mainscan 就是把这个对差固化下来：原版有、产物里还一样的英文
# 就是漏翻。与 blindscan 一样**只报告不拦脚本**（迁移途中本来就该先发现再补），但结论进小结。
echo
echo "== 5/7 主进程英文扫描（electron/*.cjs）=="
{
  echo
  echo "## 主进程英文扫描（mainscan：原版 electron/*.cjs vs 构建产物）"
} >> "${REPORT}"
MAIN_RC=skip
if [ -f "${PRISTINE_ASAR}" ] && [ -f "${HERE}/output/app.asar" ]; then
  # 临时目录用 mktemp：解包出来的树里有 Freebuff 自己的 vendored 二进制
  # （`sdk/vendor/ripgrep/*/rg.exe`），Windows 上偶尔被安全软件 / 正在运行的应用占住而删不掉；
  # 固定路径会留下上一轮的残留，而清理失败也不该让整套 update.sh 在这儿 abort。
  MS_DIR="$(mktemp -d)"
  # 两侧都要解包：原版那一侧 build.sh 已经解过一次但用 mktemp 用完即删（traps rm），
  # 28 MB 的 asar 解包是秒级，这里重解一次远比让 build.sh 留下副作用目录干净。
  set +e
  npx -y @electron/asar extract "${PRISTINE_ASAR}" "${MS_DIR}/pristine" >> "${REPORT}" 2>&1
  MS_PRISTINE_RC=$?
  npx -y @electron/asar extract "${HERE}/output/app.asar" "${MS_DIR}/built" >> "${REPORT}" 2>&1
  MS_BUILT_RC=$?
  set -e
  if [ "${MS_PRISTINE_RC}" -ne 0 ] || [ "${MS_BUILT_RC}" -ne 0 ]; then
    echo "  ! app.asar 解包失败（npx @electron/asar 不可用？），跳过主进程扫描" | tee -a "${REPORT}"
    MAIN_RC=skip
  else
    set +e
    MAIN_OUT="$(node "${HERE}/tools/mainscan.js" "${MS_DIR}/pristine" "${MS_DIR}/built" 2>&1)"
    MAIN_RC=$?
    set -e
    printf '%s\n' "${MAIN_OUT}" | tee -a "${REPORT}"
  fi
  rm -rf "${MS_DIR}" 2>/dev/null || echo "  ! 临时目录未能删除：${MS_DIR}（不影响扫描结论）" | tee -a "${REPORT}"
else
  echo "  ! 缺原版 app.asar 或 output/app.asar，跳过" | tee -a "${REPORT}"
fi

# --- 6/7 上游新增文案 + 回归闸门 ------------------------------------------------------
# 两个基线、两个视角，恰好互补：
#   ① 上游新增（tools/upstreamdiff.js）：比**上一版英文原版 vs 本版英文原版**，无需汉化包——
#      先把「本版上游新写了哪些文案」列出来（这是补翻的待办清单）；原版由 build.sh 每次登记成
#      快照 work/pristine/<版本>/（上一次适配存的那份就是今天的基线）。只有一版基线时按提示
#      「补基线」（import --from-release / capture --exe），别就这么放过这一步。
#   ② 回归闸门（tools/regress.js）：比**上一版汉化包 vs 本版产物**，揪「变回英文」的静默回归。
#      迁移的静默失败模式：remap 按「去变量的文字骨架」找对应位置，同一句话若有多种变体，
#      两条词条可能被指到同一处互相覆盖，剩下那处就变回英文而 build.sh 依旧全绿。
echo
echo "== 6/7 上游新增文案 + 回归闸门 =="
{
  echo
  echo "## 上游新增文案（upstreamdiff：上一版英文原版 vs 本版英文原版）"
} >> "${REPORT}"
UDIFF_RC=2
set +e
UDIFF_OUT="$(node "${HERE}/tools/upstreamdiff.js" --auto 2>&1)"
UDIFF_RC=$?
set -e
# 全文进报告，控制台只预览前 40 行（同 blindscan 的处理；用 sed 不用 head，避免 SIGPIPE 配 pipefail）
printf '%s\n' "${UDIFF_OUT}" | tee -a "${REPORT}" >/dev/null
printf '%s\n' "${UDIFF_OUT}" | sed -n '1,40p'
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

# --- 6b/7 单词级界面文案差集 + 字面量占用 ------------------------------------------------
# 为什么还要一道（两道对差通道之外的第三个视角）：
#   ① upstreamdiff 的片段级要 ≥3 词、字面量级要 ≥2 词，regress 的片段提取只认句子——
#      `Settings` / `Theme` / `Missions` 这类**单词文案三条通道全都看不见**（0.0.131 那次
#      14 条是人工从 uipos 的 52 条里肉眼挑出来的）。uipos_gap 把它变成差集：本版产物 −
#      上一版产物 − intentional-english.json 的 uiStrings。
#   ② 词典按「完整字面量」替换，分不清「给人看的标签」和「代码里的值」。0.0.131 实测
#      `Cookies` 在 browser-import.cjs 里是路径后缀（`path.join(root, 'Cookies')`），
#      翻掉会让 Cookie 导入静默找不到文件——当时靠临时脚本才发现。lint_collisions
#      把这条规则固化下来（路径参数 / 比较位置 / IPC 通道名三种形态直接失败）。
echo
echo "== 6b/7 单词级界面文案差集 + 字面量占用 =="
{
  echo
  echo "## 界面位置英文差集（uipos_gap：本版产物 ← 上一版产物，减登记表）"
} >> "${REPORT}"
GAP_RC=2
if [ -f "${FINAL_BUNDLE}" ]; then
  GAP_ARGS=(--bundle "${FINAL_BUNDLE}")
  [ -n "${BASE}" ] && GAP_ARGS+=(--prev "${BASE}")
  set +e
  GAP_OUT="$(node "${HERE}/tools/uipos_gap.js" "${GAP_ARGS[@]}" 2>&1)"
  GAP_RC=$?
  set -e
  printf '%s\n' "${GAP_OUT}" | tee -a "${REPORT}"
else
  echo "  ! 没找到 output 主 bundle，跳过" | tee -a "${REPORT}"
fi
{
  echo
  echo "## 字面量占用检查（lint_collisions：词条会不会在代码里当值用）"
} >> "${REPORT}"
COLLIDE_RC=2
# pristine.js path 给的是快照根目录，本工具要的是含 electron/*.cjs 的那一层
# 快照目录按 targetVersion 命名（packVersion 理论上可能带后缀，这里按目录口径取）
COLLIDE_VER="$(node -e 'const m = require(process.argv[1]); console.log(m.targetVersion || m.packVersion)' "${HERE}/manifest.json")"
COLLIDE_ROOT="$(node "${HERE}/tools/pristine.js" path "${COLLIDE_VER}" --require-electron 2>/dev/null || true)"
COLLIDE_TREE=""
if [ -n "${COLLIDE_ROOT}" ] && [ -d "${COLLIDE_ROOT}/electron" ]; then
  COLLIDE_TREE="${COLLIDE_ROOT}/electron"
else
  COLLIDE_TREE="$(ls -1dt "${HERE}"/work/pristine/*/electron 2>/dev/null | head -1 || true)"
fi
if [ -n "${COLLIDE_TREE}" ] && [ -d "${COLLIDE_TREE}" ]; then
  set +e
  node "${HERE}/tools/lint_collisions.js" --electron "${COLLIDE_TREE}" 2>&1 | tee -a "${REPORT}"
  COLLIDE_RC=${PIPESTATUS[0]}
  set -e
else
  echo "  ! 找不到含 electron/ 的原版快照，跳过（本版快照：bash build.sh 会登记）" | tee -a "${REPORT}"
fi

# --- 7/7 汇总 ----------------------------------------------------------------------
echo
echo "== 7/7 本次更新小结 =="
echo "  · 模板变量自动迁移：${REMAPPED} 条$( [ "${REMAPPED}" -gt 0 ] && echo '  → 建议人工抽查 git diff dict.json 后提交' )"
if [ "${AMBIGUOUS:-0}" -gt 0 ]; then
  echo "  · remap 歧义条目：${AMBIGUOUS} 条 ⚠ 未自动迁移（清单见报告）——不改就会在下个版本变回英文"
else
  echo "  · remap 歧义条目：0 条 ✓"
fi
case "${UDIFF_RC}" in
  0)  echo "  · 上游新增文案：词典已全覆盖 ✓" ;;
  1)  echo "  · 上游新增文案：⚠ 有待补翻（清单见报告「上游新增文案」一节）" ;;
  *)  echo "  · 上游新增文案：跳过（只有一版原版基线）——补基线：node tools/pristine.js import --from-release latest";;

esac
case "${GATE_RC}" in
  0)  echo "  · 回归闸门：未发现新增英文片段 ✓" ;;
  1) echo "  · 回归闸门：⚠ 发现新增英文片段（清单见报告）——补翻 dict.json 后重跑 build.sh" ;;
  *) echo "  · 回归闸门：跳过（本地缺上一版包，发布时还会再比一次）" ;;
esac
case "${GAP_RC:-2}" in
  0)  echo "  · 单词级界面文案（uipos_gap）：未登记的新增英文 0 处 ✓" ;;
  1) echo "  · 单词级界面文案（uipos_gap）：⚠ 有本版新增的界面位置英文——能翻的补 dict.json，"
      echo "      品牌名 / 模型名 / 代码串登进 intentional-english.json 的 uiStrings（逐条写理由）" ;;
  *) echo "  · 单词级界面文案（uipos_gap）：跳过（缺本版产物）" ;;
esac
case "${COLLIDE_RC:-2}" in
  0)  echo "  · 字面量占用（lint_collisions）：没有词条被代码占用 ✓" ;;
  1) echo "  · 字面量占用（lint_collisions）：⚠ 有词条在代码里当值用（路径 / 比较 / IPC）——"
      echo "      从 dict.json 撤掉，改写成 patches/electron-*.patch，或把两处用法拆开" ;;
  *) echo "  · 字面量占用（lint_collisions）：跳过（找不到原版 electron/ 快照）" ;;
esac
case "${MAIN_RC}" in
  0)    echo "  · 主进程英文扫描：未发现漏翻 ✓" ;;
  1)    echo "  · 主进程英文扫描：⚠ 有疑似漏翻（清单见报告）——补进 patches/electron-*.patch 后重跑 bash build.sh" ;;
  skip) echo "  · 主进程英文扫描：跳过（app.asar 解包不可用）" ;;
  *)    echo "  · 主进程英文扫描：⚠ 未能完成（mainscan 自身报错，明细见报告）" ;;
esac
case "${PATCH_ANCHOR:-skip}" in
  ok)     echo "  · 主进程补丁锚点预检：全部能干净套用 ✓" ;;
  broken) echo "  · 主进程补丁锚点预检：⚠ 有补丁套不上（分诊与修法见报告）——行号漂移用"
          echo "      node tools/reanchor_patch.js --all --write 重锚定；上游改写则按新版原文改补丁正文" ;;
  *)      echo "  · 主进程补丁锚点预检：跳过（缺原版 electron/ 快照或补丁目录）" ;;
esac
case "${PATCH_STATUS}" in
  keep)    echo "  · UI 行为补丁（原版体检）：KEEP ✓ 锚点命中、上游仍带该缺陷，补丁继续保留" ;;
  retire)  echo "  · UI 行为补丁（原版体检）：⚠ RETIRE 可退场——上游已复现不出缺陷，删除清单见报告" ;;
  unknown) echo "  · UI 行为补丁（原版体检）：⚠ UNKNOWN 无法判定去留，需人工核对" ;;
  *)       echo "  · UI 行为补丁（原版体检）：跳过（未记录原版主 bundle）" ;;
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
  4) 报告里「上游新增文案」一节是**上游本版新写的英文**（与有无汉化包无关）：
     「词典未覆盖」那几条就是本版要翻的清单，补进 dict.json 后重跑 bash build.sh；
     「疑似改写」是上一版某句被整段重写（旧词条会落 MISSED），要按新句改写词条；
     清单来自 work/pristine/ 里上一版与本版两份英文原版快照（build.sh 每次登记本版那份）。
     只有一版基线时这一步会报「只有 1 版原版基线」——那不是「等下次」，按提示补：
       node tools/pristine.js list                              # 本机还能掘到什么
       node tools/pristine.js import --from-release latest      # 从我们自己的 Release 取上一版原版
       node tools/pristine.js capture --exe <安装包>            # 从安装包解（需要 7-Zip）
     本版快照也可以搬去别的机器：node tools/pristine.js export <版本> --out dist/
  5) 报告里「主进程英文扫描」带 ⚠ 时：那些是 electron/*.cjs 里没译的**界面文案**
     （菜单、原生对话框、shell:openIn 报错、MCP 同意窗口）——词典够不着，得写进
     patches/electron-*.patch；若确认它就该保留英文（协议 / 日志 / 品牌名），
     把它加进 tools/mainscan.js 的 INTENTIONAL 名单并写明理由，下次不再重复报。
     单独重跑（解包方式与本步骤相同，两侧都给「含 electron/ 的目录」）：
       npx -y @electron/asar extract <原版 app.asar> /tmp/ms-pristine
       npx -y @electron/asar extract output/app.asar /tmp/ms-built
       node tools/mainscan.js /tmp/ms-pristine /tmp/ms-built

报告里「界面位置英文差集」带 ⚠ 时（单词级文案，upstreamdiff 与 regress 都看不见）：
  那些位置的词数少于 2 个，所以三条通道全漏。能翻的补进 dict.json；品牌名 / 模型名 /
  JSON 示例这类登进 intentional-english.json 的 uiStrings（逐条写理由、仓库内可审，
  换机器或 CI 发布也不会忘）。单独重跑：
    node tools/uipos_gap.js --bundle output/ui/assets/index-<hash>.js --prev dist/hanhua-pack-<上一版>.zip

报告里「字面量占用检查」带 ⚠ 时（词条在代码里当值用，翻掉静默改行为）：
  典型形态是目录名 path.join(root, 'Cookies')、比较值 x === 'Enabled'、IPC 通道名这类；
  构建仍会全绿，只有真去用那个功能才会暴露（Cookie 导入找不到文件）。处置：从 dict.json
  撤掉该词条，改写进 patches/electron-*.patch（只改该翻的那处），或把两处用法拆开。
  单独重跑：node tools/lint_collisions.js --electron work/pristine/<版本>/electron

报告里「UI 行为补丁体检」红了或带 ⚠ 时（与词典无关）：
  · REWRITE（锚点失配、缺陷仍在）→ 在新版原版里重新定位同一处语义，更新 find/apply；
  · RETIRE（原版已复现不出缺陷）→ 上游自行修复，按报告里的删除清单把那组补丁退场；
  · UNKNOWN（无法取证）→ 上游结构变化，探针拿不到证据，人工核对后决定去留；
  · 产物侧行为取证未达标（构建日志里的「主 bundle 行为取证」）→ 别装机，先核对补丁是否真的生效。
随时可以单独问一次：node tools/ui_patch_status.js   （不带参数就自动找本机英文原版）
TIP
