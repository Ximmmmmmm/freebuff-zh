#!/usr/bin/env node
// From a leftover.js listing, keep only entries that look like user-facing
// English prose (sentence-like, natural punctuation only).
// Usage: node tools/filter.js <leftovers.txt> [minWords]
const fs = require('fs')
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/)
const minWords = Number(process.argv[3] || 2)

const CODE_CHARS = /[{}[\]()=;<>|\\^~`@#$%&*+_/]/
const isProse = (t) => {
  if (!t || t.length < 4 || /[\u4e00-\u9fff]/.test(t)) return false
  if (!/[A-Za-z]/.test(t)) return false
  if (CODE_CHARS.test(t)) return false
  // word count: alphabetic runs
  const words = (t.match(/[A-Za-z]+/g) || []).length
  if (words < minWords) return false
  // require at least one lowercase word longer than 2 (prose-like), or Title Case phrase
  const lowWords = t.match(/[a-z]{3,}/g) || []
  if (lowWords.length === 0 && !/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(t)) return false
  // exclude pure data rows / csv-like
  if (/\t/.test(t)) return false
  return true
}

const out = new Map()
for (const l of lines) {
  const m = l.match(/^(\d+)\t(template|string|template\/string)\t(.*)$/)
  if (!m) continue
  const n = Number(m[1])
  const text = m[3]
  if (!isProse(text)) continue
  out.set(text, (out.get(text) || 0) + n)
}
const arr = [...out.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
for (const [t, c] of arr) console.log(`${c}\t${t}`)
console.log(`total distinct: ${arr.length}`)
