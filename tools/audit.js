#!/usr/bin/env node
// Audit: which previously-catalogued UI candidates are STILL in English in the
// current bundle (quoted literals + backtick templates).
// Usage: node tools/audit.js <bundle> [candidates.tsv]
const fs = require('fs')
const path = require('path')

const file = process.argv[2]
const candFile = process.argv[3] || path.join(__dirname, '..', 'work', 'candidates.tsv')
const src = fs.readFileSync(file, 'utf8')
const lines = fs.readFileSync(candFile, 'utf8').split(/\r?\n/).filter(Boolean)

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const count = (re) => {
  const r = new RegExp(re.source, re.flags)
  let n = 0
  while (r.exec(src) !== null) n++
  return n
}

const hits = []
for (const line of lines) {
  const tab = line.indexOf('\t')
  if (tab < 0) continue
  const s = line.slice(tab + 1)
  if (!s || s.length < 3 || /[\u4e00-\u9fff]/.test(s)) continue
  // skip obvious code/identifiers/CSS classes
  if (/^[a-z0-9_ .\-:;=,()/\\+*'"<>]+$/.test(s) && !/^[A-Z]/.test(s)) continue
  const n = count(new RegExp('"' + esc(s) + '"', 'g'))
  if (n > 0) hits.push([n, s])
}
hits.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]))
for (const [c, s] of hits) console.log(`${c}\t${s}`)
console.log(`---TOTAL remaining UI candidates: ${hits.length}`)
