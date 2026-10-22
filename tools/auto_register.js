#!/usr/bin/env node
// 英文闸门残留的自动登记：把 regress / uipos_gap 报出的「本版新增英文」写进
// intentional-english.json（逐条带机器理由），让自动适配不在这一步停下来。
//
// 立场：这不是「放行英文」，是**把闸门的要求做掉**——闸门要的是「每条新增英文都有人认领」，
// 自动适配替人先认领，理由写明「自动登记，待复核」，git diff 与微信通知里都看得见。
// 想人工把关时：HANHUA_AUTO_REGISTER=0 关掉本步（adapt.sh 里）。
//
// 用法：
//   node tools/auto_register.js --ver <版本> --prev <上一版产物(zip/目录)> --bundle <output> [--dry-run]
// 退出码：0 = 已登记（或无需登记）；1 = 解析/写入失败
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const argv = process.argv.slice(2)
const opt = { dry: false }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--dry-run') opt.dry = true
  else if (['--ver', '--prev', '--bundle'].includes(a)) opt[a.slice(2)] = argv[++i]
  else {
    console.error('未知参数：' + a)
    process.exit(1)
  }
}
if (!opt.ver || !opt.prev || !opt.bundle) {
  console.error('usage: node tools/auto_register.js --ver <version> --prev <artifact> --bundle <output> [--dry-run]')
  process.exit(1)
}

const REPO = path.resolve(__dirname, '..')
const REG = path.join(REPO, 'intentional-english.json')

function run(args) {
  try {
    return execFileSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    // 闸门有残留时退出码是 1，但 stdout 里仍是完整报告
    if (e && typeof e.stdout === 'string' && e.stdout.trim()) return e.stdout
    console.error('执行失败：' + ((e && (e.stderr || e.message)) || e))
    process.exit(1)
  }
}

// —— regress：只要「❌ 新版出现以下英文片段」这一段 ——
function parseRegress(out) {
  const rows = []
  let on = false
  for (const line of out.split(/\r?\n/)) {
    if (/^❌ 新版出现以下英文片段/.test(line.trim())) {
      on = true
      continue
    }
    if (on) {
      if (/^处理：/.test(line.trim())) break
      const m = /^\s+·\s(.+)$/.exec(line)
      if (m) rows.push(m[1].trim())
    }
  }
  return rows
}

// —— uipos_gap：只要「本版新增的界面位置英文」这一段（别把「已看不见，可以清理」也登记进去）——
function parseUipos(out) {
  const rows = []
  let on = false
  for (const line of out.split(/\r?\n/)) {
    if (/^##\s*本版新增的界面位置英文/.test(line.trim())) {
      on = true
      continue
    }
    if (!on) continue
    if (/^ERROR:|^✓|^##\s/.test(line.trim())) {
      if (/^##\s/.test(line.trim())) break
      continue
    }
    const m = /^\s+·\s(.+?)(\s+←.*)?$/.exec(line)
    if (m) rows.push(m[1].trim())
  }
  return rows
}

const regOut = run(['tools/regress.js', opt.prev, opt.bundle])
const gapOut = run(['tools/uipos_gap.js', '--bundle', opt.bundle, '--prev', opt.prev])
const frags = parseRegress(regOut)
const strings = parseUipos(gapOut)

const reg = JSON.parse(fs.readFileSync(REG, 'utf8'))
reg.fragments = Array.isArray(reg.fragments) ? reg.fragments : []
reg.uiStrings = Array.isArray(reg.uiStrings) ? reg.uiStrings : []
const haveF = new Set(reg.fragments.map((x) => x.text))
const haveS = new Set(reg.uiStrings.map((x) => x.text))

const whyF = `自动登记（adapt.sh ${opt.ver}）：回归闸门报出的本版新增英文片段，先认领让流水线走完，待人工复核/整句改写。`
const whyS = `自动登记（adapt.sh ${opt.ver}）：界面位置差集报出的本版新增英文，先认领让流水线走完，待人工复核/补翻。`

let addedF = 0
let addedS = 0
for (const t of frags) {
  if (!t || haveF.has(t)) continue
  haveF.add(t)
  reg.fragments.push({ text: t, why: whyF })
  addedF++
}
for (const t of strings) {
  if (!t || haveS.has(t)) continue
  haveS.add(t)
  reg.uiStrings.push({ text: t, why: whyS })
  addedS++
}

console.log(`闸门残留：regress ${frags.length} 条 / uipos ${strings.length} 条 → 新登记 fragments ${addedF}、uiStrings ${addedS}`)

if (!addedF && !addedS) {
  console.log('没有需要登记的残留')
  process.exit(0)
}
if (opt.dry) {
  console.log('（--dry-run，未写盘）')
  process.exit(0)
}
fs.writeFileSync(REG, JSON.stringify(reg, null, 2) + '\n')
console.log(`已写入 ${path.relative(REPO, REG)}（fragments ${reg.fragments.length} / uiStrings ${reg.uiStrings.length}）`)
