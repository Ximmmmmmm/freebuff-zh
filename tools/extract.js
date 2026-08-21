#!/usr/bin/env node
// Extract candidate user-facing string literals (English prose) from a file.
// Usage: node extract.js <file> [--all]
// Prints: text<TAB>count<TAB>firstSnippet?  sorted by count desc, then text.
// Default filter keeps strings that look like human-readable copy:
//   - at least two words, or one word with title case that isn't a code identifier
//   - skips camelCase/snake_case/kebab/ALL_CAPS identifiers, URLs, paths, format tokens
const fs = require('fs')

const file = process.argv[2]
if (!file) {
  console.error('usage: node extract.js <file> [--all]')
  process.exit(1)
}
const all = process.argv.includes('--all')
const src = fs.readFileSync(file, 'utf8')

// Match double-quoted string literals. Minified JS uses double quotes for most
// strings; also catch single-quoted ones used in some spots.
const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g
const counts = new Map()
let m
while ((m = re.exec(src)) !== null) {
  const raw = m[1] !== undefined ? m[1] : m[2]
  let s
  try {
    s = JSON.parse('"' + raw.replace(/\\/g, '\\\\') + '"')
  } catch {
    s = raw
  }
  if (!s || s.length < 2) continue
  counts.set(s, (counts.get(s) || 0) + 1)
}

const isProse = (s) => {
  if (/[\u4e00-\u9fff]/.test(s)) return false // already Chinese
  // has at least one space -> phrase
  if (/\s/.test(s)) return true
  // single word: title-case multi-letter word, or lowercase word with length>=3
  if (/^[A-Z][a-z]+$/.test(s)) return true
  if (/^[a-z]{3,}$/.test(s)) return true
  return false
}

const entries = [...counts.entries()]
  .filter(([s]) => (all ? true : isProse(s)))
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

for (const [s, n] of entries) {
  console.log(`${n}\t${s}`)
}
