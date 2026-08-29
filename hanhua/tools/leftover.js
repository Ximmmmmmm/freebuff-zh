#!/usr/bin/env node
// Lexical scanner: walks the bundle and extracts every string literal
// (double-quoted, single-quoted, and backtick templates) and regexes with care,
// then lists the ones that still read as English.
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8')
const HELP = process.argv.includes('-h')

const isAsciiProse = (s) => {
  if (!s || s.length < 3 || /[\u4e00-\u9fff]/.test(s)) return false
  if (!/[A-Za-z]/.test(s)) return false
  // strip whitespace/trailing punctuation for the checks
  const t = s.trim()
  if (t.length < 2) return false
  return true
}

function tokenize(code) {
  const out = []
  let i = 0
  const n = code.length
  while (i < n) {
    const c = code[i]
    // whitespace
    if (/\s/.test(c)) { i++; continue }
    // line comment
    if (c === '/' && code[i + 1] === '/') { while (i < n && code[i] !== '\n') i++; continue }
    // block comment
    if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    // string literals
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      let j = i + 1
      let val = ''
      while (j < n) {
        const ch = code[j]
        if (ch === '\\') { val += code.slice(j, j + 2); j += 2; continue }
        if (ch === quote) { j++; break }
        if (quote === '`' && ch === '$' && code[j + 1] === '{') {
          // consume interpolation, tracking braces
          let depth = 1
          let k = j + 2
          while (k < n && depth > 0) {
            if (code[k] === '{') depth++
            else if (code[k] === '}') depth--
            if (code[k] === '`') { /* theoretically a nested template; skip over it */ }
            k++
          }
          val += code.slice(j, k)
          j = k
          continue
        }
        val += ch
        j++
      }
      out.push({ type: quote === '`' ? 'template' : 'string', quote, value: val, start: i })
      i = j
      continue
    }
    i++
  }
  return out
}

const toText = (tok) => {
  if (tok.type === 'template') return tok.value
  // unescape for display
  try { return JSON.parse('"' + tok.value.replace(/^'|'$/g, '"').replace(/"/g, '\\"') + '"') } catch {
    return tok.value
  }
}

const skipBad = (s, type) => {
  const t = s.trim()
  if (!t) return true
  if (!/[A-Za-z]/.test(t)) return true
  if (/[\u4e00-\u9fff]/.test(t)) return true
  // pure identifier-ish / code
  if (/^[a-z][a-z0-9]*$/.test(t) && t === t.toLowerCase()) return true
  if (/^[A-Z][A-Za-z0-9]*$/.test(t) && t === t) return false // "Login" etc still prose-ish
  // CSS-ish, attrs, events — but only apply to string-type (templates drop out)
  if (type === 'string') {
    if (/^(div|span|button|input|svg|path|circle|rect|text|main|menu|label|pre|code|img|form)\b/.test(t)) return true
    if (/^(on|data|aria)-/.test(t)) return true
  }
  if (type === 'template' && /\$\{/.test(t)) return false // templates with interpolation ARE interesting
  if (/^[a-z0-9_ .\-:;=%&|!?+*/<>,()\[\]{}"'\\]+$/.test(t) && !/\s/.test(t)) {
    // single token, all-lower with no capitals -> likely code unless length>18 with spaces
    if (!/[A-Z]/.test(t)) return true
  }
  return false
}

const toks = tokenize(src)

// Aggregate with sample + type counts.
const agg = new Map()
for (const tok of toks) {
  const text = toText(tok)
  if (skipBad(text, tok.type)) continue
  if (!agg.has(text)) agg.set(text, { n: 0, types: new Set(), sample: '' })
  const a = agg.get(text)
  a.n++
  a.types.add(tok.type)
  if (!a.sample || a.sample.length < 60) a.sample = text
}
const arr = [...agg.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
if (HELP) {
  console.log('leftover.js <file> — lists remaining English-looking string literals (count<TAB>types<TAB>text)')
  console.log(`counts: ${toks.length} literals tokenized`)
}
for (const [text, a] of arr) {
  console.log(`${a.n}\t${[...a.types].join('/')}\t${text}`)
}
