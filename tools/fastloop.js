#!/usr/bin/env node
// 词典快验循环：改几条 → 立刻拿到「这几条对不对」，不必攒一大批再自己 eyeball。
//
// 为什么要它：tools/update.sh 全量实测 44 秒，其中 28 秒是五个残留扫描器各读一遍 3MB 产物、
// 4 秒是构建与打包——那些查的是「整版迁移做干净了没」。你改词条时 wanted 的是另一件事：
// 「我刚写的这 5 条，格式合不合法、能不能套进本版 bundle」。所以这里拆两档：
//
//   快档（本脚本，实测 <1s）
//     · tools/lint_dict.js —— 结构 / 占位符 / 模板残骸 / 半截模板键
//     · 命中探针 —— 变化的键能否在本版**英文原版**里找到（四种形态：原样 / 引号转义 /
//       \uXXXX 转义 / 模板字面量原文；实测本版词典 2071/2071 条都可用其中一种命中）
//       判据来自直接子串查找，比跑一遍 apply.js 快一个量级，且不会改任何文件。
//     命中失败在构建里是第 4 步才炸的 MISSED，那时你已改了几百条、找不回是哪条；这里当场点出来。
//   全档（--full）：完整 bash tools/update.sh（四道闸门 + 回归对差），迁移收尾时跑一次。
//
// 触发：轮询 dict.json 的 mtime+size，稳定 1.2 秒才动手（编辑器保存常分两次写）。
//      不用 fs.watch —— Windows 上对 rename-on-save（vim 等）不可靠。
//
// 用法：
//   node tools/fastloop.js --pristine <hanhua-backup-*/ui>            # 监听
//   node tools/fastloop.js --pristine <…> --once                      # 跑一次，可串进脚本
//   node tools/fastloop.js --pristine <…> --full                      # 完整 update.sh
//   --dict <file>  指到别的词典（自测用；默认 <repo>/dict.json）
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const SECTIONS = ['exact', 'template', 'code', 'pattern']
const args = process.argv.slice(2)
const valOf = (n) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null }
const has = (n) => args.includes('--' + n)
const DICT = valOf('dict') || path.join(REPO, 'dict.json')

function die (m) { process.stderr.write('错误：' + m + '\n'); process.exit(1) }

// --- 原版 bundle 定位：给文件用文件；给目录（hanhua-backup-* 或其 ui/）在里面找 index-*.js ---
function resolveBundle (p) {
  if (!p) return null
  if (!fs.existsSync(p)) return null
  if (fs.statSync(p).isFile()) return p
  const roots = [p, path.join(p, 'ui'), path.join(p, 'ui', 'assets'), path.join(p, 'assets')]
  for (const r of roots) {
    if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) continue
    const hit = fs.readdirSync(r).filter((f) => /^index-.*\.js$/.test(f)).sort().pop()
    if (hit) return path.join(r, hit)
  }
  return null
}
const BUNDLE = resolveBundle(valOf('pristine'))
if (!BUNDLE) die('需要 --pristine 指向本版英文原版（hanhua-backup-*/ui，或其中的 index-*.js）。'
  + '\n  没有原版就没法验命中，只跑 lint 会给你假的安全感。'
  + '\n  例：node tools/fastloop.js --pristine "$LOCALAPPDATA/Programs/@codebufffreebuff-desktop/resources/hanhua-backup-XXXX/ui"')
const SRC = fs.readFileSync(BUNDLE, 'utf8')

// --- 命中判据：一个键可能在原版里以四种形态出现，任一命中即算命中（只增不减） --------
//   1) 原样            —— 绝大多数（实测本版 exact 1656/1656 走这条，故三种备用形态只是兜底）
//   2) 引号/反斜杠转义 —— 键里带 " 或 \，在双引号字面量里是转义态
//   3) \uXXXX 转义     —— 键里带弯撇号 / 全角标点，压缩产物常写成转义态（F4 就是这么暴露的）
//   4) 模板字面量原文  —— template 键里的 ${x} 在源码里是原样，不是转义文本
// 只增不减：任一形态命中即算命中，所以扩展形态不会把原来命中的判成未命中。
const escNonAscii = (s) => s.replace(/[\u007f-\uffff]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
const escQuote = (s) => s.replace(/["\\]/g, '\\$&')
const forms = (k) => {
  const out = new Set([k, escQuote(k), escNonAscii(k), escNonAscii(escQuote(k))])
  try { const j = JSON.stringify(k).slice(1, -1); out.add(j); out.add(escNonAscii(j)) } catch (e) { /* 非法字符串忽略 */ }
  const raw = String.raw({ raw: [k] })
  out.add(raw); out.add(escNonAscii(raw))
  return [...out].filter(Boolean)
}
const hits = (k) => forms(k).some((v) => v && SRC.includes(v))

// --- 词典快照（'section\0key' → value）------------------------------------------
function readDict (f) { return JSON.parse(fs.readFileSync(f, 'utf8')) }
function flat (d) {
  const m = new Map()
  for (const sec of SECTIONS) for (const [k, v] of Object.entries(d[sec] || {})) m.set(sec + '\u0000' + k, v)
  return m
}
const short = (s, n = 62) => { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s }

// --- 一轮快验 -------------------------------------------------------------------
// prev 为 null 表示「没有基线」（首次启动 / --once 首跑），此时只验全量命中率，不做差集。
function runFast (prev) {
  const t0 = Date.now()
  const out = []
  let cur
  try { cur = flat(readDict(DICT)) } catch (e) { return { bad: true, out: ['✗ dict.json 不是合法 JSON：' + e.message] } }

  const l1 = spawnSync(process.execPath, [path.join(REPO, 'tools', 'lint_dict.js'), DICT], { encoding: 'utf8' })
  const lintText = (l1.stdout || '') + (l1.stderr || '')
  if (l1.status !== 0) {
    out.push('✗ lint_dict 未通过：')
    for (const line of lintText.split('\n')) if (/^\s*[!！]\s*(E\d|W\d)/.test(line) || /^\s+!/.test(line)) out.push('   ' + line.trim())
    out.push('   （修完再谈命中：结构不过时命中结果无意义）')
    return { bad: true, out, cur }
  }

  if (!prev) {
    const miss = [...cur.keys()].map((k) => k.split('\u0000')[1]).filter((k) => !hits(k))
    out.push(`✓ lint 通过 · 基线：${cur.size} 条里 ${miss.length} 条在本版原版命中不了` + (miss.length ? '（多为只在主进程 / 已下线的历史条目，非本轮引入）' : ''))
    for (const k of miss.slice(0, 8)) out.push('   · ' + short(k))
    if (miss.length > 8) out.push(`   … 其余 ${miss.length - 8} 条`)
    return { bad: false, out, cur }
  }

  // 复合键 'section\0key' 在 Map 里好用，但查 bundle 必须先拆开——整键拿去 includes 一定不命中
  const split = (key) => ({ sec: key.split('\u0000')[0], k: key.split('\u0000')[1] })
  const added = [], modified = [], removed = []
  for (const [key, v] of cur) {
    if (!prev.has(key)) added.push(Object.assign({ v }, split(key)))
    else if (prev.get(key) !== v) modified.push(Object.assign({ v, old: prev.get(key) }, split(key)))
  }
  for (const key of prev.keys()) if (!cur.has(key)) removed.push(split(key).k)
  const touched = [...added, ...modified]
  if (!touched.length && !removed.length) return { bad: false, out: ['✓ lint 通过 · 词条无变化'], cur }

  out.push(`✓ lint 通过 · 本轮改动：增 ${added.length} / 改译文 ${modified.length} / 删 ${removed.length}`)
  const miss = touched.filter((e) => !hits(e.k))
  if (miss.length) {
    out.push(`✗ 其中 ${miss.length} 条的**原文键**在本版英文原版里找不到 —— 构建第 4 步会以此中止（MISSED）：`)
    for (const e of miss.slice(0, 12)) {
      out.push(`   [${e.sec}] ${short(e.k)}`)
      out.push(`          原样 / 引号转义 / \\uXXXX / 模板原文 四种形态都没命中：引号或撇号是否抄错？该句是否已下线或只在主进程（那要进 patches/）？`)
    }
    if (miss.length > 12) out.push(`   … 其余 ${miss.length - 12} 条`)
    return { bad: true, out, cur }
  }
  const empty = touched.filter((e) => typeof e.v !== 'string' || (e.v === '' && e.sec !== 'code'))
  if (empty.length) out.push(`! ${empty.length} 条改动译文为空（lint 只在全量时判，这里单独提醒）`)
  out.push(`✓ 改动条目全部能在本版原版命中 · 用时 ${((Date.now() - t0) / 1000).toFixed(2)}s`)
  return { bad: false, out, cur }
}

// --- 入口 -----------------------------------------------------------------------
const stamp = () => new Date().toTimeString().slice(0, 8)
function emit (r) { for (const l of r.out) process.stdout.write('  ' + l + '\n'); return r.bad ? 2 : 0 }

if (has('full')) {
  process.stdout.write('== 跑完整 tools/update.sh（四道闸门 + 回归对差）==\n')
  const r = spawnSync('bash', [path.join(REPO, 'tools', 'update.sh')], { stdio: 'inherit', cwd: REPO })
  process.exit(r.status || 0)
}

let snap
try { snap = flat(readDict(DICT)) } catch (e) { die('dict.json 读不动：' + e.message) }

if (has('once')) {
  const base = valOf('baseline')
  let prev = null
  if (base) { try { prev = flat(readDict(base)) } catch (e) { die('--baseline 读不动：' + e.message) } }
  process.stdout.write(`[${stamp()}] 快验 ${prev ? '（差集基线=' + path.basename(base) + '）' : '（全量覆盖率，无差集基线）'}\n`)
  process.stdout.write(`  原版：${path.basename(BUNDLE)}\n`)
  const r = runFast(prev)
  process.exit(emit(r))
}

let lastM = fs.statSync(DICT).mtimeMs, lastSz = fs.statSync(DICT).size, timer = null
process.stdout.write(`监听 ${path.basename(DICT)}（mtime+size 稳定 1.2s 触发；Ctrl-C 退出）\n  原版：${path.basename(BUNDLE)}\n`)
setInterval(() => {
  let s
  try { s = fs.statSync(DICT) } catch (e) { return }
  if (s.mtimeMs === lastM && s.size === lastSz) return
  lastM = s.mtimeMs; lastSz = s.size
  clearTimeout(timer)
  timer = setTimeout(() => {
    const r = runFast(snap)
    process.stdout.write(`\n[${stamp()}] dict.json 改动 →\n`)
    emit(r)
    if (r.cur) snap = r.cur
  }, 1200)
}, 250)
