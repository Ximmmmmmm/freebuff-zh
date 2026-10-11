#!/usr/bin/env bash
# autopilot：上游发新版后的一键自动汉化。把「检测 → 登记 → 迁移 → 补翻 → 重建」串成一条链，
# 每一步都 fail-closed；到「发布」之前停下——四道闸门（release.sh）永远留给人工眼前过。
#
# 探测源：Freebuff Desktop 自己的更新 feed（app-update.yml 的 generic provider，
# https://freebuff.com/api/desktop/updates/win-x64/latest.yml，302 到 GitHub 资产）。
# 这就是应用自更新轮询的同一份权威源：version: 一行直出版本号，releaseNotes 附带本版变更说明。
# 上游 desktop release 在 CodebuffAI/codebuff-community 上标 prerelease——别用「releases 列表
# 过滤 prerelease」的常规套路去枚举，会一个都看不见；按 tag 精查才可靠。
#
# 用法：
#   bash tools/autopilot.sh --check     # 只探测：上游有没有比 manifest targetVersion 更新的版本
#   bash tools/autopilot.sh [--plan]    # 全流程（--plan 只打印执行计划就停，不落地）
#   bash tools/autopilot.sh --apply     # 全流程 + 构建全绿后 bash apply.sh 装机（restore.sh 可回滚）
#
#   默认不装机、不发布。发布 = 公开动作，永远人工跑 bash tools/release.sh。
#
# 全流程干什么（新版本已在本地装机、且装机文件是纯英文原版时）：
#   P1 源确认：装机版本 == 上游最新版？装机纯净性三查（lang 汉化污染 / LocalPatches 污染 / asar 在位）
#   P2 快照登记：pristine.js capture --asar --ui（upstreamdiff 的本版基线，幂等）
#   P3 补丁漂移自动修复：preflight 分诊 → 行号漂移 reanchor --all --write（纯机械）→ 还套不上
#      regen_patch --broken --write（搬既有译文；**含纯新增块的补丁会被它自己的 fail-closed 拒绝
#      写入**，转人工——0.0.154.1 的 HANHUA_SHELL_COLORS 就是不许自动化碰的东西）
#   P4 七步迁移：ALLOW_MISSED=1 bash tools/update.sh <装机 asar> <装机 ui>（缺口模式：新版改写
#      过的旧词条挂 MISSED 不拦构建；内部构建已换 build_locked.sh，WorkBuddy 持锁也落得了地）
#   P5 词典自动补翻：update.sh 生成的 changelist 骨干 → auto_translate.js 预填（术语表 + 词典记忆
#      + 可选 LLM）→ **dictapply --check 体检把关**（auto_translate 自己体检不过也退出 0，这里
#      必须显式再查一次）→ 过了才 dictapply --write 落进 dict.json
#   P6 重建验证：build_locked.sh 不带 ALLOW_MISSED 再构建——全绿 = 本版词典全覆盖
#   P7 总结：自动补了几条、还剩几条人工、报告在哪、下一步命令
#
# 退出码（配计划任务/CI 友好）：
#   0 = 上游无新版（已适配最新）；全流程走完且构建全绿；--plan 计划打印完
#   1 = 需要人工介入（补丁漂移修不动 / 预填体检不过 / 重建仍有缺口 / 装机源被污染）——附清单
#   2 = 环境 / 用法问题（装机目录不存在、feed 拉不动算网络问题走 1）
#   3 = 上游有新版，但本机还没装上（让应用自更新 / 手动装新版后重跑）
#
# 机器可读输出行（grep 友好）：STATUS=... / NEW_VERSION=... / INSTALLED_VERSION=... / ADAPTED_VERSION=...
# 环境覆盖（自测与换机器用）：
#   HANHUA_AUTOPILOT_FEED=<latest.yml 的 URL 或本地文件路径>
#   HANHUA_AUTOPILOT_INSTALL=<Freebuff 安装目录>
#   HANHUA_AUTOPILOT_MANIFEST=<manifest.json 路径>
#   HANHUA_AUTOPILOT_INSTALLED_VERSION=<直接给定装机版本，跳过 asar 解包读取>
#   HANHUA_AUTOPILOT_STOP_AFTER=plan（打印完计划就退 0）
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="${HERE}/work/autopilot-${STAMP}.log"
mkdir -p "${HERE}/work"

INSTALL="${HANHUA_AUTOPILOT_INSTALL:-${LOCALAPPDATA:-}/Programs/@codebufffreebuff-desktop}"
FEED_URL="${HANHUA_AUTOPILOT_FEED:-https://freebuff.com/api/desktop/updates/win-x64/latest.yml}"
MANIFEST="${HANHUA_AUTOPILOT_MANIFEST:-${HERE}/manifest.json}"
MODE="run"
APPLY=0
for a in "$@"; do
  case "$a" in
    --check) MODE="check" ;;
    --plan) MODE="plan" ;;
    --apply) APPLY=1 ;;
    -h|--help|help) sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "ERROR: 未知参数 $a（--check / --plan / --apply）" >&2; exit 2 ;;
  esac
done

log() { printf '%s\n' "$*" | tee -a "${LOG}"; }
die() { # die <exit-code> <message...>
  local rc="$1"; shift
  printf 'ERROR: %s\n' "$*" | tee -a "${LOG}" >&2
  printf 'STATUS=blocked\n' | tee -a "${LOG}"
  exit "$rc"
}

# 三段数值版本比较：ver_cmp a b → stdout 打 -1 / 0 / 1（「0.0.170」与「0.0.99」必须数值比，
# 字典序会把 0.0.99 排在 0.0.170 前面误判成「已是最新」）
ver_cmp() {
  local -a a b
  IFS='.' read -r -a a <<< "$1"
  IFS='.' read -r -a b <<< "$2"
  local a1="${a[0]:-0}" a2="${a[1]:-0}" a3="${a[2]:-0}"
  local b1="${b[0]:-0}" b2="${b[1]:-0}" b3="${b[2]:-0}"
  if   [ "$a1" -lt "$b1" ]; then echo -1
  elif [ "$a1" -gt "$b1" ]; then echo 1
  elif [ "$a2" -lt "$b2" ]; then echo -1
  elif [ "$a2" -gt "$b2" ]; then echo 1
  elif [ "$a3" -lt "$b3" ]; then echo -1
  elif [ "$a3" -gt "$b3" ]; then echo 1
  else echo 0; fi
}

# --- P0 探测：上游最新版 vs 已适配版 ------------------------------------------------
APP_ASAR="${INSTALL}/resources/app.asar"
UI_DIR="${INSTALL}/resources/orchestrator/ui"

[ -f "${MANIFEST}" ] || die 2 "manifest 不存在：${MANIFEST}"
ADAPTED="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).targetVersion||"")' "${MANIFEST}")"
[ -n "${ADAPTED}" ] || die 2 "manifest 里读不出 targetVersion：${MANIFEST}"

if [ -f "${FEED_URL}" ]; then
  FEED="$(cat "${FEED_URL}")"
else
  FEED="$(curl -sL --ssl-no-revoke --max-time 30 "${FEED_URL}" 2>>"${LOG}")" \
    || die 1 "上游 feed 拉取失败：${FEED_URL}（网络问题不等于「无新版」，按 fail-closed 处理）"
fi
UPSTREAM="$(printf '%s\n' "${FEED}" | sed -n 's/^version:[[:space:]]*\([0-9][0-9.]*\)[[:space:]]*$/\1/p' | head -1)"
[ -n "${UPSTREAM}" ] || die 1 "feed 解析不出版本号（不是合法的 latest.yml？）：${FEED_URL}"

log "== autopilot ${STAMP} =="
log "上游最新版:   ${UPSTREAM}（feed: ${FEED_URL}）"
log "已适配版本:   ${ADAPTED}（manifest targetVersion）"
printf 'ADAPTED_VERSION=%s\nNEW_VERSION=%s\n' "${ADAPTED}" "${UPSTREAM}" | tee -a "${LOG}"

CMP="$(ver_cmp "${UPSTREAM}" "${ADAPTED}")"
if [ "${CMP}" = "0" ]; then
  log "上游没有比已适配版更新的版本——无事可做。"
  printf 'STATUS=up-to-date\n' | tee -a "${LOG}"
  exit 0
elif [ "${CMP}" = "-1" ]; then
  log "上游最新版（${UPSTREAM}）比已适配版（${ADAPTED}）还旧？——像是上游回滚，人工确认后再动。"
  printf 'STATUS=upstream-rollback\n' | tee -a "${LOG}"
  exit 1
fi
log "上游有新版：${ADAPTED} → ${UPSTREAM}"
printf '%s\n' "${FEED}" | sed -n '/^releaseNotes: |/,$p' | head -6 | tee -a "${LOG}"

if [ "${MODE}" = "check" ]; then
  log "（--check 只探测。全流程：bash tools/autopilot.sh；装机后加 --apply）"
  printf 'STATUS=new-version\n' | tee -a "${LOG}"
  exit 3
fi

# --- P1 源确认：新版本得先装到本机，且必须是纯英文原版 --------------------------------
[ -d "${INSTALL}" ] || die 2 "Freebuff 安装目录不存在：${INSTALL}"
[ -f "${APP_ASAR}" ] || die 2 "装机 app.asar 不存在：${APP_ASAR}"
[ -f "${UI_DIR}/index.html" ] || die 2 "装机 ui/index.html 不存在：${UI_DIR}"

if [ -n "${HANHUA_AUTOPILOT_INSTALLED_VERSION:-}" ]; then
  INSTALLED="${HANHUA_AUTOPILOT_INSTALLED_VERSION}"
else
  VDIR="$(mktemp -d)"
  trap 'rm -rf "${VDIR}"' EXIT
  ( cd "${VDIR}" && npx -y @electron/asar ef "${APP_ASAR}" package.json ) >>"${LOG}" 2>&1 \
    || die 1 "装机 app.asar 的 package.json 解不出来（asar 损坏？）"
  INSTALLED="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version||"")' "${VDIR}/package.json")"
  [ -n "${INSTALLED}" ] || die 1 "装机 package.json 里没有 version 字段"
fi
printf 'INSTALLED_VERSION=%s\n' "${INSTALLED}" | tee -a "${LOG}"
log "本机装机版本: ${INSTALLED}"

if [ "${INSTALLED}" != "${UPSTREAM}" ]; then
  log "新版本还没装到本机（装机 ${INSTALLED} ≠ 上游 ${UPSTREAM}）——两条路任选："
  log "  1) 重启/常驻 Freebuff 让它自更新装上（推荐），装好后重跑本脚本"
  log "  2) 手动下载安装包装上后重跑（feed 资产名：Freebuff-${UPSTREAM}-win-x64.exe）"
  log "本机没有 7-Zip，autopilot 不直接解安装包（有 7z 后可以走 pristine.js capture --exe 自己登记）。"
  printf 'STATUS=not-installed\n' | tee -a "${LOG}"
  exit 3
fi

# 纯净性三查：装机文件将被当作构建原版（pristine），被汉化/LocalPatches 改过的坚决不用
# ——拿污染源构建 = 报告全绿的假象（§4 备份链必须是英文原版；§1.6 localpatch 污染事故）
if grep -q '<html lang="zh-CN">' "${UI_DIR}/index.html" 2>/dev/null; then
  die 1 "装机 ui 已是汉化版（lang=\"zh-CN\"）——不能当原版。先 bash restore.sh 还原英文，或等应用自更新换回原版。"
fi
# 注意 grep 无匹配返回 1、set -e + pipefail 下必须 || true 接住——「没有污染」是好消息，不许当错误退出
POISON="$({ grep -l '!=="false"' "${UI_DIR}"/assets/index-*.js 2>/dev/null || true; } | wc -l | tr -d ' ')"
if [ "${POISON}" != "0" ]; then
  die 1 "装机 ui 疑似带 LocalPatches（bundle 出现 '!==\"false\"'）——不是纯原版，拒绝用作构建源。"
fi
log "装机源纯净性检查通过（非汉化、无 LocalPatches）。"

if [ "${MODE}" = "plan" ]; then
  log ""
  log "== 执行计划（--plan 只打印，未落地；快照登记等副作用一概不做）=="
  log "  0. 登记本版原版快照：node tools/pristine.js capture --asar \"${APP_ASAR}\" --ui \"${UI_DIR}\""
  log "  1. 补丁漂移自动修复：preflight → reanchor --all --write → regen --broken --write（纯新增块转人工）"
  log "  2. ALLOW_MISSED=1 bash tools/update.sh \"${APP_ASAR}\" \"${UI_DIR}\"   # 七步迁移 + 缺口模式构建"
  log "  3. node tools/auto_translate.js <changelist 骨干> --write            # 词典预填（术语表+记忆+可选 LLM）"
  log "  4. node tools/dictapply.js <changelist> --check && --write           # 体检把关后落盘 dict.json"
  log "  5. bash tools/build_locked.sh \"${APP_ASAR}\" \"${UI_DIR}\"             # 重建验证（不带缺口模式）"
  log "  6. 剩余人工：词典仍缺的句子 / 需真翻的新文案（autopilot 会逐条列出）"
  log "  → 正式跑：bash tools/autopilot.sh${APPLY:+ --apply}"
  printf 'STATUS=planned\n' | tee -a "${LOG}"
  exit 0
fi

# --- P2 快照登记（upstreamdiff 的本版基线；幂等，已登记会跳过）------------------------
log "== P2 登记本版原版快照 =="
node "${HERE}/tools/pristine.js" capture --asar "${APP_ASAR}" --ui "${UI_DIR}" 2>&1 | tee -a "${LOG}" \
  || die 1 "pristine capture 失败——没有本版基线，后面的对差与补丁预检都做不了。"
SNAP="$(node "${HERE}/tools/pristine.js" path "${UPSTREAM}" --require-electron 2>>"${LOG}")" \
  || die 1 "快照登记后仍取不到 ${UPSTREAM} 的完整快照（缺 electron 部分？）"
log "快照：${SNAP}"

# --- P3 补丁漂移自动修复（机械的自动修，带纯新增块的 fail-closed 转人工）----------------
log "== P3 补丁锚点预检 =="
if ! node "${HERE}/tools/patch_preflight.js" --snapshot "${SNAP}" >>"${LOG}" 2>&1; then
  log "有补丁套不上（分诊见 ${LOG}）——先试行号重锚定（纯机械，安全自动修）："
  if node "${HERE}/tools/reanchor_patch.js" --all --snapshot "${SNAP}" --write >>"${LOG}" 2>&1; then
    log "重锚定完成。"
  else
    log "重锚定有 hunk 定位不到（上游改写）——交给重生成："
  fi
  if ! node "${HERE}/tools/patch_preflight.js" --snapshot "${SNAP}" >>"${LOG}" 2>&1; then
    log "仍有补丁套不上——用既有译文重生成（regen_patch --broken --write；含纯新增块的补丁会被"
    log "它自己的 fail-closed 拒绝落盘，这是设计使然——0.0.154.1 的 HANHUA_SHELL_COLORS 不许自动化弄丢）："
    node "${HERE}/tools/regen_patch.js" --broken --snapshot "${SNAP}" --write 2>&1 | tee -a "${LOG}" || true
    if ! node "${HERE}/tools/patch_preflight.js" --snapshot "${SNAP}" >>"${LOG}" 2>&1; then
      log ""
      log "✗ 补丁漂移自动化修不动了——需要人工（分诊与改法见 ${LOG}）："
      log "    · 行号漂移：node tools/reanchor_patch.js --all --snapshot <SNAP> --write"
      log "    · 上游改写：node tools/regen_patch.js <patch> --snapshot <SNAP>（纯新增块须 --drop-plain-adds 后手工补回）"
      log "  处理完重跑本脚本即可（已完成的步骤都是幂等的）。"
      die 1 "补丁预检未通过，中止在构建之前——别拿套不上补丁的产物交 postbuild。"
    fi
  fi
fi
log "补丁全部能干净套用 ✓"

# --- P4 七步迁移（缺口模式：旧词条对不上不拦构建，先出报告）---------------------------
log "== P4 七步迁移（update.sh，缺口模式）=="
if ! ALLOW_MISSED=1 bash "${HERE}/tools/update.sh" "${APP_ASAR}" "${UI_DIR}" 2>&1 | tee -a "${LOG}"; then
  die 1 "update.sh 中止（详情见 ${LOG}）——修完重跑，各步骤幂等。"
fi
UPDATE_REPORT="$(ls -1t "${HERE}/work/update-"*.txt 2>/dev/null | head -1 || true)"
[ -n "${UPDATE_REPORT}" ] && log "迁移报告：${UPDATE_REPORT}"

# --- P5 词典自动补翻：预填 → 体检 → 落盘 ----------------------------------------------
log "== P5 词典自动补翻 =="
SKEL="$(ls -1t "${HERE}/work/changelist-"*.json 2>/dev/null | head -1 || true)"
AUTO_FILLED=0
if [ -z "${SKEL}" ]; then
  log "没有 changelist 骨干（本版没有新增界面文案要翻？）——跳过预填。"
else
  log "预填骨干：${SKEL}"
  node "${HERE}/tools/auto_translate.js" "${SKEL}" --write 2>&1 | tee -a "${LOG}" || true
  # auto_translate 体检不过也退出 0——把关必须自己显式做
  if node "${HERE}/tools/dictapply.js" "${SKEL}" --check >>"${LOG}" 2>&1; then
    node "${HERE}/tools/dictapply.js" "${SKEL}" --write 2>&1 | tee -a "${LOG}"
    AUTO_FILLED="$(node -e '
      const l = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
      let n = 0
      for (const key of ["add", "modify"]) if (Array.isArray(l[key])) for (const it of l[key]) if (it.value) n++
      console.log(n)' "${SKEL}")"
    log "自动补翻落盘：${AUTO_FILLED} 条已写入 dict.json（记得 git diff 复查）。"
  else
    log "! 预填未过 dictapply --check 体检——不落盘，清单留在 ${SKEL}，人工微调后："
    log "    node tools/dictapply.js ${SKEL#"${HERE}"/} --check && node tools/dictapply.js ${SKEL#"${HERE}"/} --write"
  fi
fi

# --- P6 重建验证（严格模式：MISSED>0 就失败，把剩余缺口亮出来）--------------------------
log "== P6 重建验证（严格模式）=="
BUILD_OUT="$(bash "${HERE}/tools/build_locked.sh" "${APP_ASAR}" "${UI_DIR}" 2>&1 | tee -a "${LOG}")" || {
  MISSED_LINES="$(printf '%s\n' "${BUILD_OUT}" | grep -A200 '^MISSED (' | head -40 || true)"
  log ""
  log "✗ 严格重建未通过——剩余缺口（需人工真翻，多半是上游新写的句子）："
  printf '%s\n' "${MISSED_LINES}" | tee -a "${LOG}"
  log "  处理路径：把句子补进 dict.json（保持 key 与原文逐字节一致），或走 changelist："
  log "    node tools/dictapply.js --emit pattern < 清单 && node tools/auto_translate.js <changelist> --write"
  log "  完成后重跑：bash tools/build_locked.sh \"${APP_ASAR}\" \"${UI_DIR}\""
  die 1 "仍有未命中的词典条目，本版未达到「全覆盖」。"
}
log "重建全绿：词典全覆盖、补丁干净、postbuild 自检通过 ✓"
log "产物在 output/（app.asar + ui/），可用装机：bash apply.sh"

# --- P7 总结 ---------------------------------------------------------------------------
log ""
log "== autopilot 完成 ${STAMP} =="
log "  ${ADAPTED} → ${UPSTREAM}：快照已登记、迁移报告 ${UPDATE_REPORT:-（无）}、自动补翻 ${AUTO_FILLED} 条、重建全绿"
log "下一步（人工，按需）："
log "  · git diff dict.json patches/            # 复查自动化改了什么"
log "  · bash apply.sh                          # 装机（可 restore.sh 回滚；会自动联动控制器 --reapply）"
log "  · bash tools/release.sh                  # 发布（四道闸门在眼前过，autopilot 永不代发）"
if [ "${APPLY}" = "1" ]; then
  log "== --apply：装机 =="
  bash "${HERE}/apply.sh" 2>&1 | tee -a "${LOG}" || die 1 "apply.sh 装机失败（可用 bash restore.sh 回滚）"
  log "装机完成（汉化 + 控制器本机补丁已联动重打）。"
fi
printf 'STATUS=green\n' | tee -a "${LOG}"
exit 0
