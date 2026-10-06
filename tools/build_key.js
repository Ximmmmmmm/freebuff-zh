#!/usr/bin/env node
// 构建复用（build reuse）：把「输入 → 产物」变成一条**可验证的等式**，输入没变就别重跑那次构建。
//
// 为什么值得单独立一道：`build.sh` 的 18s 里绝大部分不是「算出来」的，而是固定开销（解包 / 打包
// asar、46+44 次 node 冷启动、postbuild 的行为取证）。adaptation 与发布之间来回调整词条时，
// 真正变的往往只有 `dict.json` 一行——而「只是想再看一遍报告」的重跑更是什么都没变。
//
// 可信度靠两条独立校验，缺一不可（这也是它敢跳过构建的理由）：
//   1. **输入指纹**：build.sh / dict.json / intentional-english.json / manifest.json / patches/** /
//      tools/** 全部内容 + 原版 app.asar 与原版 ui/ 的字节，逐条 sha256 后再合成一枚 key。
//      任何一处变了一个字节，key 就变——包括**工具自己**（apply.js 改了，构建行为就变了）。
//   2. **产物哈希**：上次成功构建把 output/ 里每个文件的 sha256 记进缓存；复用前逐个复算。
//      于是「有人手改过 output/」「产物被别的东西覆盖」都不会被当成可复用。
// 两条都过才 rc 0；任何一条不过立刻 rc 1 并说明是**哪一组输入**变了、还是哪个产物文件对不上。
//
// 子命令：
//   node tools/build_key.js key    [--root R] [--asar <原版 app.asar>] [--ui <原版 ui 目录>]
//       算输入指纹并打印（只读，不写盘）
//   node tools/build_key.js verify --key <指纹> [--root R] [--out <产物目录>] [--cache <缓存>]
//       指纹与产物都还成立 → rc 0；否则 rc 1（打印原因与是哪一组输入变了）
//   node tools/build_key.js record --key <指纹> [--root R] [--out <产物目录>] [--cache <缓存>]
//       构建成功后调用：记下指纹、各组输入的哈希与产物的 sha256
//
// 退出码：key / record 成功 0、环境不对 2；verify 可复用 0、不可复用 1、用法不对 2
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const REPO = path.join(__dirname, '..')
const argv = process.argv.slice(2)
const die = (msg) => {
  console.error(`ERROR: ${msg}`)
  process.exit(2)
}

// --- 参数 -------------------------------------------------------------------------
const cmd = argv[0]
if (!cmd || cmd === '-h' || cmd === '--help') {
  console.log(
    [
      '用法：',
      '  node tools/build_key.js key   [--root R] [--asar <原版 app.asar>] [--ui <原版 ui 目录>]',
      '  node tools/build_key.js verify --key <指纹> [--root R] [--out <目录>] [--cache <文件>]',
      '  node tools/build_key.js record --key <指纹> [--root R] [--out <目录>] [--cache <文件>]',
      '  key / record：0 成功，2 环境不对；verify：0 可复用，1 不可复用（打印原因），2 用法不对',
    ].join('\n'),
  )
  process.exit(cmd ? 0 : 2)
}
let root = REPO
let asarPath = ''
let uiDir = ''
let outDir = ''
let cachePath = ''
let wantKey = ''
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  const val = () => {
    const v = argv[++i]
    if (v === undefined) die(`${a} 需要一个值`)
    return v
  }
  if (a === '--root') root = path.resolve(val())
  else if (a === '--asar') asarPath = path.resolve(val())
  else if (a === '--ui') uiDir = path.resolve(val())
  else if (a === '--out') outDir = path.resolve(val())
  else if (a === '--cache') cachePath = path.resolve(val())
  else if (a === '--key') wantKey = val()
  else die(`未知参数：${a}（-h 看用法）`)
}
if (!['key', 'verify', 'record'].includes(cmd)) die(`未知子命令：${cmd}（支持 key / verify / record）`)
if (cmd !== 'key' && !wantKey) die(`${cmd} 需要 --key <指纹>`)
if (!outDir) outDir = path.join(root, 'output')
if (!cachePath) cachePath = path.join(root, 'work', 'build-cache.json')

const group = (label, paths) => {
  const h = crypto.createHash('sha256')
  for (const p of paths) {
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      // 目录递归收集（stable：按路径排序，避免文件系统顺序影响指纹）
      const walk = (d) => {
        const out = []
        for (const n of fs.readdirSync(d).sort()) {
          const child = path.join(d, n)
          if (fs.statSync(child).isDirectory()) out.push(...walk(child))
          else out.push(child)
        }
        return out
      }
      for (const f of walk(p)) h.update(path.relative(root, f) + '\0').update(fs.readFileSync(f)).update('\0')
    } else {
      h.update(path.relative(root, p) + '\0').update(fs.readFileSync(p)).update('\0')
    }
  }
  return { label, hash: h.digest('hex') }
}

// 输入分组：诊断「到底哪一组变了」时按组说人话，而不是只报一个 key 不同
function inputGroups() {
  const list = []
  const add = (label, rels) => {
    const ps = []
    for (const rel of rels) {
      const p = path.join(root, rel)
      if (!fs.existsSync(p)) continue
      if (fs.statSync(p).isDirectory()) {
        for (const n of fs.readdirSync(p)) ps.push(path.join(p, n))
      } else ps.push(p)
    }
    list.push(group(label, ps))
  }
  add('构建脚本 build.sh', ['build.sh'])
  add('词典 dict.json', ['dict.json'])
  add('登记表 intentional-english.json', ['intentional-english.json'])
  add('版本 manifest.json', ['manifest.json'])
  add('补丁 patches/', ['patches'])
  add('工具 tools/', ['tools'])
  if (asarPath) list.push(group('原版 app.asar', [asarPath]))
  if (uiDir) list.push(group('原版 ui/', [uiDir]))
  return list
}

const keyOf = (groups) => {
  const h = crypto.createHash('sha256')
  for (const g of groups) h.update(`${g.label}\0${g.hash}\0`)
  return h.digest('hex')
}
const sha256Of = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

// 产物清单：output/ 下每个文件（缓存本身在 work/ 里，不会混进来）
function productList() {
  const out = []
  const walk = (d) => {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n)
      if (fs.statSync(p).isDirectory()) walk(p)
      else out.push({ path: path.relative(outDir, p).split(path.sep).join('/'), sha256: sha256Of(p), size: fs.statSync(p).size })
    }
  }
  if (!fs.existsSync(outDir)) die(`产物目录不存在：${outDir}`)
  walk(outDir)
  return out
}
const readCache = () => {
  if (!fs.existsSync(cachePath)) return null
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'))
  } catch {
    return null
  }
}

// --- key：算指纹 ------------------------------------------------------------------
if (cmd === 'key') {
  if (!asarPath || !fs.existsSync(asarPath)) die(`--asar 指向的原版 app.asar 不存在：${asarPath || '(未给)'}`)
  if (!uiDir || !fs.existsSync(uiDir)) die(`--ui 指向的原版 ui 目录不存在：${uiDir || '(未给)'}`)
  process.stdout.write(keyOf(inputGroups()) + '\n')
  process.exit(0)
}

// --- verify：指纹 + 产物双校验 -----------------------------------------------------
if (cmd === 'verify') {
  const cache = readCache()
  if (!cache) {
    console.log(`不可复用：没有构建记录（${path.relative(REPO, cachePath)} 不存在或读不出来）`)
    process.exit(1)
  }
  const groups = inputGroups()
  if (cache.key !== wantKey || keyOf(groups) !== wantKey) {
    console.log('不可复用：输入指纹与上次构建不同——输入变了就该重建')
    const old = cache.inputs || {}
    for (const g of groups) {
      const was = old[g.label]
      if (was && was !== g.hash) console.log(`  · 变了：${g.label}`)
    }
    // 自己踩过一次的坑：调用方忘了传 --asar / --ui 时，这里算的组比缓存少两组，指纹必然对不上——
    // 方向是安全的（宁可重建），但诊断会一句“变了”都说不出来，看着像工具坏了。点出来。
    const cur = new Set(groups.map((g) => g.label))
    for (const label of Object.keys(old)) {
      if (!cur.has(label)) console.log(`  · 这次没提供：${label}（--asar / --ui 没给，无法核对）`)
    }
    process.exit(1)
  }
  const product = productList()
  const missing = []
  const changed = []
  const byPath = new Map(product.map((p) => [p.path, p]))
  for (const rec of cache.product || []) {
    const now = byPath.get(rec.path)
    if (!now) missing.push(rec.path)
    else if (now.sha256 !== rec.sha256) changed.push(rec.path)
    byPath.delete(rec.path)
  }
  const extra = [...byPath.keys()]
  if (missing.length || changed.length || extra.length) {
    console.log('不可复用：产物与上次构建的哈希对不上（被改动 / 缺文件 / 多文件）')
    for (const p of missing) console.log(`  · 缺文件：${p}`)
    for (const p of changed) console.log(`  · 已改动：${p}`)
    for (const p of extra) console.log(`  · 多出来的文件：${p}`)
    process.exit(1)
  }
  console.log(`可复用：输入指纹 ${wantKey.slice(0, 12)}… 与产物 ${(cache.product || []).length} 个文件的哈希都对得上（构建于 ${cache.createdAt || '?'}）`)
  process.exit(0)
}

// --- record：构建成功后记录 --------------------------------------------------------
const groups = inputGroups()
const cache = {
  key: wantKey,
  createdAt: new Date().toISOString(),
  inputs: Object.fromEntries(groups.map((g) => [g.label, g.hash])),
  product: productList(),
}
fs.mkdirSync(path.dirname(cachePath), { recursive: true })
fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n')
console.log(`已记录构建缓存：${path.relative(REPO, cachePath)}（输入指纹 ${wantKey.slice(0, 12)}…，产物 ${cache.product.length} 个文件）`)
process.exit(0)
