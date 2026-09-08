#!/usr/bin/env node
// Template 词典条目随 minifier 变量重命名自动迁移。
//
// 每个新版本 bundle 里，模板字面量的插值表达式变量名会被重排（如 ${Mq(t.cost,e)} → ${Dq(t.cost,e)}），
// 词典 key 必须逐字节一致才能命中。本工具在新 bundle 上按**英文锚文本**定位同一模板字符串，
// 捕获当前版本的实际插值表达式，替换进 key 与译文，避免每版手工逐一核对。
//
// 用法：node tools/remap.js <bundle.js> [--dict <dict.json>] [--write]
//   默认 dry-run，只打印报告；--write 才会写回词典。
// 状态分类：
//   SAME       原 key 在 bundle 中逐字节存在（无需迁移）
//   RENAMED    仅插值表达式变化，已按锚文本捕获并回填（--write 时写入）
//   AMBIGUOUS  锚文本命中多处且形态不一 / 占位符无法可靠对应（保留人工处理）
//   MISSING    英文锚文本在 bundle 中找不到（词条可能过期；构建后的 MISSED 流程负责）
const fs = require('fs')
const path = require('path')

const REPO = path.join(__dirname, '..')

// --- 参数 ---------------------------------------------------------------------
const argv = process.argv.slice(2)
const bundleFile = argv.find((a) => !a.startsWith('--'))
let dictPath = path.join(REPO, 'dict.json')
let write = false
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dict') dictPath = argv[++i]
  if (argv[i] === '--write') write = true
}
if (!bundleFile) {
  console.error('usage: node tools/remap.js <bundle.js> [--dict <dict.json>] [--write]')
  process.exit(1)
}
if (!fs.existsSync(bundleFile)) {
  console.error(`ERROR: 找不到 bundle：${bundleFile}`)
  process.exit(1)
}

// --- 模板字面量解析：把 `固定${expr}固定…` 切成 lit/expr 交错段 --------------------
// 逐字符扫描，尊重引号字符串与嵌套花括号；不做完整 JS 语法分析（minified 表达式足够规整）。
function parseTemplate(s) {
  const parts = []
  let lit = ''
  let i = 0
  const pushLit = () => {
    if (lit !== '') parts.push({ t: 'lit', v: lit })
    lit = ''
  }
  while (i < s.length) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 1
      let j = i + 2
      let q = null // 当前处于哪种引号内
      while (j < s.length && depth > 0) {
        const c = s[j]
        if (q) {
          if (c === '\\') j++
          else if (c === q) q = null
        } else if (c === '"' || c === "'" || c === '`') {
          q = c
        } else if (c === '{') depth++
        else if (c === '}') depth--
        j++
      }
      if (depth !== 0) return null // 花括号不闭合
      pushLit()
      parts.push({ t: 'expr', v: s.slice(i + 2, j - 1) })
      i = j
    } else {
      lit += s[i]
      i++
    }
  }
  pushLit()
  return parts
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 捕获到的表达式必须括号平衡且不含反引号，否则认为边界切错了
function balancedExpr(e) {
  if (!e || e.length > 300 || e.includes('`')) return false
  let d = 0
  let q = null
  for (let k = 0; k < e.length; k++) {
    const c = e[k]
    if (q) {
      if (c === '\\') k++
      else if (c === q) q = null
    } else if (c === '"' || c === "'") q = c
    else if (c === '(' || c === '{' || c === '[') d++
    else if (c === ')' || c === '}' || c === ']') d--
    if (d < 0) return false
  }
  return d === 0
}

// --- 载入 ----------------------------------------------------------------------
const src = fs.readFileSync(bundleFile, 'utf8')
const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'))
if (!dict.template || typeof dict.template !== 'object') {
  console.error('ERROR: dict.json 缺少 template 分区')
  process.exit(1)
}

const stats = { SAME: [], RENAMED: [], AMBIGUOUS: [], MISSING: [] }

for (const [key, zh] of Object.entries(dict.template)) {
  if (src.includes('`' + key + '`')) {
    stats.SAME.push(key)
    continue
  }
  const keyParts = parseTemplate(key)
  const zhParts = typeof zh === 'string' ? parseTemplate(zh) : null
  const keyExprs = keyParts ? keyParts.filter((p) => p.t === 'expr').map((p) => p.v) : []
  if (!keyParts || !zhParts || keyExprs.length === 0) {
    // 无插值的纯字面量无需迁移——命不中就是词条过期
    stats.MISSING.push(key)
    continue
  }

  // 构造正则：固定段按字面匹配，插值段用捕获组。先用「点号链 + 可选调用」的严格形态，
  // 整体命不中再退化为惰性捕获。惰性捕获不能含反引号——否则会跨越其它模板字面量
  // 吞进大段无关代码（捕获校验会拦下，但会漏掉真身）。
  const mk = (cap) =>
    new RegExp(
      '`' + keyParts.map((p) => (p.t === 'lit' ? escRe(p.v) : '(' + cap + ')')).join('') + '`',
      'g',
    )
  const STRICT_CAP =
    '[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*(?:\\([^`]{0,200}?\\))?'
  const LAZY_CAP = '[^`]{0,400}?'
  let re = mk(STRICT_CAP)
  if (!re.test(src)) re = mk(LAZY_CAP)
  re.lastIndex = 0

  const matches = []
  let m
  while ((m = re.exec(src)) !== null && matches.length < 6) {
    matches.push(m)
    if (m.index === re.lastIndex) re.lastIndex++ // 零宽匹配保险
  }
  if (matches.length === 0) {
    stats.MISSING.push(key)
    continue
  }
  // 多处命中但插值完全一致也算唯一；不一致就不敢猜
  const caps = matches.map((mm) => mm.slice(1))
  if (new Set(caps.map((c) => c.join('\u0000'))).size > 1) {
    stats.AMBIGUOUS.push([key, `锚文本在 bundle 命中 ${matches.length} 处且插值不一致`])
    continue
  }
  const newExprs = caps[0]
  if (!newExprs.every(balancedExpr)) {
    stats.AMBIGUOUS.push([key, '捕获到的表达式括号不平衡，边界可能切错'])
    continue
  }

  // 建立 old → new 映射。
  // 数量一致：按位一一对应（最常见的纯改名情形）。
  // 数量不一致：中文吸收了部分占位符（如复数条件）。仍按 EN 锚文本里的出现顺序对齐：
  //   第 k 个「仍在译文中出现」的旧表达式 ← 第 k 个新捕获。对不上则放弃交人工。
  const mapping = new Map()
  let safe = true
  if (keyExprs.length === newExprs.length) {
    keyExprs.forEach((o, idx) => mapping.set(o, newExprs[idx]))
  } else {
    let k = 0
    for (const o of keyExprs) {
      if (zh.includes(o)) {
        if (k >= newExprs.length) {
          safe = false
          break
        }
        mapping.set(o, newExprs[k])
      }
      k++
    }
  }
  for (const o of keyExprs) {
    if (zh.includes(o) && !mapping.has(o)) {
      safe = false
      break
    }
  }
  if (!safe || mapping.size === 0) {
    stats.AMBIGUOUS.push([
      key,
      `插值数不齐（key ${keyExprs.length} 处 vs bundle ${newExprs.length} 处）且无法顺序对齐`,
    ])
    continue
  }

  const rebuild = (parts) => parts.map((p) => ({ t: p.t, v: p.t === 'expr' ? mapping.get(p.v) ?? p.v : p.v }))
  const newKey = rebuild(keyParts).map((p) => p.v).join('')
  const newZh = rebuild(zhParts).map((p) => p.v).join('')
  // 落笔前自证：重建的新 key 必须能在 bundle 里逐字节命中，绝不把词典改坏
  if (!src.includes('`' + newKey + '`')) {
    stats.AMBIGUOUS.push([key, `重建的新 key 无法逐字节命中 bundle:\n      ↳ ${JSON.stringify(newKey)}`])
    continue
  }
  // 结构自证：新 key 的插值槽数必须与原 key 一致。锚文本正则若命中无关的普通
  // 字符串（捕获值没有 ${} 包装，如 `development: true`），重建出的 newKey 会丢
  // 插值槽——这种"改名"是假的，降级 AMBIGUOUS 交人工，绝不写回词典。
  const nkExprCount = (parseTemplate(newKey) || []).filter((p) => p.t === 'expr').length
  if (nkExprCount !== keyExprs.length) {
    stats.AMBIGUOUS.push([
      key,
      `重建的新 key 插值槽数与原 key 不一致（${keyExprs.length} → ${nkExprCount}），锚文本疑似命中无关字符串:\n      ↳ ${JSON.stringify(newKey)}`,
    ])
    continue
  }
  stats.RENAMED.push([key, newKey, newZh])
}

// --- 报告 ----------------------------------------------------------------------
const short = (s, n = 72) => JSON.stringify(s == null ? '(空)' : s.length > n ? s.slice(0, n) + '…' : s)
console.log(`template 条目共 ${Object.keys(dict.template).length}`)
console.log(`  SAME       ${stats.SAME.length}`)
console.log(`  RENAMED    ${stats.RENAMED.length}${write ? '' : '   （dry-run，加 --write 写回）'}`)
console.log(`  AMBIGUOUS  ${stats.AMBIGUOUS.length}`)
console.log(`  MISSING    ${stats.MISSING.length}`)

if (stats.RENAMED.length) {
  console.log('\nRENAMED 明细:')
  for (const [k, nk] of stats.RENAMED) {
    const kp = parseTemplate(k).filter((p) => p.t === 'expr').map((p) => p.v)
    const nkp = (parseTemplate(nk) || []).filter((p) => p.t === 'expr').map((p) => p.v)
    const diff = kp
      .map((e, i) =>
        e !== nkp[i] ? `${short(e, 40)} → ${nkp[i] === undefined ? '(插值消失)' : short(nkp[i], 40)}` : null,
      )
      .filter(Boolean)
    console.log(`  · ${diff.join(' ; ') || '(插值未变，仅修正了其它内容)'}`)
  }
}
if (stats.AMBIGUOUS.length) {
  console.log('\nAMBIGUOUS 明细（需人工核对，未改动）:')
  for (const [k, why] of stats.AMBIGUOUS) console.log(`  · ${short(k, 60)}\n      ↳ ${why}`)
}
if (stats.MISSING.length) {
  console.log('\nMISSING 明细（英文锚文本不在该 bundle，交由构建后 MISSED 流程）:')
  for (const k of stats.MISSING) console.log(`  · ${short(k, 90)}`)
}

// --- 写回 ----------------------------------------------------------------------
if (write) {
  if (stats.RENAMED.length) {
    for (const [k, nk, nz] of stats.RENAMED) {
      delete dict.template[nk] // 新旧同形时防止残留
      delete dict.template[k]
      dict.template[nk] = nz
    }
    fs.writeFileSync(dictPath, JSON.stringify(dict, null, 2) + '\n')
    console.log(`\nwrote ${dictPath}（${stats.RENAMED.length} 条已迁移，其余分区与顺序不受影响）`)
  } else {
    console.log('\n--write 给出但 RENAMED 为 0，文件未动。')
  }
}
