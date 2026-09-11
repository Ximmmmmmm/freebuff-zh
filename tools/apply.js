#!/usr/bin/env node
// Apply hanhua/dict.json to a file:
//   exact    -> replaces "English" literals globally, except semantic/code contexts
//   pattern  -> replaces only in UI-attribute contexts
//   template -> replaces `English ${...}` template literals
// Usage: node apply.js <file> [--write]
// Without --write, prints what WOULD change and reports keys with 0 matches.
const fs = require('fs')
const path = require('path')
const { contextReason } = require('./semantic_guard')

const file = process.argv[2]
const write = process.argv.includes('--write')
// --quiet: 只报替换计数与 MISSED 条数，不逐条列出（用于主进程小文件，避免噪音淹没
// UI bundle 的 MISSED 详单——那才是待补翻清单）
const quiet = process.argv.includes('--quiet')
if (!file) {
  console.error('usage: node apply.js <file> [--write]')
  process.exit(1)
}
const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dict.json'), 'utf8'))

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const countOf = (src, re) => {
  let n = 0
  const r = new RegExp(re.source, re.flags)
  while (r.exec(src) !== null) n++
  return n
}

// UI 属性的锚点：pattern 只在这些位置生效，所以短词（Delete / Manage / Available…）
// 放这里不会碰到比较、枚举自映射或协议常量。
const ATTR_ANCHORS = [
  'children:',
  'label:',
  'title:',
  'placeholder:',
  'confirmLabel:',
  'actionLabel:',
  '"data-tooltip":',
  '"aria-label":',
]
// 值位置允许压缩后的「解构默认值 / 变量赋值」形态：
//   children:"Delete"   与   confirmLabel:n="Delete"
const OPT_ASSIGN = '(?:[A-Za-z_$][\\w$]*\\s*=\\s*)?'
// 比较运算符右侧是协议常量 / 状态码，不是文案
const CMP_BEFORE = /(?:===|!==|==|!=|\.includes\s*\(|\.startsWith\s*\(|\.endsWith\s*\(|\.types\.includes\s*\(|\bcase\s*)\s*$/

let src = fs.readFileSync(file, 'utf8')
const before = src
let totalReplaced = 0
const missed = []
const semanticBlocked = []

const applyExact = (source, dictSection) => {
  for (const [en, zh] of Object.entries(dictSection || {})) {
    const re = new RegExp('"' + esc(en) + '"', 'g')
    const n = countOf(source, re)
    if (n === 0) {
      // 幂等检查必须限定在完整的双引号字面量，不能用“译文在文件任意位置
      // 出现”掩盖一个真正漏翻的 key。
      const reZh = new RegExp('"' + esc(zh) + '"', 'g')
      if (countOf(source, reZh) === 0) missed.push(en)
      continue
    }
    source = source.replace(re, (match, offset, whole) => {
      const reason = contextReason(whole, offset, offset + match.length)
      if (reason) {
        semanticBlocked.push({ en, reason })
        return match
      }
      totalReplaced++
      // 使用 replace callback，zh 中的 $&、$1、反斜杠都按普通文本写入，
      // 不会被 String.replace 的 replacement 语法再次解释。
      return '"' + zh + '"'
    })
  }
  return source
}

// --- pattern：仅界面属性位置（在 code/exact/template 之前跑）----------------------
// 值位置要认压缩产物的四种形态——早期实现只认第一种，connectors 面板整片状态标签漏翻：
//   children:"Delete"                                          直接字面量
//   confirmLabel:n="Delete"                                    默认参数（解构默认值）
//   label:t.status==="idle"?"Ready when needed":"Disconnected"  三元分支
//   "aria-label":`${s?"Collapse":"Expand"} thinking details`     模板插值内部的字面量
// 做法：取锚点后到「第 0 层逗号 / 分号 / 右括号」为止的值文本，只认其中第 0 层的字符串
// 字面量（第 1 层以上是别的属性值：class 名、色值、SVG 路径…，比较运算符右侧是协议常量），
// 并对值里的模板字面量下钻到 ${…} 内部（模板固定段交给 template 分区）。

// 值文本终点：第 0 层的逗号 / 分号 / 右括号
function valueEnd(start) {
  let depth = 0
  let i = start
  let q = null
  const limit = Math.min(src.length, start + 400)
  while (i < limit) {
    const c = src[i]
    if (q) {
      if (c === '\\') i++
      else if (c === q) q = null
    } else if (c === '"' || c === "'" || c === '`') q = c
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break
      depth--
    } else if ((c === ',' || c === ';') && depth === 0) break
    i++
  }
  return i
}

function skipString(start, end) {
  const q = src[start]
  let i = start + 1
  while (i < end) {
    if (src[i] === '\\') i += 2
    else if (src[i] === q) return i + 1
    else i++
  }
  return end
}

// 收集值文本里第 0 层的字符串字面量（含三元分支），并下钻模板插值
function collectUiLiterals(start, end, out, depth) {
  let i = start
  while (i < end) {
    const c = src[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      let raw = ''
      while (j < end) {
        const ch = src[j]
        if (ch === '\\') {
          raw += src.slice(j, j + 2)
          j += 2
          continue
        }
        if (ch === c) break
        raw += ch
        j++
      }
      if (depth === 0 && !CMP_BEFORE.test(src.slice(Math.max(0, i - 40), i))) {
        let value = null
        try {
          value = JSON.parse('"' + raw + '"')
        } catch {
          value = null
        }
        if (value) out.push({ start: i, end: j + 1, value })
      }
      i = j + 1
      continue
    }
    if (c === '`') {
      i = scanTemplate(i, end, out, depth)
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    i++
  }
}

// 扫描模板字面量，返回其后的位置；插值 ${…} 内部再按「第 0 层」扫一遍
function scanTemplate(start, end, out, depth) {
  let i = start + 1
  while (i < end) {
    const c = src[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '`') return i + 1
    if (c === '$' && src[i + 1] === '{') {
      const exprStart = i + 2
      let d = 1
      let k = exprStart
      while (k < end && d > 0) {
        const cc = src[k]
        if (cc === '\\') {
          k += 2
          continue
        }
        if (cc === '"' || cc === "'") {
          k = skipString(k, end)
          continue
        }
        if (cc === '`') {
          k = scanTemplate(k, end, out, depth)
          continue
        }
        if (cc === '{') d++
        else if (cc === '}') d--
        k++
      }
      if (depth === 0) collectUiLiterals(exprStart, k - 1, out, 0)
      i = k
      continue
    }
    i++
  }
  return end
}

const patternLiterals = []
{
  const anchorRe = new RegExp('(?:' + ATTR_ANCHORS.map(esc).join('|') + ')' + OPT_ASSIGN, 'g')
  let m
  while ((m = anchorRe.exec(src)) !== null) {
    const vs = m.index + m[0].length
    collectUiLiterals(vs, valueEnd(vs), patternLiterals, 0)
  }
}

const patternHits = new Map()
const patternValues = new Set()
const patternEdits = []
for (const lit of patternLiterals) {
  patternValues.add(lit.value)
  const zh = (dict.pattern || {})[lit.value]
  if (zh === undefined) continue
  patternHits.set(lit.value, (patternHits.get(lit.value) || 0) + 1)
  patternEdits.push({ start: lit.start, end: lit.end, text: '"' + zh + '"' })
}
// 倒序回写，避免位移影响后面的区间
patternEdits.sort((a, b) => b.start - a.start)
for (const e of patternEdits) {
  src = src.slice(0, e.start) + e.text + src.slice(e.end)
  totalReplaced++
}
// pattern 也必须报 MISSED——它是短词的安全区，零命中意味着「原文没了」或「匹配形态变了」，
// 两种都要人看一眼，不能像 0.0.103 那样静静躺着 31 条死条目。
for (const [en, zh] of Object.entries(dict.pattern || {})) {
  if (patternHits.has(en)) continue
  if (patternValues.has(zh)) continue // 幂等：上一次跑已经把译文写进去了
  missed.push('[pattern] ' + en)
}

// code: exact multi-token fragments (e.g. pluralization), replaced verbatim.
// These entries are intentionally opt-in and are not passed through the UI
// semantic-context filter used by exact literals.
for (const [en, zh] of Object.entries(dict.code || {})) {
  const re = new RegExp(esc(en), 'g')
  const n = countOf(src, re)
  if (n === 0) {
    const reZh = new RegExp(esc(zh), 'g')
    if (countOf(src, reZh) === 0) missed.push('[code] ' + en)
    continue
  }
  src = src.replace(re, () => zh)
  totalReplaced += n
}

for (const [en, zh] of Object.entries(dict.template || {})) {
  const re = new RegExp('`' + esc(en) + '`', 'g')
  const n = countOf(src, re)
  if (n === 0) {
    const reZh = new RegExp('`' + esc(zh) + '`', 'g')
    if (countOf(src, reZh) === 0) missed.push('`' + en + '`')
    continue
  }
  src = src.replace(re, () => '`' + zh + '`')
  totalReplaced += n
}

// Apply exact literals after templates. This prevents an exact entry such as
// "unknown error" from changing an embedded string before its full template
// entry has a chance to match.
src = applyExact(src, dict.exact)

const diffLen = src.length - before.length
console.log(`replaced ${totalReplaced} occurrences (bundle size ${before.length} -> ${src.length}, ${diffLen >= 0 ? '+' : ''}${diffLen} bytes)`)
if (missed.length) {
  if (quiet) {
    console.log(`missed ${missed.length} keys (详情见 UI bundle 构建日志)`)
  } else {
    console.log(`MISSED (${missed.length} keys, no exact match):`)
    for (const m of missed) console.log(`  - ${JSON.stringify(m)}`)
  }
} else {
  console.log('all keys matched')
}
if (semanticBlocked.length) {
  const unique = [...new Map(semanticBlocked.map((x) => [`${x.en}\u0000${x.reason}`, x])).values()]
  console.error(`semantic-blocked ${semanticBlocked.length} occurrences（代码语义位置禁止翻译）:`)
  for (const item of unique.slice(0, 30)) {
    console.error(`  - ${JSON.stringify(item.en)} ← ${item.reason}`)
  }
  if (unique.length > 30) console.error(`  … 其余 ${unique.length - 30} 项略`)
  console.error('ERROR: 为避免破坏运行时协议常量，本文件未写入任何修改。')
  process.exit(1)
}

if (write) {
  fs.writeFileSync(file, src)
  console.log(`wrote ${file}`)
}
