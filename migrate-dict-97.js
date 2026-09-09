#!/usr/bin/env node
// 0.0.97 MISSED 词条迁移 + 清理 autotranslate 截断伪词条。
// 校验（bundle 逐字节命中 + 老 key 存在 + 新 key 不冲突）全部通过才允许 --apply。
const fs = require('fs')

const SPEC = '/tmp/migrate-spec-97.json'
const DICT = '/opt/freebuff-zh/dict.json'
const ASSETS = '/opt/freebuff-zh/work/pristine-0.0.97/app/resources/orchestrator/ui/assets'

const APPLY = process.argv.slice(2).includes('--apply')

const main = fs.readdirSync(ASSETS).find((f) => /^index-.*\.js$/.test(f))
const src = fs.readFileSync(`${ASSETS}/${main}`, 'utf8')
const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'))
const dict = JSON.parse(fs.readFileSync(DICT, 'utf8'))

const has = (sec, k) => Object.prototype.hasOwnProperty.call(dict[sec], k)

function present(sec, key) {
  if (sec === 'template') return src.includes('`' + key + '`')
  if (sec === 'exact') return src.includes('"' + key + '"') || src.includes("'" + key + "'")
  return true
}

const errors = []
const ops = []

// spec 驱动的三条操作（replace / delete / rewrite）
for (const e of spec) {
  const sec = e.section
  if (e.mode === 'delete') {
    if (!has(sec, e.old)) errors.push(`old key 不在 dict: [${sec}] ${JSON.stringify(e.old)}`)
    else ops.push({ sec, old: e.old, key: null, zh: null })
  } else if (e.mode === 'rewrite') {
    if (!has(sec, e.old)) errors.push(`old key 不在 dict: [${sec}] ${JSON.stringify(e.old)}`)
    if (has(sec, e.newKey)) errors.push(`新 key 已存在于 dict: [${sec}] ${JSON.stringify(e.newKey)}`)
    if (!present(sec, e.newKey)) errors.push(`重写 key 不在 bundle: [${sec}] ${JSON.stringify(e.newKey)}`)
    else ops.push({ sec, old: e.old, key: e.newKey, zh: e.newZh })
  } else if (e.mode === 'replace') {
    if (!has(sec, e.old)) {
      errors.push(`old key 不在 dict: [${sec}] ${JSON.stringify(e.old)}`)
      continue
    }
    const tr = (s) => e.pairs.reduce((acc, [f, r]) => acc.split(f).join(r), s)
    const nk = tr(e.old)
    const nz = tr(dict[sec][e.old])
    if (has(sec, nk)) errors.push(`新 key 已存在于 dict: [${sec}] ${JSON.stringify(nk)}`)
    if (!present(sec, nk)) errors.push(`迁移后 key 不在 bundle: [${sec}] ${JSON.stringify(nk)}`)
    else ops.push({ sec, old: e.old, key: nk, zh: nz })
  }
}

// autotranslate 的 tplRe 截到嵌套反引号会产出半截伪词条（与完整 key 同前缀但以
// 未闭合的 "${" 结尾）。按前缀识别并删除：完整 key 之外的同前缀词条都是伪词条。
const PREFIX = '${C} costs ${O} '
const artifacts = Object.keys(dict.template).filter((k) => k.startsWith(PREFIX))
const fullNewKeys = ops.filter((o) => o.sec === 'template' && o.key).map((o) => o.key)
const fullOldKeys = ops.filter((o) => o.sec === 'template' && o.old).map((o) => o.old)
for (const k of artifacts) {
  if (fullNewKeys.includes(k) || fullOldKeys.includes(k)) continue
  ops.push({ sec: 'template', old: k, key: null, zh: null, artifact: true })
}
console.log(`截断伪词条扫描: 同前缀 ${artifacts.length} 条, 其中伪词条 ${ops.filter((o) => o.artifact).length} 条`)

if (errors.length) {
  console.log('校验失败，未做任何修改：')
  for (const er of errors) console.log('  ' + er)
  process.exit(1)
}

console.log(`校验全部通过：${ops.length} 条操作${APPLY ? '' : '（dry-run，加 --apply 写入）'}`)
for (const op of ops) {
  console.log(`  [${op.sec}] ${op.artifact ? '(删伪词条) ' : ''}${op.key === null ? '(删除)' : ''} ${JSON.stringify(op.key || op.old).slice(0, 100)}`)
  if (op.zh != null) console.log(`      => ${JSON.stringify(op.zh).slice(0, 120)}`)
}

if (APPLY) {
  fs.copyFileSync(DICT, '/tmp/dict-before-migrate-97.json')
  for (const op of ops) {
    if (op.old !== null) delete dict[op.sec][op.old]
    if (op.key !== null) dict[op.sec][op.key] = op.zh
  }
  fs.writeFileSync(DICT, JSON.stringify(dict, null, 2) + '\n')
  console.log('已写入 dict.json（备份: /tmp/dict-before-migrate-97.json）')
}
