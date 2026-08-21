#!/usr/bin/env node
// After applying the dictionary, list remaining user-facing English phrases.
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8')
const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g
const counts = new Map()
let m
while ((m = re.exec(src)) !== null) {
  const raw = m[1] !== undefined ? m[1] : m[2]
  let s
  try { s = JSON.parse('"' + raw.replace(/\\/g, '\\\\') + '"') } catch { s = raw }
  if (!s || s.length < 4 || /[\u4e00-\u9fff]/.test(s)) continue
  // keep only prose-looking: has a space, alphabetic, no code punctuation
  if (!/\s/.test(s)) continue
  if (!/^[A-Za-z][A-Za-z ,.!?'’&:…·%+/-]*$/.test(s)) continue
  if (/^(viewBox|void 0|and |or |of |in |for |on |to |the |a |an |with |from |at |by )$/.test(s)) continue
  if (/^\d/.test(s)) continue
  counts.set(s, (counts.get(s) || 0) + 1)
}
const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
for (const [s, n] of entries) console.log(`${n}\t${s}`)
