#!/usr/bin/env node
// 重新定位（resituate）：对「够不着本版 bundle」的旧词条，在新版英文原版里找回它的现形态，
// 能确定的直接给出可写回的新键 + 同步好的译文，不能确定的列成候选交人工——把 remap 之后
// 那段「逐条在新 bundle 里搜一遍、把压缩变量名抄对」的手工活变成一条命令。
//
// 为什么 remap 不够：remap 只处理 template 分区，而且只在**固定段逐字节还在**时才能迁移；
// 一旦同一锚文本命中多处（AMBIGUOUS）或锚文本本身被改写 / 下线（MISSING），它就交回人工。
// 实测 0.0.156 适配：remap 报了 13 条 AMBIGUOUS + 11 条 MISSING，加上 missed_diagnose 的
// 「只在上一版 UI 出现」清单共 35 条，全部要人工在新 bundle 里搜现形态——本工具就是这一步。
//
// 四个分区的定位手段不同，因为它们的形态不同：
//   · template / 任何含 `${…}` 的键 → 固定段当锚、插值当捕获组（与 remap 同源的三种捕获形态），
//     命中处就是新键；唯一的候选且译文能同步 → RELOCATE，多候选 → CONFIRM；
//   · code 片段（`"Showing ",A.files.length," of ",A.matches,` 这类跨引号的源码片段）→ 把片段里的
//     标识符全抹成占位符做**骨架子串搜索**（含模板 `${…}` 内部的名字——minifier 同样会改它们）：
//     命中处的原文就是新片段，译文里的名字再按位置同步过去；
//   · 插值里还套着模板的键（`${a?`${b}`:c}`）→ 三种正则捕获都跨不过反引号，改用**固定段序列
//     扫描**：扫出 bundle 里每条完整模板字面量，与 key 比「固定段序列 + 插值个数」，序列相等
//     即同一个键的现形态（静态文案逐字节不动，minifier 只重排标识符）；
//   · exact / pattern（整句或短词，没有插值可当锚）→ 在**完整字面量集合**里按词级相似度找改写后的
//     新句子（` · Sponsored by ` → ` | Sponsored by `），列出候选与相似度，绝不自动改写散文；
//   · 都没有 → GONE（上游把这条下线了），`--prune-gone` 可一次清掉。
//
// 与邻居的分工：`remap.js` 管「固定段没变、只是插值变量改名」的自动迁移；`missed_diagnose.js`
// 负责**分类**「够不着」的条目（命中 / 只在主进程 / 只在上一版 / 两边都没有）并拦构建；本工具
// 负责把「只在上一版 UI 出现」那一类**定位到现形态**。给 `--electron <目录>` 时还会替
// missed_diagnose 检查一遍「其实是主进程专属」，避免把该写进补丁的条目当成死词条删掉。
//
// 用法：
//   node tools/resituate.js --ui <本版英文原版 bundle|ui 目录> [--prev-ui <上一版英文原版>]
//                          [--dict <dict.json>] [--electron <electron 目录>]
//                          [--write] [--prune-gone] [--json <out.json>] [--limit N] [--quiet]
//   默认 dry-run；--write 写回 RELOCATE 条目（带与 remap 同级的自证），--prune-gone 一并删 GONE。
// 退出码：0 = 没有需要人工的条目；1 = 有 CONFIRM / GONE（发布闸门该拦的那种）；2 = 输入 / 调用出错。
'use strict'

const fs = require('fs')
const path = require('path')
const {
  parseTemplate,
  skeletonOf,
  innerOf,
  balancedExpr,
  escRe,
  templateRegex,
  STRICT_CAP,
  BALANCED_CAP,
  LAZY_CAP,
} = require('./literal_skeleton.js')
const { resolveBundle, collectLiteralsFromSource, normText } = require('./regress.js')

const REPO = path.join(__dirname, '..')
const ZONES = ['exact', 'template', 'code', 'pattern']
const MAX_CANDIDATES = 4
// 候选统一形态：文本 + 相似度 + 命中处数（同一文本复制成多份时 >1）
const candOf = (h) => ({ text: h.text, score: h.score ?? 1, sites: h.sites })

function usage(msg) {
  if (msg) console.error('ERROR: ' + msg)
  console.error(
    'usage: node tools/resituate.js --ui <本版英文原版> [--prev-ui <上一版>] [--dict <dict.json>]\n' +
      '                              [--electron <electron 目录>] [--write] [--prune-gone]\n' +
      '                              [--json <out.json>] [--limit N] [--quiet]',
  )
  process.exit(2)
}

// --- 相似度：词级 Dice（`0.0.156` 那种整句改写靠它给出候选） -------------------------
const wordBag = (s) => normText(s).toLowerCase().match(/[a-z][a-z0-9]*/g) || []
function dice(a, b) {
  const A = new Set(wordBag(a))
  const B = new Set(wordBag(b))
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const w of A) if (B.has(w)) hit++
  return (2 * hit) / (A.size + B.size)
}

// --- 源码片段扫描：标识符（含模板字符串 `${…}` 内部的）与「其余字符」两层 -----------------
// 与 literal_skeleton 的 idents 的关键差别：`${…}` 里的名字也算。minifier 同样会改它们
// （`n=`${e}s`)=>` → `n=`${t}s`)=>`），漏掉内层会让骨架配不上，或者让译文里留下旧名字。
// 字符串**文本**逐字保留——那是要翻译的文案，也是骨架里唯一稳定的锚。
function skipQuoted(s, i) {
  const q = s[i]
  let j = i + 1
  while (j < s.length) {
    if (s[j] === '\\') j += 2
    else if (s[j] === q) return j + 1
    else j++
  }
  return j
}

// 跳过 `${…}` 表达式（i 指向 `{` 之后），返回配对 `}` 之后；给了 collect 就连内层名字一起收
function skipInterp(s, i, collect) {
  let depth = 1
  let j = i
  while (j < s.length) {
    const c = s[j]
    if (c === '}') {
      if (--depth === 0) return j + 1
      j++
      continue
    }
    if (c === '{') { depth++; j++; continue }
    if (c === '"' || c === "'") { j = skipQuoted(s, j); continue }
    if (c === '`') { j = skipTemplate(s, j, collect); continue }
    if (collect && /[A-Za-z_$]/.test(c)) {
      let k = j
      while (k < s.length && /[\w$]/.test(s[k])) k++
      collect.push({ start: j, end: k, name: s.slice(j, k) })
      j = k
      continue
    }
    j++
  }
  return j
}

// 跳过模板字面量（i 指向开引号），返回收尾引号之后；collect 时收集插值内部的名字
function skipTemplate(s, i, collect) {
  let j = i + 1
  while (j < s.length) {
    const c = s[j]
    if (c === '\\') { j += 2; continue }
    if (c === '`') return j + 1
    if (c === '$' && s[j + 1] === '{') { j = skipInterp(s, j + 2, collect); continue }
    j++
  }
  return j
}

// 代码片段里的标识符 token（含模板插值内部的；字符串文本里的单词不算）
function codeIdents(s) {
  const out = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '"' || c === "'") { i = skipQuoted(s, i); continue }
    if (c === '`') { i = skipTemplate(s, i, out); continue }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < s.length && /[\w$]/.test(s[j])) j++
      out.push({ start: i, end: j, name: s.slice(i, j) })
      i = j
      continue
    }
    i++
  }
  return out.sort((a, b) => a.start - b.start)
}

// 按给定 token 表做标识符改名（数量必须一致，即骨架相同才成立）；对不上返回 null
function renameVia(tokens, s, names) {
  if (tokens.length !== names.length) return null
  let out = ''
  let last = 0
  tokens.forEach((t, i) => {
    out += s.slice(last, t.start) + names[i]
    last = t.end
  })
  return out + s.slice(last)
}

// 片段骨架：标识符换通配，其余（标点 / 字符串常量）逐字匹配；同时给出「稳定文本」——
// 太泛的骨架（`n=e` 之流）哪怕唯一命中也不许自动写回，那是撞名不是定位。
// 用正则而不是字符串 index 做定位：占位符与源码的长度不同，靠索引换算会把边界算错
// （实测把 `"Showing ",A.files.length," of ",A.matches,` 的尾巴多吞了 70 个字符）。
const SPECIFIC_MIN = 10
function fragmentPattern(frag) {
  let re = ''
  let stable = ''
  let last = 0
  for (const t of codeIdents(frag)) {
    const lit = frag.slice(last, t.start)
    re += escRe(lit) + '[A-Za-z_$][\\w$]*'
    stable += lit
    last = t.end
  }
  const tail = frag.slice(last)
  return { re: re + escRe(tail), stable: stable + tail }
}

const fragmentRegex = (frag) => fragmentPattern(frag).re

function skeletonWithMap(s) {
  return { skel: fragmentRegex(s), ids: codeIdents(s) }
}

// 在源码里按骨架找片段。命中处的**源码原文**就是新片段——不用再做一次改名映射。
function locateFragment(frag, src) {
  if (frag.length < 12) return [] // 再短会满地命中，交给人工
  const { stable } = fragmentPattern(frag)
  let re
  try {
    re = new RegExp(fragmentRegex(frag), 'g')
  } catch {
    return []
  }
  const hits = []
  let m
  while ((m = re.exec(src)) !== null && hits.length < 32) {
    hits.push({ start: m.index, end: m.index + m[0].length, text: m[0] })
    if (m.index === re.lastIndex) re.lastIndex++
  }
  // 同形的多处（同一片段被复制了两份）按文本去重——候选列里给一份就够，
  // 但保留“有几处”这个事实，判断「该不该写回」要看它。
  const uniq = []
  const seen = new Set()
  for (const h of hits) {
    if (seen.has(h.text)) continue
    seen.add(h.text)
    uniq.push(h)
  }
  return uniq.map((h) => ({
    ...h,
    sites: hits.filter((x) => x.text === h.text).length,
    stableLen: stable.length,
    specific: stable.length >= SPECIFIC_MIN,
  }))
}

// --- 译文同步：把旧译文里的插值按映射改到新键（与 remap.js 同一套自证） ---------------
function rebuildZh(oldKey, zh, newKey) {
  const kp = parseTemplate(oldKey)
  const np = parseTemplate(newKey)
  const zp = parseTemplate(zh)
  const oldE = kp.filter((p) => p.t === 'expr').map((p) => p.v)
  const newE = np.filter((p) => p.t === 'expr').map((p) => p.v)
  if (!oldE.length) return { ok: true, zh }
  // 映射值带上「在新键里的序号」：重建后要按序号回比骨架，光有文本比不出「这条是第几个插值」。
  const mapping = new Map()
  if (oldE.length === newE.length) {
    oldE.forEach((o, i) => mapping.set(o, { v: newE[i], idx: i }))
  } else {
    // 中文吸收了部分占位符（复数条件）：只映射译文里**还在用**的那些，按出现顺序对齐
    let k = 0
    for (const o of oldE) {
      if (zh.includes(o)) {
        if (k >= newE.length) return { ok: false, why: '插值数不齐且无法顺序对齐' }
        mapping.set(o, { v: newE[k], idx: k })
      }
      k++
    }
  }
  for (const o of oldE) if (zh.includes(o) && !mapping.has(o)) return { ok: false, why: '译文里有无法对齐的插值' }
  if (!mapping.size) return { ok: false, why: '插值映射为空（译文里没有任何旧插值）' }

  // v 一律存「插值内部文本」，`${…}` 外壳只在最后 join 时补：中间的自证都按骨架比，
  // 带着外壳会把 `${a?"收起":"展开"}` 与 `a?"Collapse":"Expand"` 当成两种形态。
  const parts = zp.map((p) => {
    if (p.t !== 'expr') return { t: 'lit', v: p.v }
    const hit = mapping.get(p.v)
    if (hit) return { t: 'expr', v: hit.v, idx: hit.idx, partial: p.partial }
    // 译文自己的写法变体：按骨架找到对应插值，只换标识符。
    // 用 codeIdents 而不是 idents：嵌套模板里的名字也要跟着改，否则译文会留下旧名字。
    const sk = skeletonOf(p.v)
    for (const [o, n] of mapping) {
      if (skeletonOf(o) !== sk) continue
      const names = codeIdents(innerOf(n.v)).map((t) => t.name)
      const renamed = renameVia(codeIdents(p.v), p.v, names)
      if (renamed !== null) return { t: 'expr', v: renamed, idx: n.idx, partial: p.partial }
    }
    return { t: 'expr', v: p.v, idx: null, partial: p.partial }
  })
  const out = parts.map((p) => (p.t === 'expr' ? '${' + p.v + (p.partial ? '' : '}') : p.v)).join('')

  const slots = parts.filter((p) => p.t === 'expr')
  const oldSlots = zp.filter((p) => p.t === 'expr')
  if (slots.length !== oldSlots.length) return { ok: false, why: `译文插值槽数变化（${oldSlots.length} → ${slots.length}）` }
  // 逐条按「它是新键里第几个插值」回比骨架：对齐不上的插值写进去就是引用未定义的变量。
  const bad = slots.find((p) => p.idx === null || skeletonOf(p.v) !== skeletonOf(newE[p.idx]))
  if (bad) return { ok: false, why: `译文的插值 ${JSON.stringify('${' + bad.v + '}')} 无法与新键对齐（骨架不匹配）` }
  const tailOf = (s) => (s.match(/\$\{[^}]*$/) || [])[0]
  if (kp.some((p) => p.partial) && tailOf(out) !== tailOf(newKey)) {
    return { ok: false, why: '重建后译文与 key 的半截尾巴不一致（apply.js 会拼断模板）' }
  }
  return { ok: true, zh: out }
}

// --- code 分区的译文同步：zh 本身也是代码片段，旧名→新名要按位置贴过去 ------------------
// zh 可能整段重写掉代码（`" code comment",h.length===1?"":"s"` → `" 条代码注释"`），也可能与
// key 逐名对应（`["Edit ",t.configKey,…]` → `["编辑 ",t.configKey,…]`）。判据不是猜：只有
// 「旧、新片段名字数一致」且「zh 用到的每个名字在旧片段里都有同名」时才按名字+出现次序改名。
function syncCodeZh(oldKey, zh, newKey) {
  const o = codeIdents(oldKey)
  const n = codeIdents(newKey)
  const z = codeIdents(zh)
  if (!z.length) return { ok: true, zh } // 译文没引用任何代码名字，无需改名
  if (o.length !== n.length) {
    return { ok: false, why: `新旧片段的名字数不同（${o.length} → ${n.length}），改名的对应关系不可靠` }
  }
  const byName = new Map() // 旧名 → 依次对应的新名
  o.forEach((t, i) => {
    if (!byName.has(t.name)) byName.set(t.name, [])
    byName.get(t.name).push(n[i].name)
  })
  let out = ''
  let last = 0
  for (const t of z) {
    const queue = byName.get(t.name)
    if (!queue || !queue.length) {
      return { ok: false, why: `译文里的 ${JSON.stringify(t.name)} 在旧片段里找不到同名标识符` }
    }
    out += zh.slice(last, t.start) + queue.shift()
    last = t.end
  }
  return { ok: true, zh: out + zh.slice(last) }
}

// --- 模板类键的候选：固定段当锚、插值当捕获组 ----------------------------------------
// 三种捕获形态都跨不过反引号，所以 `${a?`${b}`:c}` 这类「插值里还套模板」的键再加一路
// 源码扫描兜底：扫出 bundle 里每条完整模板字面量，与 key 比「固定段序列 + 插值个数」。
// minifier 只重排标识符，静态文案逐字节不动，固定段序列相等即同一个键的现形态。
function scanTemplateLiterals(src) {
  const out = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '"' || c === "'") { i = skipQuoted(src, i); continue }
    if (c === '`') {
      const end = skipTemplate(src, i) // 指向收尾反引号之后
      out.push({ text: src.slice(i + 1, end - 1), start: i + 1 })
      i = end
      continue
    }
    if (c === '/' && src[i + 1] === '*') { // 注释里的反引号不是模板
      const close = src.indexOf('*/', i + 2)
      i = close < 0 ? src.length : close + 2
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      const close = src.indexOf('\n', i + 2)
      i = close < 0 ? src.length : close + 1
      continue
    }
    i++
  }
  return out
}

// 键的形态签名：固定段逐字 + 插值只记个数（与半截模板）
const tplSig = (key) =>
  parseTemplate(key)
    .map((p) => (p.t === 'lit' ? 'L' + p.v : 'E' + (p.partial ? '!' : '')))
    .join('\u0000')

let scanCache = { src: null, list: null }
function templateHitsByScan(key, src) {
  if (scanCache.src !== src) scanCache = { src, list: scanTemplateLiterals(src) }
  const sig = tplSig(key)
  const hits = []
  for (const { text } of scanCache.list) {
    if (tplSig(text) !== sig) continue
    const parts = parseTemplate(text)
    if (parts.some((p) => p.partial)) continue
    hits.push({ text, caps: parts.filter((p) => p.t === 'expr').map((p) => p.v), okExpr: true })
    if (hits.length >= MAX_CANDIDATES * 3) break
  }
  return hits
}

function templateCandidates(key, src) {
  let re = null
  let capName = 'strict'
  for (const [cap, name] of [
    [STRICT_CAP, 'strict'],
    [BALANCED_CAP, 'balanced'],
    [LAZY_CAP, 'lazy'],
  ]) {
    const cand = templateRegex(key, cap)
    if (cand && cand.test(src)) {
      re = templateRegex(key, cap)
      capName = name
      break
    }
  }
  const hits = []
  if (re) {
    let m
    re.lastIndex = 0
    while ((m = re.exec(src)) !== null && hits.length < MAX_CANDIDATES * 3) {
      const caps = m.slice(1)
      const partialTail = parseTemplate(key).some((p) => p.partial)
      const head = partialTail ? caps.slice(0, -1) : caps
      hits.push({ text: m[0].slice(1, -1), caps, okExpr: head.every(balancedExpr) })
      if (m.index === re.lastIndex) re.lastIndex++
    }
  } else {
    hits.push(...templateHitsByScan(key, src))
    if (hits.length) capName = 'scan'
  }
  // 同一现形态被复制成多份时只留一条候选（`Remove ${e.name}` 出现两次不是两个答案），
  // 但「有几处命中」这个事实不能丢：调用方靠候选条数判断「唯一才敢自动写回」。
  const seen = new Set()
  const uniq = []
  for (const h of hits) {
    const been = seen.has(h.text)
    if (!been) {
      seen.add(h.text)
      uniq.push({ ...h, sites: 1 })
      continue
    }
    uniq[uniq.findIndex((u) => u.text === h.text)].sites++
  }
  return { cap: uniq.length ? capName : null, hits: uniq }
}

// --- 字面量类键的候选：完整字面量集合里按相似度找改写后的新句子 ----------------------
// 阈值按词数分档：` · Sponsored by `（3 词）这种短键拿 Dice 比会把 `by word` 也报出来
// （共享一个 `by` 就有 0.5），所以短键要求更高的相似度。
function literalCandidates(key, literals) {
  const words = wordBag(key).length
  const threshold = words <= 3 ? 0.6 : 0.5
  const out = []
  for (const text of literals.keys()) {
    if (text === key) continue
    const s = dice(key, text)
    if (s >= threshold) out.push({ text, score: s })
  }
  out.sort((a, b) => b.score - a.score)
  const uniq = []
  const seen = new Set()
  for (const c of out) {
    if (seen.has(c.text)) continue
    seen.add(c.text)
    uniq.push(c)
    if (uniq.length >= MAX_CANDIDATES) break
  }
  return uniq
}

// --- 主流程 -----------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2)
  const opt = { limit: 12, quiet: false, write: false, pruneGone: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--quiet') opt.quiet = true
    else if (a === '--write') opt.write = true
    else if (a === '--prune-gone') opt.pruneGone = true
    else if (a === '--limit') opt.limit = Number(argv[++i])
    else if (['--ui', '--prev-ui', '--dict', '--electron', '--json'].includes(a)) opt[a.slice(2)] = argv[++i]
    else usage(`未知参数：${a}`)
  }
  if (!opt.ui) usage('--ui 必填（本版英文原版 bundle / ui 目录）')

  const dictPath = path.resolve(opt.dict || path.join(REPO, 'dict.json'))
  if (!fs.existsSync(dictPath)) usage(`找不到词典：${dictPath}`)
  const cur = resolveBundle(path.resolve(opt.ui))
  if (!cur) usage(`在 ${opt.ui} 下找不到主 bundle`)
  const prev = opt['prev-ui'] ? resolveBundle(path.resolve(opt['prev-ui'])) : null
  if (opt['prev-ui'] && !prev) usage(`在 ${opt['prev-ui']} 下找不到主 bundle`)

  const src = fs.readFileSync(cur, 'utf8')
  const prevSrc = prev ? fs.readFileSync(prev, 'utf8') : null
  const electronSrc = opt.electron ? collectElectron(path.resolve(opt.electron)) : null
  const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'))
  const literals = collectLiteralsFromSource(src)

  const rows = []
  let total = 0
  for (const zone of ZONES) {
    for (const [key, zh] of Object.entries(dict[zone] || {})) {
      total++
      if (src.includes(key)) continue
      const wasInPrev = prevSrc ? prevSrc.includes(key) : null
      const row = { zone, key, zh, wasInPrev, verdict: null, reason: '', candidates: [] }
      // 词典够不着主进程：该写进 patches/electron-*.patch，不是死词条（有 --electron 才查）
      if (electronSrc && electronSrc.some((f) => f.src.includes(key))) {
        row.verdict = 'MAIN'
        row.reason = `只在主进程出现（${electronSrc.filter((f) => f.src.includes(key)).map((f) => f.file).join(', ')}）：词典够不着，写进 patches/electron-*.patch`
        rows.push(row)
        continue
      }
      rows.push(row)
      if (zone === 'code') {
        const hits = locateFragment(key, src)
        if (hits.length === 1) {
          const synced = syncCodeZh(key, zh, hits[0].text)
          if (!synced.ok) {
            row.verdict = 'CONFIRM'
            row.reason = `片段骨架唯一命中，但译文无法自动同步：${synced.why}`
            row.candidates = [candOf(hits[0])]
          } else if (!hits[0].specific) {
            row.verdict = 'CONFIRM'
            row.reason = `片段骨架唯一命中，但稳定文本只有 ${hits[0].stableLen} 字符，太短的骨架会撞名，人工点头再写回`
            row.candidates = [candOf(hits[0])]
          } else {
            row.verdict = 'RELOCATE'
            row.newKey = hits[0].text
            row.newZh = synced.zh
            row.reason = '片段骨架唯一命中（minifier 只改了标识符名），译文里的名字已按位置同步'
          }
        } else if (hits.length > 1) {
          row.verdict = 'CONFIRM'
          row.reason = `片段骨架命中 ${hits.length} 种形态，选一处`
          row.candidates = hits.slice(0, MAX_CANDIDATES).map(candOf)
        } else {
          row.verdict = 'GONE'
          row.reason = '片段骨架在本版源码里找不到（上游删掉了这段代码）'
        }
        continue
      }
      if (key.includes('${')) {
        const { cap, hits } = templateCandidates(key, src)
        if (!hits.length) {
          row.verdict = 'GONE'
          row.reason = '固定段在本版 bundle 里找不到（正则捕获与固定段扫描都没命中）'
          continue
        }
        const keySlots = parseTemplate(key).filter((p) => p.t === 'expr').length
        const usable = hits.filter((h) => h.okExpr)
        const sameSlots = usable.filter((h) => h.caps.length === keySlots)
        const capName = cap === 'scan' ? '固定段扫描' : `${cap} 捕获`
        if (usable.length === 1) {
          const rebuilt = rebuildZh(key, zh, usable[0].text)
          if (rebuilt.ok) {
            row.verdict = 'RELOCATE'
            row.newKey = usable[0].text
            row.newZh = rebuilt.zh
            row.reason = `唯一候选（${capName}，插值 ${keySlots} → ${usable[0].caps.length}）`
          } else {
            row.verdict = 'CONFIRM'
            row.reason = `唯一候选但译文无法自动同步：${rebuilt.why}`
            row.candidates = [candOf(usable[0])]
          }
        } else if (sameSlots.length === 1) {
          const rebuilt = rebuildZh(key, zh, sameSlots[0].text)
          if (rebuilt.ok) {
            row.verdict = 'RELOCATE'
            row.newKey = sameSlots[0].text
            row.newZh = rebuilt.zh
            row.reason = `多候选里只有一处插值数相同（${keySlots} 处），其余候选形态不符（共 ${usable.length} 种形态）`
          } else {
            row.verdict = 'CONFIRM'
            row.reason = `多候选中插值数相同的只有一处，但译文无法自动同步：${rebuilt.why}`
            row.candidates = usable.slice(0, MAX_CANDIDATES).map(candOf)
          }
        } else {
          row.verdict = 'CONFIRM'
          row.reason = `${usable.length} 种候选且插值各不相同，选一条（${capName}）`
          row.candidates = usable.slice(0, MAX_CANDIDATES).map(candOf)
        }
        continue
      }
      // 字面量类（exact / pattern 与无插值的 template）
      const cands = literalCandidates(key, literals)
      if (!cands.length) {
        row.verdict = 'GONE'
        row.reason = '本版无相似度 ≥0.5 的字面量候选（上游下线或整句重写）'
      } else if (cands.length === 1 && cands[0].score >= 0.85) {
        row.verdict = 'CONFIRM'
        row.reason = `唯一近邻候选（相似度 ${cands[0].score.toFixed(2)}）：散文改写不自动写回，确认后照抄新键`
        row.candidates = cands
      } else {
        row.verdict = 'CONFIRM'
        row.reason = `${cands.length} 个近邻候选，按相似度排序`
        row.candidates = cands
      }
    }
  }

  const byVerdict = (v) => rows.filter((r) => r.verdict === v)
  const stale = rows.length
  if (!opt.quiet) {
    console.log(`重新定位：${path.basename(cur)}${prev ? `（上一版 ${path.basename(prev)}）` : ''}`)
    console.log(`  旧词条 ${total} 条 → 命中 ${total - stale} · 待定位 ${stale}`)
    if (prevSrc) {
      const notPrev = rows.filter((r) => r.wasInPrev === false).length
      if (notPrev) console.log(`  其中 ${notPrev} 条连上一版原版里也没有（可能是更早版本遗留的死词条）`)
    }
    console.log(`  可自动迁移 ${byVerdict('RELOCATE').length} · 需人工确认 ${byVerdict('CONFIRM').length}` +
      ` · 疑似下线 ${byVerdict('GONE').length}${electronSrc ? ` · 只在主进程 ${byVerdict('MAIN').length}` : ''}`)
  }

  const show = (v, title, hint) => {
    const list = byVerdict(v)
    if (!list.length) return
    console.log(`\n## ${title}（${list.length}）`)
    if (hint) console.log('   ' + hint)
    for (const r of list.slice(0, opt.limit)) {
      console.log(`   · [${r.zone}] ${JSON.stringify(r.key.length > 110 ? r.key.slice(0, 110) + '…' : r.key)}`)
      if (r.verdict === 'RELOCATE') console.log(`      → ${JSON.stringify(r.newKey.length > 110 ? r.newKey.slice(0, 110) + '…' : r.newKey)}`)
      console.log(`      ↳ ${r.reason}`)
      for (const c of (r.candidates || []).slice(0, MAX_CANDIDATES)) {
        const at = c.sites > 1 ? `，${c.sites} 处` : ''
        console.log(`        候选（${c.score.toFixed(2)}${at}）：${JSON.stringify(c.text.length > 110 ? c.text.slice(0, 110) + '…' : c.text)}`)
      }
    }
    if (list.length > opt.limit) console.log(`   … 其余 ${list.length - opt.limit} 条见 --limit`)
  }

  show('RELOCATE', '可自动迁移 RELOCATE', '--write 会写回这些（新键、新译文都过一遍自证）')
  show('CONFIRM', '需人工确认 CONFIRM', '按候选核对后手工改 dict.json（分类只看形态，去留由人定）')
  show('GONE', '疑似已下线 GONE', '--prune-gone 可一次删除（**先确认**不是改写成了别的句子）')
  if (electronSrc) show('MAIN', '词典够不着主进程 MAIN', '写进 patches/electron-*.patch，并从 dict.json 删掉')

  if (opt.json) {
    fs.writeFileSync(
      path.resolve(opt.json),
      JSON.stringify(
        rows.map((r) => ({ zone: r.zone, key: r.key, verdict: r.verdict, reason: r.reason, newKey: r.newKey || null, candidates: r.candidates })),
        null,
        2,
      ) + '\n',
    )
    console.log(`\n清单已写入 ${opt.json}`)
  }

  // --- 写回 ---------------------------------------------------------------------
  if (opt.write || opt.pruneGone) {
    let wrote = 0
    let pruned = 0
    for (const r of rows) {
      if (r.verdict !== 'RELOCATE') continue
      // 落笔前自证：新键必须能在本版 bundle 里逐字节命中（remap 的同级防线）
      if (!src.includes(r.newKey) && !src.includes('`' + r.newKey + '`')) {
        console.error(`ERROR: 拒绝写回 ${JSON.stringify(r.key)}：重建的新键在本版 bundle 里找不到`)
        process.exit(1)
      }
      delete dict[r.zone][r.newKey]
      delete dict[r.zone][r.key]
      dict[r.zone][r.newKey] = r.newZh
      wrote++
    }
    if (opt.pruneGone) {
      for (const r of byVerdict('GONE')) {
        delete dict[r.zone][r.key]
        pruned++
      }
    }
    fs.writeFileSync(dictPath, JSON.stringify(dict, null, 2) + '\n')
    console.log(`\n写了 ${dictPath}：迁移 ${wrote} 条${opt.pruneGone ? `，删除 ${pruned} 条` : ''}`)
  } else if (!opt.quiet) {
    console.log('\n（dry-run：加 --write 写回 RELOCATE，--prune-gone 一并删 GONE）')
  }

  const remain = rows.filter((r) => r.verdict === 'CONFIRM' || r.verdict === 'GONE' || (r.verdict === 'MAIN' && !opt.pruneGone))
  if (opt.write || opt.pruneGone) {
    // 写回后：RELOCATE 已迁、GONE 按 --prune-gone 删或不删。**没删的 GONE 仍是死词条**，
    // 与 MAIN 一样要人工表态——否则「--write 一下」就会把一堆没核对的 GONE 悄悄放行成 rc 0，
    // 与文件头「1 = 有 CONFIRM / GONE」的契约自相矛盾。
    const left = rows.filter(
      (r) => r.verdict === 'CONFIRM' || ((r.verdict === 'GONE' || r.verdict === 'MAIN') && !opt.pruneGone),
    )
    if (!left.length) {
      console.log('\n✓ 没有需要人工的条目了')
      process.exit(0)
    }
    const kinds = [...new Set(left.map((r) => r.verdict))].join(' / ')
    console.error(`\nERROR: 还有 ${left.length} 条需要人工处理（${kinds}）`)
    process.exit(1)
  }
  if (!remain.length) {
    console.log('\n✓ 所有够不着的旧词条都能自动定位')
    process.exit(0)
  }
  console.error(
    `\nERROR: ${remain.length} 条旧词条需要人工（可用 --write 自动迁移 RELOCATE` +
      `${byVerdict('GONE').length ? '，--prune-gone 删除确认过的 GONE' : ''}）`,
  )
  process.exit(1)
}

function collectElectron(dir) {
  if (!fs.existsSync(dir)) return []
  if (fs.statSync(dir).isFile()) dir = path.dirname(dir)
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(cjs|html)$/.test(f))
    .map((f) => ({ file: f, src: fs.readFileSync(path.join(dir, f), 'utf8') }))
}

if (require.main === module) main()
module.exports = {
  dice,
  codeIdents,
  fragmentPattern,
  locateFragment,
  syncCodeZh,
  rebuildZh,
  scanTemplateLiterals,
  templateCandidates,
  literalCandidates,
  skeletonWithMap,
}
