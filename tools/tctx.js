#!/usr/bin/env node
// Print context windows around backtick template literals.
// Usage: node tools/tctx.js <file> <template-substring> [max]
const fs = require('fs')
const file = process.argv[2]
const w = process.argv[3]
const max = Number(process.argv[4] || 6)
const src = fs.readFileSync(file, 'utf8')
const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const re = new RegExp('`' + esc, 'g')
let m, c = 0
console.log(`===== \`${w}\` (showing up to ${max}) =====`)
while ((m = re.exec(src)) !== null && c < max) {
  const s = Math.max(0, m.index - 120)
  const e = Math.min(src.length, m.index + w.length + 160)
  console.log(`[${c}] …${src.slice(s, e).replace(/\n/g, '\\n')}…`)
  c++
}
if (c === 0) console.log('(no matches)')
