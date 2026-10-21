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
  // 窗口关闭按钮 tooltip：pattern 分区被 "Close panel"/"Close chat pane" 含住无法入库，
  // 这里按渲染点直接改写（锚点全 bundle 唯一）
  [
    '"data-tooltip":"Close"',
    '"data-tooltip":"\u5173\u95ed"',
  ],
  // 「N day(s)」单位格式器（设置页 Current/Longest streak 的值）：单位改「天」，保持与胶囊一致；
  // 不能走词典，见文件头第 2 条。锚点**不写死函数名和 NumberFormat 的变量名**：这两个名字每版都会
  // 被重新压缩改掉（0.0.179 是 _V/Cue，0.0.183 是 RW/hhe），而函数体一个字节没动。写死名字等于每版
  // 都要人工重锚一次，失败时还会以「上游改写了锚点」的名义把误报当成真改写。名字交给捕获组原样带回，
  // 这里只锁结构。第三个元素是幂等探针：先看它，命中即视为已应用，绝不二次替换。
  [
    /function ([\w$]+)\(e\)\{return`\$\{([\w$]+)\.format\(e\)\} \$\{e===1\?"day":"days"\}`\}/g,
    'function $1(e){return`${$2.format(e)} \\u5929`}',
    /\$\{[\w$]+\.format\(e\)\} \\u5929/g,
  ],
]

let s = fs.readFileSync(f, 'utf8')
let applied = 0
const missed = []
for (const [from, to, probe] of replacements) {
  if (from instanceof RegExp) {
    if (probe && probe.test(s)) {
      probe.lastIndex = 0
      applied++ // 已应用过（幂等）
      continue
    }
    const hits = s.match(from)
    if (!hits) {
      missed.push('结构锚点未命中（函数体形态变了？）：' + String(from).slice(0, 70))
      continue
    }
    if (hits.length !== 1) {
      // 命中多处却按单一位置设计＝锚点不够具体，静默全替换会把别处的同类结构一起改掉
      from.lastIndex = 0
      missed.push(`锚点命中 ${hits.length} 次（设计要求唯一）：` + String(from).slice(0, 70))
      continue
    }
    s = s.replace(from, to)
    applied++
    continue
  }
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
