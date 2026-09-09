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

const attrKeys = [
  ['children', 'children:"%s"'],
  ['label', 'label:"%s"'],
  ['title', 'title:"%s"'],
  ['placeholder', 'placeholder:"%s"'],
  ['data-tooltip', '"data-tooltip":"%s"'],
  ['aria-label', '"aria-label":"%s"'],
  ['confirmLabel', 'confirmLabel:"%s"'],
]

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

// pattern first so children:"X" gets the same translation before exact runs
for (const [en, zh] of Object.entries(dict.pattern || {})) {
  for (const [, tmpl] of attrKeys) {
    const re = new RegExp(tmpl.replace('%s', esc(en)), 'g')
    const n = countOf(src, re)
    if (n === 0) continue
    // callback replacement avoids treating $&/$1 in a future translation as
    // String.replace metacharacters.
    src = src.replace(re, () => tmpl.replace('%s', zh))
    totalReplaced += n
  }
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
