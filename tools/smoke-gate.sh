#!/usr/bin/env bash
# smoke-gate.sh — 构建/发布前的冒烟闸门：无头 Chromium 真实加载 output/ui，抓未捕获异常。
#
# 挡的是 0.0.100 那类事故：LLM 把代码语义位置（Lezer 节点名、枚举自映射）翻成中文，
# apply 后的静态检查（语法/守卫/postbuild 自检）全过，用户应用汉化后启动即崩。
# 静态规则只能挡"已知类别"，真实浏览器执行 bundle 才能挡住"未知类别"。
#
# 用法: bash tools/smoke-gate.sh [ui-dir]      # 默认 output/ui
# 退出码: 0=通过（含环境缺失时放行）  1=冒烟失败（产物有运行时污染风险）
# 副作用: 冒烟输出写入 ${HANHUA_SMOKE_LOG:-work/smoke-last.log}，供 smoke-heal.js 消费。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="${1:-${HERE}/output/ui}"
LOG="${HANHUA_SMOKE_LOG:-${HERE}/work/smoke-last.log}"
mkdir -p "$(dirname "${LOG}")"

if [ ! -d "${UI_DIR}" ]; then
  echo "smoke-gate: ${UI_DIR} 不存在，跳过冒烟" >&2
  exit 0
fi

set +e
OUT="$(node "${HERE}/tools/smoke-test.js" "${UI_DIR}" 2>&1)"
RC=$?
set -e
printf '%s\n' "${OUT}" | tee "${LOG}"

if [ "${RC}" -eq 0 ]; then
  exit 0
fi

# 退出码 3 = 缺 playwright/chromium。构建机未必装浏览器，此时只警告不阻断，
# 否则会把 Windows 本地构建全部卡死。
if [ "${RC}" -eq 3 ]; then
  echo "smoke-gate: 环境缺 playwright/chromium（exit 3）——本次放行，未做运行时校验" >&2
  exit 0
fi

echo "smoke-gate: 冒烟失败（exit ${RC}）——产物存在启动崩溃风险" >&2
exit 1
