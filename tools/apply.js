#!/usr/bin/env node
// Apply hanhua/dict.json to a file:
//   exact    -> replaces "English" literals globally (double-quoted)
//   pattern  -> replaces only in UI-attribute contexts:
//               children:"X", label:"X", title:"X", placeholder:"X",
//               "data-tooltip":"X", "aria-label":"X", confirmLabel:"X"
//   template -> replaces `English ${...}` template literals (backtick-quoted)
// Usage: node apply.js <file> [--write]
// Without --write, prints what WOULD change and reports keys with 0 matches.
const fs = require('fs')
const path = require('path')

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

const applyExact = (src, dictSection) => {
  for (const [en, zh] of Object.entries(dictSection)) {
    const re = new RegExp('"' + esc(en) + '"', 'g')
    const n = countOf(src, re)
    if (n === 0) {
      // idempotent: already translated if the Chinese value is present
      const reZh = new RegExp('"' + esc(zh) + '"', 'g')
      if (countOf(src, reZh) === 0) missed.push(en)
      continue
    }
    src = src.replace(re, '"' + zh + '"')
    totalReplaced += n
  }
  return src
}

// pattern first so children:"X" gets the same translation before exact runs
for (const [en, zh] of Object.entries(dict.pattern)) {
  for (const [k, tmpl] of attrKeys) {
    const re = new RegExp(tmpl.replace('%s', esc(en)), 'g')
    const n = countOf(src, re)
    if (n === 0) continue
    src = src.replace(re, tmpl.replace('%s', esc(zh)))
    totalReplaced += n
  }
}

// code: exact multi-token fragments (e.g. pluralization), replaced verbatim
for (const [en, zh] of Object.entries(dict.code || {})) {
  const re = new RegExp(esc(en), 'g')
  const n = countOf(src, re)
  if (n === 0) {
    const reZh = new RegExp(esc(zh), 'g')
    if (countOf(src, reZh) === 0) missed.push('[code] ' + en)
    continue
  }
  src = src.replace(re, zh)
  totalReplaced += n
}

for (const [en, zh] of Object.entries(dict.template)) {
  const re = new RegExp('`' + esc(en) + '`', 'g')
  const n = countOf(src, re)
  if (n === 0) {
    const reZh = new RegExp('`' + esc(zh) + '`', 'g')
    if (countOf(src, reZh) === 0) missed.push('`' + en + '`')
    continue
  }
  src = src.replace(re, '`' + zh + '`')
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

if (write) {
  fs.writeFileSync(file, src)
  console.log(`wrote ${file}`)
}
