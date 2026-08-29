#!/usr/bin/env node
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8')
const words = process.argv.slice(3)
for (const w of words) {
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('"' + esc + '"', 'g')
  let m, c = 0
  const out = []
  while ((m = re.exec(src)) !== null && c < 3) {
    const s = Math.max(0, m.index - 42)
    const e = Math.min(src.length, m.index + w.length + 2 + 42)
    out.push(src.slice(s, e).replace(/\n/g, '\\n'))
    c++
  }
  console.log(`===== "${w}" (${c}) =====`)
  for (const o of out) console.log('  …' + o + '…')
}
