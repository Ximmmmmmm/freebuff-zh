#!/usr/bin/env node
// 词条命中体检（构建前置）：词典里的每一条，到底能不能被替换到东西？
//
// 为什么需要它：build.sh 把词典套到 **UI bundle** 上时，MISSED 是硬失败——这条约束是隐式的，
// 词典分区名（exact / template / code / pattern）一个都没提示它。0.0.131 适配就栽在这里：
// 38 条只在主进程出现的浏览器子系统文案被塞进了 dict.json，构建跑到第 4 步才报
// 「词典有 38 条未命中（原文可能随版本改写）」——那句提示是错的方向，实际原因是
// **主进程专属文案只能写成 patches/electron-*.patch**，词典根本够不着它。
//
// 本工具在解包 asar 之前就把每一条词条归到四类里，失败时直接说清该往哪边补：
//   1. 命中本版 UI bundle                —— 正常（可以替换）
//   2. 只在 electron/*.cjs 里出现        —— 写成 patches/，不要进词典（这是当初踩的坑）
//   3. 只在上一版 UI bundle 里出现        —— 上游改写了这句（按 MISSED 流程改写词条）
//   4. 两边都没有                        —— 疑似历史死词条，删掉即可
//
// 用法：
//   node tools/missed_diagnose.js --dict <dict.json> --ui <本版 UI bundle 或 ui 目录>
//        [--electron <本版 electron 目录>] [--prev-ui <上一版 bundle 或 ui 目录>]
//        [--quiet] [--limit N]
// 退出码：0 = 没有「够不着」的词条；1 = 有（第 2/3/4 类都算够不着，构建必然失败）；2 = 输入无法解析
//
// 为什么用「子串出现」而不是逐字节的引号边界：这是**前置**体检，宁可漏报也不能误报——
// 只要该 key 的文本在本版 UI bundle 里出现过，就交给 build.sh 的真流程（apply.js 的引号
// 边界与语义过滤）去判定；反过来，文本压根不出现的话，无论边界怎么配都替换不到，结论是硬的。
'use strict'

const fs = require('fs')
const path = require('path')

function usage(msg) {
  if (msg) console.error('ERROR: ' + msg)
  console.error(
    'usage: node tools/missed_diagnose.js --dict <dict.json> --ui <本版 UI bundle|ui 目录> ' +
      '[--electron <electron 目录>] [--prev-ui <上一版 bundle|ui 目录>] [--quiet] [--limit N]',
  )
  process.exit(2)
}

// 目录 → 主 bundle。跟 regress.js 一样只认 index-*.js：其它 assets 是语言/主题分块，
// 文案不在里面（把它们一起搜会让「命中」永远成立，体检就失效了）。
function resolveBundle(p) {
  if (!fs.existsSync(p)) return null
  const st = fs.statSync(p)
  if (st.isFile()) return p
  const idx = path.join(p, 'index.html')
  if (fs.existsSync(idx)) {
    const m = fs.readFileSync(idx, 'utf8').match(/src="\.\/(assets\/[^"]*\.js)"/)
    if (m) {
      const b = path.join(p, m[1])
      if (fs.existsSync(b)) return b
    }
  }
  for (const sub of [path.join(p, 'assets'), path.join(p, 'ui', 'assets'), p]) {
    if (!fs.existsSync(sub)) continue
    const hit = fs.readdirSync(sub).find((f) => /^index-.*\.js$/.test(f))
    if (hit) return path.join(sub, hit)
  }
  return null
}

function readElectronDir(dir) {
  if (!dir) return []
  if (!fs.existsSync(dir)) return []
  // 允许传单个文件（有人会顺手给 electron/main.cjs）：取它所在目录，别让 readdirSync 抛 ENOTDIR。
  if (fs.statSync(dir).isFile()) dir = path.dirname(dir)
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(cjs|html)$/.test(f))
    .map((f) => ({ file: f, src: fs.readFileSync(path.join(dir, f), 'utf8') }))
}

function main() {
  const argv = process.argv.slice(2)
  const opt = { quiet: false, limit: 12 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--quiet') opt.quiet = true
    else if (a === '--limit') opt.limit = Number(argv[++i])
    else if (['--dict', '--ui', '--electron', '--prev-ui'].includes(a)) opt[a.slice(2)] = argv[++i]
    else usage(`未知参数：${a}`)
  }
  if (!opt.dict || !opt.ui) usage('--dict 与 --ui 必填')

  const dictPath = path.resolve(opt.dict)
  if (!fs.existsSync(dictPath)) usage(`找不到词典：${dictPath}`)
  const uiBundle = resolveBundle(path.resolve(opt.ui))
  if (!uiBundle) usage(`在 ${opt.ui} 下找不到 UI 主 bundle（index-*.js）`)
  const prevBundle = opt['prev-ui'] ? resolveBundle(path.resolve(opt['prev-ui'])) : null
  const electron = readElectronDir(opt.electron ? path.resolve(opt.electron) : null)

  const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'))
  const curUi = fs.readFileSync(uiBundle, 'utf8')
  const prevUi = prevBundle ? fs.readFileSync(prevBundle, 'utf8') : null

  const buckets = { ok: [], mainOnly: [], prevOnly: [], nowhere: [] }
  for (const part of ['exact', 'template', 'code', 'pattern']) {
    for (const key of Object.keys(dict[part] || {})) {
      if (curUi.includes(key)) {
        buckets.ok.push({ part, key })
        continue
      }
      const inMain = electron.filter((f) => f.src.includes(key)).map((f) => f.file)
      if (inMain.length) buckets.mainOnly.push({ part, key, where: inMain })
      else if (prevUi && prevUi.includes(key)) buckets.prevOnly.push({ part, key })
      else buckets.nowhere.push({ part, key })
    }
  }

  const total = buckets.ok.length + buckets.mainOnly.length + buckets.prevOnly.length + buckets.nowhere.length
  if (!opt.quiet) {
    console.log(`词条命中体检：${path.relative(process.cwd(), dictPath)}`)
    console.log(`  本版 UI bundle：${path.basename(uiBundle)}${prevUi ? `　上一版：${path.basename(prevBundle)}` : '　（没有上一版基线）'}`)
    console.log(`  词条 ${total} 条 → 命中 UI ${buckets.ok.length}　只在主进程 ${buckets.mainOnly.length}　只在上版 UI ${buckets.prevOnly.length}　两边都没有 ${buckets.nowhere.length}`)
  }

  const show = (label, hint, rows) => {
    if (!rows.length) return
    console.log(`\n## ${label}（${rows.length} 条）`)
    console.log(`   ${hint}`)
    for (const r of rows.slice(0, opt.limit)) {
      const where = r.where ? `　← ${r.where.join(', ')}` : ''
      console.log(`   · [${r.part}] ${JSON.stringify(r.key.slice(0, 110))}${where}`)
    }
    if (rows.length > opt.limit) console.log(`   … 其余 ${rows.length - opt.limit} 条见 --limit`)
  }

  show(
    '只在主进程出现',
    '词典够不着 → 写成 patches/electron-*.patch 后从 dict.json 删掉（UI 侧 MISSED 是硬失败）',
    buckets.mainOnly,
  )
  show('只在上一版 UI 出现', '上游改写了这句或把它整段下线：按新原文改写词条，确认下线就直接删', buckets.prevOnly)
  show('两边都没有', '疑似历史死词条（也可能只是基线没登记）：确认后删除', buckets.nowhere)

  const bad = buckets.mainOnly.length + buckets.prevOnly.length + buckets.nowhere.length
  if (bad === 0) {
    console.log(`\n✓ ${buckets.ok.length} 条词条都能在本版 UI bundle 里命中`)
    process.exit(0)
  }
  console.error(
    `\nERROR: 有 ${bad} 条词条够不着本版 UI bundle —— build.sh 会在第 4 步以 MISSED 中止，` +
      `要改的清单就在上面（先解决「只在主进程出现」那一类，它最常被误塞进词典）`,
  )
  process.exit(1)
}

if (require.main === module) main()
module.exports = { resolveBundle, readElectronDir }
