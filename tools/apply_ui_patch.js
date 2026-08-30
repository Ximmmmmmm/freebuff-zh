// Apply UI index.html translations directly (replaces git apply for this file).
// Like apply.js for dict entries, every replacement that matches neither the
// English source nor the (already applied) Chinese translation is reported as
// MISSED — a version bump that rewrites index.html must not fail silently.
// Usage: node apply_ui_patch.js <index.html>
const fs = require('fs')

const f = process.argv[2]
if (!f) {
  console.error('usage: node apply_ui_patch.js <index.html>')
  process.exit(1)
}

const replacements = [
  ['<html lang="en">', '<html lang="zh-CN">'],
  ['<title>Freebuff Desktop</title>', '<title>Freebuff 桌面版</title>'],
  ["<h1>Freebuff couldn't load</h1>", '<h1>Freebuff 无法加载</h1>'],
  ['<h1>Freebuff couldn’t load</h1>', '<h1>Freebuff 无法加载</h1>'],
  [/Part of the interface did not start\. Reload once; if this screen returns, reinstall the\r?\n\s+latest version\. Your projects and conversations are safe\./,
   '部分界面未能启动。请重新加载一次；如果此界面再次出现，请重新安装最新版本。你的项目和对话都是安全的。'],
  ['Reload Freebuff', '重新加载 Freebuff'],
  ['Get latest installer', '获取最新安装程序'],
]

let s = fs.readFileSync(f, 'utf8')
const before = s
let applied = 0
const missed = []

for (const [from, to] of replacements) {
  const hit = from instanceof RegExp ? from.test(s) : s.includes(from)
  if (hit) {
    s = s.replace(from, to)
    applied++
  } else if (!s.includes(to)) {
    const label = typeof from === 'string' ? from : from.source
    missed.push(label.length > 80 ? label.slice(0, 77) + '...' : label)
  }
}

if (missed.length) {
  console.log(`MISSED (${missed.length} replacements, no match —— 原文可能随版本改写，需人工核对):`)
  for (const m of missed) console.log('  - ' + JSON.stringify(m))
}

if (s === before) {
  console.log(applied === 0 && missed.length === 0
    ? 'apply_ui_patch: no changes (already translated?)'
    : `apply_ui_patch: no changes (${applied} applied, ${missed.length} missed)`)
} else {
  fs.writeFileSync(f, s)
  console.log(`apply_ui_patch: patched ${f} (${applied} replacements)`)
}
