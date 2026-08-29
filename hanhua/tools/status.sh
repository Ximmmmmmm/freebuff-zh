#!/usr/bin/env bash
# 状态一览：装机内容 vs 本地构建产物 vs 备份，一眼判断该走哪条路。
#   - 装机已汉化且与 output 一致        → 无事可做
#   - 装机已汉化但 output 更新          → output 有新构建未安装
#   - 装机是英文原版（自动更新刚跑完）  → 按 docs/更新维护.md 处理
# 用法：bash tools/status.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RES="${LOCALAPPDATA}/Programs/@codebufffreebuff-desktop/resources"

line() { printf '  %-28s %s\n' "$1" "$2"; }

echo "== Freebuff 汉化状态 =="

# --- 装机 ---
if [ ! -f "${RES}/app.asar" ]; then
  echo "  ✗ 未找到安装目录 ${RES}"
  exit 1
fi
INSTALLED_LANG="英文原版"
if grep -q '<html lang="zh-CN">' "${RES}/orchestrator/ui/index.html" 2>/dev/null; then
  INSTALLED_LANG="已汉化"
fi
INSTALLED_BUNDLE="$(sed -n 's/.*src="\.\/\(assets\/index-[^"]*\.js\)".*/\1/p' "${RES}/orchestrator/ui/index.html" 2>/dev/null | head -1)"
line "装机 index.html" "${INSTALLED_LANG}"
line "装机 主 bundle" "${INSTALLED_BUNDLE:-未找到}"

# --- output 构建 ---
OUT_LANG="（无构建产物）"
OUT_BUNDLE=""
if [ -f "${HERE}/output/ui/index.html" ]; then
  grep -q '<html lang="zh-CN">' "${HERE}/output/ui/index.html" && OUT_LANG="已汉化" || OUT_LANG="未汉化!"
  OUT_BUNDLE="$(sed -n 's/.*src="\.\/\(assets\/index-[^"]*\.js\)".*/\1/p' "${HERE}/output/ui/index.html" | head -1)"
fi
line "output/index.html" "${OUT_LANG}"
line "output 主 bundle" "${OUT_BUNDLE:-—}"

SAME_ASAR="不同"
if cmp -s "${RES}/app.asar" "${HERE}/output/app.asar" 2>/dev/null; then
  SAME_ASAR="一致"
fi
line "app.asar 装机 vs output" "${SAME_ASAR}"

# --- 备份 ---
echo
echo "  备份（hanhua-backup-*，最新在上）:"
n=0
while IFS= read -r d; do
  [ -z "$d" ] && continue
  n=$((n + 1))
  echo "    $(basename "$d")"
done < <(ls -1dt "${RES}"/hanhua-backup-* 2>/dev/null || true)
[ "$n" -eq 0 ] && echo "    （无——从未 apply.sh 过，无法构建/还原）"

# --- 建议 ---
echo
echo "== 建议 =="
if [ "${INSTALLED_LANG}" = "英文原版" ]; then
  if [ -n "${OUT_BUNDLE}" ] && [ "${OUT_BUNDLE}" = "${INSTALLED_BUNDLE}" ]; then
    echo "  · 应用被自动更新过，但当前 output 正好对应该版本 → 直接 bash apply.sh"
  else
    echo "  · 应用是新的英文版本 → 跑 bash tools/update.sh 走完整迁移流程"
  fi
elif [ "${SAME_ASAR}" = "一致" ] && [ "${OUT_LANG}" = "已汉化" ]; then
  echo "  · 装机与 output 完全一致，汉化已是最新 ✓"
else
  echo "  · 装机与 output 不一致 → output 有更新，bash apply.sh 安装"
fi
