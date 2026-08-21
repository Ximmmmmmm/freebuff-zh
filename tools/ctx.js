#!/usr/bin/env node
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8')
const needle = process.argv[3]
const before = Number(process.argv[4] || 120)
const after = Number(process.argv[5] || 120)
let i = src.indexOf(needle)
if (i === -1) {
  console.log('(not found)')
  process.exit(0)
}
console.log('…' + src.slice(Math.max(0, i - before), i + needle.length + after).replace(/\n/g, '\\n') + '…')
