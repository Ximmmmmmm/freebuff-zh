#!/usr/bin/env node
// Count exact quoted occurrences ("Word") of given words in a file, sorted desc.
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8')
const words = process.argv.slice(3)
const out = []
for (const w of words) {
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('"' + esc + '"', 'g')
  const n = (src.match(re) || []).length
  out.push([n, w])
}
out.sort((a, b) => b[0] - a[0])
for (const [n, w] of out) console.log(`${n}\t${w}`)
