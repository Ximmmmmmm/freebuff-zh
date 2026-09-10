#!/usr/bin/env node
// smoke-heal.js — 冒烟失败自愈：从报错信息提取中文串，删除词典里产出这些译文的
// 词条（翻译污染运行时的根因是"译文落进了代码位置"，删词 = 回退英文，安全）。
//
// 输入: 冒烟输出全文（stdin 或 argv[1]）。例：
//   RangeError: Position specified relative to unknown parser 强调
//   → 提取 "强调" → 删除 dict.json 中产出 "强调" 的词条 → 调用方重建重测
//
// 误伤防护（0.0.100 事故复盘：初版把日志话术当污染词，一次误删 40 条正常词条）：
//   1. 只从报错行提取，剔除冒烟脚本自己的输出行；
//   2. 完全等于脚本话术/泛词（"加载""等待""冒烟"…）的中文串直接丢弃；
//   3. 删除优先「译文 === 中文串」的精确匹配，精确命中即止，不走子串；
//   4. 子串兜底 + 单轮删除上限 HANHUA_HEAL_MAX（默认 8），超上限宁可转人工。
//
// 退出码: 0=已删词条（词典变小了，请重建）  1=无法定位/超限（转人工）
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const DICT = path.join(ROOT, 'dict.json')
const MAX_REMOVE = parseInt(process.env.HANHUA_HEAL_MAX || '8', 10)
const input = process.argv[2] !== undefined ? process.argv[2] : fs.readFileSync(0, 'utf8')

// 兜底：冒烟日志若被 Latin-1 解码过（"å¼ºè°ƒ"），先还原成中文再提取，
// 否则正则匹配不到任何汉字段，自愈会静默失败。
function demojibake(s) {
  if (!/[\u0080-\u00ff]/.test(s)) return s
  try {
    const out = Buffer.from(s, 'latin1').toString('utf8')
    return /[\u4e00-\u9fff]/.test(out) && !out.includes('\ufffd') ? out : s
  } catch { return s }
}

// 冒烟脚本自身的输出行（含中文但不是报错），以及堆栈 URL 行
const NOISE_LINE = /^(冒烟|加载 http|报错中的中文串|已删除|SMOKE_|\s*[✓✗])|SMOKE_(OK|FAIL|HEAL|HEALED)|http:\/\/127\.0\.0\.1/

// 脚本话术与高频泛词：中文串「完全等于」这些词时丢弃。
// 注意只判等、不判包含——"正在加载…" 这类真实译文仍会被保留。
const STOPWORDS = new Set([
  '冒烟', '加载', '等待', '子元素', '未捕获异常', '未捕获', '异常', '报错', '禁止发布',
  '渲染器', '渲染', '通过', '失败', '环境', '缺失', '跳过', '输出', '日志', '条目',
  '检查', '产物', '构建', '发布', '原因', '提示', '警告', '错误', '信息', '页面',
  '文件', '目录', '脚本', '工具', '词典', '词条', '翻译', '中文', '英文', '版本',
  '适配', '安装', '应用', '控制器', '启动', '崩溃', '运行时', '污染', '自愈', '重建',
])

const source = demojibake(input)
const lines = source.split('\n').filter((l) => l.trim() && !NOISE_LINE.test(l))

const cjkRuns = new Set()
for (const line of lines) {
  for (const m of line.matchAll(/[\u3400-\u9fff][\u3400-\u9fff·]{0,40}/g)) {
    const s = m[0].replace(/[·]+$/, '')
    if (s.length < 2) continue // 单字误伤面大（"低"/"无"），要求至少两字
    if (STOPWORDS.has(s)) continue
    cjkRuns.add(s)
  }
}
if (!cjkRuns.size) {
  console.log('SMOKE_HEAL_NONE: 报错里没有可定位的中文串')
  process.exit(1)
}
const runs = [...cjkRuns].sort((a, b) => b.length - a.length)
console.log(`报错中的中文串: ${runs.map((s) => `"${s}"`).join(' ')}`)

const dict = JSON.parse(fs.readFileSync(DICT, 'utf8'))
const sections = ['exact', 'pattern', 'template', 'code']

function collect(matchFn) {
  const hits = []
  for (const section of sections) {
    const sec = dict[section]
    if (!sec) continue
    for (const [en, zh] of Object.entries(sec)) {
      if (typeof zh === 'string' && matchFn(zh)) hits.push([section, en, zh])
    }
  }
  return hits
}

// 1) 精确匹配：译文与报错中文串完全相等。命中就够，不再扩散。
let hits = collect((zh) => runs.includes(zh))
let mode = '精确'

// 2) 子串兜底：精确没命中时才允许，且受删除上限约束。
if (!hits.length) {
  hits = collect((zh) => runs.some((s) => zh.includes(s)))
  mode = '子串'
}

if (!hits.length) {
  console.log('SMOKE_HEAL_NONE: 报错中文串与词典任何译文都不匹配（可能是别的问题）')
  process.exit(1)
}
if (hits.length > MAX_REMOVE) {
  console.log(
    `SMOKE_HEAL_ABORT: ${mode}匹配到 ${hits.length} 条（上限 ${MAX_REMOVE}）——` +
      `判定为策略失效，拒绝批量删词以免毁词典，转人工处理`
  )
  for (const [sec, en, zh] of hits.slice(0, 20)) console.log(`  候选 [${sec}] ${JSON.stringify(en)} = ${JSON.stringify(zh)}`)
  process.exit(1)
}

const backup = path.join(ROOT, 'work', `dict-before-heal-${Date.now()}.json`)
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true })
fs.writeFileSync(backup, JSON.stringify(dict, null, 2) + '\n')

for (const [section, en, zh] of hits) {
  console.log(`  删除 [${section}] ${JSON.stringify(en)} = ${JSON.stringify(zh)}`)
  delete dict[section][en]
}
fs.writeFileSync(DICT, JSON.stringify(dict, null, 2) + '\n')
console.log(`SMOKE_HEALED: ${mode}匹配删除 ${hits.length} 条污染词条（备份: ${backup}），请重建后重测`)
