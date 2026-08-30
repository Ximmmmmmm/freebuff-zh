#!/usr/bin/env node
// From a leftover.js listing, print untranslated template literals that contain
// interpolation — the most likely user-facing dynamic strings.
// Usage: node tools/tpls.js <leftovers.txt>
const fs = require('fs')
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/)
const out = []
for (const l of lines) {
  const m = l.match(/^(\d+)\t(template|string|template\/string)\t(.*)$/)
  if (!m) continue
  const n = Number(m[1])
  const type = m[2]
  const text = m[3]
  if (type.includes('template') && text.includes('${') && !/[\u4e00-\u9fff]/.test(text)) {
    out.push([n, text])
  }
}
out.sort((a, b) => b[0] - a[0])
for (const [n, t] of out) console.log(`${n}\t${t}`)
console.log(`total: ${out.length}`)
