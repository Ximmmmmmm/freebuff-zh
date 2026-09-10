'use strict'

// These contexts accept protocol/grammar identifiers rather than user-visible
// copy. A translated value here can be syntactically valid but semantically
// wrong (for example document.createEvent("Event") or
// dataTransfer.types.includes("Files")). Keep this list deliberately narrow:
// normal UI attributes such as title/label remain translatable.
//
// 0.0.100 事故教训：LLM 批量翻译把 Lezer 节点名 "Emphasis" 翻成 "强调"，
// resolve:"Emphasis" / after:"Emphasis" / t[t.Emphasis=25]="Emphasis" 四处
// 代码位置被污染，应用启动即崩（RangeError: unknown parser）。以下新增：
//   - resolve/mark/after：Lezer 语法扩展配置属性
//   - displayName：主题/套餐等标识符式展示名（比较风险高，保持英文）
//   - backgroundColor/fill/stroke：CSS 系统色关键字（如 "Highlight"）
//   - 枚举赋值 ]="X"：TS 枚举自映射（t[t.Always=0]="Always"）
const SEMANTIC_PROPERTIES = new Set([
  'top',
  'parser',
  'grammar',
  'token',
  'node',
  'term',
  'rule',
  'alias',
  'kind',
  'mode',
  'scope',
  'selector',
  'extension',
  'resolve',
  'mark',
  'after',
  'displayName',
  'backgroundColor',
  'fill',
  'stroke',
])

const SEMANTIC_CALLS = [
  /(?:document\.)?createEvent\s*\([^()]*$/,
  /new\s+(?:Event|CustomEvent|MouseEvent|KeyboardEvent|PointerEvent)\s*\([^()]*$/,
  /\.types\.includes\s*\([^()]*$/,
  /\.(?:phrase|endsWith|startsWith)\s*\([^()]*$/,
  /\.configure\s*\([^()]*$/,
]

// Calls whose first string argument is a protocol value. Unlike the property
// rules above, these are matched from the call site so a minified bundle does
// not need stable variable names.
const SEMANTIC_CALL_NAMES = [
  /\b(?:document\.)?createEvent\s*\([^,)]*$/,
  /\.(?:phrase|endsWith|startsWith)\s*\([^,)]*$/,
  /\.types\.includes\s*\([^,)]*$/,
  /\.configure\s*\([^,)]*$/,
]

function hasCJK(s) {
  return /[\u3400-\u9fff]/.test(s)
}

function contextReason(source, start, end) {
  const before = source.slice(Math.max(0, start - 180), start)
  const property = before.match(/(?:^|[,{;])\s*([A-Za-z_$][\w$]*)\s*:\s*$/)
  if (property && SEMANTIC_PROPERTIES.has(property[1])) {
    return `semantic property ${property[1]}`
  }
  if (/\]\s*=\s*$/.test(before)) {
    // TS 枚举自映射：t[t.Emphasis=25]="Emphasis"。普通 UI 字符串不会以
    // 索引赋值形式出现在压缩产物里，误伤面极小。
    return 'enum member assignment'
  }
  if (/(?:===|!==|==|!=)\s*$/.test(before) || /\bcase\s*$/.test(before)) {
    return 'comparison or switch case'
  }
  if (SEMANTIC_CALLS.some((re) => re.test(before)) || SEMANTIC_CALL_NAMES.some((re) => re.test(before))) {
    return 'semantic API argument'
  }
  if (/\b(?:DOMException|URL|URLSearchParams)\s*\([^()]*$/.test(before)) {
    return 'platform API argument'
  }
  void end
  return null
}

function decodeDoubleQuoted(raw) {
  try {
    return JSON.parse('"' + raw + '"')
  } catch {
    return raw
  }
}

function findUnsafeMatches(source) {
  const out = []
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g
  let m
  while ((m = re.exec(source)) !== null) {
    const raw = m[1] !== undefined ? m[1] : m[2]
    const value = m[1] !== undefined ? decodeDoubleQuoted(raw) : raw
    if (!hasCJK(value)) continue
    const reason = contextReason(source, m.index, re.lastIndex)
    if (reason) out.push({ value, reason, index: m.index })
  }
  return out
}

module.exports = {
  SEMANTIC_PROPERTIES,
  contextReason,
  findUnsafeMatches,
  hasCJK,
}
