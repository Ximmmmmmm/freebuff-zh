#!/usr/bin/env bash
# Freebuff 汉化包全自动更新流水线（Linux 服务器版）
#
# 监测 Freebuff Desktop 新版本 → 下载官方安装包 → 解出原版 → remap → 构建 → 发布 Release
# 有新增未翻译文案时自动中止，只发通知，不发半成品。
#
# 依赖：bash / curl / unzip / node 20+ / npx（拉 @electron/asar）/ gh CLI（已登录）
# 告警：失败/卡死/需人工时经 tools/notify.js 通知（.notify.json 配 webhook 多渠道；
#       未配置时用 gh 在仓库开 issue 兜底，同标题去重防刷屏，详见 docs/服务器自动更新.md）
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

# --- 失败告警 ------------------------------------------------------------------
# 渠道与去重逻辑见 tools/notify.js：.notify.json 配 webhook（feishu/wecom/bark/
# serverchan/generic）优先；未配置时用 gh 在仓库开 issue 兜底（复用发布用的登录）。
# 同标题只发一次（work/.notify-state），避免 30 分钟一次的 cron 对同一故障刷屏；
# 版本探测恢复或成功发布时自动清状态/关 issue。通知自身失败绝不阻塞主流程。
notify() { # $1=标题 $2=正文（可省略）
  node tools/notify.js "$1" "${2:-}" || true
}
notify_ok() { # $1=标题 $2=正文：恢复/成功通知（总是发送，并清告警状态、关兜底 issue）
  node tools/notify.js --ok "$1" "${2:-}" || true
}
fail() { # $1=退出码 $2=消息 $3=可选自定义告警标题
  log "ERROR: ${2}"
  notify "${3:-[freebuff-zh] 自动更新失败（v${NEWVER:-?}）}" "版本: ${NEWVER:-未知}
${2}
报告: ${REPORT:-（尚未生成）}"
  exit "${1}"
}

# --- 任务互斥锁 --------------------------------------------------------------
# 使用 Linux 原生 flock；锁由文件描述符持有，进程退出或异常终止时内核自动释放。
# 不删除锁文件，避免清理动作误删下一次任务刚获取的锁。
LOCK_FILE="${HERE}/work/.autoupdate.lock"
if ! command -v flock >/dev/null 2>&1; then
  log "ERROR: 当前系统缺少 flock，无法安全执行更新任务"
  exit 1
fi
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  # 锁长时间不释放 = 任务疑似卡死（正常最长一轮含 Codex 翻译约 15-20 分钟，留 90 分钟余量）
  LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "${LOCK_FILE}" 2>/dev/null || echo 0) ))
  if [ "${LOCK_AGE}" -gt 5400 ]; then
    notify "[freebuff-zh] 自动更新任务疑似卡死" "更新锁已持有 ${LOCK_AGE} 秒（超过 90 分钟），请上服务器检查进程与 work/autoupdate.log，必要时清理卡死进程。"
  fi
  log "已有更新任务运行中，本次跳过"
  exit 0
fi

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
  # 此前是静默退出——官方改下载页/302 结构时会永远查不到新版本且无人知晓，必须告警
  notify "[freebuff-zh] 官方版本探测失败" "无法从 freebuff.com 下载直链解析最新版本（location=${LOC:-空}）。官方可能调整了下载页或 302 结构，autoupdate 已失明，需人工检查探测逻辑。"
  exit 0
fi

NEWVER="${LATEST_TAG#freebuff-desktop-v}"
CURVER="$(node -e 'const m=require("./manifest.json"); console.log(m.targetVersion)')"
log "官方最新: ${NEWVER} / 当前适配: ${CURVER}"

if [ "${NEWVER}" = "${CURVER}" ] && [ "${FORCE}" -eq 0 ]; then
  log "版本未变，无需更新"
  # 探测链路正常工作 = 此前若有告警，此刻视为已恢复（清状态/关兜底 issue，不发通知）
  [ -f work/.notify-state ] && node tools/notify.js --reset >/dev/null 2>&1 || true
  exit 0
fi

# 从这里开始 manifest/dict 可能被 remap 或自动翻译修改。保存精确的运行前快照，
# 失败时恢复快照而不是 git checkout，避免误删用户在工作树里的既有未提交编辑。
ROLLBACK_DIR="$(mktemp -d "${HERE}/work/.autoupdate-state.XXXXXX")"
cp manifest.json "${ROLLBACK_DIR}/manifest.json"
cp dict.json "${ROLLBACK_DIR}/dict.json"
ROLLBACK_ENABLED=1
rollback_on_exit() {
  local rc=$?
  if [ "${ROLLBACK_ENABLED}" -eq 1 ]; then
    cp "${ROLLBACK_DIR}/manifest.json" manifest.json 2>/dev/null || true
    cp "${ROLLBACK_DIR}/dict.json" dict.json 2>/dev/null || true
    log "任务失败，已恢复 manifest.json 与 dict.json 的运行前状态"
  fi
  rm -rf "${ROLLBACK_DIR}" 2>/dev/null || true
  exit "${rc}"
}
trap rollback_on_exit EXIT

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
[ "${YML_OK}" -eq 1 ] && [ -s "${YML_PATH}" ] || fail 1 "latest.yml 下载失败（镜像与直连 10 轮重试均不可用）"

EXPECT_B64="$(grep -m1 '^sha512:' "${YML_PATH}" | awk '{print $2}')"
if [ -z "${EXPECT_B64}" ]; then
  fail 1 "latest.yml 里没有 sha512，无法校验（官方发布产物异常）"
fi
EXPECT_HEX="$(node -e "console.log(Buffer.from('${EXPECT_B64}','base64').toString('hex'))")"

# 下载大文件（exe）：跨源断点续传（-C -），每轮轮流试各镜像，直到 sha512 匹配。
# 注意 curl -C - 在本地文件已等长时返回 416（退出码 33），此时若 sha 仍未过，
# 说明文件损坏，删掉重新下载。
log "下载 ${ASSET_EXE}（镜像优先 + 断点续传，SHA512 校验）..."
for round in $(seq 1 60); do
  ACTUAL_HEX="$(sha512sum "${EXE_PATH}" 2>/dev/null | awk '{print $1}')" || ACTUAL_HEX=""
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
  ACTUAL_HEX="$(sha512sum "${EXE_PATH}" 2>/dev/null | awk '{print $1}')" || ACTUAL_HEX=""
  if [ "${EXPECT_HEX}" = "${ACTUAL_HEX}" ]; then
    log "SHA512 校验通过（第 ${round} 轮）"
    break
  fi
  log "第 ${round} 轮未完成，8 秒后重试..."
  sleep 8
done
ACTUAL_HEX="$(sha512sum "${EXE_PATH}" 2>/dev/null | awk '{print $1}')" || ACTUAL_HEX=""
if [ "${EXPECT_HEX}" != "${ACTUAL_HEX:-}" ]; then
  fail 1 "多次尝试后 SHA512 仍不匹配（官方包下载不完整或被篡改）"
fi

# --- 3. 从安装包解出原版 app.asar 与 ui/ --------------------------------------
# NSIS 安装包用 7z 解出的是外壳（$PLUGINSDIR/app-64.7z 内嵌真正的应用 payload，
# Electron 多文件结构），需二次解压 app-*.7z 才能拿到 resources/。
command -v 7z >/dev/null || fail 1 "缺少 7z（Alibaba Cloud Linux: yum install -y p7zip p7zip-plugins；Debian: apt install p7zip-full）"

STAGE="work/pristine-${NEWVER}"
rm -rf "${STAGE}"; mkdir -p "${STAGE}/installer"
7z x -y -o"${STAGE}/installer" "${EXE_PATH}" >/dev/null 2>&1 || fail 1 "7z 解外层 NSIS 失败（${ASSET_EXE}）"

# 二次解压内嵌 payload（app-*.7z / archive 等命名，全局找最大的 .7z）
INNER_7Z="$(find "${STAGE}/installer" -name '*.7z' -printf '%s %p\n' 2>/dev/null | sort -rn | head -1 | awk '{print $2}')"
if [ -n "${INNER_7Z}" ]; then
  log "内嵌 payload: ${INNER_7Z}，二次解压..."
  7z x -y -o"${STAGE}/app" "${INNER_7Z}" >/dev/null 2>&1 || fail 1 "7z 二次解压失败（${INNER_7Z}）"
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
[ -f "${PRISTINE_ASAR}" ] && [ -d "${PRISTINE_UI}" ] || fail 1 "安装包里找不到 app.asar / ui（官方打包布局可能变更，需适配解包逻辑）"
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
# 有未翻译新增文案或构建失败就不发布，只留报告。新增文案先自动翻译一轮（配置了
# .translator.json / HANHUA_LLM_* 时），仍有残留才中止人工。
REPORT="work/update-${NEWVER}.txt"
log "构建 + 残留扫描（日志: ${REPORT}）..."
set +e
{
  echo "=== autoupdate ${NEWVER} 构建 + 残留扫描 ==="
  bash tools/update.sh "${PRISTINE_ASAR}" "${PRISTINE_UI}"
} > "${REPORT}" 2>&1
RC=$?
set -e

# 主 bundle（自动翻译输入：英文原版，提取未入词典的新文案）
UI_BUNDLE="$(ls "${PRISTINE_UI}"/assets/index-*.js 2>/dev/null | head -1 || true)"

# 新版本文案的自动翻译（Codex 全程驱动）：优先 Codex agent 翻译，不可用时
# 降级 LLM 批量翻译（.translator.json 三模型链），最多三轮。每轮把新翻词条
# 合入 dict 后重建验证；仍 MISSED 才转人工。
AUTO_TRIES=0
NEED_TRANSLATE=0
if [ "${RC}" -ne 0 ] && grep -qE "MISSED|未命中" "${REPORT}" 2>/dev/null; then
  NEED_TRANSLATE=1
elif [ "${RC}" -eq 0 ] && [ -n "${UI_BUNDLE}" ] && { [ "${NEWVER}" != "${CURVER}" ] || [ "${FORCE}" -eq 1 ]; }; then
  # 纯新增文案不会让构建失败（如 0.0.98 的 "Thread mentions" 引导卡片），
  # 只按 MISSED 触发就会漏翻直接发布；版本变化或 --force 重建时用
  # codex-translate 的候选提取探测未入词典的新文案，有候选就进自动翻译。
  CAND_LOG="$(node tools/codex-translate.js "${UI_BUNDLE}" --extract-only --max 1 2>&1)" || true
  if printf '%s' "${CAND_LOG}" | grep -qE '候选 [0-9]+ 条'; then
    log "检测到未入词典的新文案候选，进入自动翻译"
    NEED_TRANSLATE=1
  fi
fi
while [ "${NEED_TRANSLATE}" -eq 1 ] && [ "${AUTO_TRIES}" -lt 3 ]; do
  if [ "${RC}" -ne 0 ] && ! grep -qE "MISSED|未命中" "${REPORT}" 2>/dev/null; then
    break  # 构建失败与词典无关（补丁/语法），不自动处理
  fi
  if [ -z "${UI_BUNDLE}" ]; then
    log "主 bundle 缺失——不能自动翻译，转人工"
    break
  fi
  AUTO_TRIES=$((AUTO_TRIES + 1))
  log "检测到新增未翻译文案（第 ${AUTO_TRIES} 轮自动翻译，源: ${UI_BUNDLE}）..."
  TR_OUT=""
  TR_RC=99
  # 第一优先：Codex agent 全程翻译（read-only sandbox + 确定性校验，见 codex-translate.js）
  if [ -f "tools/codex-translate.js" ] && command -v codex >/dev/null 2>&1; then
    log "Codex agent 翻译（第 ${AUTO_TRIES} 轮，源: ${UI_BUNDLE}）..."
    TR_RC=0
    TR_OUT="$(node tools/codex-translate.js "${UI_BUNDLE}" --report "${REPORT}" --max 150 2>&1)" || TR_RC=$?
  else
    log "codex CLI 不可用，跳过 Codex 翻译"
  fi
  # Codex 不可用/未产出时，降级 LLM 批量翻译（三模型链故障切换）
  if [ "${TR_RC}" -ne 0 ] || ! printf '%s' "${TR_OUT}" | grep -qE 'CODEX_TRANSLATE_OK'; then
    if { [ ! -s ".translator.json" ] && [ -z "${HANHUA_LLM_BASE:-}" ]; }; then
      log "无 .translator.json（或主 bundle 缺失）——不能自动翻译，转人工"
      break
    fi
    log "Codex 未生效（rc=${TR_RC}），降级 LLM 批量翻译..."
    TR_OUT=""
    TR_RC=0
    TR_OUT="$(node tools/autotranslate.js "${UI_BUNDLE}" --max 300 2>&1)" || TR_RC=$?
  fi
  printf '%s\n' "${TR_OUT}" | tail -20 | sed 's/^/  /'
  if [ "${TR_RC}" -ne 0 ]; then
    log "自动翻译未生效（检查 .translator.json 配置/LLM 可达性），转人工"
    break
  fi
  if printf '%s' "${TR_OUT}" | grep -qE '没有发现新的未翻译|AUTOTRANSLATE_NONE|CODEX_TRANSLATE_NONE|新增 0 条'; then
    log "自动翻译未发现可补词条（或全部被拒），转人工"
    break
  fi
  log "自动翻译完成，重新构建验证..."
  set +e
  {
    echo "=== autoupdate ${NEWVER} 构建 + 残留扫描（自动翻译后第 ${AUTO_TRIES} 轮）==="
    bash tools/update.sh "${PRISTINE_ASAR}" "${PRISTINE_UI}"
  } > "${REPORT}" 2>&1
  RC=$?
  set -e
  if [ "${RC}" -eq 0 ]; then NEED_TRANSLATE=0; fi
done

# --- 5.5/6. Codex agent 兜底 ---------------------------------------------------
# 自动翻译两轮后仍有 MISSED 时，让 Codex agent（deepseek-v4-flash，经净化代理）
# 产出迁移方案；agent-migrate.js 自带确定性校验（key 真实存在/占位符一致/代码
# 语义黑名单），一条不过全不落库。agent 失败不阻塞，照旧转人工。
if [ "${RC}" -ne 0 ] && [ -n "${UI_BUNDLE}" ] && grep -qE "MISSED|未命中" "${REPORT}" \
   && [ -f "tools/agent-migrate.js" ]; then
  log "自动翻译未解决的残留，尝试 Codex agent 修复..."
  AG_OUT=""
  AG_RC=0
  # set -e 下捕获 agent 的非零退出码，不能让失败直接跳出而绕过后续
  # 降级/回滚与人工提示。
  AG_OUT="$(node tools/agent-migrate.js "${REPORT}" "${UI_BUNDLE}" 2>&1)" || AG_RC=$?
  printf '%s\n' "${AG_OUT}" | tail -12 | sed 's/^/  /'
  if [ "${AG_RC}" -eq 0 ]; then
    log "agent 修复已落库，重新构建验证..."
    set +e
    {
      echo "=== autoupdate ${NEWVER} 构建 + 残留扫描（agent 修复后）==="
      bash tools/update.sh "${PRISTINE_ASAR}" "${PRISTINE_UI}"
    } > "${REPORT}" 2>&1
    RC=$?
    set -e
  else
    log "agent 修复未通过（退出码 ${AG_RC}），转人工"
  fi
fi

if [ "${RC}" -ne 0 ]; then
  if grep -qE "MISSED|未命中" "${REPORT}"; then
    log "自动翻译后仍有新增未翻译文案——不发布半成品。请人工补翻 dict.json 后重跑（--force）。报告: ${REPORT}"
    fail 2 "自动翻译（Codex/LLM 多轮）后仍有新增未翻译文案，已停止发布。请人工补翻 dict.json 后 bash tools/autoupdate.sh --force 重跑。报告: ${REPORT}" "[freebuff-zh] v${NEWVER} 需人工补翻新文案"
  fi
  fail 1 "构建/自检失败（退出码 ${RC}），不发布。报告: ${REPORT}"
fi

# --- 7. 提交 + 发布 Release ---------------------------------------------------
git add manifest.json dict.json
if git diff --cached --quiet; then
  ROLLBACK_ENABLED=0
  log "无词典/版本变更（同版本 --force 重建？），跳过提交与发布"
  exit 0
fi
git -c user.name="hanhua-bot" -c user.email="bot@users.noreply.github.com" \
  commit -m "适配 Freebuff v${NEWVER}（autoupdate）"
# 提交成功后快照已不再需要回滚；push/release 失败也不应撤销已提交的适配。
ROLLBACK_ENABLED=0
git push origin "$(git branch --show-current)" || fail 1 "git push 失败（远端不可达/凭据问题）；适配已本地提交，网络恢复后手动 git push 即可"

# 只有确实产生提交（版本/词典变化）才发布 Release；release.sh 自带版本防呆。
# 同版本修正（远端 packVersion 已等于本次）时 release.sh 默认拒绝，自动加
# --force 覆盖（客户端对 packVersion <= 已暂存的包会静默跳过，未装包的用户
# 和新升级用户能拿到修正后的包）。
REL_ARGS=""
REMOTE_MURL="$(gh api "repos/Ximmmmmmm/freebuff-zh/releases/latest" --jq '.assets[] | select(.name=="pack-manifest.json") | .browser_download_url' 2>/dev/null || true)"
if [ -n "${REMOTE_MURL}" ]; then
  REMOTE_PVER="$(curl -sL --max-time 30 "${REMOTE_MURL}" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{console.log(JSON.parse(s).packVersion||"")}catch{console.log("")}})' 2>/dev/null || true)"
  if [ -n "${REMOTE_PVER}" ] && [ "${REMOTE_PVER}" = "${NEWVER}" ]; then
    REL_ARGS="--force"
    log "远端已是 pack-v${NEWVER}（同版本修正），发布时带 --force 覆盖"
  fi
fi
bash tools/release.sh ${REL_ARGS} || fail 1 "release.sh 发布失败（gh 凭据/网络问题）；适配已提交推送，修复后可 bash tools/release.sh --force 单独补发"
log "✅ Freebuff v${NEWVER} 汉化包已发布。控制器会在 30 分钟内提示用户更新。"

# --- 8. 成功通知 + 磁盘清理 ----------------------------------------------------
# 发布成功 = 全链路恢复：发恢复通知（清告警状态、自动关闭此前兜底的 issue）。
notify_ok "[freebuff-zh] v${NEWVER} 汉化包已发布" "全自动适配成功：探测 → 下载（SHA512 校验）→ 自动翻译 → 构建 → 提交 → 发布。控制器会在 30 分钟内提示用户更新。"

# work/ 每个版本会累积 ~650MB 的 pristine 解包目录，downloads/ 每个版本 ~150MB
# 安装包，磁盘 84% 告急。保守清理：只删「非当前版本且 48h 前改动」的 pristine 与
# 安装包（宽限期避免误删正在排障的现场），报告与翻译前备份保留最近 15 份。
cleanup_old() {
  find work -maxdepth 1 -type d -name 'pristine-*' ! -name "pristine-${NEWVER}" -mtime +1 -exec rm -rf {} + 2>/dev/null || true
  find downloads -maxdepth 1 -type f \( -name 'Freebuff-*.exe' -o -name 'Freebuff-*.yml' \) ! -name "Freebuff-${NEWVER}-*" -mtime +1 -delete 2>/dev/null || true
  ls -1t work/update-*.txt 2>/dev/null | tail -n +16 | xargs -r rm -f 2>/dev/null || true
  ls -1t work/dict-before-*.json 2>/dev/null | tail -n +16 | xargs -r rm -f 2>/dev/null || true
}
CLEANED="$(cleanup_old && du -sh work downloads 2>/dev/null | tr '\n' ' ')"
log "清理完成，当前占用: ${CLEANED}"
