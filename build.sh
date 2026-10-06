#!/usr/bin/env bash
# Rebuild the localized output/ from a pristine (English) Freebuff Desktop.
#
# Pipeline (verified byte-for-byte against the shipped output/):
#   1. extract pristine app.asar
#   2. apply the translation dictionary (dict.json) via tools/apply.js
#   3. apply the hand-written patches (patches/electron-*.patch) via git apply
#   4. repack app.asar; for ui/: patch index.html + apply the dictionary to the bundles
#      + apply the UI behaviour patches (tools/apply_ui_code_patch.js — not translations,
#      see docs/更新维护.md「第五种静默失败」)
#
# Usage:
#   bash build.sh                          # auto-pick pristine: newest hanhua-backup-*,
#                                          # or the installed English files when no backup exists
#   bash build.sh <app.asar> <ui-dir>      # use explicit pristine sources
#
# Output goes to output/ (app.asar + ui/). Install with: bash apply.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- 并发度：给「一堆互相独立的小文件各起一次 node」的步骤用 -------------------------
# 那两步的墙钟时间几乎全是**进程冷启动**（实测：46 次 apply.js = 4.5s、44 次 node --check = 3.2s，
# 而两者各自的实际工作量都在 1s 量级），串行是纯浪费。并发度按核数给，封顶 8
# （再多只是让杀毒 / IO 互相抢），需要时可 HANHUA_JOBS=1 退回串行复现旧行为。
JOBS="${HANHUA_JOBS:-$(nproc 2>/dev/null || echo 4)}"
case "${JOBS}" in '' | *[!0-9]*) JOBS=4 ;; esac
if [ "${JOBS}" -gt 8 ]; then JOBS=8; fi
if [ "${JOBS}" -lt 1 ]; then JOBS=1; fi
INSTALL="${LOCALAPPDATA:-}/Programs/@codebufffreebuff-desktop"

# --- 参数：--rebuild 可出现在任意位置，其余按位置取（<app.asar> [ui-dir]）-------------------
REBUILD=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --rebuild) REBUILD=1 ;;
    *) ARGS+=("$a") ;;
  esac
done
set -- ${ARGS[@]+"${ARGS[@]}"}

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

# --- 构建复用：输入没变 + 产物哈希仍对得上 → 直接跳过整次重建 -------------------------
# 为什么：这次构建的墙钟里约 18s 是固定开销（解包 / 打包 asar、46 + 44 次 node 冷启动、
# postbuild 的行为取证），而适配期间来回调词条、或只想再看一遍报告时，输入往往一个字节没变。
# 判据不是「猜」，是两条可验证的等式（细节见 tools/build_key.js 的文件头）：
#   输入指纹 = build.sh / dict / 登记表 / manifest / patches / tools/ + 原版 asar 与 ui 的逐字节哈希
#   产物哈希 = 上次成功构建记下的 output/ 每个文件的 sha256
# 于是「手改了 output/」或「改了 apply.js」都不会被当成可复用。要重建：bash build.sh --rebuild。
if [ -n "${PRISTINE_UI}" ]; then
  BUILD_KEY="$(node "${HERE}/tools/build_key.js" key --asar "${PRISTINE_ASAR}" --ui "${PRISTINE_UI}")"
  if [ "${REBUILD}" -eq 1 ]; then
    echo "构建复用：--rebuild 指定，本次强制重建"
  elif node "${HERE}/tools/build_key.js" verify --key "${BUILD_KEY}" --asar "${PRISTINE_ASAR}" --ui "${PRISTINE_UI}"; then
    echo
    echo "== 复用上次构建 =="
    echo "   输入（词典 / 补丁 / tools / 原版）一个字节没变，output/ 的产物哈希也对得上——不重新生成。"
    echo "   需要重建：bash build.sh --rebuild"
    exit 0
  fi
fi

# --- 登记本版英文原版快照（供下次适配对差 / 跨机器搬运）----------------------------
# 自动更新会把装机目录的英文原版覆盖掉（0.0.114 那次连 hanhua-backup-* 一起清了），而
# 「本版上游新增了哪些文案」正需要上一版的英文原版才能比。这里是全流程唯一手里正好拿着
# 英文原版的地方，所以顺手把它登记成快照 work/pristine/<版本>/（ui 主 bundle + electron/*.cjs，
# work/ 不入库）。tools/upstreamdiff.js --auto 取最新的两版，update.sh 第 6 步会自动跑。
#
# 快照而非单个 bundle 的好处是**可搬运**：node tools/pristine.js export/import 能把它拷到
# 另一台机器（或从我们自己的 Release import），换机器/清空 work/ 之后基线也还在。
# 登记失败不该让构建挂掉（缺的只是「下次的基线」，不是这次的产物），所以只提醒。
UPVER="$(node -e 'const m = require(process.argv[1]); console.log(m.targetVersion)' "${HERE}/manifest.json")"
if [ -n "${PRISTINE_UI}" ] && [ -f "${PRISTINE_UI}/index.html" ]; then
  if ! node "${HERE}/tools/pristine.js" capture --asar "${PRISTINE_ASAR}" --ui "${PRISTINE_UI}" --version "${UPVER}" --quiet; then
    echo "  ! 本版英文原版快照未登记（不影响本次构建）：node tools/pristine.js capture --asar <asar> --ui <ui 目录> 可手工补" >&2
  fi
else
  echo "  ! 未给 ui 目录，跳过英文原版快照登记（下次对差会少一版基线）" >&2
fi

# --- 词典门禁：结构 / 重复键 / 占位符 / 半截模板键 （tools/lint_dict.js）-----------------
# 以前 lint 只在 CI 跑，本地 build.sh → apply.sh 这条实际用的链路里形同虚设：结构写坏
# （最阴的是「半截模板」键丢了尾巴）照样能构建、能装，装完才崩。放在解包之前跑，
# 几秒钟就能发现，不必等整套构建跑完。update.sh / release.sh 走的都是这里。
echo
echo "== 0/4 词典门禁（tools/lint_dict.js）=="
if ! node "${HERE}/tools/lint_dict.js"; then
  echo "ERROR: 词典未通过门禁（错误明细见上）。半截模板键尾巴不对等结构问题会让产物直接坏掉，已中止构建。" >&2
  exit 1
fi

# --- 词条命中体检：够不着 UI bundle 的条目在解包之前就炸（tools/missed_diagnose.js）-------
# 「词典条目必须能在 UI bundle 命中」是 build.sh 的硬约束（第 4 步 UI 侧 MISSED 即中止），
# 但它一直只是隐含的：0.0.131 适配时 38 条**主进程专属**文案被塞进词典，构建跑到第 4 步
# 才报「词典有 38 条未命中（原文可能随版本改写）」——提示的方向是错的，实际原因只是
# 它们该写成 patches/electron-*.patch。这里在解包之前就把每一条归到四类里（命中 / 只在
# 主进程 / 只在上一版 / 两边都没有），几秒就能报出来，且直接说清该往哪边补。
echo
echo "== 0b/4 词条命中体检（tools/missed_diagnose.js）=="
if [ -n "${PRISTINE_UI}" ]; then
  SNAP_ELECTRON="${HERE}/work/pristine/${UPVER}/electron"
  PREV_SNAP="$(ls -1dt "${HERE}"/work/pristine/*/ 2>/dev/null | sed -n 2p || true)"
  DIAG=(--dict "${HERE}/dict.json" --ui "${PRISTINE_UI}")
  if [ -d "${SNAP_ELECTRON}" ]; then DIAG+=(--electron "${SNAP_ELECTRON}"); fi
  if [ -n "${PREV_SNAP}" ] && [ -d "${PREV_SNAP}ui" ]; then DIAG+=(--prev-ui "${PREV_SNAP}ui"); fi
  if ! node "${HERE}/tools/missed_diagnose.js" "${DIAG[@]}"; then
    echo "ERROR: 词典里有够不着本版 UI bundle 的词条（分类见上），已提前拦下（否则会在第 4 步以 MISSED 中止）。" >&2
    echo "  只在主进程出现 → 写成 patches/electron-*.patch，并从 dict.json 删掉（词典够不着主进程文件）" >&2
    echo "  只在上一版 UI 出现 → 上游改写了这句或整段下线：按新原文改写词条，确认下线就直接删" >&2
    echo "  两边都没有 → 历史死词条，删掉即可" >&2
    # 缺口发布模式（ALLOW_MISSED=1）：第 4 步那个 MISSED 检查认这个开关，本关以前不认，
    # 等于把「缺口发布」这条路堵死在解包之前 —— 开关形同虚设。这里让它同样认。
    if [ "${ALLOW_MISSED:-0}" = "1" ]; then
      echo "WARN: ALLOW_MISSED=1 缺口发布模式——够不着的词条不做迁移，对应文案保持英文；其余校验（补丁 / 语法 / 自检 / 行为取证）照常执行。" >&2
    else
      exit 1
    fi
  fi
else
  echo "  ! 未给 ui 目录，跳过（体检需要本版 UI bundle）" >&2
fi

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo
echo "== 1/4 解包主进程 asar =="
npx -y @electron/asar extract "${PRISTINE_ASAR}" "${WORK}/main"

echo "== 2/4 套用翻译词典 (dict.json) =="
# 每个文件仍是**一次独立的 apply.js**（口径一字不改，只是并发跑）：它们彼此独立、各写各的文件，
# 换句话说就是「把 46 次进程冷启动叠起来」，实测 4.5s → 1.1s。--quiet 下每个文件只一行输出，
# 行内不会交错；任何一个失败 xargs 返回 123，配合 set -e / pipefail 照样中止构建。
printf '%s\n' "${WORK}/main/electron/"*.cjs "${WORK}/main/electron/"*.html "${WORK}/main/package.json" \
  | xargs -d '\n' -P "${JOBS}" -I{} node "${HERE}/tools/apply.js" {} --write --quiet

echo "== 3/4 套用人工补丁 (patches/) =="
# 原版 asar 内文本是 CRLF 行尾，而补丁文件是 LF。Windows 的 git apply 会自动
# 处理行尾差异，但 Linux（服务器 CI）上严格匹配会直接失败，所以打补丁前先统一
# 成 LF。词典步骤已用 node 重写这些文件，这里再转一次无副作用。
find "${WORK}/main" -type f \( -name '*.cjs' -o -name '*.html' -o -name '*.js' -o -name '*.json' -o -name '*.ts' \) -exec sed -i 's/\r$//' {} +
(cd "${WORK}/main" && for p in "${HERE}"/patches/electron-*.patch; do
  if ! git apply -p1 "$p"; then
    echo "ERROR: 补丁未干净套用：$(basename "$p")" >&2
    # 失败分两种，处置完全不同，别让维护者自己猜：
    #   行号漂移（上游在前面插了几行）→ 一条命令重锚定；上游改写 → 补丁正文要人工重维护。
    echo "  先分诊：node tools/patch_preflight.js    # 行号漂移 vs 上游改写，附逐 hunk 结论" >&2
    echo "  行号漂移 → node tools/reanchor_patch.js --all --write（只改 @@ 头，补丁正文不动）" >&2
    echo "  上游改写 → node tools/regen_patch.js --broken --write（用既有译文重生成，行号由工具算）" >&2
    exit 1
  fi
done)

echo "== 语法校验补丁后的主进程文件 =="
# 判据与之前完全一致（就是 node --check），只是把 44 次冷启动叠起来：3.2s → 1.1s。
# 失败时 node 自己会点名文件与行号（比原先那句 basename 更具体），下面再给处置建议。
if ! printf '%s\n' "${WORK}/main/electron/"*.cjs | xargs -d '\n' -P "${JOBS}" -I{} node --check {}; then
  echo "ERROR: 主进程文件存在语法错误（详情见上，node --check 会点名文件与行号）—— 补丁悬空模板等会引发 v0.0.72 式启动崩溃，已中止构建" >&2
  exit 1
fi

echo "== 4/4 重打包 asar 并处理 ui =="
# 产物先落在临时目录，自检通过之后才整份换位进 output/。
# 为什么必须这样：控制器只认「output/ 目录存在 + 版本戳」就安装，不读构建日志——
# 以前 app.asar 在自检之前就落地 output/，于是「自检已判不可靠」的产物照样被装进装机。
# （2026-10-05 事故：自检打印「产物不可靠，请勿安装」后退出，可 app.asar 早已落盘，
#   控制器把它打进了装机，Freebuff 直接打不开。）
# 改成 staging 之后，任何一步失败都不碰 output/，失败构建再也留不下可被安装的产物。
STAGE="${WORK}/out"
rm -rf "${STAGE}"
mkdir -p "${STAGE}"
npx -y @electron/asar pack "${WORK}/main" "${STAGE}/app.asar"

if [ -n "${PRISTINE_UI}" ]; then
  rm -rf "${STAGE}/ui"
  mkdir -p "${STAGE}/ui"
  # 整份镜像原版 ui（含 fonts/ logos/ 与全部 assets/），再单独覆盖要汉化的那两个文件。
  # 只拷 index.html + assets/ 会把 fonts/ 与 logos/ 丢掉：应用后界面缺字体、服务图标全空。
  cp -r "${PRISTINE_UI}/." "${STAGE}/ui/"
  # Apply UI translations directly (git apply has CRLF issues on Windows with .gitattributes)
  node "${HERE}/tools/apply_ui_patch.js" "${STAGE}/ui/index.html"
  # 汉化包版本戳：控制器用 installed/output 产物里的这个 meta 比对是否需要更新
  PACK_VERSION="$(node -e 'const m = require(process.argv[1]); console.log(m.packVersion || m.targetVersion)' "${HERE}/manifest.json")"
  PACK_VERSION="${PACK_VERSION}" node -e 'const fs = require("fs"); const f = process.argv[1]; let s = fs.readFileSync(f, "utf8"); if (!s.includes("hanhua-pack")) { s = s.replace(/<head>/i, "<head>\n<meta name=\"hanhua-pack\" content=\"" + process.env.PACK_VERSION + "\">"); fs.writeFileSync(f, s); }' "${STAGE}/ui/index.html"
  # apply the dictionary ONLY to the main bundle (the one index.html loads):
  # other assets are syntax-highlighting grammars whose keys ("Command", "move", …)
  # are internal identifiers and must stay English.
  MAIN_BUNDLE="$(sed -n 's/.*src="\.\/\(assets\/[^"]*\.js\)".*/\1/p' "${STAGE}/ui/index.html" | head -1)"
  if [ -n "${MAIN_BUNDLE}" ] && [ -f "${STAGE}/ui/${MAIN_BUNDLE}" ]; then
    APPLY_LOG="$(node "${HERE}/tools/apply.js" "${STAGE}/ui/${MAIN_BUNDLE}" --write)"
    printf '%s\n' "${APPLY_LOG}"
    REPLACED="$(printf '%s' "${APPLY_LOG}" | sed -n 's/^replaced \([0-9][0-9]*\) occurrences.*/\1/p')"
    if [ -z "${REPLACED}" ] || [ "${REPLACED}" -eq 0 ]; then
      echo "ERROR: 词典对主 bundle 的替换次数为 0 —— 词典应用未生效（v0.0.70 式静默失败），已中止构建" >&2
      exit 1
    fi
    MISSED="$(printf '%s' "${APPLY_LOG}" | sed -n 's/^MISSED (\([0-9][0-9]*\) keys.*/\1/p')"
    if [ -n "${MISSED}" ] && [ "${MISSED}" -gt 0 ]; then
      if [ "${ALLOW_MISSED:-0}" = "1" ]; then
        # 缺口发布模式（手动可选）：词典锚文本在新版失效但其余校验
        # （补丁/语法/自检）照常执行——未翻文案保持英文，功能无损。
        echo "WARN: 词典有 ${MISSED} 条未命中（ALLOW_MISSED=1 缺口发布模式，对应文案保持英文）"
      else
        echo "ERROR: 词典有 ${MISSED} 条未命中（MISSED 明细见上方日志）——原文可能随版本改写，请核对 dict.json 后重试，已中止构建" >&2
        exit 1
      fi
    fi
    # 行为补丁（不是翻译）：少量必须改的 UI 逻辑。锚点用「属性名 + 字面量 + 结构」
    # 匹配并把短名字经捕获组带回，所以 minifier 改名不会失配；但必须唯一命中，
    # 命中 0 处或 2 处以上都中止构建，逼出「上游改写了这段代码」的时刻。
    # 必须在词典之后跑：锚点已经过校验的是词典替换后的文本（见 tools/apply_ui_code_patch.js）。
    echo "== 套用 UI 行为补丁 (tools/apply_ui_code_patch.js) =="
    node "${HERE}/tools/apply_ui_code_patch.js" "${STAGE}/ui/${MAIN_BUNDLE}" --write
  else
    echo "  ! 未在 index.html 中找到主 bundle，跳过词典应用" >&2
  fi
else
  echo "  (no ui dir given — skipping ui)"
fi

echo
# 自检读的是 staging，不是 output/——自检没过，output/ 一个字节都不会变。
node "${HERE}/tools/postbuild.js" "${STAGE}" --main-src "${WORK}/main" || {
  echo "ERROR: 构建产物自检未通过，output/ 不可靠。请勿安装。" >&2
  echo "       （本次产物只在临时目录 ${STAGE}，未落地到 output/，控制器装不到它）" >&2
  exit 1
}

# 自检通过，才整份换位进 output/。先删旧份，避免新旧文件混在同一份产物里。
rm -rf "${HERE}/output"
mv "${STAGE}" "${HERE}/output"

echo
# 构建成功才记缓存（postbuild 不过就中止在前面，不会留下「可疑但可复用」的记录）
if [ -n "${BUILD_KEY:-}" ]; then
  node "${HERE}/tools/build_key.js" record --key "${BUILD_KEY}" || echo "  ! 构建缓存写入失败（不影响本次产物，只是下次要重建）" >&2
fi

echo "完成：output/app.asar 与 output/ui/ 已生成。"
echo "安装：bash apply.sh"
echo "注意：asar 内容与 Release 产物一致；容器头部可能因 @electron/asar 版本不同有细微差异，不影响运行。"
