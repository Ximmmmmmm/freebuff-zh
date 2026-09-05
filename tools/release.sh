#!/usr/bin/env bash
# 打包 output/ 为汉化包并发布 GitHub Release —— 多开控制器的「汉化包更新」
# 从该 Release 检查 / 下载 / 校验（SHA512）/ 落到 output/，点「应用汉化」生效。
#
# 用法：
#   bash tools/release.sh               # 打包并上传（需要 gh CLI 已登录）
#   bash tools/release.sh --no-upload   # 只打包到 dist/，打印手工上传步骤
#   bash tools/release.sh --force       # 覆盖同 packVersion 发布（默认拒绝不升版本的发布）
#
# 发布前确认 output/ 是最新构建（bash build.sh）。packVersion 在 manifest.json
# 里维护：跟随 targetVersion、与其保持一致；同版本重发需追加 --force（客户端
# 对「packVersion <= 已暂存」的包会静默跳过，除非先清掉已装的包版本戳）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="Ximmmmmmm/freebuff-zh"
UPLOAD=1
FORCE=0
for a in "$@"; do
  case "$a" in
    --no-upload) UPLOAD=0 ;;
    --force)     FORCE=1 ;;
    *) echo "未知参数：$a（支持 --no-upload / --force）" >&2; exit 1 ;;
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

gh release create "pack-v${VER}" "${ZIP}" "${MANIFEST}" -R "${REPO}" \
  --title "汉化包 v${VER}（适配 Freebuff v${TARGET}）" \
  --notes "词典/补丁适配 Freebuff Desktop v${TARGET}。控制器会自动检查并下载，点「应用汉化」生效。"
echo "已发布 Release pack-v${VER}。控制器下次检查即可拉到新包。"
