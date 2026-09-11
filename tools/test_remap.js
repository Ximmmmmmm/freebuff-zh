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
//   5. lint_dict 的 E5 负面用例：未登记的半截键 / 译文尾巴不一致 / 放进 exact 分区，均须 exit 1。
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

console.log(fail ? `\n${fail} 项失败` : `\n全部通过（${samples.length} 条样本 + 3 条负面用例）`)
process.exit(fail ? 1 : 0)
