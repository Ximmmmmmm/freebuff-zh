#!/usr/bin/env node
// Print context windows around EXACT quoted occurrences: "word" (double-quoted literal).
// Usage: node context2.js <file> <word> [word ...]
const fs = require('fs')

const file = process.argv[2]
const words = process.argv.slice(3)
if (!file || words.length === 0) {
  console.error('usage: node context2.js <file> <word> [...]')
  process.exit(1)
}
const src = fs.readFileSync(file, 'utf8')
const W = 60

for (const w of words) {
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('"' + esc + '"', 'g')
  let m, count = 0
  console.log(`\n===== "\\"${w}\\"" =====`)
  while ((m = re.exec(src)) !== null && count < 6) {
    const start = Math.max(0, m.index - W)
    const end = Math.min(src.length, m.index + w.length + 2 + W)
    console.log(`[${count}] …${src.slice(start, end).replace(/\n/g, '\\n')}…`)
    count++
  }
  if (count === 0) console.log('(no exact quoted occurrences)')
}
