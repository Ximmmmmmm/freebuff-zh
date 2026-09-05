#!/usr/bin/env bash
# Freebuff 汉化包全自动更新流水线（Linux 服务器版）
#
# 监测 Freebuff Desktop 新版本 → 下载官方安装包 → 解出原版 → remap → 构建 → 发布 Release
# 有新增未翻译文案时自动中止，只发通知，不发半成品。
#
# 依赖：bash / curl / unzip / node 20+ / npx（拉 @electron/asar）/ gh CLI（已登录）
# 用法：
#   bash tools/autoupdate.sh                 # 单次检查
#   bash tools/autoupdate.sh --force         # 跳过"版本未变"短路，强制重建
# 配合 cron（每 30 分钟）：
#   */30 * * * * cd /opt/freebuff-zh && bash tools/autoupdate.sh >> work/autoupdate.log 2>&1
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${HERE}"

FORCE=0
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    *) echo "未知参数：$a" >&2; exit 1 ;;
  esac
done

mkdir -p work downloads

log() { echo "[$(date '+%F %T')] $*"; }

# 官方安装包信息：GitHub Releases 上的 freebuff-desktop-v* tag（freebuff.com 的
# 下载直链 302 到这里的 asset）。
OWNER=CodebuffAI
REPO=codebuff-community
OFFICIAL_DL="https://freebuff.com/api/desktop/download/windows"

# --- 1. 探测最新版本 ----------------------------------------------------------
# 注意：官方的 freebuff-desktop-v* tag 混在 codebuff-community 仓库里，但列表页前
# 几十页全是 codebuff CLI 的 v1.0.x release，按列表过滤会扑空。官方下载直链是
# 302 到最新 desktop 安装包（和控制器 CheckVersionAsync 同一招），跟随重定向拿
# 版本号最稳。
LOC="$(curl -sI --max-time 30 "${OFFICIAL_DL}" | tr -d '\r' | grep -i '^location:' | awk '{print $2}')"
LATEST_TAG="$(echo "${LOC}" | grep -oE 'freebuff-desktop-v[0-9.]+')"

if [ -z "${LATEST_TAG}" ]; then
  log "无法从官方下载直链解析最新版本（location=${LOC:-空}），退出"
  exit 0
fi

NEWVER="${LATEST_TAG#freebuff-desktop-v}"
CURVER="$(node -e 'const m=require("./manifest.json"); console.log(m.targetVersion)')"
log "官方最新: ${NEWVER} / 当前适配: ${CURVER}"

if [ "${NEWVER}" = "${CURVER}" ] && [ "${FORCE}" -eq 0 ]; then
  log "版本未变，无需更新"
  exit 0
fi

# --- 2. 下载官方安装包（win-x64）与 latest.yml --------------------------------
ASSET_EXE="Freebuff-${NEWVER}-win-x64.exe"
ASSET_YML="Freebuff-${NEWVER}-win-x64.yml"
# GitHub release 资产完整 URL；镜像源以「镜像前缀 + 完整 GitHub URL」转发
GH_EXE_URL="https://github.com/${OWNER}/${REPO}/releases/download/${LATEST_TAG}/${ASSET_EXE}"
GH_YML_URL="https://github.com/${OWNER}/${REPO}/releases/download/${LATEST_TAG}/${ASSET_YML}"

EXE_PATH="downloads/${ASSET_EXE}"
YML_PATH="downloads/${ASSET_YML}"

# 国内服务器直连 GitHub release 资产常被限速到 ~30KB/s（甚至握手后超时），
# 走加速镜像通常快 40 倍（实测 ghfast.top ≈ 1.2MB/s）。列表按速度排序，官方直连
# 作最后兑底（空前缀）。内容一致性由下载完成后的 sha512 校验保证，镜像只搬运不改内容。
SOURCES=(
  "https://ghfast.top/"
  "https://gh-proxy.com/"
  ""
)

# 下载小文件（latest.yml）：依次试各源，任一成功即可（镜像前缀 + 完整 GitHub URL）
fetch_small() { # $1=完整 GitHub URL $2=输出 $3=超时秒
  local full="$1" out="$2" tm="$3" src url
  for src in "${SOURCES[@]}"; do
    url="${src}${full}"
    if curl -sL --max-time "${tm}" -o "${out}" "${url}" && grep -q '^sha512:' "${out}" 2>/dev/null; then
      return 0
    fi
    log "  源 ${src}失败，换下一个"
  done
  return 1
}

log "下载 ${ASSET_YML}（镜像优先）..."
YML_OK=0
for i in $(seq 1 10); do
  if fetch_small "${GH_YML_URL}" "${YML_PATH}" 90; then YML_OK=1; break; fi
  log "latest.yml 下载失败（第 ${i} 次），5 秒后重试"
  sleep 5
done
[ "${YML_OK}" -eq 1 ] && [ -s "${YML_PATH}" ] || { log "ERROR: latest.yml 下载失败"; exit 1; }

EXPECT_B64="$(grep -m1 '^sha512:' "${YML_PATH}" | awk '{print $2}')"
if [ -z "${EXPECT_B64}" ]; then
  log "ERROR: latest.yml 里没有 sha512，无法校验"
  exit 1
fi
EXPECT_HEX="$(node -e "console.log(Buffer.from('${EXPECT_B64}','base64').toString('hex'))")"

# 下载大文件（exe）：跨源断点续传（-C -），每轮轮流试各镜像，直到 sha512 匹配。
# 注意 curl -C - 在本地文件已等长时返回 416（退出码 33），此时若 sha 仍未过，
# 说明文件损坏，删掉重新下载。
log "下载 ${ASSET_EXE}（镜像优先 + 断点续传，SHA512 校验）..."
for round in $(seq 1 60); do
  ACTUAL_HEX="$(sha512sum "${EXE_PATH}" 2>/dev/null | awk '{print $1}')"
  if [ "${EXPECT_HEX}" = "${ACTUAL_HEX}" ]; then
    log "SHA512 校验通过（第 ${round} 轮）"
    break
  fi
  for src in "${SOURCES[@]}"; do
    url="${src}${GH_EXE_URL}"
    if curl -sL -C - --max-time 900 -o "${EXE_PATH}" "${url}" 2>/dev/null; then
      break
    elif [ "$?" -eq 33 ]; then
      log "  ${src}：本地文件已等长但 sha512 未过（416），删除重下"
      rm -f "${EXE_PATH}"
    else
      log "  ${src} 下载中断，换下一个源"
    fi
  done
  ACTUAL_HEX="$(sha512sum "${EXE_PATH}" 2>/dev/null | awk '{print $1}')"
  if [ "${EXPECT_HEX}" = "${ACTUAL_HEX}" ]; then
    log "SHA512 校验通过（第 ${round} 轮）"
    break
  fi
  log "第 ${round} 轮未完成，8 秒后重试..."
  sleep 8
done
ACTUAL_HEX="$(sha512sum "${EXE_PATH}" 2>/dev/null | awk '{print $1}')"
if [ "${EXPECT_HEX}" != "${ACTUAL_HEX:-}" ]; then
  log "ERROR: 多次尝试后 SHA512 仍不匹配（官方包下载不完整或被篡改）"
  exit 1
fi

# --- 3. 从安装包解出原版 app.asar 与 ui/ --------------------------------------
# NSIS 安装包用 7z 解出的是外壳（$PLUGINSDIR/app-64.7z 内嵌真正的应用 payload，
# Electron 多文件结构），需二次解压 app-*.7z 才能拿到 resources/。
command -v 7z >/dev/null || { log "ERROR: 需要 7z（apt install p7zip-full）"; exit 1; }

STAGE="work/pristine-${NEWVER}"
rm -rf "${STAGE}"; mkdir -p "${STAGE}/installer"
7z x -y -o"${STAGE}/installer" "${EXE_PATH}" >/dev/null 2>&1 || { log "ERROR: 7z 解外层 NSIS 失败"; exit 1; }

# 二次解压内嵌 payload（app-*.7z / archive 等命名，全局找最大的 .7z）
INNER_7Z="$(find "${STAGE}/installer" -name '*.7z' -printf '%s %p\n' 2>/dev/null | sort -rn | head -1 | awk '{print $2}')"
if [ -n "${INNER_7Z}" ]; then
  log "内嵌 payload: ${INNER_7Z}，二次解压..."
  7z x -y -o"${STAGE}/app" "${INNER_7Z}" >/dev/null 2>&1 || { log "ERROR: 7z 二次解压失败"; exit 1; }
else
  # 无内嵌压缩包：外层即应用目录（老版本/其他打包方式兑底）
  mkdir -p "${STAGE}/app"
  cp -r "${STAGE}"/installer/. "${STAGE}/app/" 2>/dev/null || true
fi

# 安装包内布局（Electron）：resources/app.asar 与 resources/orchestrator/ui/
PRISTINE_ASAR="${STAGE}/app/resources/app.asar"
PRISTINE_UI="${STAGE}/app/resources/orchestrator/ui"
if [ ! -f "${PRISTINE_ASAR}" ] || [ ! -d "${PRISTINE_UI}" ]; then
  # 布局兜底：全局搜一遍，避免官方调整目录结构后管线挂掉
  PRISTINE_ASAR="$(find "${STAGE}" -name app.asar | head -1)"
  PRISTINE_UI="$(find "${STAGE}" -type d -name ui | grep orchestrator | head -1)"
fi
[ -f "${PRISTINE_ASAR}" ] && [ -d "${PRISTINE_UI}" ] || { log "ERROR: 安装包里找不到 app.asar / ui"; exit 1; }
log "原版就绪: ${PRISTINE_ASAR}"

# --- 4. 版本变化时才更新 manifest（同版本 --force 重建会留下假 diff）---------
# 注意 manifest.json 是 CRLF 行尾，node 以 LF 重写会造出无意义 diff，所以非换行尾策略：
# 直接用 node 读改后以原文件换行风格写回。
if [ "${NEWVER}" != "${CURVER}" ]; then
  node -e "
const fs=require('fs');
const p='manifest.json';
const raw=fs.readFileSync(p,'utf8');
const nl=raw.includes('\\r\\n') ? '\\r\\n' : '\\n';
const m=JSON.parse(raw);
m.targetVersion='${NEWVER}'; m.packVersion='${NEWVER}';
fs.writeFileSync(p, JSON.stringify(m,null,2).split('\\n').join(nl)+nl);
"
  log "manifest.json → target=${NEWVER} pack=${NEWVER}"
else
  log "manifest.json 版本未变（${NEWVER}），跳过重写"
fi

# 主 bundle 在 ui/assets/index-*.js；remap 自动迁移 ${...} 变量名（dict.json 若
# 被改出实质 diff，提交阶段会体现——同版本重建时 remap 无变化则不会触发发布）
BUNDLE="$(ls "${PRISTINE_UI}"/assets/index-*.js 2>/dev/null | head -1 || true)"
if [ -n "${BUNDLE}" ]; then
  log "remap 模板变量..."
  node tools/remap.js "${BUNDLE}" --write || true
fi

# --- 5/6. 构建 + 残留扫描（tools/update.sh 内建构建与防呆自检）---------------
# 有未翻译新增文案或构建失败就不发布，只留报告。
REPORT="work/update-${NEWVER}.txt"
log "构建 + 残留扫描（日志: ${REPORT}）..."
set +e
{
  echo "=== autoupdate ${NEWVER} 构建 + 残留扫描 ==="
  bash tools/update.sh "${PRISTINE_ASAR}" "${PRISTINE_UI}"
} > "${REPORT}" 2>&1
RC=$?
set -e

if [ "${RC}" -ne 0 ]; then
  if grep -qE "MISSED|未命中" "${REPORT}"; then
    log "有新增未翻译文案——不发布半成品。请人工补翻 dict.json 后重跑（--force）。报告: ${REPORT}"
    git checkout -- manifest.json dict.json 2>/dev/null || true
    exit 2
  fi
  log "ERROR: 构建/自检失败（退出码 ${RC}），不发布。报告: ${REPORT}"
  git checkout -- manifest.json dict.json 2>/dev/null || true
  exit 1
fi

# --- 7. 提交 + 发布 Release ---------------------------------------------------
git add manifest.json dict.json
if git diff --cached --quiet; then
  log "无词典/版本变更（同版本 --force 重建？），跳过提交与发布"
  exit 0
fi
git -c user.name="hanhua-bot" -c user.email="bot@users.noreply.github.com" \
  commit -m "适配 Freebuff v${NEWVER}（autoupdate）"
git push origin "$(git branch --show-current)"

# 只有确实产生提交（版本/词典变化）才发布 Release；release.sh 自带版本防呆
bash tools/release.sh
log "✅ Freebuff v${NEWVER} 汉化包已发布。控制器会在 30 分钟内提示用户更新。"
