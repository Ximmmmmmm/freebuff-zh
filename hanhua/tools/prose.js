#!/usr/bin/env node
// Scan a JS bundle for remaining English prose: multi-word fragments inside
// double-quoted, single-quoted, or backtick literals, including fragments that
// are concatenation pieces (e.g. " more — keep typing").
// Usage: node tools/prose.js <bundle> [minWordCount]
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8')
const MINW = Number(process.argv[3] || 2)

function tokenize(code) {
  const out = []
  let i = 0
  const n = code.length
  while (i < n) {
    const c = code[i]
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      let j = i + 1
      let val = ''
      while (j < n) {
        const ch = code[j]
        if (ch === '\\') { val += code.slice(j, j + 2); j += 2; continue }
        if (ch === quote) { j++; break }
        if (quote === '`' && ch === '$' && code[j + 1] === '{') {
          let depth = 1
          let k = j + 2
          while (k < n && depth > 0) {
            if (code[k] === '{') depth++
            else if (code[k] === '}') depth--
            k++
          }
          val += code.slice(j, k)
          j = k
          continue
        }
        val += ch
        j++
      }
      out.push(val)
      i = j
      continue
    }
    i++
  }
  return out
}

const counts = new Map()
for (const v of tokenize(src)) {
  const t = v.trim()
  if (!t || /[\u4e00-\u9fff]/.test(t)) continue
  if (!/[A-Za-z]/.test(t)) continue
  // count "words" as alphabetic runs
  const words = (t.match(/[A-Za-z]+/g) || []).length
  if (words < MINW) continue
  if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(t) && words <= 3) continue // e.g. "Angular HTML" language names
  counts.set(t, (counts.get(t) || 0) + 1)
}
const arr = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
for (const [t, c] of arr) console.log(`${c}\t${t}`)
console.log(`total distinct: ${arr.length}`)
