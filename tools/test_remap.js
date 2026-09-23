#!/usr/bin/env node
// remap / lint_dict 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 为什么需要它：词典键必须与 bundle 逐字节一致，而 minifier 每次发版都会改变量名——
// 迁移逻辑一旦悄悄退化，表现是「版本更新后某几句变回英文」，而 build.sh 依旧全绿
// （词条失配后会以 MISSING/MISSED 的形式被补掉或放过）。这里用 dict.json 里的真实词条
// 合成一份「变量改名」的假 bundle，断言 remap 能把它们迁移过去、lint 能拦住坏词条。
//
// 覆盖：
//   1. 普通 template 词条：改名后 RENAMED、译文插值同步、新 key 命中假 bundle；
//   2. 「半截模板」词条（以未闭合 `${条件?` 结尾的嵌套模板写法）：改名后同样 RENAMED，
//      且译文尾巴与 key 逐字节一致；
//   3. 未改名的 bundle：全部落 SAME（不允许误判 MISSING/AMBIGUOUS）；
//   4. 迁移后的词典必须过 lint_dict；
//   5. lint_dict 的 E5 负面用例：未登记的半截键 / 译文尾巴不一致 / 放进 exact 分区，均须 exit 1；
//   6. 同一锚文本在 bundle 里有**两份拷贝**：插值一致时照旧迁移，插值名不一致时必须拒绝
//      写回、列进 AMBIGUOUS 明细（猜一份写下去＝另一份静默退回英文，而构建依旧全绿）；
//   7. AMBIGUOUS 的**每一条**退出路径：能触发的都配夹具并断言「词典一个字节都没动」
//      （只断开退出码不够——真正的伤害是写坏词典），构造上不可达的三条写清理由，
//      另配「形似但应放行」的边界夹具，钉住它们不会被误拦。
//
// 用法：node tools/test_remap.js        # 退出码非 0 表示回归
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const dictPath = path.join(REPO, 'dict.json')
const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'))

const WORK = path.join(REPO, 'work', 'test-remap')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })
const bundlePath = path.join(WORK, 'fake-bundle.js')

const KEYWORDS = new Set([
  'void', 'null', 'true', 'false', 'return', 'if', 'else', 'typeof', 'new', 'in', 'of', 'undefined', 'this',
])
// 与 remap.js 的 parseTemplate 同样的切分口径（含末尾未闭合的半截段）
const EXPR = /\$\{(?:[^{}]|\{[^{}]*\})*\}|\$\{[^}]*$/g
const exprList = (s) => s.match(EXPR) || []
const isTruncated = (k) => /\$\{[^}]*$/.test(k)
// 自测自己的切分能力：`${` 的个数必须与切分结果一致（更深的嵌套不选来当样本，避免测错对象）
const countable = (s) => exprList(s).length === (s.match(/\$\{/g) || []).length
const noBacktick = (s) => !s.includes('`')
const skeleton = (s) => s.replace(EXPR, '\u0000')
// 与 remap.js / lint_dict.js 同口径的表达式骨架（抹掉字符串字面量）
const skel = (e) => e.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '\u0001')

// --- 选样本 ---------------------------------------------------------------------
//   · 半截模板词条：全部纳入（以未闭合 `${条件?` 结尾的嵌套模板写法）
//   · 「译文写法变体」词条：译文插值改写了内部字符串常量（`${r.title||"新会话"}`），
//     不在 key 的插值表里 —— 旧实现会把 `${}` 外壳写丢，必须显式盯住
//   · 其余普通 template 词条：补到 6 条
// 共同前提：切分可数、不含反引号、插值非空、骨架彼此不撞（撞了会互相抢锚点）
const truncated = Object.keys(dict.template).filter(isTruncated)
const eligible = []
for (const [k, v] of Object.entries(dict.template)) {
  if (isTruncated(k)) continue
  if (!noBacktick(k) || !noBacktick(v) || !countable(k) || !countable(v)) continue
  if (exprList(k).length === 0) continue
  const kx = exprList(k)
  eligible.push({ k, variant: exprList(v).some((e) => !kx.includes(e)) })
}
const seen = new Set(truncated.map(skeleton))
const plain = []
for (const group of [eligible.filter((e) => e.variant), eligible.filter((e) => !e.variant).slice(0, 6)]) {
  for (const { k } of group) {
    const sk = skeleton(k)
    if (seen.has(sk)) continue
    seen.add(sk)
    plain.push(k)
  }
}
const samples = [...plain, ...truncated]
if (truncated.length === 0) {
  console.error('FAIL: dict.json 里没有「半截模板」词条——这本身异常（0.0.104 起有 4 条）')
  process.exit(1)
}
if (plain.length === 0) {
  console.error('FAIL: 选不出可测的普通 template 词条')
  process.exit(1)
}

// --- 合成「下一版 minifier 改了变量名」的 bundle ---------------------------------
function renameKey(k, tag) {
  let idx = 0
  return k.replace(EXPR, (m) => {
    const partial = !m.endsWith('}')
    const inner = partial ? m.slice(2) : m.slice(2, -1)
    const map = new Map()
    const renamed = inner.replace(/[A-Za-z_$][\w$]*/g, (t) => {
      if (KEYWORDS.has(t)) return t
      if (map.has(t)) return map.get(t)
      const name = `q${tag}_${idx}_${t}`
      map.set(t, name)
      return name
    })
    idx++
    return '${' + renamed + (partial ? '' : '}')
  })
}

const renamed = samples.map((k, i) => [k, renameKey(k, i)])
const writeBundle = (pairs) =>
  fs.writeFileSync(bundlePath, pairs.map(([, k], i) => `var t${i}=\`${k}\`;`).join('\n'))

// 除 template 外放占位词条：lint_dict 的逐行解析要求分区有内容才能序列化成多行
const PLACEHOLDER = {
  exact: { __placeholder__: '占位' },
  template: {},
  code: { __placeholder__: '' },
  pattern: { __placeholder__: '占位' },
}
const tmpDict = JSON.parse(JSON.stringify(PLACEHOLDER))
for (const [k] of renamed) tmpDict.template[k] = dict.template[k]
const tmpDictPath = path.join(WORK, 'dict.json')
const dictText = JSON.stringify(tmpDict, null, 2) + '\n'
fs.writeFileSync(tmpDictPath, dictText)
fs.writeFileSync(path.join(WORK, 'dict-unchanged.json'), dictText)

const node = (args) => {
  try {
    return { code: 0, out: execFileSync('node', args, { encoding: 'utf8' }) }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}
const remap = (dictFile, extra = []) =>
  node([path.join(REPO, 'tools', 'remap.js'), bundlePath, '--dict', dictFile, ...extra])
const lint = (dictFile) => node([path.join(REPO, 'tools', 'lint_dict.js'), dictFile])

let fail = 0
const chk = (ok, msg) => {
  console.log((ok ? '  ok  ' : '  FAIL ') + msg)
  if (!ok) fail++
}
const count = (re, s) => Number((s.match(re) || [])[1])

// --- 1) 改名后的 bundle：必须全部自动迁移 -----------------------------------------
console.log(`样本：普通 template ${plain.length} 条 + 半截模板 ${truncated.length} 条\n`)
writeBundle(renamed)
const r1 = remap(tmpDictPath, ['--write'])
console.log(r1.out.trim().split('\n').slice(0, 5).join('\n') + '\n')
chk(count(/RENAMED\s+(\d+)/, r1.out) === samples.length, `RENAMED = ${samples.length}`)
chk(count(/AMBIGUOUS\s+(\d+)/, r1.out) === 0, 'AMBIGUOUS = 0')
chk(count(/MISSING\s+(\d+)/, r1.out) === 0, 'MISSING = 0')

const migrated = JSON.parse(fs.readFileSync(tmpDictPath, 'utf8')).template
for (const [k, nk] of renamed) {
  const tag = isTruncated(k) ? '[半截模板]' : '[普通]'
  chk(Object.prototype.hasOwnProperty.call(migrated, nk), `${tag} 新 key 已写回 ${JSON.stringify(nk.slice(-26))}`)
  chk(!Object.prototype.hasOwnProperty.call(migrated, k), `${tag} 旧 key 已移除`)
  const zh = migrated[nk] || ''
  const keyTail = (nk.match(/\$\{[^}]*$/) || [])[0]
  if (isTruncated(nk)) chk((zh.match(/\$\{[^}]*$/) || [])[0] === keyTail, `${tag} 译文尾巴与 key 一致 ${JSON.stringify(keyTail)}`)
  // 译文的插值槽数由译文自己决定（中文常吸收复数占位符），迁移只是改名，不允许增减
  const oldZh = dict.template[k]
  chk(exprList(zh).length === exprList(oldZh).length, `${tag} 译文插值槽数未变（${exprList(oldZh).length}）`)
  // 译文插值允许改写内部的字符串常量（如 ${r.title||"新会话"}），按骨架对齐即可；
  // 且 `${` 外壳不能被迁移吞掉（旧实现会丢，把译文改坏）
  const kSkel = exprList(nk).map(skel)
  chk(exprList(zh).every((e) => kSkel.includes(skel(e))), `${tag} 译文插值按骨架对齐到新 key`)
  chk((zh.match(/\$\{/g) || []).length === (oldZh.match(/\$\{/g) || []).length, `${tag} 译文插值外壳完整（${(oldZh.match(/\$\{/g) || []).length} 个）`)
  chk(zh !== dict.template[k], `${tag} 译文确实随变量名迁移`)
}

// --- 2) 迁移结果必须过 lint -------------------------------------------------------
const l1 = lint(tmpDictPath)
chk(l1.code === 0 && /lint 通过/.test(l1.out), '迁移后的词典过 lint_dict')

// --- 3) 未改名的 bundle：全部 SAME，不允许误判 ------------------------------------
writeBundle(samples.map((k) => [k, k]))
const r2 = remap(path.join(WORK, 'dict-unchanged.json'))
chk(count(/SAME\s+(\d+)/, r2.out) === samples.length, `未改名时全部 SAME（${samples.length}）`)
chk(count(/MISSING\s+(\d+)/, r2.out) === 0, '未改名时 MISSING = 0')

// --- 3.5) 捕获形态：相邻插值 / 全插值骨架必须能自动迁移 -----------------------------
// 老实现只有一条「不跨反引号的惰性捕获」兜底（strict 那版忘了包 `${…}` 外壳，永远命不中）：
// 相邻插值 `\${a}\${b}` 会被从中间切开，切出的片段括号不平衡 → 整条词条降级 AMBIGUOUS 交人工；
// 骨架里没有锚文本（整条都是插值）时必然如此。这类词条在真实 bundle 里遇到 minifier 改名
// 就会退回英文，所以钉死它们能自动迁移。
const SHAPES = [
  '${aa}${bb?">":"<"}',
  'Selected output (${JSON.stringify(obj.cwd)}${tail}):',
  '${p}${q}',
]
for (const [i, k] of SHAPES.entries()) {
  const nk = renameKey(k, 90 + i)
  const b = path.join(WORK, `shape-${i}.js`)
  fs.writeFileSync(b, `var s${i}=\`${nk}\`;\n`)
  const d = path.join(WORK, `shape-${i}.json`)
  fs.writeFileSync(
    d,
    JSON.stringify(
      { exact: { __placeholder__: '占位' }, template: { [k]: `译文${i}` }, code: { __placeholder__: '' }, pattern: { __placeholder__: '占位' } },
      null,
      2,
    ) + '\n',
  )
  const r = node([path.join(REPO, 'tools', 'remap.js'), b, '--dict', d, '--write'])
  const nRen = count(/RENAMED\s+(\d+)/, r.out)
  const nAmb = count(/AMBIGUOUS\s+(\d+)/, r.out)
  chk(nRen === 1 && nAmb === 0, `捕获形态 ${JSON.stringify(k.slice(0, 32))} → RENAMED ${nRen} / AMBIGUOUS ${nAmb}`)
  if (nRen === 1) {
    const migrated = JSON.parse(fs.readFileSync(d, 'utf8')).template
    chk(Object.prototype.hasOwnProperty.call(migrated, nk), '  新 key 已写回且与 bundle 逐字节一致')
  }
}

// --- 3.6) 同一锚文本有两份拷贝：插值一致照旧迁移，不一致必须拒绝写回 --------------------
// 真实来历：0.0.134 上游把侧栏那批组件在 bundle 里**重复打进了一份**（两份的压缩短名不同），
// 于是 `Dismiss notification: ${…}` 这类句子各有两种形态；两份插值**一致**时按唯一定位迁移
// 是对的（0.0.134 就是这么过的），而 0.0.136 两份又各自改了名（`l` / `S`），捕获结果不再一致
// ——映射到哪一份都不确定，remap 必须拒绝写回、列进 AMBIGUOUS 交人工，不能猜一个写下去：
// 猜错的那份会默默退回英文，而 build.sh 照旧 `all keys matched`（最容易漏掉的一类静默回归）。
//
// 注意这里测的是「同锚文本 + 插值不一致」，而不是「只要有两份拷贝就报歧义」——
// 后者会把 0.0.134 那种正常情形也误判成需要人工。
const dupKey = 'Report a problem: ${aa.message}'
const dupZh = '报告问题：${aa.message}'
const dupDictText = (extra) =>
  JSON.stringify(
    {
      exact: { __placeholder__: '占位' },
      template: { ...extra },
      code: { __placeholder__: '' },
      pattern: { __placeholder__: '占位' },
    },
    null,
    2,
  ) + '\n'

// 3.6a 两份拷贝的插值**一致**（只是短名整体改名）→ 照旧自动迁移
{
  const d = path.join(WORK, 'dup-consistent.json')
  fs.writeFileSync(d, dupDictText({ [dupKey]: dupZh }))
  const b = path.join(WORK, 'dup-consistent.js')
  fs.writeFileSync(b, 'var c0=`Report a problem: ${bb.message}`;\nvar c1=`Report a problem: ${bb.message}`;\n')
  const r = node([path.join(REPO, 'tools', 'remap.js'), b, '--dict', d, '--write'])
  const nRen = count(/RENAMED\s+(\d+)/, r.out)
  const nAmb = count(/AMBIGUOUS\s+(\d+)/, r.out)
  chk(nRen === 1 && nAmb === 0, `两份拷贝插值一致 → RENAMED ${nRen} / AMBIGUOUS ${nAmb}`)
  const migrated = JSON.parse(fs.readFileSync(d, 'utf8')).template
  chk(
    Object.prototype.hasOwnProperty.call(migrated, 'Report a problem: ${bb.message}'),
    '  已迁移到两份拷贝共有的形态（不是只写其中一份）',
  )
}

// 3.6b 两份拷贝的插值**不一致** → 必须拒绝写回，并在歧义明细里点名
{
  const d = path.join(WORK, 'dup-divergent.json')
  const before = dupDictText({ [dupKey]: dupZh })
  fs.writeFileSync(d, before)
  const b = path.join(WORK, 'dup-divergent.js')
  fs.writeFileSync(b, 'var d0=`Report a problem: ${bb.message}`;\nvar d1=`Report a problem: ${cc.message}`;\n')
  const r = node([path.join(REPO, 'tools', 'remap.js'), b, '--dict', d, '--write'])
  const nRen = count(/RENAMED\s+(\d+)/, r.out)
  const nAmb = count(/AMBIGUOUS\s+(\d+)/, r.out)
  chk(nRen === 0, `两份拷贝插值不一致 → RENAMED = 0（实际 ${nRen}）`)
  chk(nAmb === 1, `  该词条落 AMBIGUOUS（实际 ${nAmb}）`)
  chk(/锚文本在 bundle 命中 2 处且插值不一致/.test(r.out), '  歧义明细点名「命中 2 处且插值不一致」')
  chk(/Report a problem: \$\{aa\.message\}/.test(r.out), '  歧义明细里列的是原 key（人工照着它改）')
  chk(fs.readFileSync(d, 'utf8') === before, '  词典文件一个字节都没动（拒绝写回）')
}

// --- 3.7) AMBIGUOUS 的每一条退出路径 ------------------------------------------------
// AMBIGUOUS 是 remap 唯一的「拒绝写回」表态（宁可交人工，也不猜着改词典），每条退出路径
// 都对应一种具体的不确定。全 9 条（按 remap.js 里 AMBIGUOUS.push 的出现顺序；括号里是覆盖
// 它的夹具）：
//   1. 锚文本在 bundle 命中 N 处且插值不一致 ......... 3.6b（同锚两份拷贝、插值各自改名）
//   2. 捕获到的表达式括号不平衡，边界可能切错 ........ P2 ×2
//   3. 半截模板尾巴捕获异常 ......................... 构造上不可达（见下）
//   4. 插值数不齐且无法顺序对齐 ..................... 构造上不可达（见下）
//   5. 重建的新 key 无法逐字节命中 bundle ........... P5
//   6. 重建的新 key 插值槽数与原 key 不一致 ......... 构造上不可达（见下）
//   7. 重建的译文插值槽数变化 ....................... P7
//   8. 译文的插值无法与新 key 对齐（骨架不匹配）..... P8
//   9. 重建后译文与 key 的半截尾巴不一致 ............ P9
//
// 三条「构造上不可达」是被捕获构造排除的，不是漏测——它们是对**旧实现**的防御，现在的
// 正则构造已经让它们不可能成立（写清楚而不是拿假夹具凑数，免得下次维护时误以为覆盖够了）：
//   · 第 3 条：尾巴的捕获组本身就是 `(\$\{[^`}]{1,200})`，与那句校验正则同形，永远通过；
//     「尾巴连一个字符都捕获不到」的形态会整体命不中 → 落 MISSING（下面有边界夹具钉住）；
//   · 第 4 条：mk() 给 key 的**每个**插值各生成一个捕获组，于是 keyExprs.length 与
//     newExprs.length 恒等，那个「数不齐」分支进不去；
//   · 第 6 条：捕获值自带 `${…}` 外壳、且 parseTemplate 只在顶层数 `${`，重建出的 newKey
//     插值槽数恒等于原 key——只有旧实现（捕获忘了包外壳）才可能丢槽。
const remapCase = (label, { key, zh, src, expect, reason }) => {
  const n = remapCase.n++
  const b = path.join(WORK, `amb-${n}.js`)
  const d = path.join(WORK, `amb-${n}.json`)
  fs.writeFileSync(b, src)
  const text =
    JSON.stringify(
      {
        exact: { __placeholder__: '占位' },
        template: { [key]: zh },
        code: { __placeholder__: '' },
        pattern: { __placeholder__: '占位' },
      },
      null,
      2,
    ) + '\n'
  fs.writeFileSync(d, text)
  const r = node([path.join(REPO, 'tools', 'remap.js'), b, '--dict', d, '--write'])
  const nRen = count(/RENAMED\s+(\d+)/, r.out)
  const nAmb = count(/AMBIGUOUS\s+(\d+)/, r.out)
  const nMis = count(/MISSING\s+(\d+)/, r.out)
  const got = { RENAMED: nRen, AMBIGUOUS: nAmb, MISSING: nMis }[expect]
  chk(got === 1, `${label}（RENAMED ${nRen} / AMBIGUOUS ${nAmb} / MISSING ${nMis}）`)
  if (reason) chk(r.out.includes(reason), `  ↳ 明细点名「${reason}」`)
  if (expect === 'AMBIGUOUS') chk(fs.readFileSync(d, 'utf8') === text, '  ↳ 词典文件一个字节都没动（拒绝写回）')
}
remapCase.n = 0

// P2 括号不平衡：捕获到的表达式括号不配平（两种成因各一例）
remapCase('P2 括号不平衡（调用组多吃一个右括号）', {
  key: 'File ${aa.name} is ready', zh: '文件 ${aa.name} 已就绪',
  src: 'var a=`File ${bb(x))} is ready`;\n',
  expect: 'AMBIGUOUS', reason: '捕获到的表达式括号不平衡，边界可能切错',
})
remapCase('P2 括号不平衡（裸左括号，无闭合）', {
  key: 'Total: ${aa.n} items', zh: '共 ${aa.n} 项',
  src: 'var a=`Total: ${bb(} items`;\n',
  expect: 'AMBIGUOUS', reason: '捕获到的表达式括号不平衡，边界可能切错',
})

// P5 重建的新 key 命不中：key 把**同一个**插值写了两遍，而 bundle 里两处形态不同
// （映射表以 key 文本为键，两次写入只剩一条 → 重建出的 newKey 与 bundle 对不上）
remapCase('P5 重建的新 key 无法逐字节命中 bundle', {
  key: 'A ${aa} B ${aa} C', zh: '甲 ${aa} 乙 ${aa} 丙',
  src: 'var a=`A ${q1} B ${q2} C`;\n',
  expect: 'AMBIGUOUS', reason: '重建的新 key 无法逐字节命中 bundle',
})

// P7 译文插值槽数变化：译文里那个插值被映射到了「半截尾巴」（没有收尾花括号），
// 于是重建后的译文整个塌成一个槽
remapCase('P7 重建的译文插值槽数变化', {
  key: 'A ${aa.x} B ${cond?', zh: '甲 ${cond?} 乙 ${cond?',
  src: 'var a=`A ${q1} B ${q2?`;\n',
  expect: 'AMBIGUOUS', reason: '重建的译文插值槽数变化（2 → 1），拒绝写回',
})

// P8 译文插值无法对齐：译文里多了一个 key 里没有、映射表也找不到的插值（骨架不匹配）
remapCase('P8 译文的插值无法与新 key 对齐', {
  key: 'Hello ${aa.name}', zh: '你好 ${aa.name}（${zz.extra}）',
  src: 'var a=`Hello ${bb.name}`;\n',
  expect: 'AMBIGUOUS', reason: '无法与新 key 对齐（骨架不匹配），拒绝写回',
})

// P9 译文尾巴不一致：key 是半截模板，译文却把尾巴写成了闭合形态——apply.js 会拼断模板
remapCase('P9 重建后译文与 key 的半截尾巴不一致', {
  key: 'A ${cc.x} B ${aa?', zh: '甲 ${dd.y} 乙 ${q2?}',
  src: 'var a=`A ${dd.y} B ${q2?`;\n',
  expect: 'AMBIGUOUS', reason: '重建后译文与 key 的半截尾巴不一致',
})

// 边界：形似上面那三条「构造上不可达」的守卫、但**应当放行**的形态——它们必须走
// 迁移 / 过期判定，绝不能被误拦成歧义（否则正常版本适配会被养成「反正都是人工改」）。
remapCase('边界：半截尾巴形态正常 → 照旧迁移', {
  key: 'Spend ${aa.n} ${bb?', zh: '花掉 ${aa.n} ${bb?',
  src: 'var a=`Spend ${q1} ${q2?`;\n',
  expect: 'RENAMED',
})
remapCase('边界：半截尾巴后面紧跟反引号（一个字符都捕获不到）→ 认作过期而非歧义', {
  key: 'Spend ${aa.n} ${bb?', zh: '花掉 ${aa.n} ${bb?',
  src: 'var a=`Spend ${q1} ${`;\n',
  expect: 'MISSING',
})
remapCase('边界：两处插值形态规整 → 照旧迁移', {
  key: 'A ${aa.x} B ${cc.y}', zh: '甲 ${aa.x} 乙 ${cc.y}',
  src: 'var a=`A ${q1} B ${q2}`;\n',
  expect: 'RENAMED',
})
remapCase('边界：捕获值自带 ${} 外壳且含嵌套 ${（槽数不变）→ 照旧迁移', {
  key: 'A ${aa.x} B', zh: '甲 ${aa.x} 乙',
  src: 'var a=`A ${bb(${cc})} B`;\n',
  expect: 'RENAMED',
})

// --- 4) lint 的 E5 负面用例 -------------------------------------------------------
const negative = (label, mutate) => {
  const d = JSON.parse(dictText)
  mutate(d)
  const p = path.join(WORK, `dict-bad-${negative.n++}.json`)
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n')
  const r = lint(p)
  chk(r.code === 1, `${label} → exit 1（实际 ${r.code}）`)
  return r.out
}
negative.n = 0

const outUnreg = negative('未登记的半截键', (d) => {
  d.template['${x} about to expire in ${y.balance>0?'] = '${x} 将于 ${y.balance>0? 后过期'
})
chk(/未登记的半截模板键/.test(outUnreg), '  报错指出需在 TRUNCATED_TEMPLATE_ANCHORS 登记')

const outTail = negative('译文半截尾巴与 key 不一致', (d) => {
  const k = truncated[0]
  d.template[k] = d.template[k].replace(/\$\{[^}]*$/, '${zz?')
})
chk(/半截尾巴与 key 不一致/.test(outTail), '  报错指出尾巴不一致')

const outSec = negative('半截键放进 exact 分区', (d) => {
  const k = truncated[0]
  d.exact[k] = d.template[k]
  delete d.template[k]
})
chk(/只能出现在 template 分区/.test(outSec), '  报错指出分区限制')

console.log(
  fail
    ? `\n${fail} 项失败`
    : `\n全部通过（${samples.length} 条样本 + 重复拷贝 2 例 + 退出路径/边界 ${remapCase.n} 例 + 3 条负面用例）`,
)
process.exit(fail ? 1 : 0)
