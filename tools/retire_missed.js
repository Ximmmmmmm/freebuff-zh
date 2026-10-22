#!/usr/bin/env node
// 自动退休「够不着的词条」：本版 UI 里怎么都命中不了的条目，从 dict.json 移进归档，让严格构建能过。
//
// 为什么可以自动做：这些条目在本版产物里**一次都不会被替换**——
//   · 只在主进程出现  → 词典本来就够不着主进程，该写成 patches/electron-*.patch；
//   · 只在上版 UI 出现 → 上游把整句改写/下线了；
//   · 两边都没有      → 历史死词条。
// 留着它们，严格构建永远 MISSED 失败（0.0.186 就是被 7 条这样的句子挂住的）。
// 归档保留原文与译文，想复用随时翻得出来，不做静默丢弃。
//
// 数据来源是 tools/missed_diagnose.js --json（同一套分类，不自己再猜一遍）。
//
// 用法：
//   node tools/retire_missed.js --ui <本版 ui|bundle> --ver <版本> [--electron <目录>] [--prev-ui <上版 ui>]
//   node tools/retire_missed.js ... --write      # 归档 + 走 dictapply 落盘
// 退出码：0 = 有可退休条目（试跑）或已退休；1 = 没有可退休条目 / 执行失败；2 = 用法问题
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const argv = process.argv.slice(2)
const opt = { write: false }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--write') opt.write = true
  else if (['--ui', '--ver', '--electron', '--prev-ui'].includes(a)) opt[a.slice(2)] = argv[++i]
  else {
    console.error('未知参数：' + a)
    process.exit(2)
  }
}
if (!opt.ui || !opt.ver) {
  console.error('usage: node tools/retire_missed.js --ui <ui|bundle> --ver <version> [--electron <dir>] [--prev-ui <ui>] [--write]')
  process.exit(2)
}

const REPO = path.resolve(__dirname, '..')
const dictPath = path.join(REPO, 'dict.json')
const archiveDir = path.join(REPO, 'work', 'retired')
const archivePath = path.join(archiveDir, `dict-${opt.ver}.json`)

// —— 1) 问 missed_diagnose：哪些条目够不着（它退出码 1 是正常的）——
const args = ['tools/missed_diagnose.js', '--dict', dictPath, '--ui', opt.ui, '--json', '--quiet']
if (opt.electron) args.push('--electron', opt.electron)
if (opt['prev-ui']) args.push('--prev-ui', opt['prev-ui'])
let raw = ''
try {
  raw = execFileSync(process.execPath, args, { cwd: REPO, encoding: 'utf8' })
} catch (e) {
  // 退出码 1 时 stdout 里仍是完整 JSON；真正的错误在 stderr
  if (e && typeof e.stdout === 'string' && e.stdout.trim().startsWith('{')) raw = e.stdout
  else {
    console.error('missed_diagnose 失败：' + ((e && (e.stderr || e.message)) || e))
    process.exit(1)
  }
}
let report
try {
  report = JSON.parse(raw)
} catch (e) {
  console.error('解析 missed_diagnose 的 JSON 失败：' + e.message)
  process.exit(1)
}

const why = {
  mainOnly: '只在本版主进程出现：词典够不着 electron/*.cjs，应改写进 patches/electron-*.patch，先退休',
  prevOnly: '只在上版 UI 出现：上游把整句改写或下线了，先退休（原文与译文已归档）',
  nowhere: '两边都没有：历史死词条',
}
const hit = []
for (const bucket of ['mainOnly', 'prevOnly', 'nowhere']) {
  for (const item of report[bucket] || []) {
    hit.push({ section: item.part, key: item.key, bucket, why: why[bucket] })
  }
}

if (!hit.length) {
  console.log('没有够不着的词条（全部命中本版 UI）：无需退休')
  process.exit(1)
}

console.log(`诊断：共 ${report.total} 条 → 命中 ${report.ok}，够不着 ${hit.length}`)
const byBucket = {}
for (const h of hit) byBucket[h.bucket] = (byBucket[h.bucket] || 0) + 1
for (const k of Object.keys(byBucket)) console.log(`  · ${k}: ${byBucket[k]}`)
for (const h of hit.slice(0, 8)) console.log(`    - [${h.section}] ${h.key.slice(0, 80)}`)
if (hit.length > 8) console.log(`    … 其余 ${hit.length - 8} 条略`)

// —— 2) 归档（同版本重跑时合并去重）——
let archive = { version: opt.ver, why: '严格构建够不着本版产物：按 missed_diagnose 分类自动退休', items: [] }
if (fs.existsSync(archivePath)) {
  try {
    const prev = JSON.parse(fs.readFileSync(archivePath, 'utf8'))
    if (prev && Array.isArray(prev.items)) archive.items = prev.items
  } catch {}
}
const seen = new Set(archive.items.map((x) => `${x.section}\u0000${x.key}`))
for (const h of hit) {
  const id = `${h.section}\u0000${h.key}`
  if (seen.has(id)) continue
  seen.add(id)
  archive.items.push({ section: h.section, key: h.key, bucket: h.bucket, why: h.why, retiredAt: new Date().toISOString().slice(0, 10) })
}

const changelist = {
  version: opt.ver,
  del: hit.map((h) => ({
    section: h.section,
    key: h.key,
    note: '本版够不着 UI（自动退休，分类 ' + h.bucket + '，归档见 work/retired/dict-' + opt.ver + '.json）',
  })),
}
const clPath = path.join(REPO, 'work', `changelist-retire-${opt.ver}.json`)
fs.mkdirSync(archiveDir, { recursive: true })
fs.writeFileSync(clPath, JSON.stringify(changelist, null, 2) + '\n')

if (!opt.write) {
  console.log(`试跑：清单 ${path.relative(REPO, clPath)}；加 --write 归档并落盘`)
  process.exit(0)
}

fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2) + '\n')
console.log(`已归档：${path.relative(REPO, archivePath)}（累计 ${archive.items.length} 条）`)

// —— 3) 走 dictapply 唯一入口落盘（它自己跑 lint，不过会还原）——
try {
  execFileSync(process.execPath, ['tools/dictapply.js', clPath, '--write'], { cwd: REPO, stdio: 'inherit' })
} catch (e) {
  console.error('dictapply --write 失败：' + ((e && e.message) || e))
  process.exit(1)
}
console.log(`已退休 ${hit.length} 条够不着的词条`)
