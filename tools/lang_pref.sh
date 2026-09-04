#!/usr/bin/env bash
# 让 AI 智能体也跟着汉化一起默认中文回复。
#
# 原理：Freebuff 的 orchestrator 在 initialSessionState 里无条件调用
# loadUserKnowledgeFiles()，读取 ~/.AGENTS.md 并以
#   "Project instructions: ... Follow them for the rest of the session."
# 注入系统提示词。这是唯一不必修改专有 bundle 就能常驻影响回复语言的官方入口。
# 界面上的「包含 AGENTS.md」勾选只管项目根那一份（默认关闭），与本文件无关。
#
# 被 apply.sh / restore.sh 以 source 方式引用：
#   lang_pref_install    写入 / 更新本包的语言偏好段
#   lang_pref_uninstall  精确移除本包写入的那一段
# 只在两个标记之间增删，用户的自有内容一律按字节原样保留（因此刻意用 head/tail
# 切片而非 awk/sed 重写整文件——后者会吃掉 CRLF 的 \r）。

ZH_LANG_BEGIN="# >>> freebuff-zh:lang-pref >>>"
ZH_LANG_END="# <<< freebuff-zh:lang-pref <<<"

# 定位用户主目录（与应用的 os.homedir() 保持一致）
zh_lang_home() {
  if [ -n "${HOME:-}" ] && [ -d "${HOME}" ]; then
    printf '%s\n' "${HOME}"
    return 0
  fi
  if [ -n "${USERPROFILE:-}" ]; then
    local converted=""
    if command -v cygpath >/dev/null 2>&1; then
      converted="$(cygpath -u "${USERPROFILE}" 2>/dev/null || true)"
    fi
    if [ -n "${converted}" ] && [ -d "${converted}" ]; then
      printf '%s\n' "${converted}"
      return 0
    fi
    if [ -d "${USERPROFILE}" ]; then
      printf '%s\n' "${USERPROFILE}"
      return 0
    fi
  fi
  return 1
}

zh_lang_target() {
  local home
  home="$(zh_lang_home)" || return 1
  printf '%s/.AGENTS.md\n' "${home%/}"
}

zh_lang_block() {
  printf '%s\n' "${ZH_LANG_BEGIN}"
  cat <<'ZH_LANG_BLOCK'
# 由 freebuff-zh 汉化包写入。运行 restore.sh 可只移除本段而不影响你自己的内容；
# 想应用汉化时不写这一段，设 FREEBUFF_ZH_NO_LANG=1 再跑 apply.sh。

- **始终使用简体中文回复**，无论提问使用什么语言；不要先输出英文再补中文。
- 仅当用户本轮明确指定其他语言时那一轮才改用该语言，下一轮恢复中文。
- 保持原文不翻译：代码、命令、文件路径、标识符、API 名、日志与报错原文、库名与专有名词。
- 需要用户确认的选项、计划、待办清单、总结与进度说明一律用中文书写。
- 代码中的注释跟随所在文件的既有语言惯例，不要为了中文而改动既有代码。
ZH_LANG_BLOCK
  printf '%s\n' "${ZH_LANG_END}"
}

# 本包段落的行号区间，正常时输出 "begin end" 并返回 0
# 只有 BEGIN 没有 END（段落被手工改坏）时返回 2：此时无法判断边界，
# 绝不能用「按到文件末尾」兜底——那会把用户写在段后的正文一起吃掉
zh_lang_range() {
  local file="$1" b e
  [ -f "${file}" ] || return 1
  b="$(grep -nF "${ZH_LANG_BEGIN}" "${file}" 2>/dev/null | head -1 | cut -d: -f1)"
  [ -n "${b}" ] || return 1
  e="$(grep -nF "${ZH_LANG_END}" "${file}" 2>/dev/null | tail -1 | cut -d: -f1)"
  if [ -z "${e}" ] || [ "${e}" -lt "${b}" ]; then
    return 2
  fi
  printf '%s %s\n' "${b}" "${e}"
}

# 按行号区间剥离段落，其余内容按字节原样输出（区间来自 zh_lang_range）
# 顺带吃掉紧邻段前那个由本包插入的空行分隔符
zh_lang_cut() {
  local file="$1" b="$2" e="$3" prev
  if [ "${b}" -gt 1 ]; then
    prev="$(head -n $((b - 1)) "${file}" | tail -n 1)"
    [ -z "${prev%$'\r'}" ] && b=$((b - 1))
  fi
  if [ "${b}" -le 1 ]; then
    tail -n +$((e + 1)) "${file}"
  else
    {
      head -n $((b - 1)) "${file}"
      tail -n +$((e + 1)) "${file}"
    }
  fi
}

# 追加时补齐换行：末字节不是换行的文件先补一个换行，再用一个空行分隔
# 已知边界：若用户文件原本结尾没有换行符，这里补的换行在 uninstall 后无法退回
# （行级切片无法记住"原本缺结尾换行"这个事实），文件会比原状多出一个 \n
zh_lang_ensure_sep() {
  [ -s "$1" ] || return 0
  if [ -n "$(tail -c 1 "$1")" ]; then
    printf '\n' >>"$1"
  fi
  printf '\n' >>"$1"
}

zh_lang_warn_broken() {
  echo "WARN: $1 里的 freebuff-zh 语言偏好段不完整（只有起始标记、缺结束标记），" >&2
  echo "      为避免误删你的内容，本次未改动该文件。请自行删除从" >&2
  echo "      '${ZH_LANG_BEGIN}' 到段末的几行。" >&2
}

lang_pref_install() {
  if [ "${FREEBUFF_ZH_NO_LANG:-}" = "1" ]; then
    echo "已按 FREEBUFF_ZH_NO_LANG=1 跳过 AI 回复语言设置。"
    return 0
  fi
  local target tmp rng rc b e pre_exists=""
  if ! target="$(zh_lang_target)"; then
    echo "WARN: 未能定位用户主目录，跳过 AI 回复语言设置（界面汉化不受影响）。" >&2
    return 0
  fi
  if [ -f "${target}" ]; then
    pre_exists="1"
  fi
  tmp="${target}.freebuff-zh.tmp"
  rng="$(zh_lang_range "${target}")" && rc=0 || rc=$?
  case "${rc}" in
    2)
      rm -f "${tmp}"
      zh_lang_warn_broken "${target}"
      return 0
      ;;
    0)
      b="${rng%% *}"
      e="${rng##* }"
      zh_lang_cut "${target}" "${b}" "${e}" >"${tmp}" || {
        rm -f "${tmp}"
        echo "WARN: 无法改写 ${target}，跳过 AI 回复语言设置。" >&2
        return 0
      }
      # 剥段时一并吃掉了旧的空行分隔符，这里补回，保证多次 apply 输出逐字节一致
      zh_lang_ensure_sep "${tmp}"
      ;;
    *)
      if [ -f "${target}" ]; then
        cp "${target}" "${tmp}" || {
          rm -f "${tmp}"
          echo "WARN: 无法写入 ${target}，跳过 AI 回复语言设置（界面汉化不受影响）。" >&2
          return 0
        }
      else
        : >"${tmp}"
      fi
      zh_lang_ensure_sep "${tmp}"
      ;;
  esac
  if ! zh_lang_block >>"${tmp}" || ! mv -f "${tmp}" "${target}"; then
    rm -f "${tmp}"
    echo "WARN: 无法写入 ${target}，跳过 AI 回复语言设置（界面汉化不受影响）。" >&2
    return 0
  fi
  if [ -n "${pre_exists}" ]; then
    echo "AI 回复语言偏好已写入 ${target}（你自己的内容原样保留）。"
  else
    echo "AI 回复语言偏好已写入 ${target}。"
  fi
  echo "对新建会话生效；已经打开的会话要重开一个才读得到。"
}

lang_pref_uninstall() {
  local target tmp rng rc b e
  if ! target="$(zh_lang_target)"; then
    echo "WARN: 未能定位用户主目录，未改动 ~/.AGENTS.md。" >&2
    return 0
  fi
  if [ ! -f "${target}" ]; then
    echo "未找到 ${target}，无需移除。"
    return 0
  fi
  rng="$(zh_lang_range "${target}")" && rc=0 || rc=$?
  if [ "${rc}" = "2" ]; then
    zh_lang_warn_broken "${target}"
    return 0
  fi
  if [ "${rc}" != "0" ]; then
    echo "${target} 没有本包写入的语言偏好段，保持原样。"
    return 0
  fi
  tmp="${target}.freebuff-zh.tmp"
  b="${rng%% *}"
  e="${rng##* }"
  if ! zh_lang_cut "${target}" "${b}" "${e}" >"${tmp}"; then
    rm -f "${tmp}"
    echo "WARN: 无法改写 ${target}，请手动删除夹在两个 freebuff-zh:lang-pref 标记之间的段落。" >&2
    return 0
  fi
  if grep -q '[^[:space:]]' "${tmp}" 2>/dev/null; then
    if mv -f "${tmp}" "${target}"; then
      echo "已从 ${target} 移除语言偏好段（你自己的内容保留）。"
    else
      rm -f "${tmp}"
      echo "WARN: 无法改写 ${target}，请手动删除夹在两个 freebuff-zh:lang-pref 标记之间的段落。" >&2
    fi
  else
    rm -f "${tmp}" "${target}"
    echo "已删除 ${target}（移除语言偏好段后只剩空白内容）。"
  fi
}

# 直接执行时的手动入口：bash tools/lang_pref.sh install|uninstall
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  set -euo pipefail
  case "${1:-install}" in
    install) lang_pref_install ;;
    uninstall) lang_pref_uninstall ;;
    *)
      echo "用法: bash tools/lang_pref.sh [install|uninstall]" >&2
      exit 2
      ;;
  esac
fi
