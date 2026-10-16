// UI 主 bundle 的外科手术补丁（服务端文案的渲染点改写 + Intl 安全的单位替换）。
// 为什么存在：词典只能替换**字面量**，而两类文案够不着——
//   1. 服务端下发的整句（streak 胶囊的 line.label，如 "1 day streak"）：bundle 里没有原文，
//      只能在渲染点做模式改写（/^(\d+) days? streak$/ → 连续 N 天）；
//   2. "day"/"days" 这类**多用途字面量**：同串还出现在 Intl.RelativeTimeFormat 的单位表里
//      （i("day")），词典全局替换会把日期相对时间打崩，只能按函数锚点定点替换。
// 与 apply_ui_patch.js 同约定：命中原文或已含译文=幂等通过；两者皆无 = MISSED（硬失败），
// 上游改写该处时不允许静默丢补丁。
// 注入的中文用 \u 转义写入，避免 postbuild 的「代码语义常量中文哨兵」误报。
// Usage: node tools/apply_ui_js_patch.js <index-*.js>
'use strict'
const fs = require('fs')

const f = process.argv[2]
if (!f) {
  console.error('usage: node tools/apply_ui_js_patch.js <bundle.js>')
  process.exit(1)
}

const replacements = [
  // streak 胶囊：服务端 label（"N day(s) streak"）→ 连续 N 天；其它 label 原样透传
  [
    'className:"streak-count",children:n.label',
    'className:"streak-count",children:(x=>{const m=/^(\\d+) (?:day|days) streak$/.exec(x);return m?"\\u8fde\\u7eed "+m[1]+" \\u5929":x})(n.label)',
  ],
  // _V() 的 "N day(s)" 格式器（设置页 Current/Longest streak 的值）：单位改「天」，
  // 保持与胶囊一致；不能走词典，见文件头第 2 条
  [
    'function _V(e){return`${Cue.format(e)} ${e===1?"day":"days"}`}',
    'function _V(e){return`${Cue.format(e)} \\u5929`}',
  ],
]

let s = fs.readFileSync(f, 'utf8')
let applied = 0
const missed = []
for (const [from, to] of replacements) {
  if (s.includes(from)) {
    s = s.split(from).join(to)
    applied++
  } else if (s.includes(to)) {
    applied++ // 已应用过（幂等）
  } else {
    missed.push(from.slice(0, 70))
  }
}
fs.writeFileSync(f, s)
console.log(`apply_ui_js_patch: ${applied} replacements`)
if (missed.length) {
  console.error('MISSED（上游改写了锚点，补丁没打上）:')
  for (const m of missed) console.error('  - ' + m)
  process.exit(1)
}
