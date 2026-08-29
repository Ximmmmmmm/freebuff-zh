#!/usr/bin/env node
// Check which user-facing English strings in the bundle are NOT in dict.json
const fs = require('fs')
const path = require('path')

const bundlePath = process.argv[2]
if (!bundlePath) {
  console.error('Usage: node check_remaining.js <bundle.js>')
  process.exit(1)
}

// Load dictionary
const dictPath = path.join(__dirname, '..', 'dict.json')
const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'))
const allKeys = new Set()
for (const cat of Object.values(dict)) {
  for (const key of Object.keys(cat)) {
    allKeys.add(key)
  }
}

// Read bundle
const src = fs.readFileSync(bundlePath, 'utf8')

// Extract all string literals (double and single quoted)
const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g
const counts = new Map()
let m
while ((m = re.exec(src)) !== null) {
  const raw = m[1] !== undefined ? m[1] : m[2]
  let s
  try { s = JSON.parse('"' + raw.replace(/\\/g, '\\\\') + '"') } catch { s = raw }
  if (!s || s.length < 3) continue
  counts.set(s, (counts.get(s) || 0) + 1)
}

// Also extract backtick templates (simplified: grab content between backticks)
const tplRe = /`((?:[^`\\]|\\.)*?)`/g
while ((m = tplRe.exec(src)) !== null) {
  let s = m[1]
  if (!s || s.length < 3) continue
  // skip pure code templates (no spaces, no letters beyond identifiers)
  counts.set(s, (counts.get(s) || 0) + 1)
}

// Filter: user-facing English prose
const isUserFacing = (s) => {
  if (/[\\u4e00-\\u9fff]/.test(s)) return false  // already Chinese
  if (!/[A-Za-z]/.test(s)) return false
  const t = s.trim()
  if (t.length < 3) return false
  
  // Skip HTML/CSS/JSX noise
  if (/^<(div|span|button|input|svg|path|circle|rect|text|main|menu|label|pre|code|img|form|br|hr)/.test(t)) return false
  if (/^(data-|aria-|on[A-Z]|class=|style=|className=)/.test(t)) return false
  
  // Skip code patterns
  if (/^[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]*$/.test(t)) return false  // camelCase
  if (/^[a-z]+_[a-z]+$/.test(t)) return false  // snake_case
  if (/^[A-Z_]+$/.test(t)) return false  // ALL_CAPS
  if (/^\.\/|^http|^import|^export/.test(t)) return false
  
  // Must look like natural language: has a space or is a title-case word
  if (/\s/.test(t)) return true
  if (/^[A-Z][a-z]{2,}$/.test(t) && !/^(Div|Span|Button|Input|Svg|Path|Rect|Text|Main|Menu|Label|Pre|Code|Img|Form|True|False|Null|Undefined|Error|Object|Array|String|Number|Boolean|Symbol|Promise|Module|Exports|Returns|Function|Class|Constructor|Proto|Super|This|New|Delete|Void|Typeof|Instanceof|In|Of|With|For|While|If|Else|Switch|Case|Break|Continue|Return|Throw|Try|Catch|Finally|Debugger|Yield|Async|Await|Static|Get|Set|Extends|Implements|Interface|Type|Enum|Package|Private|Protected|Public|Abstract|Final|Native|Transient|Volatile|Synchronized|Native|Strict)$/.test(t)) return true
  
  return false
}

// Classify: translated or not
const translated = []
const untranslated = []

for (const [s, n] of counts) {
  if (!isUserFacing(s)) continue
  if (allKeys.has(s)) {
    translated.push([n, s])
  } else {
    untranslated.push([n, s])
  }
}

untranslated.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]))
translated.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]))

console.log(`=== 未翻译的用户可见英文 (${untranslated.length} 处) ===`)
console.log(`(频次\t字符串)\n`)
for (const [n, s] of untranslated) {
  console.log(`${n}\t${s}`)
}

console.log(`\n=== 已翻译 (${translated.length} 处) ===`)
for (const [n, s] of translated) {
  console.log(`${n}\t${s}`)
}
