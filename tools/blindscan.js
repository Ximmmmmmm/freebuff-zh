#!/usr/bin/env node
// 盲区英文扫描：找出「原版 bundle 里有、汉化产物里也原样还在」的英文文案。
//
// 为什么需要它：`uipos.js` 只看界面属性锚点的第 0 层字面量、`fieldscan.js` 只看
// description/tagline 这类字段、`regress.js` 只比对「够长够像句子」的片段，于是这三类
// 位置的英文可以在每一版都静静躺着——
//   · `children:[cond?"A":"B"]`：JSX 文本节点只认「整段就是一个字符串」的元素，
//     三元分支在 `[` 里面（第 1 层），uipos 与 apply.js 的 pattern 都够不着；
//   · 模板插值内部的字面量：uipos 把 `${…}` 整体当占位符、压根不进插值；
//   · 函数默认值 / 赋值语句里的字符串：不在任何界面锚点上。
// 0.0.110 适配时正是靠这种对差扫出 24 条历史遗留英文（连接器面板、预览报错、
// 购买时段 tooltip、「编辑一条消息」嵌套模板族…）；它给出的是「从一开始就没译过」，
// 与 regress 的「本版把已译的弄回英文」互补，互不重叠。
//
// 做法（刻意不写 JS 词法分析器）：2.4 MB 的 minified bundle 里既有正则字面量里的引号、
// 也有 shiki 那种含反引号的怪模板，朴素扫描会错位配对、把几十万字符当成一个字符串
// （实测最长一条 38 万字符），而手写完整词法分析得不偿失。于是换成两步：
//   1. 在原版里取「与引号相邻的英文片段」（片段前后紧挨着 " ' ` 或 `${`），
//      这类片段只可能是给人看的文案，顺手把 `typeof b` 这类代码片段排除掉；
//   2. 在产物里用同一支正则取英文片段，凡是原版里也有的，就是没被词典碰过的残留。
// 单侧面相邻即可（`"…preview: ${x}` 这类固定段也是相邻的），因此模板固定段、
// children 数组里的三元分支、插值内部的字面量都能覆盖。
//
// 用法：node tools/blindscan.js <原版 bundle|目录> <产物 bundle|目录> [--words N] [--no-ctx]
//   目录可以是 ui/ 本身、Freebuff 的 resources 目录、或本仓库的 output/。
//   --words N 最少词数，默认 2（只找多词文案）；找短标签用 --words 1（噪音大，需人工筛）。
// 退出码：0 = 没有「疑似文案」；1 = 有（人工确认后补进 dict.json 或记入有意保留）；
//         2 = 用法/输入错误。
// 自测：node tools/test_blindscan.js（CI 会跑）。
'use strict'

const fs = require('fs')
const path = require('path')

// --- 英文片段提取 --------------------------------------------------------------
// 词里允许数字与 ' ’ . - &（`can’t` / `1 file` / `auto-ended` / `R&D`），
// 其他符号都会切断片段，所以代码里的 `a&&b`、`x.y`、`f(x)` 不会连成一个大片段。
const WORD = "[A-Za-z][A-Za-z0-9'’.&\\-]*"
const SPAN_RE = new RegExp(WORD + '(?:[ \\t]' + WORD + ')*', 'g')
const QUOTE_EDGE = /["'`]/

function isTemplateStart(src, at) {
  return src[at] === '$' && src[at + 1] === '{'
}

// 与引号相邻的片段：前一个字符是引号 / 后一个字符是引号 / 后接 `${`
function isQuoteAdjacent(src, start, end) {
  const prev = src[start - 1]
  const next = src[end]
  return QUOTE_EDGE.test(prev || '') || QUOTE_EDGE.test(next || '') || isTemplateStart(src, end)
}

// 原版里所有「与引号相邻」的片段（键 = 片段文本，值 = 首处位置）
function collectQuotedSpans(src) {
  const out = new Map()
  for (const m of src.matchAll(SPAN_RE)) {
    const start = m.index
    const end = start + m[0].length
    if (!isQuoteAdjacent(src, start, end)) continue
    if (!out.has(m[0])) out.set(m[0], start)
  }
  return out
}

// 产物里出现过的英文片段
function collectSpans(src) {
  const out = new Map()
  for (const m of src.matchAll(SPAN_RE)) {
    out.set(m[0], (out.get(m[0]) || 0) + 1)
  }
  return out
}

function contextOf(src, at, len) {
  return src
    .slice(Math.max(0, at - 45), at + len + 45)
    .replace(/\s+/g, ' ')
    .trim()
}

// --- 过滤：只留下「像给人看的英文」 --------------------------------------------
const hasCJK = /[\u3400-\u9fff]/
// 出现这些基本就是代码而不是文案（与 regress.js 的 CODEISH 同一套思路）
const CODEISH = /[(){}\[\];=<>]|&&|\|\||=>|\?\.|\?\?|function |typeof |const |let |var |\[object|\\n|console\.|\.js\b/
// 自然语言的强信号：至少出现一个常见小词（与 regress.js 的 COMMON 保持一致，
// 两个工具的「像句子吗」判断才不会互相打架）
const COMMON = new RegExp(
  '\\b(' +
    [
      'the', 'and', 'or', 'to', 'of', 'in', 'you', 'your', 'yours', 'for', 'with', 'is', 'are',
      'not', 'this', 'that', 'these', 'those', 'from', 'will', 'can', 'cannot', 'when', 'then',
      'after', 'before', 'more', 'than', 'use', 'used', 'uses', 'if', 'on', 'day', 'days',
      'month', 'months', 'first', 'all', 'new', 'only', 'while', 'instead', 'have', 'has',
      'left', 'out', 'but', 'any', 'get', 'gets', 'add', 'adds', 'costs', 'cost', 'buys', 'buy',
      'plan', 'wallet', 'usage', 'hour', 'hours', 'session', 'sessions', 'message', 'messages',
      'tool', 'tools', 'free', 'trial', 'premium', 'unlimited', 'charged', 'spend', 'refund',
      'connect', 'connected', 'choose', 'select', 'search', 'remove', 'delete', 'save',
    ].join('|') +
    ')\\b',
  'i'
)

// 像给人看的英文（不是标识符 / 路径 / 类名 / 键名）
function looksLikeCopy(text, minWords = 2) {
  const t = text.trim()
  if (t.length < 2 || t.length > 300) return false
  if (!/[A-Za-z]/.test(t) || hasCJK.test(t)) return false
  const words = t.match(/[A-Za-z]{2,}/g) || []
  if (words.length < minWords) return false
  if (minWords >= 2 && !/ /.test(t)) return false
  // --words 1 时单词也可能进来：全小写的多半是类名 / 标识符 / 包名，直接丢掉
  if (minWords <= 1 && words.length === 1 && !/[A-Z]/.test(t)) return false
  if (CODEISH.test(t)) return false
  if (/^(?:https?:|\/\/|~\/)/i.test(t)) return false
  if (/^[a-z0-9_$.-]+$/.test(t)) return false // 全小写标识符 / 命令（bun install、包名路径）
  // 大半 token 是标识符形状（含 . / $ 或驼峰，如 `provider/model-name`、`EditorView.setState`）
  // 就当代码——但不能一律拍死：一整句话里夹一两个符号名（`Calls to EditorView.setState …`）
  // 才是常态，所以按比例判。
  const tokens = t.split(/\s+/)
  const identish = tokens.filter((w) => /[./$]/.test(w) || /^[a-z]+[A-Z]/.test(w)).length
  if (identish / tokens.length > 0.5) return false
  // kebab-case 类名组合（如 `agent-trigger has-byok`）是代码不是文案
  const kebab = t.match(/[a-z][a-z0-9]*(?:-[a-z0-9]+)+/g) || []
  if (kebab.length >= 2 && kebab.join('').length / t.replace(/\s+/g, '').length > 0.6) return false
  // 全是「标识符形状」的 token 且带连字符 / 点号（`act tool-row`、`cmd+shift+p`），
  // 又没有任何常见小词 —— 当类名 / 快捷键组合丢掉（不能一刀切成全小写就丢：
  // `auto-ended after inactivity` 这种真文案也是全小写，但它含 after）
  const allIdent = tokens.every((w) => /^[a-z0-9_$.-]+$/.test(w))
  if (allIdent && tokens.some((w) => /[-._]/.test(w)) && !COMMON.test(t)) return false
  return true
}

// 疑似「该翻却没翻」：多词 + 有常见小词（判据与 regress 一致，便于两处结论对齐）
function isLikelyCopy(text, minWords = 2) {
  if (!looksLikeCopy(text, minWords)) return false
  const words = text.trim().match(/[A-Za-z]{2,}/g) || []
  return words.length >= 2 && COMMON.test(text)
}

// --- 对差 ---------------------------------------------------------------------
function compare(pristineSrc, outputSrc, minWords = 2) {
  const pristineSpans = collectQuotedSpans(pristineSrc)
  const outputSpans = collectSpans(outputSrc)
  const confirmed = []
  const other = []
  let sawInBoth = 0
  for (const [text, n] of outputSpans) {
    const at = pristineSpans.get(text)
    if (at === undefined) continue // 原版里没有 = 这句是版本新增（或被译过又改回）
    sawInBoth++
    if (!looksLikeCopy(text, minWords)) continue
    const entry = { text, n, ctx: contextOf(pristineSrc, at, text.length) }
    if (isLikelyCopy(text, minWords)) confirmed.push(entry)
    else other.push(entry)
  }
  const byText = (a, b) => a.text.localeCompare(b.text)
  confirmed.sort(byText)
  other.sort(byText)
  return { pristineSpans: pristineSpans.size, outputSpans: outputSpans.size, sawInBoth, confirmed, other }
}

// 目录 → index.html → 它加载的主 bundle（与 build.sh / update.sh 同一套找法）
function resolveBundle(p, fail) {
  let st
  try {
    st = fs.statSync(p)
  } catch {
    return fail(`ERROR: 路径不存在：${p}`)
  }
  if (st.isFile()) return p
  for (const rel of ['index.html', path.join('ui', 'index.html'), path.join('orchestrator', 'ui', 'index.html')]) {
    const html = path.join(p, rel)
    if (!fs.existsSync(html)) continue
    const m = fs.readFileSync(html, 'utf8').match(/src="\.\/(assets\/[^"]+\.js)"/)
    if (!m) continue
    const js = path.join(path.dirname(html), m[1])
    if (fs.existsSync(js)) return js
  }
  return fail(`ERROR: 在 ${p} 下找不到 index.html 及其主 bundle`)
}

function main(argv) {
  const wordsArg = argv.indexOf('--words')
  let minWords = 2
  if (wordsArg !== -1) {
    minWords = Number(argv[wordsArg + 1])
    if (!Number.isInteger(minWords) || minWords < 1) {
      console.error('ERROR: --words 需要一个正整数')
      return 2
    }
  }
  const noCtx = argv.includes('--no-ctx')
  const args = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--words')
  if (args.length < 2) {
    console.error('usage: node tools/blindscan.js <原版 bundle|目录> <产物 bundle|目录> [--words N] [--no-ctx]')
    return 2
  }
  const die = (msg) => {
    console.error(msg)
    process.exit(2)
  }
  const pristineFile = resolveBundle(args[0], die)
  const outputFile = resolveBundle(args[1], die)

  const { pristineSpans, outputSpans, sawInBoth, confirmed, other } = compare(
    fs.readFileSync(pristineFile, 'utf8'),
    fs.readFileSync(outputFile, 'utf8'),
    minWords
  )

  const show = (e) => console.log(`${e.n}\t${e.text}${noCtx ? '' : `\n\t@ ${e.ctx}`}`)
  console.log(`盲区英文扫描：原版与引号相邻的片段 ${pristineSpans} 种，产物英文片段 ${outputSpans} 种，两边都有 ${sawInBoth} 种`)
  console.log(`  疑似文案（多词 + 常见小词，多半该翻）：${confirmed.length} 条`)
  console.log(`  其余（短标签 / 库内部 / 品牌词，人工判断）：${other.length} 条`)
  if (confirmed.length) {
    console.log('\n## 疑似文案')
    for (const e of confirmed) show(e)
  }
  if (other.length) {
    console.log('\n## 其余（需人工判断；模型名 / 键盘键名 / 库内部报错按惯例保留英文）')
    for (const e of other) show(e)
  }
  return confirmed.length ? 1 : 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))

module.exports = { collectQuotedSpans, collectSpans, looksLikeCopy, isLikelyCopy, compare, resolveBundle }
