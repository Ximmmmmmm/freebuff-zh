#!/usr/bin/env node
// 界面位置英文差集体检：uipos 报出来的「界面位置英文」里，哪些是本版新增、词典还没覆盖的？
//
// 为什么需要它：两条对差通道（tools/upstreamdiff.js 的片段级 / 字面量级）都有词数下限
// （≥3 词 / ≥2 词），**单词文案两边都进不来**；而 tools/regress.js 的片段提取同样只认句子。
// 结果就是 `Settings` / `Projects` / `General` / `Missions` / `Theme` / `Reset` / `Width` /
// `Height` / `Availability` / `Browser` / `System` 与设备预设这类单词标签，只能靠人去看
// uipos 的清单（0.0.131 适配时 14 条就是这么手工挑出来的——52 条里挑 14 条，全靠肉眼）。
//
// 本工具把这一步变成可执行判据：uipos 扫**本版产物**（English 还在 = 词典没覆盖）与
// **上一版已发布产物**（那时就有的多半是品牌名 / 模型名 / 代码），做差集，再减掉
// intentional-english.json 的 uiStrings 登记表。剩下的就是本版新增、需要人看一眼的鬼东西。
//
// 登记表是**两道闸门共用**的：本工具认界面位置，tools/upstreamdiff.js 还认它的**字面量
// 通道**（≥2 词的短串，典型是 `displayName:"Solar Mini 4"` 这种 uipos 根本不扫的位置）。
// 所以「哪些登记项已经死了」不能拿 uipos 的集合去问（它只能替自己那一半作证），
// 要问产物本身——判据见下面 stale 那段。
//
// 用法：
//   node tools/uipos_gap.js --bundle <本版产物：bundle / 目录 / pack zip>
//        [--prev <上一版产物>] [--allow <json>] [--limit N] [--quiet]
// 退出码：0 = 没有未登记的界面位置英文；1 = 有（补进 dict.json，或登进 uiStrings 并写理由）；2 = 输入/调用出错
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
// normText 是读登记表三个工具（regress / upstreamdiff / uipos_gap）共用的归一化，
// 定义在 tools/regress.js：两侧过同一道处理（抹插值 + 折叠空白 + 去首尾），`${…}` 形态的
// 登记项（如 `Action: ${…}${…}.`）才能对上产物原文。
const { resolveBundle, normText } = require('./regress.js')

function usage(msg) {
  if (msg) console.error('ERROR: ' + msg)
  console.error('usage: node tools/uipos_gap.js --bundle <产物> [--prev <上一版产物>] [--allow <json>] [--limit N] [--quiet]')
  process.exit(2)
}

// uipos.js 的输出（人类可读）：
//   remaining UI-position English: N
//   ## kind (n)
//   次数\t字符串
//   \t@ 上下文（--ctx 时才有）
// 只取 `## 小节` 之后的「数字+制表符」行；以制表符开头的续行（上下文 / 多行字符串的第二行）
// 一律跳过——两侧都按同一口径解析，差集才不会假报。
function parseUipos(out) {
  const set = new Set()
  let inSection = false
  for (const line of out.split('\n')) {
    if (/^## /.test(line)) {
      inSection = true
      continue
    }
    if (!inSection) continue
    const m = line.match(/^(\d+)\t(.+)$/)
    if (m) set.add(m[2].trim())
  }
  return set
}

function runUipos(bundle) {
  try {
    return execFileSync(process.execPath, [path.join(__dirname, 'uipos.js'), bundle], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    })
  } catch (e) {
    usage(`跑 tools/uipos.js ${bundle} 失败：${e.message}`)
  }
}

function loadAllow(file) {
  const p = file || path.join(__dirname, '..', 'intentional-english.json')
  if (!fs.existsSync(p)) return { path: p, entries: new Map() }
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'))
  const entries = new Map()
  for (const it of doc.uiStrings || []) {
    const text = typeof it === 'string' ? it : it && it.text
    if (!text) continue
    entries.set(text, (it && it.why) || '')
  }
  return { path: p, entries }
}

function main() {
  const argv = process.argv.slice(2)
  const opt = { limit: 30, quiet: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--quiet') opt.quiet = true
    else if (a === '--limit') opt.limit = Number(argv[++i])
    else if (a === '--bundle') opt.bundle = argv[++i]
    else if (a === '--prev') opt.prev = argv[++i]
    else if (a === '--allow') opt.allow = argv[++i]
    else usage(`未知参数：${a}`)
  }
  if (!opt.bundle) usage('--bundle 必填')

  const cur = resolveBundle(path.resolve(opt.bundle))
  if (!cur) usage(`在 ${opt.bundle} 下找不到主 bundle（ui/index.html 或 assets/index-*.js）`)
  const prev = opt.prev ? resolveBundle(path.resolve(opt.prev)) : null
  if (opt.prev && !prev) usage(`在 ${opt.prev} 下找不到主 bundle`)

  // 产物整串（归一化一次）——给下面「登记项整串还在不在」的判据当干草堆。读不到就跳过这道
  // 提醒：宁可少一条提醒，也不能因为读不到文件就把整张登记表都报成死条目。
  let haystack = ''
  try {
    haystack = normText(fs.readFileSync(cur, 'utf8'))
  } catch (e) {
    if (!opt.quiet) console.log(`  ! 读不到产物内容（${e.message}），跳过登记表清理提醒`)
  }

  const allow = loadAllow(opt.allow)
  const curSet = parseUipos(runUipos(cur))
  const prevSet = prev ? parseUipos(runUipos(prev)) : new Set()
  const added = [...curSet]
    .filter((x) => !prevSet.has(x))
    .filter((x) => !allow.entries.has(x))
    .sort()

  if (!opt.quiet) {
    console.log(`界面位置英文差集：${path.basename(cur)}${prev ? ` ← 上一版 ${path.basename(prev)}` : '（没有上一版基线，看全量）'}`)
    console.log(
      `  本版界面位置英文 ${curSet.size} 处${prev ? `，上一版 ${prevSet.size} 处` : ''}；` +
        `扣除登记表 ${allow.entries.size} 条后，本版独有 ${added.length} 处`,
    )
    console.log(`  （这些位置的词数都 <2，upstreamdiff / regress 两通道都看不见，只能靠这道体检）`)
  }

  if (added.length) {
    console.log('\n## 本版新增的界面位置英文（词典还没覆盖）')
    console.log('   能翻的补进 dict.json（补完重跑 bash build.sh）；品牌名 / 模型名 / 代码串登进')
    console.log(`   ${path.relative(process.cwd(), allow.path)} 的 uiStrings（逐条写理由）`)
    for (const x of added.slice(0, opt.limit)) console.log(`   · ${x}`)
    if (added.length > opt.limit) console.log(`   … 其余 ${added.length - opt.limit} 条见 --limit`)
  }

  // 登记项在本版已经不存在了（上游删掉/改了/我们自己翻掉了）→ 提醒清理，不失败。
  //
  // 判据是「整串还在不在产物里」，**不是**「uipos 还看不看得见」：登记表是两道闸门共用的，
  // 只为 upstreamdiff 的字面量通道登记的条目（模型名 `displayName:"Solar Mini 4"`、
  // 命令行 `git init` 这类）永远进不了 curSet，用旧判据就会年年把同 5 条报成「可以清理」
  // （0.0.140 → 0.0.147 每版一次）。只要那段英文还出现在产物里（在哪个位置都算），这条登记
  // 就还有用处；整串都没了才算死条目。代价是「挪到别的位置、恰好又被别的串包含」会漏报——
  // 这道提醒本来就是提示不是判据，宁可少报一次。
  const stillPresent = (text) => haystack.includes(normText(text))
  const stale = haystack ? [...allow.entries.keys()].filter((x) => !stillPresent(x)) : []
  if (stale.length && !opt.quiet) {
    console.log(`\n## 登记表里有 ${stale.length} 条在本版产物里已看不见（整串都没了），可以清理`)
    for (const x of stale.slice(0, 10)) console.log(`   · ${x}`)
  }

  if (added.length === 0) {
    console.log('\n✓ 界面位置英文里没有未登记的新增项')
    process.exit(0)
  }
  console.error(`\nERROR: 有 ${added.length} 处界面位置英文没被词典覆盖（清单见上）`)
  process.exit(1)
}

if (require.main === module) main()
module.exports = { parseUipos }
