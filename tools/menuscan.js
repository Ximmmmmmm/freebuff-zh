#!/usr/bin/env node
// Extract user-facing literals (label/title/message/detail/buttonLabel/etc.)
// from main-process files, showing any that still contain English words.
// Usage: node tools/menuscan.js <asar-extracted-dir>
const fs = require('fs')
const path = require('path')
const dir = process.argv[2]
const files = fs.readdirSync(dir).filter((f) => /\.(cjs|html)$/.test(f))
const re = /(label|title|message|detail|buttonLabel|placeholder|body|heading|subtitle|hint):(["'])((?:[^"'\\]|\\.)*)\2/g
for (const f of files) {
  const p = path.join(dir, f)
  const src = fs.readFileSync(p, 'utf8')
  const seen = new Set()
  let m
  const rows = []
  while ((m = re.exec(src)) !== null) {
    const raw = m[2]
    let s
    try { s = JSON.parse('"' + raw.replace(/\\/g, '\\\\') + '"') } catch { s = raw }
    if (/[a-zA-Z]{3,}/.test(s) && !seen.has(m[1] + s)) {
      seen.add(m[1] + s)
      rows.push([m[1], s])
    }
  }
  if (rows.length) {
    console.log(`===== ${f}`)
    for (const [k, v] of rows) console.log(`  ${k}: ${JSON.stringify(v)}`)
  }
}
