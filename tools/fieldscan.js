#!/usr/bin/env node
// 字段级英文残留扫描：列出 `<字段>:"英文"` 且译文仍是英文的条目。
//
// 为什么需要它：`uipos.js` 只认界面属性锚点（children/label/title/placeholder/
// aria-label/data-tooltip/confirmLabel/actionLabel），像 `description:` / `tagline:` /
// `hint:` 这类字段不在锚点里，整片英文也扫不出来——0.0.103.2 就是在 connectors 目录里
// 撞到 100 条 `description:` 介绍全是英文（还是用户能看见的宫格介绍）。
//
// 用法：node tools/fieldscan.js <bundle.js> [字段名…]
//   默认扫描 description tagline hint subtitle note
//   退出码：0 = 没有残留；1 = 有残留（列出明细，供人工决定翻译还是有意保留）
const fs = require('fs')

const file = process.argv[2]
if (!file) {
  console.error('usage: node tools/fieldscan.js <bundle.js> [field …]')
  process.exit(2)
}
const src = fs.readFileSync(file, 'utf8')
const extra = process.argv.slice(3).filter((a) => !a.startsWith('--'))
const FIELDS = extra.length ? extra : ['description', 'tagline', 'hint', 'subtitle', 'note']

const hasCJK = /[\u3400-\u9fff]/
const counts = new Map()

for (const field of FIELDS) {
  const re = new RegExp(field + ':"((?:[^"\\\\]|\\\\.)*)"', 'g')
  let m
  while ((m = re.exec(src)) !== null) {
    let v
    try {
      v = JSON.parse('"' + m[1] + '"')
    } catch {
      v = m[1]
    }
    if (!v || hasCJK.test(v) || !/[A-Za-z]/.test(v)) continue
    // 纯标识符 / 路径 / 命令不像给人看的文案
    if (/^[\w./@-]+$/.test(v.trim()) && !/\s/.test(v)) continue
    const key = field + '|' + v
    counts.set(key, (counts.get(key) || 0) + 1)
  }
}

const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
console.log(`字段级英文残留（${FIELDS.join('/')}）：${entries.length}`)
for (const [k, n] of entries) {
  const i = k.indexOf('|')
  console.log(`${n}\t${k.slice(0, i)}: ${k.slice(i + 1)}`)
}
process.exit(entries.length ? 1 : 0)
