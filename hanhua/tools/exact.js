#!/usr/bin/env node
// Print the exact enclosing literal (backtick template or quoted string) for a
// search term. Usage: node tools/exact.js <bundle> <search> [max]
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8')
const w = process.argv[3]
const max = Number(process.argv[4] || 8)
let from = 0
let found = 0
while (found < max) {
  const idx = src.indexOf(w, from)
  if (idx < 0) break
  from = idx + w.length
  // walk backwards to find opening quote
  let q = -1
  for (let i = idx; i >= 0; i--) {
    const c = src[i]
    if (c === '`' || c === '"' || c === "'") { q = i; break }
    if (c === '/' || c === ';') break
  }
  if (q < 0) continue
  const quote = src[q]
  let end = -1
  let i = q + 1
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue }
    if (src[i] === quote) { end = i; break }
    if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
      let depth = 1
      let k = i + 2
      while (k < src.length && depth > 0) {
        if (src[k] === '{') depth++
        else if (src[k] === '}') depth--
        k++
      }
      i = k
      continue
    }
    i++
  }
  if (end < 0) continue
  const lit = src.slice(q, end + 1)
  console.log(`[${found}] ${lit}`)
  found++
}
