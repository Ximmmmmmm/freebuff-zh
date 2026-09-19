#!/usr/bin/env bash
# Apply the 汉化 (Chinese localization) build to the installed Freebuff Desktop.
# - Backs up the current app.asar and ui/ to <install>/resources/hanhua-backup-<timestamp>/
# - Replaces resources/app.asar and resources/orchestrator/ui/
# Run from anywhere:  bash apply.sh [<构建目录>] [--force]
set -euo pipefail

INSTALL="${LOCALAPPDATA}/Programs/@codebufffreebuff-desktop"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- 参数：可选构建目录 + --force ------------------------------------------------
# 以前只有「第一个参数 = 构建目录」。加 --force 时不能用 `$1` 位置取，所以这里扫一遍。
FORCE=0
OUT=""
for arg in "$@"; do
  case "${arg}" in
    -f|--force) FORCE=1 ;;
    -*)
      echo "ERROR: 未知参数：${arg}（用法：bash apply.sh [<构建目录>] [--force]）" >&2
      exit 2
      ;;
    *)
      if [ -z "${OUT}" ]; then
        OUT="${arg}"
      else
        echo "ERROR: 多余的参数：${arg}（用法：bash apply.sh [<构建目录>] [--force]）" >&2
        exit 2
      fi
      ;;
  esac
done
# optional: source dir of the localized build (defaults to this repo's output/)
OUT="${OUT:-${HERE}/output}"

if [ ! -f "${OUT}/app.asar" ] || [ ! -d "${OUT}/ui" ]; then
  echo "ERROR: ${OUT}/app.asar or ${OUT}/ui missing — run the localization build first." >&2
  exit 1
fi
if [ ! -f "${INSTALL}/resources/app.asar" ]; then
  echo "ERROR: installed app not found at ${INSTALL}" >&2
  exit 1
fi

# --- 闸门：应用在跑就拒绝热换文件（除非 --force）----------------------------------
# restore.sh 早就挡住了这一条，理由是「文件被占用，删一半留半套」；apply.sh 当时只覆盖不删，
# 所以没加。但实测（2026-09-19，装机 0.0.124）它有一个更贵的后果：**混合态**。
#
# 装机文件是运行中的进程按需从磁盘读的，两侧时机并不一样：
#   · 渲染进程（resources/orchestrator/ui/index.html + assets）每个窗口加载/重载都重新读，
#     于是热换之后界面立刻变成中文；
#   · 主进程（app.asar 里的 electron/main.cjs）只在**进程启动时**读一次，热换之后它跑的
#     仍是换文件之前那一套代码。
# 换之前那一套若是英文原版，它就**不含** patches/electron-main.cjs.patch 的 launch id 复用
# 补丁（`apiLaunchToken ?? randomUUID()`）。本机 orchestrator（Bun）崩一次重启就会换一个新
# launch id，而渲染进程只把令牌读一次并永久缓存（preload.cjs 的 apiToken() → bundle 里的
# ID()），此后每个写操作都被判 403 {"error":"forbidden"}——界面显示「无法打开标签页:
# forbidden」/「消息未发送: forbidden」，只读功能照常，直到重载窗口。
#
# 根因是「换文件时应用在跑」，所以这里挡住；确实要热换（只想看一眼效果）用 --force，
# 但要记住：热换后请**彻底退出再启动**，不要只重载窗口（重载只换渲染侧，主进程仍是旧的）。
if [ "${FORCE}" != "1" ] && command -v tasklist >/dev/null 2>&1; then
  # tasklist 的 //FI 是 Git Bash 下避免路径转换的写法（与 restore.sh 一致）。
  if tasklist //FI "IMAGENAME eq Freebuff.exe" 2>/dev/null | grep -q 'Freebuff\.exe'; then
    echo "ERROR: 检测到 Freebuff 正在运行，已停止换文件。" >&2
    echo "  热换会留下「界面是新的、主进程还是旧的」混合态：旧的那套没有 launch id 复用补丁，" >&2
    echo "  orchestrator 崩一次重启就会让此后每个写操作都 403 forbidden（无法打开标签页 / 消息未发送）。" >&2
    echo "  请先完全退出 Freebuff（含多开实例）再运行；确实要热换用：bash apply.sh --force" >&2
    exit 1
  fi
fi

TS="$(date +%Y%m%d-%H%M%S)"
BK="${INSTALL}/resources/hanhua-backup-${TS}"
# 备份链必须保持英文原版——build.sh / remap 的回归测试都拿最新备份当 pristine。
# 装机已是汉化版时不再重复备份，否则汉化产物会被当成"原版"污染备份链。
if grep -q '<html lang="zh-CN">' "${INSTALL}/resources/orchestrator/ui/index.html" 2>/dev/null; then
  echo "当前装机已是汉化版，跳过备份（保留既有英文原版备份，避免污染备份链）。"
else
  mkdir -p "${BK}"
  cp "${INSTALL}/resources/app.asar" "${BK}/app.asar"
  cp -r "${INSTALL}/resources/orchestrator/ui" "${BK}/ui"
  echo "Backed up current files to: ${BK}"
fi

cp "${OUT}/app.asar" "${INSTALL}/resources/app.asar"
# 覆盖式更新，避免在应用运行中删除整目录被占用（device busy）
cp "${OUT}/ui/index.html" "${INSTALL}/resources/orchestrator/ui/index.html"
mkdir -p "${INSTALL}/resources/orchestrator/ui/assets"
cp -r "${OUT}/ui/assets/." "${INSTALL}/resources/orchestrator/ui/assets/"
echo "汉化已应用：app.asar 与 ui/ 已替换。"
echo "重启 Freebuff 桌面应用即可看到中文界面。"
if [ "${FORCE}" = "1" ]; then
  echo "注意（--force）：如果刚才有实例在跑，只重载窗口是不够的——主进程仍跑着换文件之前的"
  echo "  electron/main.cjs（热换造成的混合态）。请彻底退出 Freebuff 再启动。"
fi
