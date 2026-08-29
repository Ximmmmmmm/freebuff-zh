#!/usr/bin/env node
// Scan the installed app for user-facing English strings not yet in dict.json.
// Usage: node scan_installed.js <bundle.js> [app.asar-extracted-dir]
const fs = require('fs')
const path = require('path')

const dictPath = path.join(__dirname, '..', 'dict.json')
const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'))
const allKeys = new Set()
for (const cat of Object.values(dict)) {
  for (const k of Object.keys(cat)) allKeys.add(k)
}

// --- helpers ---
function extractStrings(src) {
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g
  const counts = new Map()
  let m
  while ((m = re.exec(src)) !== null) {
    const raw = m[1] !== undefined ? m[1] : m[2]
    let s
    try { s = JSON.parse('"' + raw.replace(/\\/g, '\\\\') + '"') } catch { s = raw }
    if (!s || s.length < 3) continue
    counts.set(s, (counts.get(s) || 0) + 1)
  }
  return counts
}

function isProse(s) {
  if (/[\u4e00-\u9fff]/.test(s)) return false // already Chinese
  if (!/[A-Za-z]/.test(s)) return false
  const t = s.trim()
  if (t.length < 4) return false
  // Must contain a space or be title-case word (real word, not code)
  if (/\s/.test(t)) {
    // phrase with spaces — check it looks like English prose
    if (/^[A-Za-z][A-Za-z ,.!?'’&:…·%+/\-()]+\.?$/.test(t)) return true
    // template-like with ${} — interesting
    if (/\$\{/.test(t) && /[A-Z]/.test(t)) return true
  }
  // Single title-case word ≥ 4 letters
  if (/^[A-Z][a-z]{3,}$/.test(t)) return true
  return false
}

// Skip words that are intentionally kept English per README
const skipWords = new Set([
  'Enter', 'Delete', 'Escape', 'Tab', 'Home', 'End',
  'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight',
  'Backspace', 'Shift', 'Control', 'Alt', 'Meta',
  'Python', 'TypeScript', 'JavaScript', 'JavaScript',
  'Markdown', 'Celsius', 'Unicode',
  'Ayu Dark', 'Ayu Light', 'Ayu Mirage',
])

// --- scan bundle ---
const bundleFile = process.argv[2]
if (!bundleFile) {
  console.error('Usage: node scan_installed.js <bundle.js>')
  process.exit(1)
}

console.log(`Scanning: ${bundleFile}\n`)
const src = fs.readFileSync(bundleFile, 'utf8')
const counts = extractStrings(src)

const missing = []
for (const [s, n] of counts) {
  if (!isProse(s)) continue
  if (allKeys.has(s)) continue
  if (skipWords.has(s)) continue
  missing.push([n, s])
}

missing.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]))

console.log(`=== 未翻译的用户可见英文 (${missing.length} 处) ===\n`)
for (const [n, s] of missing) {
  console.log(`${n}\t${s}`)
}

// --- scan main process (app.asar) ---
const asarDir = process.argv[3]
if (asarDir) {
  console.log(`\n\n=== 主进程扫描: ${asarDir} ===\n`)
  const electronDir = path.join(asarDir, 'electron')
  if (fs.existsSync(electronDir)) {
    const mainCounts = new Map()
    const files = fs.readdirSync(electronDir).filter(f => /\.(cjs|js|html)$/.test(f))
    for (const f of files) {
      const src = fs.readFileSync(path.join(electronDir, f), 'utf8')
      const c = extractStrings(src)
      for (const [s, n] of c) {
        mainCounts.set(s, (mainCounts.get(s) || 0) + n)
      }
    }
    // Also check package.json
    const pkgPath = path.join(asarDir, 'package.json')
    if (fs.existsSync(pkgPath)) {
      const src = fs.readFileSync(pkgPath, 'utf8')
      const c = extractStrings(src)
      for (const [s, n] of c) mainCounts.set(s, (mainCounts.get(s) || 0) + n)
    }

    const mainMissing = []
    for (const [s, n] of mainCounts) {
      if (!isProse(s)) continue
      if (allKeys.has(s)) continue
      if (skipWords.has(s)) continue
      mainMissing.push([n, s])
    }
    mainMissing.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]))
    console.log(`未翻译 (${mainMissing.length} 处):`)
    for (const [n, s] of mainMissing) {
      console.log(`${n}\t${s}`)
    }
  } else {
    console.log('(electron/ 目录不存在)')
  }
}
