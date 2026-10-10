#!/usr/bin/env node
// Apply hanhua/dict.json to a file:
//   exact    -> replaces "English" literals globally, except semantic/code contexts
//   pattern  -> replaces only in UI-attribute contexts
//   template -> replaces `English ${...}` template literals
// Usage: node apply.js <file> [--write]
// Without --write, prints what WOULD change and reports keys with 0 matches.
const fs = require('fs')
const path = require('path')
const { contextReason, CONSISTENT_LABELS } = require('./semantic_guard')
const { commentChecker } = require('./comment_scan')

const file = process.argv[2]
const write = process.argv.includes('--write')
// --quiet: 只报替换计数与 MISSED 条数，不逐条列出（用于主进程小文件，避免噪音淹没
// UI bundle 的 MISSED 详单——那才是待补翻清单）
const quiet = process.argv.includes('--quiet')
if (!file) {
  console.error('usage: node apply.js <file> [--write]')
  process.exit(1)
}
const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dict.json'), 'utf8'))

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const countOf = (src, re) => {
  let n = 0
  const r = new RegExp(re.source, re.flags)
  while (r.exec(src) !== null) n++
  return n
}

// --- 字面量批量扫描（Trie）-----------------------------------------------------------
// 2026-10-11：把「逐条 regex 扫全文」换成「一次扫描全查」。旧写法每条词条对整个
// 文件跑一次 new RegExp('"'+esc(en)+'"','g')——主 bundle 3.4MB × 2300+ 条 ≈ 8GB 的
// regex 扫描量（CPU profile：applyExact 4.8s + GC 1.3s，占单文件 7.5s 的大头）。
// 这里把本节所有 key 装进 Trie，对全文的每个引号位置从引号后逐字符尝试匹配。
// 语义与 esc(key) 的正则逐字节等价（都是字面匹配，含转义形态与任意上下文），
// 复杂度 O(文件大小 × 平均尝试步数)——实测主 bundle 端到端 7.5s → 1s 级。
function buildTrie(keys) {
  const root = { next: new Map(), key: null }
  for (const k of keys) {
    let node = root
    for (let i = 0; i < k.length; i++) {
      let nxt = node.next.get(k[i])
      if (!nxt) {
        nxt = { next: new Map(), key: null }
        node.next.set(k[i], nxt)
      }
      node = nxt
    }
    node.key = k
  }
  return root
}

// 扫描 source 中所有「<quote>key<quote>」形态（不论上下文，含注释/转义区——与旧
// regex 同为纯文本匹配），按出现位置升序返回 {en, start, end}。
function scanQuoted(source, trie, quote) {
  const hits = []
  const len = source.length
  let i = source.indexOf(quote)
  while (i !== -1) {
    let node = trie
    let j = i + 1
    while (j < len) {
      const nxt = node.next.get(source[j])
      if (!nxt) break
      node = nxt
      j++
      if (node.key !== null && source[j] === quote) {
        // 命中后继续走（不 break）：同一起点若还有更长 key 的形态（嵌套模板/共引号
        // 设计），一并收集——保证命中集合与「每条 key 独立跑 regex」一致；这类重叠
        // 场景会由各分区自己的重叠检测识别并回退逐条处理。
        hits.push({ en: node.key, start: i, end: j + 1 })
      }
    }
    i = source.indexOf(quote, i + 1)
  }
  return hits
}

// 一次重组替代「倒序逐条 slice 拼接」：后者每轮都生成一个新的整串（GC 压力的
// 主要来源），对不重叠的 edits 两者结果完全一致。
function spliceEdits(source, edits) {
  if (edits.length === 0) return source
  edits.sort((a, b) => a.start - b.start)
  const out = []
  let last = 0
  for (const e of edits) {
    out.push(source.slice(last, e.start), e.text)
    last = e.end
  }
  out.push(source.slice(last))
  return out.join('')
}

// 替换区间有无嵌套/重叠（区间[..,X) 与 [X,..) 纯相邻不算——只有共享字符才危险）。
// 旧实现在这种场景里靠「按词典顺序逐条替换、后一条在前一条的结果上再匹配」的级联
// 语义（0.0.169 的嵌套模板：外层 key 完整包含内层 key 的形态），一次性重组无法
// 复刻——检测到就回退逐条实现，与旧行为逐字一致。
function hasOverlappingRanges(hits) {
  if (hits.length < 2) return false
  const sorted = hits.slice().sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) return true
  }
  return false
}

// UI 属性的锚点：pattern 只在这些位置生效，所以短词（Delete / Manage / Available…）
// 放这里不会碰到比较、枚举自映射或协议常量。
const ATTR_ANCHORS = [
  'children:',
  'label:',
  'title:',
  'tagline:',
  'placeholder:',
  'confirmLabel:',
  'actionLabel:',
  '"data-tooltip":',
  '"aria-label":',
  // 不带引号的形态：`tooltip` / `ariaLabel` 是合法标识符，minifier 必然去掉引号，
  // 只认 `"data-tooltip":` / `"aria-label":` 会让这两个位置对 pattern 分区完全不可达
  // （0.0.169 的 `tooltip:"Resolve"` / `ariaLabel:"Cloud project"` 就是因此漏翻的）。
  'tooltip:',
  'ariaLabel:',
]
// 值位置允许压缩后的「解构默认值 / 变量赋值」形态：
//   children:"Delete"   与   confirmLabel:n="Delete"
const OPT_ASSIGN = '(?:[A-Za-z_$][\\w$]*\\s*=\\s*)?'
// 比较运算符右侧是协议常量 / 状态码，不是文案
const CMP_BEFORE = /(?:===|!==|==|!=|\.includes\s*\(|\.startsWith\s*\(|\.endsWith\s*\(|\.types\.includes\s*\(|\bcase\s*)\s*$/

let src = fs.readFileSync(file, 'utf8')
const before = src
// 「本次运行开始前」的文件快照。只用来回答一个问题：某条词条的译文是**本来就在文件里**
// （说明这个文件已经翻过一遍，重跑时该词条可以放过），还是**本次运行才写进去的**
// （说明原文已经消失，该词条是真 MISSED）。拿当前 src 判断是不行的：别的分区 / 同译文的
// 兄弟词条刚把同一句译文写进去，死词条就会拿它当挡箭牌，永远不报。
const initialSrc = src
const alreadyTranslated = (zh) => initialSrc.includes('"' + zh + '"')
let totalReplaced = 0
const missed = []
const semanticBlocked = []

// 注释判定交给 tools/comment_scan.js（词法细节与自测都在那边；这里只把它包成
// 「整份文件共用一张区间表」的查询函数）。
const isInsideComment = commentChecker()

const applyExact = (source, dictSection) => {
  // 0.0.159 改法：先把本节所有替换点收集齐，最后一次性回写。理由——注释区间是按
  // 「某一份具体文本」算出来的，逐条替换会让偏移持续位移，于是每换一条就得整份重新分词；
  // 而对着一份快照收集，则整节只分词一次（3MB bundle 约几十毫秒，旧实现是 1655 次行内重扫）。
  // 2026-10-11 改法：收集从「逐条 regex 扫全文」换成 Trie 一次扫描（scanQuoted），
  // 主 bundle 这一节从 4.8s+1.3s(GC) 降到亚秒级；各判定口径一字未动。命中区间若出现
  // 嵌套/重叠（旧实现靠逐条级联处理的情形），回退 applyExactLegacy——两者行为逐字一致。
  const section = dictSection || {}
  const hits = scanQuoted(source, buildTrie(Object.keys(section)), '"')
  if (hasOverlappingRanges(hits)) return applyExactLegacy(source, section)
  const edits = []
  // 本次真替换过的译文（zh → 处数）。未命中的词条要等整节跑完再判，理由见下面的
  // 幂等判断：同译文的兄弟词条不允许互相顶包。
  const replacedZh = new Map()
  // 命中计数（含注释里的命中）——旧口径：只有整份文件里一个字面量都找不到才算未命中。
  const hitCount = new Map()
  for (const h of hits) {
    const en = h.en
    const zh = section[en]
    // 白名单标签（semantic_guard.CONSISTENT_LABELS）是「同表同值、进程内派生」的界面标签：
    // 它的比较位置与显示位置必须用同一个值，只翻一处反而会错，所以这里放行；其余中文落在
    // 比较 / switch / 协议参数位置仍会拦下。
    const consistentLabel = CONSISTENT_LABELS.has(zh)
    hitCount.set(en, (hitCount.get(en) || 0) + 1)
    if (isInsideComment(source, h.start)) continue
    const reason = !consistentLabel && contextReason(source, h.start, h.end)
    if (reason) {
      semanticBlocked.push({ en, reason })
      continue
    }
    edits.push({ start: h.start, end: h.end, text: '"' + zh + '"' })
    replacedZh.set(zh, (replacedZh.get(zh) || 0) + 1)
  }
  source = spliceEdits(source, edits)
  totalReplaced += edits.length
  // 未命中的词条在这里统一判定：幂等检查限定在完整的双引号字面量（不能用“译文在文件任意
  // 位置出现”掩盖一个真漏翻的 key），而且**不能**被「同译文的兄弟词条」顶包——0.0.131
  // 实测：dict 里同时有 "Resume queue"/"Resume the queue" 与 "Queue paused."/
  // "The queue is paused." 两组同译文词条，上游把带 the 的两句改写成不带 the 之后，
  // 旧词条本该报 MISSED，却因为兄弟词条刚把同一句译文写进文件而被当成「已经翻过」放行，
  // 死词条就一直躺在词典里（而 build.sh 的 MISSED 是「全命中」的唯一凭据）。
  for (const en of Object.keys(section)) {
    if (hitCount.has(en)) continue
    const zh = section[en]
    // 幂等只认「进入本次运行之前文件里就带着这句译文」；本次运行写进去的一概不算，
    // 否则同译文的兄弟词条（或已经把整句连同插值一起改写过的 template 分区）会把
    // 死词条掩护过去。replacedZh 另外暴露「两个词条共用同一句译文」这种可疑配对。
    if (!alreadyTranslated(zh) || replacedZh.get(zh)) missed.push(en)
  }
  return source
}

// 0.0.159 版逐条 regex 实现（每条都在「上一条替换后的文本」上再匹配，靠词典顺序
// 级联处理嵌套形态）——仅在命中区间出现嵌套/重叠时由 applyExact 回退调用。
// 除参数化 section 外与旧版逐字一致（含倒序逐条拼接回写）。
const applyExactLegacy = (source, section) => {
  const edits = []
  const replacedZh = new Map()
  const unmatched = []
  for (const [en, zh] of Object.entries(section)) {
    const re = new RegExp('"' + esc(en) + '"', 'g')
    const consistentLabel = CONSISTENT_LABELS.has(zh)
    let n = 0
    let m
    while ((m = re.exec(source)) !== null) {
      n++
      const start = m.index
      const end = start + m[0].length
      if (isInsideComment(source, start)) continue
      const reason = !consistentLabel && contextReason(source, start, end)
      if (reason) {
        semanticBlocked.push({ en, reason })
        continue
      }
      edits.push({ start, end, text: '"' + zh + '"' })
      replacedZh.set(zh, (replacedZh.get(zh) || 0) + 1)
    }
    if (n === 0) unmatched.push([en, zh])
  }
  edits.sort((a, b) => b.start - a.start)
  for (const e of edits) source = source.slice(0, e.start) + e.text + source.slice(e.end)
  totalReplaced += edits.length
  for (const [en, zh] of unmatched) {
    if (!alreadyTranslated(zh) || replacedZh.get(zh)) missed.push(en)
  }
  return source
}

// --- pattern：仅界面属性位置（在 code/exact/template 之前跑）----------------------
// 值位置要认压缩产物的四种形态——早期实现只认第一种，connectors 面板整片状态标签漏翻：
//   children:"Delete"                                          直接字面量
//   confirmLabel:n="Delete"                                    默认参数（解构默认值）
//   label:t.status==="idle"?"Ready when needed":"Disconnected"  三元分支
//   "aria-label":`${s?"Collapse":"Expand"} thinking details`     模板插值内部的字面量
// 做法：取锚点后到「第 0 层逗号 / 分号 / 右括号」为止的值文本，只认其中第 0 层的字符串
// 字面量（第 1 层以上是别的属性值：class 名、色值、SVG 路径…，比较运算符右侧是协议常量），
// 并对值里的模板字面量下钻到 ${…} 内部（模板固定段交给 template 分区）。

// 值文本终点：第 0 层的逗号 / 分号 / 右括号
function valueEnd(start) {
  let depth = 0
  let i = start
  let q = null
  const limit = Math.min(src.length, start + 400)
  while (i < limit) {
    const c = src[i]
    if (q) {
      if (c === '\\') i++
      else if (c === q) q = null
    } else if (c === '"' || c === "'" || c === '`') q = c
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break
      depth--
    } else if ((c === ',' || c === ';') && depth === 0) break
    i++
  }
  return i
}

// `children:[…]` 的对齐括弧位置。0.0.159 实测：JSX 文本节点是数组元素
// （children:["Showing ",j.files.length," of ",…]），而 collectUiLiterals 把 `[` 当层级 +1，
// 于是数组里的文案永远停在 depth=1，一条都采不到——闸三报「能翻」，apply 却零命中。
function matchBracket(openIdx, end) {
  let depth = 0
  let i = openIdx
  while (i < end) {
    const c = src[i]
    if (c === '"' || c === "'") { i = skipString(i, end); continue }
    if (c === '`') { i = scanTemplate(i, end, [], 99); continue }
    if (c === '\\') { i += 2; continue }
    if (c === '[' || c === '(' || c === '{') depth++
    else if (c === ']' || c === ')' || c === '}') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return end
}

// 锚点后面的取值：值是数组字面量时按「元素层」收集（数组元素就是 JSX 的文本节点），
// 否则按第 0 层收集。
function collectValueLiterals(start, end, out) {
  let i = start
  while (i < end && /\s/.test(src[i])) i++
  if (src[i] === '[') {
    const close = matchBracket(i, end)
    collectUiLiterals(i + 1, close, out, 0)
    return
  }
  collectUiLiterals(start, end, out, 0)
}

function skipString(start, end) {
  const q = src[start]
  let i = start + 1
  while (i < end) {
    if (src[i] === '\\') i += 2
    else if (src[i] === q) return i + 1
    else i++
  }
  return end
}

// 收集值文本里第 0 层的字符串字面量（含三元分支），并下钻模板插值
function collectUiLiterals(start, end, out, depth) {
  let i = start
  while (i < end) {
    const c = src[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      let raw = ''
      while (j < end) {
        const ch = src[j]
        if (ch === '\\') {
          raw += src.slice(j, j + 2)
          j += 2
          continue
        }
        if (ch === c) break
        raw += ch
        j++
      }
      if (depth === 0 && !CMP_BEFORE.test(src.slice(Math.max(0, i - 40), i))) {
        let value = null
        try {
          value = JSON.parse('"' + raw + '"')
        } catch {
          value = null
        }
        if (value) out.push({ start: i, end: j + 1, value })
      }
      i = j + 1
      continue
    }
    if (c === '`') {
      i = scanTemplate(i, end, out, depth)
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    i++
  }
}

// 扫描模板字面量，返回其后的位置；插值 ${…} 内部再按「第 0 层」扫一遍
function scanTemplate(start, end, out, depth) {
  let i = start + 1
  while (i < end) {
    const c = src[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '`') return i + 1
    if (c === '$' && src[i + 1] === '{') {
      const exprStart = i + 2
      let d = 1
      let k = exprStart
      while (k < end && d > 0) {
        const cc = src[k]
        if (cc === '\\') {
          k += 2
          continue
        }
        if (cc === '"' || cc === "'") {
          k = skipString(k, end)
          continue
        }
        if (cc === '`') {
          k = scanTemplate(k, end, out, depth)
          continue
        }
        if (cc === '{') d++
        else if (cc === '}') d--
        k++
      }
      if (depth === 0) collectUiLiterals(exprStart, k - 1, out, 0)
      i = k
      continue
    }
    i++
  }
  return end
}

const patternLiterals = []
{
  const anchorRe = new RegExp('(?:' + ATTR_ANCHORS.map(esc).join('|') + ')' + OPT_ASSIGN, 'g')
  let m
  while ((m = anchorRe.exec(src)) !== null) {
    const vs = m.index + m[0].length
    collectValueLiterals(vs, valueEnd(vs), patternLiterals)
  }
}

const patternHits = new Map()
const patternValues = new Set()
const patternEdits = []
for (const lit of patternLiterals) {
  patternValues.add(lit.value)
  const zh = (dict.pattern || {})[lit.value]
  if (zh === undefined) continue
  patternHits.set(lit.value, (patternHits.get(lit.value) || 0) + 1)
  patternEdits.push({ start: lit.start, end: lit.end, text: '"' + zh + '"' })
}
// 回写：不重叠区间走一次重组（spliceEdits）；罕见的重叠区间回退旧的倒序逐条拼接
if (hasOverlappingRanges(patternEdits)) {
  patternEdits.sort((a, b) => b.start - a.start)
  for (const e of patternEdits) {
    src = src.slice(0, e.start) + e.text + src.slice(e.end)
    totalReplaced++
  }
} else {
  totalReplaced += patternEdits.length
  src = spliceEdits(src, patternEdits)
}
// pattern 也必须报 MISSED——它是短词的安全区，零命中意味着「原文没了」或「匹配形态变了」，
// 两种都要人看一眼，不能像 0.0.103 那样静静躺着 31 条死条目。
for (const [en, zh] of Object.entries(dict.pattern || {})) {
  if (patternHits.has(en)) continue
  if (patternValues.has(zh)) continue // 幂等：上一次跑已经把译文写进去了
  missed.push('[pattern] ' + en)
}

// code: exact multi-token fragments (e.g. pluralization), replaced verbatim.
// These entries are intentionally opt-in and are not passed through the UI
// semantic-context filter used by exact literals.
for (const [en, zh] of Object.entries(dict.code || {})) {
  const re = new RegExp(esc(en), 'g')
  // 一次扫描同时完成计数与替换（旧写法 countOf + replace 是两遍全文）
  let n = 0
  src = src.replace(re, () => {
    n++
    return zh
  })
  if (n === 0) {
    const reZh = new RegExp(esc(zh), 'g')
    if (countOf(src, reZh) === 0) missed.push('[code] ' + en)
    continue
  }
  totalReplaced += n
}

// 2026-10-11 改法：Trie 一次扫描替代逐条 regex（旧写法每条都要 countOf + replace
// 两遍全文）。missed 判定沿用旧口径（零命中且译文形态不在文本里）。命中区间若出现
// 嵌套/重叠（0.0.169 实测：外层模板 key 完整包含内层模板 key 的形态），回退旧逐条
// 实现——它靠词典顺序级联处理这类形态，行为逐字一致。
{
  const section = dict.template || {}
  const hits = scanQuoted(src, buildTrie(Object.keys(section)), '`')
  if (hasOverlappingRanges(hits)) {
    // legacy：逐条 countOf + replace（即 0.0.159 版实现，一字未动）
    for (const [en, zh] of Object.entries(section)) {
      const re = new RegExp('`' + esc(en) + '`', 'g')
      const n = countOf(src, re)
      if (n === 0) {
        const reZh = new RegExp('`' + esc(zh) + '`', 'g')
        if (countOf(src, reZh) === 0) missed.push('`' + en + '`')
        continue
      }
      src = src.replace(re, () => '`' + zh + '`')
      totalReplaced += n
    }
  } else {
    const hitCount = new Map()
    const edits = []
    for (const h of hits) {
      hitCount.set(h.en, (hitCount.get(h.en) || 0) + 1)
      edits.push({ start: h.start, end: h.end, text: '`' + section[h.en] + '`' })
    }
    for (const [en, zh] of Object.entries(section)) {
      if (hitCount.has(en)) continue
      const reZh = new RegExp('`' + esc(zh) + '`', 'g')
      if (countOf(src, reZh) === 0) missed.push('`' + en + '`')
    }
    src = spliceEdits(src, edits)
    totalReplaced += edits.length
  }
}

// Apply exact literals after templates. This prevents an exact entry such as
// "unknown error" from changing an embedded string before its full template
// entry has a chance to match.
src = applyExact(src, dict.exact)

const diffLen = src.length - before.length
console.log(`replaced ${totalReplaced} occurrences (bundle size ${before.length} -> ${src.length}, ${diffLen >= 0 ? '+' : ''}${diffLen} bytes)`)
if (missed.length) {
  if (quiet) {
    console.log(`missed ${missed.length} keys (详情见 UI bundle 构建日志)`)
  } else {
    console.log(`MISSED (${missed.length} keys, no exact match):`)
    for (const m of missed) console.log(`  - ${JSON.stringify(m)}`)
  }
} else {
  console.log('all keys matched')
}
if (semanticBlocked.length) {
  const unique = [...new Map(semanticBlocked.map((x) => [`${x.en}\u0000${x.reason}`, x])).values()]
  console.error(`semantic-blocked ${semanticBlocked.length} occurrences（代码语义位置禁止翻译）:`)
  for (const item of unique.slice(0, 30)) {
    console.error(`  - ${JSON.stringify(item.en)} ← ${item.reason}`)
  }
  if (unique.length > 30) console.error(`  … 其余 ${unique.length - 30} 项略`)
  console.error('ERROR: 为避免破坏运行时协议常量，本文件未写入任何修改。')
  process.exit(1)
}

if (write) {
  fs.writeFileSync(file, src)
  console.log(`wrote ${file}`)
}
