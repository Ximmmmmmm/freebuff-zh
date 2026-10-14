#!/usr/bin/env node
// 用法：node tools/prune_missed.js <ui-dir> <changelist.json>
//
// 把「本批 changelist 新落盘、但在 bundle 里一条都命中不了」的词条从 dict.json 剔掉。
// 为什么需要：自动补翻链（upstreamdiff --emit → auto_translate → dictapply）有三类系统性失配——
//   ① 提取链会 trim 边缘空白，bundle 里却是 " Remove server" 这种带前导/尾空格的 JSX 数组元；
//   ② pattern 分区只采 UI 属性锚点，够不着 .describe() 参数、对象属性值这些非锚点位；
//   ③ exact 分区只采双引号字面量，单引号串（.describe('...')）不可达。
// 这些条目落盘也翻不了任何位置，严格构建（MISSED>0 即败）必被它们挂住。
// 剔掉不等于放弃：条目仍在上游报告（upstreamdiff/回归闸门）的人工待办里，形态修正确实后可从报告重建。
//
// 只动「本批新增」的键，不碰词典里既有的条目——迁移留下的 CONFIRM/GONE 仍是人工决策，不走这里。
// 任何异常都 exit 1 但 adapt.sh 侧按非致命处理（严格构建本身就是最终闸门）。

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const REPO = path.join(__dirname, '..')
const BS = String.fromCharCode(92)
const NL = String.fromCharCode(10)

const uiDir = process.argv[2]
const listPath = process.argv[3]
if (!uiDir || !listPath) {
  console.error('用法：node tools/prune_missed.js <ui-dir> <changelist.json>')
  process.exit(2)
}
const dictPath = path.join(REPO, 'dict.json')

// 定位主 bundle（与 build_locked.sh 同法：index.html 的 src）
const html = fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8')
const marker = 'src="./'
const hi = html.indexOf(marker)
if (hi < 0) { console.error('prune_missed: index.html 里找不到主 bundle src'); process.exit(1) }
const rest = html.slice(hi + marker.length)
const bundleRel = rest.slice(0, rest.indexOf('"'))
const bundle = path.join(uiDir, bundleRel)
if (!fs.existsSync(bundle)) { console.error('prune_missed: bundle 不存在：' + bundle); process.exit(1) }

// 本批新增的键（add/set 的 key、rename 的 to）
const list = JSON.parse(fs.readFileSync(listPath, 'utf8'))
const batch = new Map()
for (const op of ['add', 'set', 'rename']) {
  for (const it of list[op] || []) {
    const k = op === 'rename' ? it.to : it.key
    if (typeof k === 'string' && k) batch.set(k, it.section || 'exact')
  }
}
if (!batch.size) { console.log('prune_missed: 本批无新增条目，跳过'); process.exit(0) }

// dry-run 探命中：apply.js 不加 --write 时只报告不改文件
const r = spawnSync(process.execPath, [path.join(__dirname, 'apply.js'), bundle], { encoding: 'utf8', maxBuffer: 1 << 28 })
const out = (r.stdout || '') + (r.stderr || '')
const missed = []
for (const line of out.split(NL)) {
  const s = line.trim()
  if (!s.startsWith('- "')) continue
  const inner = s.slice(3, s.length - 1)
  const cb = inner.indexOf(']')
  const section = inner.slice(1, cb)
  const key = (inner.startsWith('[') ? inner.slice(cb + 2) : inner).split(BS + '"').join('"')
  const sec = inner.startsWith('[') ? section : (batch.get(key) || 'exact')
  if (['exact', 'template', 'code', 'pattern'].includes(sec)) missed.push({ section: sec, key })
}
const drop = missed.filter((x) => batch.has(x.key))
if (!drop.length) { console.log('prune_missed: 本批新增全部命中，无需剔条'); process.exit(0) }

// 文本手术按行删（保持文件格式）；删完做 JSON 校验 + lint 由调用方/CI 兜底
const raw = fs.readFileSync(dictPath, 'utf8')
const lines = raw.split(NL)
const dropKeys = new Set(drop.map((x) => x.key + '|' + x.section))
let section = null
const kept = []
let removed = 0
for (const ln of lines) {
  const st = ln.trim()
  if (st === '"exact": {' || st === '"template": {' || st === '"code": {' || st === '"pattern": {') {
    section = st.slice(1, st.indexOf('":'))
  }
  const body = st.endsWith(',') ? st.slice(0, -1) : st
  let hit = false
  if (body.startsWith('"')) {
    try {
      const pair = JSON.parse('{' + body + '}')
      const k = Object.keys(pair)[0]
      if (dropKeys.has(k + '|' + section)) hit = true
    } catch (e) { /* 多行条目等异常形态不匹配，原样保留 */ }
  }
  if (hit) { removed += 1; continue }
  kept.push(ln)
}
// 闭合行前剥尾逗号
const fixed = []
for (const ln of kept) {
  if ((ln.trim() === '},' || ln.trim() === '}') && fixed.length && fixed[fixed.length - 1].trim().endsWith(',')) {
    fixed[fixed.length - 1] = fixed[fixed.length - 1].replace(/[ 	]+$/, '').slice(0, -1)
  }
  fixed.push(ln)
}
const newRaw = fixed.join(NL)
JSON.parse(newRaw) // 不过就炸在内存里，不写盘
fs.writeFileSync(dictPath, newRaw)
console.log('prune_missed: 剔除 ' + removed + ' 条本批新增但未命中的词条：')
for (const x of drop.slice(0, 12)) console.log('  - [' + x.section + '] ' + x.key.slice(0, 70))
if (drop.length > 12) console.log('  ... 其余 ' + (drop.length - 12) + '条见上游报告')
