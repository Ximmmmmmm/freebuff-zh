#!/usr/bin/env node
// Find English text still sitting in UI-attribute positions:
// children:"…", label:"…", title:"…", placeholder:"…", "data-tooltip":"…", "aria-label":"…", confirmLabel:"…"
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8')
const re = /(children|label|title|placeholder|"data-tooltip"|"aria-label"|confirmLabel):"((?:[^"\\]|\\.)*)"/g
const counts = new Map()
let m
while ((m = re.exec(src)) !== null) {
  let s
  try { s = JSON.parse('"' + m[2].replace(/\\/g, '\\\\') + '"') } catch { s = m[2] }
  if (!s || /[\u4e00-\u9fff]/.test(s)) continue
  if (!/[A-Za-z]/.test(s)) continue
  counts.set(s, (counts.get(s) || 0) + 1)
}
const arr = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
console.log(`remaining UI-position English: ${arr.length}`)
for (const [s, n] of arr) console.log(`${n}\t${s}`)
