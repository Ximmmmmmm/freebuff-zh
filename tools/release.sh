#!/usr/bin/env bash
# 打包 output/ 为汉化包并发布 GitHub Release —— 多开控制器的「汉化包更新」
# 从该 Release 检查 / 下载 / 校验（SHA512）/ 落到 output/，随后自动应用（无需点击）。
#
# 用法：
#   bash tools/release.sh               # 打包并上传（需要 gh CLI 已登录）
#   bash tools/release.sh --no-upload   # 只打包到 dist/，打印手工上传步骤
#   bash tools/release.sh --force       # 覆盖同 packVersion 发布（默认拒绝不升版本的发布）
#   bash tools/release.sh --allow-english # 两道英文闸门只报告不拦截（确认新英文是有意保留时）
#
# 发布前的两道英文闸门（都要过）：
#   1. 主进程扫描（tools/mainscan.js）：原版 `electron/*.cjs` vs 本次产物——词典只替双引号
#      字面量，主进程的菜单 / 原生对话框 / `shell:openIn` 报错 / MCP 同意窗口全靠 patches/，
#      漏一条不会有任何构建报错。原版取自本机最新 hanhua-backup-*（与 build.sh 同源），
#      没有就拿原版快照仓库里的 `work/pristine/<targetVersion>/`（省一次解包，也不要求
#      发布机装过 Freebuff——`pristine.js import --from-release` 取一份就有了）；
#   2. 回归闸门（tools/regress.js）：本次产物 vs 上一版已发布包，揪「变回英文」的静默回归。
#
# 发布成功后会把本版英文原版快照作为附加资产传上去（tools/pristine.js publish，失败只 WARN）：
# 别的机器 `pristine.js import --from-release <targetVersion>` 就能拿到「上一版英文原版」，
# 不必手工拷文件、也不依赖本机的更新缓存（那里装完即删，根本掘不到上一版）。
#
# 发布前确认 output/ 是最新构建（bash build.sh）。packVersion 在 manifest.json
# 里维护：跟随 targetVersion、与其保持一致；同版本重发需追加 --force（客户端
# 对「packVersion <= 已暂存」的包会静默跳过，除非先清掉已装的包版本戳）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="Ximmmmmmm/freebuff-zh"
UPLOAD=1
FORCE=0
ALLOW_ENGLISH=0
for a in "$@"; do
  case "$a" in
    --no-upload)     UPLOAD=0 ;;
    --force)         FORCE=1 ;;
    --allow-english) ALLOW_ENGLISH=1 ;;
    *) echo "未知参数：$a（支持 --no-upload / --force / --allow-english）" >&2; exit 1 ;;
  esac
done

if [ ! -f "${HERE}/output/app.asar" ] || [ ! -f "${HERE}/output/ui/index.html" ]; then
  echo "ERROR: 缺少 output/ 构建产物，先 bash build.sh" >&2
  exit 1
fi
grep -q 'hanhua-pack' "${HERE}/output/ui/index.html" || {
  echo "ERROR: output/ui/index.html 缺少 hanhua-pack 版本戳——请用最新 build.sh 重新构建" >&2
  exit 1
}

VER="$(node -e 'const m = require(process.argv[1]); console.log(m.packVersion || m.targetVersion)' "${HERE}/manifest.json")"
TARGET="$(node -e 'const m = require(process.argv[1]); console.log(m.targetVersion)' "${HERE}/manifest.json")"
ASSET="hanhua-pack-${VER}.zip"

# packVersion 防呆：客户端对「packVersion <= 已暂存」的包会静默跳过，因此
# 发布前对比远端最新 pack-manifest，版本没升就拒绝（--force 才允许覆盖）。
REMOTE_VER=""
MURL="$(gh api "repos/${REPO}/releases/latest" --jq '.assets[] | select(.name=="pack-manifest.json") | .browser_download_url' 2>/dev/null || true)"
if [ -n "${MURL}" ]; then
  REMOTE_VER="$(curl -sL "${MURL}" 2>/dev/null | node -e 'let s = ""; process.stdin.on("data", (d) => s += d); process.stdin.on("end", () => { try { console.log(JSON.parse(s).packVersion || ""); } catch { console.log(""); } })' 2>/dev/null || true)"
fi
if [ -n "${REMOTE_VER}" ]; then
  ORDER="$(printf '%s\n%s\n' "${VER}" "${REMOTE_VER}" | sort -V | head -1)"
  if [ "${ORDER}" = "${VER}" ] && [ "${FORCE}" -eq 0 ]; then
    echo "ERROR: 本地 packVersion (${VER}) 不高于远端已发布的 (${REMOTE_VER})——客户端会静默跳过这个包。" >&2
    echo "  请在 manifest.json 里调高 packVersion（跟随新 targetVersion）后重跑；确要覆盖同版本请追加 --force。" >&2
    exit 1
  fi
  echo "远端 packVersion: ${REMOTE_VER}；本次发布: ${VER}"
fi

# --- 闸门一：主进程（electron/*.cjs）里还有没有英文文案 -------------------------
# 为什么发布时还要再扫一遍：构建期没有任何东西会为主进程的漏翻报错——`uipos` / `fieldscan` /
# `blindscan` / 回归闸门全都只看 UI bundle，而主进程文案靠在 `patches/` 里手写。`update.sh`
# 的第 5 步已经在适配时报过一次（只报告不拦），但「补没补完」只有发布这道口子拦得住：
# 0.0.113 适配时就有一批从 0.0.104 以前就在的文案，是到了补翻那一步才被发现的。
# 原版来源与 build.sh 一致：优先最新 hanhua-backup-*，其次安装目录当前那份英文 app.asar。
echo
echo "== 闸门一：主进程英文扫描（原版 electron/*.cjs vs 本次产物）=="
MAIN_RC=2
PRISTINE_ASAR=""
PRISTINE_TREE=""
INSTALL="${LOCALAPPDATA:-}/Programs/@codebufffreebuff-desktop"
BK="$(ls -1dt "${INSTALL}/resources"/hanhua-backup-* 2>/dev/null | head -1 || true)"
if [ -n "${BK}" ] && [ -f "${BK}/app.asar" ]; then
  PRISTINE_ASAR="${BK}/app.asar"
elif [ -f "${INSTALL}/resources/app.asar" ] &&
     ! grep -q '<html lang="zh-CN">' "${INSTALL}/resources/orchestrator/ui/index.html" 2>/dev/null; then
  PRISTINE_ASAR="${INSTALL}/resources/app.asar"
fi
# 没有本机原版时退一步用快照仓库：里边的 electron/*.cjs 就是原版那一份，不必再解包。
# 这一步让「发布机没装过 Freebuff」不再等于「字面量闸门白跑」——快照能从 Release 上取回来。
if [ -z "${PRISTINE_ASAR}" ]; then
  PRISTINE_TREE="$(node "${HERE}/tools/pristine.js" path "${TARGET}" --require-electron 2>/dev/null || true)"
fi
if [ -z "${PRISTINE_ASAR}" ] && [ -z "${PRISTINE_TREE}" ]; then
  # 不静默跳过：发布机缺英文原版时字面量闸门就等于没跑，这个事实必须被看见
  echo "  ! 找不到英文原版（没有 hanhua-backup-*、未装 Freebuff、快照仓库里也没有 v${TARGET}），本道闸门未执行" >&2
  echo "    补齐任一样即可：node tools/pristine.js import --from-release ${TARGET}   （或 capture --exe <安装包>）" >&2
else
  MAIN_TMP="$(mktemp -d)"
  # 解包出来的树里有 Freebuff 自己的 vendored 二进制（`sdk/vendor/ripgrep/*/rg.exe`），
  # Windows 上偶尔被安全软件 / 正在运行的应用短暂占住而删不掉。清理失败绝不能把发布
  # 变成「闸门没跑完就 abort」——那样看到的退出码和真拦截长得一模一样。
  set +e
  if [ -n "${PRISTINE_ASAR}" ]; then
    echo "  原版：${PRISTINE_ASAR}"
    npx -y @electron/asar extract "${PRISTINE_ASAR}" "${MAIN_TMP}/pristine" >/dev/null 2>&1
    MAIN_R1=$?
    PRISTINE_TREE="${MAIN_TMP}/pristine"
  else
    echo "  原版：快照仓库 work/pristine/${TARGET}（含 electron/，免解包）"
    MAIN_R1=0
  fi
  npx -y @electron/asar extract "${HERE}/output/app.asar" "${MAIN_TMP}/built" >/dev/null 2>&1
  MAIN_R2=$?
  set -e
  if [ "${MAIN_R1}" -ne 0 ] || [ "${MAIN_R2}" -ne 0 ]; then
    echo "  ! app.asar 解包失败（npx @electron/asar 不可用？），本道闸门未执行" >&2
  else
    set +e
    node "${HERE}/tools/mainscan.js" "${PRISTINE_TREE}" "${MAIN_TMP}/built"
    MAIN_RC=$?
    set -e
  fi
  rm -rf "${MAIN_TMP}" 2>/dev/null || echo "  ! 临时目录未能删除：${MAIN_TMP}（不影响闸门结论，可手工删）" >&2
fi
case "${MAIN_RC}" in
  0) echo "  ✓ 主进程未发现漏翻（其余英文都在 INTENTIONAL 名单里）" ;;
  1)
    if [ "${ALLOW_ENGLISH}" -eq 1 ]; then
      echo "  WARN: 上述疑似漏翻由 --allow-english 放行" >&2
    else
      echo "ERROR: 主进程英文闸门拦住本次发布。上面的文案在英文原版里存在、产物里还是英文。" >&2
      echo "  补翻路径：写进 patches/electron-*.patch（词典只管双引号字面量，这些是单引号 / 模板）" >&2
      echo "  后重跑 bash build.sh；确认它就该保留英文时，把它加进 tools/mainscan.js 的" >&2
      echo "  INTENTIONAL 名单并写明理由（下次不再重复报）；临时放行：--allow-english。" >&2
      exit 1
    fi
    ;;
  *) echo "  ! 本道闸门未能完成比对，跳过（这次发布没有保证主进程是干净的）" >&2 ;;
esac

# --- 闸门二：回归闸门（新构建 vs 上一版已发布产物）-------------------------------------
# 版本适配时常出现「词典全命中、但某句因变体合并而变回英文」的静默回归（0.0.103 就中过一次：
# 两条只有变量名不同的词条被 remap 指到同一处互相覆盖）。这种漏翻 build.sh 拦不住，只有把
# 新旧两版产物对一遍才看得出来。取不到上一版包（首次发布 / 离线）只警告不拦。
echo
echo "== 闸门二：回归闸门（对比上一版已发布产物）=="
if [ "${ALLOW_ENGLISH}" -eq 1 ]; then
  echo "  （--allow-english：两道闸门都只报告不拦截）"
fi
PREV_TAG=""
if command -v gh >/dev/null 2>&1; then
  PREV_TAG="$(gh release list -R "${REPO}" -L 30 --json tagName \
    --jq "[.[].tagName] | map(select(. != \"pack-v${VER}\")) | .[0]" 2>/dev/null || true)"
fi
GATE_RC=2
if [ -z "${PREV_TAG}" ]; then
  echo "  ! 未找到上一版 Release（首次发布或 gh 不可用），跳过"
else
  PREV_URL="$(gh release view "${PREV_TAG}" -R "${REPO}" --json assets \
    --jq '.assets[] | select(.name | startswith("hanhua-pack-")) | .url' 2>/dev/null || true)"
  GATE_TMP="$(mktemp -d)"
  if [ -n "${PREV_URL}" ]; then
    curl -sL -H 'Accept: application/octet-stream' "${PREV_URL}" -o "${GATE_TMP}/prev.zip" || true
  fi
  if [ -s "${GATE_TMP}/prev.zip" ]; then
    set +e
    node "${HERE}/tools/regress.js" "${GATE_TMP}/prev.zip" "${HERE}/output"
    GATE_RC=$?
    set -e
  else
    echo "  ! 未能下载 ${PREV_TAG} 的汉化包，跳过"
  fi
  rm -rf "${GATE_TMP}"
fi
case "${GATE_RC}" in
  0) echo "  ✓ 相对 ${PREV_TAG} 未发现新增英文片段" ;;
  1)
    if [ "${ALLOW_ENGLISH}" -eq 1 ]; then
      echo "  WARN: 上述英文片段由 --allow-english 放行" >&2
    else
      echo "ERROR: 回归闸门拦住本次发布。请先把上面的片段补齐（dict.json → bash build.sh），" >&2
      echo "  确认确实要保留英文时再用 bash tools/release.sh --allow-english 重跑。" >&2
      exit 1
    fi
    ;;
  *) echo "  ! 闸门未能完成比对，跳过" ;;
esac

DIST="${HERE}/dist"
mkdir -p "${DIST}"
ZIP="${DIST}/${ASSET}"
rm -f "${ZIP}"
# 打 zip 跨平台：Windows 用自带 bsdtar（System32/tar.exe，条目用正斜杠且能写 zip）；
# Linux 服务器优先 zip 命令，其次 7z（-tzip）。GNU tar 不支持 -a 写 zip。
make_zip() {
  local out="$1"
  if [ -n "${SYSTEMROOT:-}" ] && [ -f "${SYSTEMROOT}/System32/tar.exe" ]; then
    (cd "${HERE}/output" && "${SYSTEMROOT}/System32/tar.exe" -a -cf "${out}" app.asar ui)
  elif command -v zip >/dev/null 2>&1; then
    (cd "${HERE}/output" && zip -q -r "${out}" app.asar ui)
  elif command -v 7z >/dev/null 2>&1; then
    (cd "${HERE}/output" && 7z a -tzip -y "${out}" app.asar ui >/dev/null)
  else
    echo "ERROR: 打 zip 需要 Windows bsdtar / zip / 7z 之一" >&2
    exit 1
  fi
}
make_zip "${ZIP}"

SHA="$(node -e 'const c = require("crypto"); console.log(c.createHash("sha512").update(require("fs").readFileSync(process.argv[1])).digest("base64"))' "${ZIP}")"
MANIFEST="${DIST}/pack-manifest.json"
node -e 'const fs = require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({ packVersion: process.argv[2], targetVersion: process.argv[3], asset: process.argv[4], sha512: process.argv[5] }, null, 2) + "\n")' \
  "${MANIFEST}" "${VER}" "${TARGET}" "${ASSET}" "${SHA}"

echo "汉化包已打包：${ZIP}"
echo "  packVersion=${VER}  targetVersion=${TARGET}  sha512(-base64)=${SHA:0:16}…"
echo
echo "⚠ 提醒：发布的是派生自 Freebuff 专有软件的汉化产物，按 README 声明仅限"
echo "  面向已合法获取 Freebuff 的用户供个人自用分发（勿商用）；声明如有调整请同步 README。"

if [ "${UPLOAD}" -eq 0 ]; then
  echo
  echo "（--no-upload）手工上传步骤："
  echo "  1) 导出本版英文原版快照（别的机器要靠它拿到「上一版原版」）："
  echo "       node tools/pristine.js export ${TARGET} --out dist            # → dist/pristine-${TARGET}.json.gz"
  echo "  2) 建 Release 时把它一起传上去："
  echo "       gh release create pack-v${VER} \"${ZIP}\" \"${MANIFEST}\" dist/pristine-${TARGET}.json.gz -R ${REPO} \\"
  echo "         --title \"汉化包 v${VER}（适配 Freebuff v${TARGET}）\" \\"
  echo "         --notes \"词典/补丁适配 Freebuff Desktop v${TARGET}。\""
  echo "     （或用：node tools/pristine.js publish --tag pack-v${VER} —— 它会导出并 gh release upload 上去）"
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo
  echo "ERROR: 未安装 gh CLI，无法上传。安装并 gh auth login 后重跑，"
  echo "  或按上面 --no-upload 的步骤手工上传。" >&2
  exit 1
fi

# 同 packVersion 重发时 tag 已存在：gh release create 会拒绝。此时用
# upload --clobber 覆盖两个资产并 edit 更新标题/备注（同版本修正重发走这条路径）。
REL_TAG="pack-v${VER}"
if gh release view "${REL_TAG}" -R "${REPO}" >/dev/null 2>&1; then
  if [ "${FORCE}" -eq 0 ]; then
    echo "ERROR: Release ${REL_TAG} 已存在。重新发布同一 packVersion 会覆盖线上包，" >&2
    echo "  确认无误请追加 --force。" >&2
    exit 1
  fi
  echo "Release ${REL_TAG} 已存在（--force），覆盖资产并更新标题/备注…"
  gh release upload "${REL_TAG}" "${ZIP}" "${MANIFEST}" -R "${REPO}" --clobber
  gh release edit "${REL_TAG}" -R "${REPO}" \
    --title "汉化包 v${VER}（适配 Freebuff v${TARGET}）" \
    --notes "词典/补丁适配 Freebuff Desktop v${TARGET}。控制器会自动检查、下载并应用，无需手动操作。"
else
  gh release create "${REL_TAG}" "${ZIP}" "${MANIFEST}" -R "${REPO}" \
    --title "汉化包 v${VER}（适配 Freebuff v${TARGET}）" \
    --notes "词典/补丁适配 Freebuff Desktop v${TARGET}。控制器会自动检查、下载并应用，无需手动操作。"
fi
echo "已发布 Release ${REL_TAG}。控制器下次检查即可拉到新包。"

# 顺带把本版英文原版快照附到同一个 Release：这是「上一版英文原版」跨机器可取的唯一现成载体
# （本机的更新缓存装完即删、装机原版会被下次自动更新覆盖）。失败只提醒——快照缺的是
# 下一次适配的基线，不是这次的包。
if ! node "${HERE}/tools/pristine.js" publish --quiet; then
  echo "  ! 本版英文原版快照未能附上 Release（不影响本次发布）：node tools/pristine.js publish" >&2
fi
