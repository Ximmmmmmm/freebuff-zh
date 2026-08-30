#!/usr/bin/env node
// Find UI-attribute literal values (data-tooltip / aria-label / title /
// placeholder / children) that still contain English prose.
// Usage: node tools/attrs.js <bundle>
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8')
const re = /("data-tooltip"|"aria-label"|title|placeholder|children):"((?:[^"\\]|\\.)*)"/g
const out = new Map()
let m
while ((m = re.exec(src)) !== null) {
  let s
  try { s = JSON.parse('"' + m[2].replace(/\\/g, '\\\\') + '"') } catch { s = m[2] }
  if (/[a-zA-Z]{3,}/.test(s) && !/[\u4e00-\u9fff]/.test(s) && !/^[a-z][a-z0-9-]*$/.test(s) && !/^[A-Z][A-Za-z]*$/.test(s) && !/^[A-Z][a-z]+$/.test(s)) {
    out.set(s, (out.get(s) || 0) + 1)
  }
}
const arr = [...out.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
for (const [s, n] of arr) console.log(`${n}\t${s}`)
console.log(`total ${arr.length}`)
