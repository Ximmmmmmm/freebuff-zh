#!/usr/bin/env node
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8')
const w = process.argv[3]
const max = Number(process.argv[4] || 14)
const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const re = new RegExp('"' + esc + '"', 'g')
let m, c = 0
console.log(`===== "${w}" (showing up to ${max}) =====`)
while ((m = re.exec(src)) !== null && c < max) {
  const s = Math.max(0, m.index - 55)
  const e = Math.min(src.length, m.index + w.length + 2 + 55)
  console.log(`[${c}] …${src.slice(s, e).replace(/\n/g, '\\n')}…`)
  c++
}
