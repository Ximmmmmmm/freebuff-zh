'use strict'

// These contexts accept protocol/grammar identifiers rather than user-visible
// copy. A translated value here can be syntactically valid but semantically
// wrong (for example document.createEvent("Event") or
// dataTransfer.types.includes("Files")). Keep this list deliberately narrow:
// normal UI attributes such as title/label remain translatable.
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
