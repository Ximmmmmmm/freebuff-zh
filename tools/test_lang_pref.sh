#!/usr/bin/env bash
# 沙箱验证 tools/lang_pref.sh —— 用临时 HOME，绝不碰真实 ~/.AGENTS.md
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO="$PWD"
FAIL=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAIL=1; }
check() {
  if [ "$2" = "$3" ]; then pass "$1"
  else fail "$1 （期望 [$3]，实际 [$2]）"
  fi
}

fresh() {
  SANDBOX="$(mktemp -d)"
  export HOME="${SANDBOX}/home"
  mkdir -p "${HOME}"
  TARGET="${HOME}/.AGENTS.md"
  # shellcheck source=/dev/null
  . "${REPO}/tools/lang_pref.sh"
}
marks() {
  local n="0"
  if [ -f "${TARGET}" ]; then
    n="$(grep -c 'freebuff-zh:lang-pref >>>' "${TARGET}" || true)"
    [ -n "${n}" ] || n="0"
  fi
  printf '%s' "${n}"
}
lines() { if [ -f "${TARGET}" ]; then wc -l < "${TARGET}" | tr -d ' '; else printf '0'; fi; }

echo "--- 用例 1：文件不存在时新建"
fresh
lang_pref_install >/dev/null
check "新建后恰有 1 段标记" "$(marks)" "1"
check "含中文回复指令" "$(grep -c '始终使用简体中文回复' "${TARGET}" || true)" "1"
L1="$(lines)"

echo "--- 用例 2：重复 apply 幂等"
lang_pref_install >/dev/null
lang_pref_install >/dev/null
check "跑三次仍只有 1 段" "$(marks)" "1"
check "行数与首次一致（不堆叠）" "$(lines)" "${L1}"

echo "--- 用例 3：用户已有内容时追加且保序"
fresh
printf '# 我的项目规范\n\n不要自动提交。\n' > "${TARGET}"
cp "${TARGET}" "${SANDBOX}/user-only"
lang_pref_install >/dev/null
check "用户内容 + 1 段标记" "$(marks)" "1"
check "用户内容仍在最前" "$(head -1 "${TARGET}")" "# 我的项目规范"
check "用户首行未被改写" "$(head -3 "${TARGET}" | tail -3 | grep -c '不要自动提交。')" "1"

echo "--- 用例 4：uninstall 只摘掉本段"
lang_pref_uninstall >/dev/null
check "移除后无标记残留" "$(marks)" "0"
check "与原始用户内容逐字节一致" "$(cmp -s "${TARGET}" "${SANDBOX}/user-only" && echo same || echo diff)" "same"

echo "--- 用例 5：uninstall 对纯本包文件应删掉文件"
fresh
lang_pref_install >/dev/null
lang_pref_uninstall >/dev/null
check "文件已删除" "$([ -f "${TARGET}" ] && echo exists || echo gone)" "gone"

echo "--- 用例 6：FREEBUFF_ZH_NO_LANG=1 跳过"
fresh
FREEBUFF_ZH_NO_LANG=1 lang_pref_install >/dev/null
check "未创建文件" "$([ -f "${TARGET}" ] && echo exists || echo gone)" "gone"

echo "--- 用例 7：CRLF 用户文件不被破坏"
fresh
printf '# 我的规范\r\n英文说明\r\n' > "${TARGET}"
cp "${TARGET}" "${SANDBOX}/crlf-before"
lang_pref_install >/dev/null
check "带 CRLF 时仍有 1 段" "$(marks)" "1"
lang_pref_uninstall >/dev/null
check "CRLF 原文件还原一致" "$(cmp -s "${TARGET}" "${SANDBOX}/crlf-before" && echo same || echo diff)" "same"

echo "--- 用例 8：无标记文件 / 文件缺失时 uninstall 安全"
fresh
printf 'nothing here\n' > "${TARGET}"
lang_pref_uninstall >/dev/null
check "无标记时保持原样" "$(cat "${TARGET}" 2>/dev/null)" "nothing here"
rm -f "${TARGET}"
lang_pref_uninstall >/dev/null
check "文件缺失时退出码 0" "$?" "0"

echo "--- 用例 9：标记段之后的用户正文不被吞掉"
fresh
lang_pref_install >/dev/null
printf '\n# 我自己后加的一段\n重要。\n' >> "${TARGET}"
lang_pref_install >/dev/null
check "更新后仍 1 段标记" "$(marks)" "1"
check "后加内容被保留" "$(grep -c '重要。' "${TARGET}" || true)" "1"
lang_pref_uninstall >/dev/null
check "移除后后加内容仍在" "$(grep -c '重要。' "${TARGET}" || true)" "1"

echo "--- 用例 10：独立入口可执行"
fresh
bash "${REPO}/tools/lang_pref.sh" install >/dev/null
check "直接跑 install 生效" "$(marks)" "1"
bash "${REPO}/tools/lang_pref.sh" uninstall >/dev/null
check "直接跑 uninstall 生效" "$([ -f "${TARGET}" ] && echo exists || echo gone)" "gone"
bash "${REPO}/tools/lang_pref.sh" bogus >/dev/null 2>&1
check "非法参数退出码 2" "$?" "2"

echo "--- 用例 11：用户文件末尾无换行（契约：还原后 = 原内容 + 一个结尾换行）"
fresh
printf '# 无结尾换行的内容' > "${TARGET}"
cp "${TARGET}" "${SANDBOX}/no-eol"
lang_pref_install >/dev/null
check "无换行时仍 1 段" "$(marks)" "1"
check "用户内容首行完整" "$(head -1 "${TARGET}")" "# 无结尾换行的内容"
lang_pref_uninstall >/dev/null
SZ_BEFORE="$(wc -c < "${SANDBOX}/no-eol" | tr -d ' ')"
SZ_AFTER="$(wc -c < "${TARGET}" | tr -d ' ')"
check "仅多出 1 个结尾换行" "$([ "${SZ_AFTER}" -eq "$((SZ_BEFORE + 1))" ] && echo plus1 || echo "diff:${SZ_BEFORE}-${SZ_AFTER}")" "plus1"
check "前缀与原文件逐字节一致" "$(head -c "${SZ_BEFORE}" "${TARGET}" | cmp -s - "${SANDBOX}/no-eol" && echo same || echo diff)" "same"

echo "--- 用例 12：END 标记被手工删掉时一律不动文件（无法判断边界，宁可不改）"
fresh
lang_pref_install >/dev/null
grep -vF '# <<< freebuff-zh:lang-pref <<<' "${TARGET}" > "${SANDBOX}/broken" && mv "${SANDBOX}/broken" "${TARGET}"
printf '\n我的尾巴。\n' >> "${TARGET}"
cp "${TARGET}" "${SANDBOX}/broken-orig"
warn1="$(lang_pref_install 2>&1)"
check "残缺时 install 不改文件" "$(cmp -s "${TARGET}" "${SANDBOX}/broken-orig" && echo same || echo diff)" "same"
check "残缺时 install 给出 WARN" "$(printf '%s' "${warn1}" | grep -c WARN)" "1"
warn2="$(lang_pref_uninstall 2>&1)"
check "残缺时 uninstall 不改文件" "$(cmp -s "${TARGET}" "${SANDBOX}/broken-orig" && echo same || echo diff)" "same"
check "残缺时 uninstall 给出 WARN" "$(printf '%s' "${warn2}" | grep -c WARN)" "1"
check "段后用户正文仍在" "$(grep -c '我的尾巴。' "${TARGET}" || true)" "1"

echo "--- 用例 13：在 set -euo pipefail 下（apply.sh/restore.sh 的真实环境）不中断"
for scenario in 全新环境 已有用户内容; do
  fresh
  cat > "${SANDBOX}/harness.sh" <<'HZ'
set -euo pipefail
. "${LANG_PREF_LIB}"
lang_pref_install
lang_pref_uninstall
lang_pref_install
echo HARNESS-OK
HZ
  if [ "${scenario}" = "已有用户内容" ]; then
    printf '# 用户内容\n\n第二行。\n' > "${TARGET}"
  fi
  out="$(LANG_PREF_LIB="${REPO}/tools/lang_pref.sh" bash "${SANDBOX}/harness.sh" 2>&1)"
  check "${scenario}：三次调用全程未中断" "$(printf '%s' "${out}" | grep -c HARNESS-OK)" "1"
  check "${scenario}：未留下临时文件" "$(ls "${HOME}" | grep -c 'freebuff-zh.tmp' || true)" "0"
  check "${scenario}：结束后仍有 1 段" "$(marks)" "1"
  rm -rf "${SANDBOX}"
done

rm -rf "${SANDBOX}"
echo
if [ "${FAIL}" = "0" ]; then echo "全部通过"; else echo "存在失败用例"; exit 1; fi
