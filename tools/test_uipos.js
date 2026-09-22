#!/usr/bin/env node
// uipos 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 为什么需要它：uipos 的锚点（children: / label: / title: / … ）以前只按「字面量出现」匹配，
// 于是有两类东西会被当成界面属性报出来，而且都**静默**——报告里多几条没人细看的英文，
// 或者更糟：uipos_gap 把「本版新多出来的那条噪音」当成新文案，发布闸门卡在一个根本不存在的
// 文案上（0.0.133 适配时实测过）。两类误报：
//   1. 字符串内容里的 `` label: ``（`` key:`label:${xe}:${R}` ``，0.0.133 新增的分组键）——
//      valueTextAt 会一路吞到下一个深度 0 的逗号，把后面 200 字符压缩代码当成「label 的值」；
//   2. 属性读取 `k.label:`Open in ${k.label}``、`n.children:[n]`（前一个字符是 `.`）。
// 判据是「锚点前的字符必须是属性边界」，这里把正例与两类误报一起钉住。
//
// 用法：node tools/test_uipos.js        # 退出码非 0 表示回归
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const WORK = path.join(__dirname, '..', 'work', 'test-uipos')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

let fail = 0
const chk = (cond, label) => {
  if (cond) console.log(`  ok  ${label}`)
  else {
    console.log(`  FAIL ${label}`)
    fail++
  }
}

// --- 合成 bundle：正例 + 两类误报 -------------------------------------------------
const src = [
  // 正例：字面量属性、默认参数、三元分支、aria-label、JSX children 文本节点、模板
  'const a={label:"Files"};',
  'const b={label:n="Delete"};',
  'const c={label:t.status==="idle"?"Ready when needed":"Disconnected"};',
  'const d={"aria-label":"Close settings",children:[" A bare text"]};',
  // 注：children:[cond?"A":"B"] 里的三元分支不在 uipos 的取值范围内（只取值的第 0 层，
  // 数组里的算第 1 层）——那是 blindscan 的覆盖面，见 docs/更新维护.md「第四种静默失败」。
  'const f={"data-tooltip":`Connected · Manage ${o}`};',
  // 误报 1：字符串内容里的 label:（0.0.133 真实形态，前一个字符是反引号）
  'const Ce=xe=>({key:`label:${xe}:${R}`,kind:"label",text:xe,focusable:!1}),Pe=xe=>xe.map(ee=>({key:ee.id,kind:"thread",thread:ee}));de.push(...$e.length&&ge.length?[Ce("Open"),...Pe($e),Ce("Closed"),...Pe(ge)]:Pe(J))}else de.push({key:`empty:${R}`,kind:"empty",path:R,loaded:re,focusable:!re});return de}),[L,x]),X=async R=>{await ce.openProject(R)}',
  // 误报 2：属性读取
  'const g=n?n.children:[n],h={children:[k.label:`Open in ${k.label}`]};',
].join('\n')

const bundle = path.join(WORK, 'index-fixture.js')
fs.writeFileSync(bundle, src)

const out = execFileSync(process.execPath, [path.join(__dirname, 'uipos.js'), bundle], { encoding: 'utf8' })
const entries = out
  .split('\n')
  .filter((l) => /^[0-9]+\t/.test(l))
  .map((l) => l.replace(/^[0-9]+\t/, ''))

const has = (s) => entries.includes(s)

// --- 1. 正例照旧报出来（判据收紧不能把真文案一起丢掉）-----------------------------
chk(has('Files'), '字面量属性 label:"Files" 仍报出')
chk(has('Delete'), '默认参数 label:n="Delete" 仍报出')
chk(has('Ready when needed') && has('Disconnected'), '三元分支两个值都报出')
chk(has('Close settings'), '"aria-label" 仍报出')
chk(has(' A bare text'), 'JSX children 文本节点仍报出')
chk(has('Connected · Manage ${…}'), '"data-tooltip" 模板仍报出')
chk(out.startsWith('remaining UI-position English: '), '输出仍带表头（格式没被改坏）')

// --- 2. 两类误报不再进报告 --------------------------------------------------------
chk(!entries.some((s) => /focusable|kind:"|Pe\(/.test(s)), '字符串内容里的 label: 不再被当成锚点')
chk(!entries.some((s) => s.length > 60), '没有跨引号吞出来的长代码片段')
chk(!has('Open in ${…}'), '属性读取（k.label:…）不再被当成界面属性')
chk(!entries.some((s) => /^\[n\]$/.test(s)), '属性读取（n.children:[n]）不再被当成 JSX 文本节点')

if (fail) {
  console.log(`\n✗ uipos 自测失败 ${fail} 项`)
  process.exit(1)
}
console.log('\n✓ uipos 自测通过（锚点必须是属性名：正例保留、两类误报挡住）')
