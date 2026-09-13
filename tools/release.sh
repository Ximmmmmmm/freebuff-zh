#!/usr/bin/env bash
# 打包 output/ 为汉化包并发布 GitHub Release —— 多开控制器的「汉化包更新」
# 从该 Release 检查 / 下载 / 校验（SHA512）/ 落到 output/，随后自动应用（无需点击）。
#
# 用法：
#   bash tools/release.sh               # 打包并上传（需要 gh CLI 已登录）
#   bash tools/release.sh --no-upload   # 只打包到 dist/，打印手工上传步骤
#   bash tools/release.sh --force       # 覆盖同 packVersion 发布（默认拒绝不升版本的发布）
#   bash tools/release.sh --allow-english # 回归闸门只报告不拦截（确认新英文是有意保留时）
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

# --- 回归闸门：新构建 vs 上一版已发布产物 -------------------------------------
# 版本适配时常出现「词典全命中、但某句因变体合并而变回英文」的静默回归（0.0.103 就中过一次：
# 两条只有变量名不同的词条被 remap 指到同一处互相覆盖）。这种漏翻 build.sh 拦不住，只有把
# 新旧两版产物对一遍才看得出来。取不到上一版包（首次发布 / 离线）只警告不拦。
echo
echo "== 回归闸门（对比上一版已发布产物）=="
if [ "${ALLOW_ENGLISH}" -eq 1 ]; then
  echo "  （--allow-english：只报告不拦截）"
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
  echo "  gh release create pack-v${VER} \"${ZIP}\" \"${MANIFEST}\" -R ${REPO} \\"
  echo "    --title \"汉化包 v${VER}（适配 Freebuff v${TARGET}）\" \\"
  echo "    --notes \"词典/补丁适配 Freebuff Desktop v${TARGET}。\""
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
