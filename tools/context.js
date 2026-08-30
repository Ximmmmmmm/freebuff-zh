#!/usr/bin/env node
// Print context windows around occurrences of given strings inside a JS bundle.
// Usage: node context.js <file> <string1> [string2 ...]
// For each string, prints up to N occurrences with ~80 chars on each side.
const fs = require('fs')

const file = process.argv[2]
const needles = process.argv.slice(3)
if (!file || needles.length === 0) {
  console.error('usage: node context.js <file> <string> [...]')
  process.exit(1)
}
const src = fs.readFileSync(file, 'utf8')
const W = 70

for (const n of needles) {
  const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  let m, count = 0
  console.log(`\n===== "${n}" =====`)
  while ((m = re.exec(src)) !== null && count < 6) {
    const start = Math.max(0, m.index - W)
    const end = Math.min(src.length, m.index + n.length + W)
    console.log(`[${count}] …${src.slice(start, end).replace(/\n/g, '\\n')}…`)
    count++
  }
  if (count === 0) console.log('(no occurrences)')
}
