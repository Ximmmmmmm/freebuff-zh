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
//
// 「半截模板」键：外层模板里内嵌模板的三元写法
//   `… wallet.${fe?` ${fe.tooltip}`:""}`
// 为了只翻固定段，词典里会存一条**以未闭合的 `${…` 结尾**的键
//   `… wallet.${fe?`   （apply.js 把它连着后面那个反引号一起匹配）
// 这种键没有闭合花括号，旧实现直接判为不可解析→永远 MISSING，只能人工把变量名抄一遍
// （0.0.104 适配时就是这么发现的 4 条）。现在尾部残余记成 partial 表达式：匹配时发成
// `\$\{` + 尾巴捕获（到反引号/右花括号为止）+ 收尾反引号，重建 key 与译文时同样回填，
// 因此它和普通模板一样能自动跟进 minifier 改名。
//
// 译文自己的写法变体：译文允许改写插值内部的字符串常量（`${r.title||"new thread"}` →
// `${r.title||"新会话"}`，lint_dict 的 E3 按骨架放行），这类插值不在 key 的插值表里。
// 重建时按**骨架**找到对应的原插值、只把标识符换掉，并补回 `${…}` 外壳——旧实现回退
// 写回原文本时会把外壳一起丢掉（写坏词典）。另外两道自证：重建后译文的插值槽数不得变化、
// 每个槽都要能按骨架对应到新 key，否则列为 AMBIGUOUS 拒绝写回。
// 自测：node tools/test_remap.js（合成变量改名的 bundle，CI 会跑）。
const fs = require('fs')
const path = require('path')
// 模板解析 / 骨架 / 标识符改名这几位是与 resituate.js 共用的底层（口径必须一致，
// 否则两个工具会对同一条词条给出互相矛盾的结论），统一放在 literal_skeleton.js。
const {
  parseTemplate,
  skeletonOf,
  idents,
  renameTo,
  innerOf,
  balancedExpr,
  templateRegex,
  STRICT_CAP,
  BALANCED_CAP,
  LAZY_CAP,
} = require('./literal_skeleton.js')

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

  // 构造正则：固定段按字面匹配，插值段用捕获组（三种形态从严到宽，第一个能在 bundle 里
  // 命中的胜出——细节见 literal_skeleton.js 的 templateRegex 注释）。
  // `${` / `}` 必须包进捕获组：捕获值会直接回填成新 key/译文的插值文本。少了外壳，
  // 重建出的 key 会丢插值槽（下面的「插值槽数」自证能拦下，但那只是事后兜底）；
  // 更要紧的是，外壳同时把边界钉死——否则相邻插值（`${a}${b}`）会被惰性捕获切错，
  // 切出来的片段括号不平衡，整条词条只能降级 AMBIGUOUS 交人工（0.0.131 适配时实测）。
  let re = null
  for (const cap of [STRICT_CAP, BALANCED_CAP, LAZY_CAP]) {
    const cand = templateRegex(key, cap)
    if (cand && cand.test(src)) {
      re = cand
      break
    }
  }
  // 三种都没命中也要按懒捕获再走一遍：交给下面 matches.length === 0 → MISSING，
  // 而不是在这里静默跳过（否则「命不中」和「没检查」就分不出来了）。
  if (!re) re = templateRegex(key, LAZY_CAP)
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
  // 半截模板的尾巴是「`${条件?`」这种未闭合形态，不能用 balancedExpr（花括号本来就不合
  // ），单独按尾巴形态校验；其余插值照旧要求括号平衡。
  const partialTail = keyParts[keyParts.length - 1].partial === true
  const headExprs = partialTail ? newExprs.slice(0, -1) : newExprs
  if (!headExprs.every(balancedExpr)) {
    stats.AMBIGUOUS.push([key, '捕获到的表达式括号不平衡，边界可能切错'])
    continue
  }
  if (partialTail && !/^\$\{[^`}]{1,200}$/.test(newExprs[newExprs.length - 1])) {
    stats.AMBIGUOUS.push([
      key,
      '半截模板尾巴捕获异常（预期形如 "${条件?"）：\n      ↳ ' +
        JSON.stringify(newExprs[newExprs.length - 1]),
    ])
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

  // 已映射的插值直接用捕获到的新表达式（捕获值自带 `${…}` 外壳）；
  // 没映射上的（译文自己的写法变体）按骨架找到对应插值、只换标识符，并补回外壳——
  // 旧实现直接原样写回 `p.v`，会把 `${` 与 `}` 一起丢掉，把译文改坏。
  const rebuild = (parts) =>
    parts.map((p) => {
      if (p.t !== 'expr') return { t: 'lit', v: p.v }
      const hit = mapping.get(p.v)
      if (hit) return { t: 'expr', v: hit }
      const sk = skeletonOf(p.v)
      for (const [o, n] of mapping) {
        if (skeletonOf(o) !== sk) continue
        const renamed = renameTo(p.v, idents(innerOf(n)).map((t) => t.name))
        if (renamed !== null) return { t: 'expr', v: '${' + renamed + (p.partial ? '' : '}') }
      }
      return { t: 'expr', v: '${' + p.v + (p.partial ? '' : '}') }
    })
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
  // 译文自证：插值槽数不能变（中文吸收复数占位符属正常，增减则一定是重建出错），
  // 且每个槽都能按骨架对应到新 key 的插值。对不上宁可不写，交人工。
  const zhSlots = (parseTemplate(newZh) || []).filter((p) => p.t === 'expr')
  const oldZhSlots = zhParts.filter((p) => p.t === 'expr')
  if (zhSlots.length !== oldZhSlots.length) {
    stats.AMBIGUOUS.push([
      key,
      `重建的译文插值槽数变化（${oldZhSlots.length} → ${zhSlots.length}），拒绝写回`,
    ])
    continue
  }
  const nkSkel = (parseTemplate(newKey) || []).filter((p) => p.t === 'expr').map((p) => skeletonOf(p.v))
  const orphan = zhSlots.find((p) => !nkSkel.includes(skeletonOf(p.v)))
  if (orphan) {
    stats.AMBIGUOUS.push([
      key,
      `译文的插值 ${JSON.stringify(orphan.v)} 无法与新 key 对齐（骨架不匹配），拒绝写回`,
    ])
    continue
  }
  if (
    partialTail &&
    (newZh.match(/\$\{[^}]*$/) || [])[0] !== (newKey.match(/\$\{[^}]*$/) || [])[0]
  ) {
    stats.AMBIGUOUS.push([key, '重建后译文与 key 的半截尾巴不一致（apply.js 会拼断模板），拒绝写回'])
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
    const partial = (parseTemplate(k) || []).some((p) => p.partial)
    const diff = kp
      .map((e, i) =>
        e !== nkp[i] ? `${short(e, 40)} → ${nkp[i] === undefined ? '(插值消失)' : short(nkp[i], 40)}` : null,
      )
      .filter(Boolean)
    console.log(
      `  · ${diff.join(' ; ') || '(插值未变，仅修正了其它内容)'}${partial ? '  [半截模板]' : ''}`,
    )
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
