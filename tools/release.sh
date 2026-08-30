#!/usr/bin/env bash
# 打包 output/ 为汉化包并发布 GitHub Release —— 多开控制器的「汉化包更新」
# 从该 Release 检查 / 下载 / 校验（SHA512）/ 落到 output/，点「应用汉化」生效。
#
# 用法：
#   bash tools/release.sh               # 打包并上传（需要 gh CLI 已登录）
#   bash tools/release.sh --no-upload   # 只打包到 dist/，打印手工上传步骤
#
# 发布前确认 output/ 是最新构建（bash build.sh）。packVersion 在 manifest.json
# 里维护：适配新 Freebuff 版本时与 targetVersion 一起升；同版本的词典修复可只升
# packVersion。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="Ximmmmmmm/freebuff-zh"
UPLOAD=1
[ "${1:-}" = "--no-upload" ] && UPLOAD=0

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

DIST="${HERE}/dist"
mkdir -p "${DIST}"
ZIP="${DIST}/${ASSET}"
rm -f "${ZIP}"
# Windows 自带 bsdtar（System32）能写 zip 且条目用正斜杠；GNU tar 不支持 -a 写 zip
(cd "${HERE}/output" && "$SYSTEMROOT/System32/tar.exe" -a -cf "${ZIP}" app.asar ui)

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
