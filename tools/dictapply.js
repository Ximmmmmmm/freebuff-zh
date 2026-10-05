#!/usr/bin/env node
// 声明式词典变更清单：把「这一版要删哪些、改哪些键、加哪些文案」从一次性脚本变成一份数据。
//
// 为什么要它：0.0.148 起每次版本迁移都在 work/ 里现写一个 adaptNNN.js（截至 0.0.156 已积累
// 47 个一次性脚本），它们各自重新实现同样的三个原语——按片段找键（要求唯一命中）、保序改名、
// 撞键即报错。脚本本身不是成本，**每次重写脚本、每次重新想清楚它的拒绝条件**才是。
// 这里把那 47 个脚本的公共部分固化下来，迁移时只写清单。
//
// 清单格式（JSON，UTF-8）：
// {
//   "version": "0.0.157",
//   "del":    [ { "section": "exact", "key": "旧文案", "note": "上游下线的理由" } ],
//   "rename": [ { "section": "template", "key": "旧片段", "to": "新文案", "value": "可选：同时改写译文" } ],
//   "set":    [ { "section": "exact",   "key": "旧文案", "value": "新译文" } ],
//   "add":    [ { "section": "exact",   "key": "新文案", "value": "新译文" } ]
// }
//
// 键定位规则（与 adaptNNN.js 的 findKey 同源，但把它的三条拒绝条件做成显式分类）：
//   1. section 内精确键命中          → 命中
//   2. section 内恰有一条包含该片段的键 → 命中（报告中列出实际键，方便核对）
//   3. 命中 0 条 → MISS；命中 ≥2 条 → AMBIGUOUS（附候选）
// rename 的 to / add 的 key 同理，但期望**不命中**（已存在就是 ADD_COLLISION）。
//
// 安全边界：
//   · 默认 dry-run，只出报告；必须显式 --write 才落盘。
//   · 先全量校验后一次性应用——清单里第 3 条写错了，前 2 条也不会被写进去。
//   · rename 保序：原位换键；需要挪位置用 "pos": "end"。
//   · rename 未给 value 时按**插值出现顺序**同步译文里的 ${…}（minifier 改名的常见场景），
//     数量不等或想手工控制时给 value，或加 "sync": false 强制原样带走。
//   · 写完自动跑 lint_dict.js（结构/占位符/模板残骸闸门），不过就把文件还原回去。
//
// 用法：
//   node tools/dictapply.js work/changelist-157.json            # 试跑，看报告
//   node tools/dictapply.js work/changelist-157.json --write    # 真改
//   node tools/dictapply.js --emit exact < new.txt              # 把上游新增文案生成清单骨架
//   node tools/dictapply.js --emit exact --from-file r.txt --value-fill TODO
//
// 给「AI 工具填清单」这条流程准备的闸门（--check；翻译不走 API，无论谁填完都要过这道）：
//   G1 code 分区 value 必须与 key 逐字节相同——那边是代码字面量，改了就是改行为
//   G2 非 code 分区译文要含中文，除非 value 以 [EN] 前缀标成有意保留英文
//   G3 译文不能等于原文（AI 最常见的偷懒：原样抄回来）
//   G4 骨架里未填的空 value 单独计数，只提醒不报错（--check 允许半成品）
//   G5 key 以 ${ 或未闭合三元残骸开头/结尾——抄键时截断了，贴回 bundle 也命中不了
//
// 推荐节奏：--emit（可加 --guidance 把译文规则一起吐出来，整段丢给 AI）→ AI 填 value
//   → --check 体检（只读）→ dry-run 看改动 → --write 落盘。

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const SECTIONS = ['exact', 'template', 'code', 'pattern']
const OPS = ['del', 'rename', 'set', 'add']
const REPO = path.join(__dirname, '..')
const short = (s, n = 64) => JSON.stringify(s == null ? '(空)' : String(s).length > n ? String(s).slice(0, n) + '…' : String(s))

// --- CLI ----------------------------------------------------------------------
const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const pos = argv.filter((a) => !a.startsWith('--') && !takesValue(a))
const valOf = (name) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}
function takesValue (a) { return ['--dict', '--emit', '--from-file', '--value-fill'].includes(a) }

const dictPath = valOf('dict') || path.join(REPO, 'dict.json')
const WRITE = flags.has('--write')
const CHECK = flags.has('--check')
const EMIT = flags.has('--emit')

// 译文规则：既是 --check 的判据，也能随骨架吐出来给填表的人/AI 看
const GUIDANCE = [
  '填这份清单的规则（汉化包词典，不是普通文本翻译）：',
  '  1) 只填 value。key / section / note 一个字符都不要动——key 必须能在本版 bundle 里',
  '     逐字节命中，改一个引号、把 ’ 换成 ASCII 撇号就整条失效（词典里 87 条 key 用弯撇号 ’、29 条用 ASCII 撇号，两种都有，抄的时候别顺手「统一」掉）。',
  '  2) 原文里的 ${...} 插值、%s、\\n、HTML 标签必须原样保留，数量不能变；位置可随语序调整。',
  '  3) 品牌与专有名词不翻：Freebuff、GLM、DeepSeek、Solar、MiMo、GPT、Gemini、Claude、',
  '     GitHub、macOS；Freebucks 也保留原文（现有词典一致如此）。',
  '  4) 术语跟现有词典（括号内是已印证条数，别自创）：provider→提供商(30)、session→会话(36)、',
  '     model→模型(38)、thread→会话(75，注意：词典里从不译作「线程」)、quota/allowance→额度。',
  '     拿不准就先 grep dict.json 看同类怎么翻。',
  '  5) 确实要整句保留英文，value 写成 "[EN] 原文"，闸门放行；除此之外 value 必须含中文，',
  '     原样抄回英文会被判「等于没翻」。',
  '  6) section=code 的条目：value 必须与 key 逐字节相同，那是代码字面量，翻了就是改行为。',
  '  7) 标点不做统一要求（现有词典混用），但别为了「美观」去改与本清单无关的既有条目。',
  '  8) 翻完跑：node tools/dictapply.js <这份文件> --check，再不带参数 dry-run 看改动，最后 --write。'
].join('\n')

// --- emit：把上游报告转成清单骨架 ---------------------------------------------
// 吃 tools/upstreamdiff.js 的那一段：
//     ## 新增文案 · 词典未覆盖（本版要翻的清单）
//       ⚠ [文案] Some new sentence
//           @ ui/assets/index-xxxx.js:1
//       ⚠ [短片段] Compact
//       ⚠ [字面量] Download
// 也吃裸清单（--bare，每行一条，可带列表符号 / 引号）。
// [文案] → exact，[短片段] / [字面量] → pattern（与 upstreamdiff 的 BUCKET 判据对齐）。
// @ 行**回挂**到它上面那条（上游报告是条目在前、@ 在后），只挂一条不串位。
// 只负责省掉「手抄 JSON」这一段，value 一律留占位，翻不翻、怎么翻由人定。
if (EMIT) {
  const forced = valOf('emit')
  if (forced && !SECTIONS.includes(forced)) die(`--emit 的分区名无效，可选：${SECTIONS.join('/')}`)
  let lines = []
  if (valOf('from-file')) {
    // Windows 下 /dev/null 会被解析成 …\nul 并抛裸 ENOENT 堆栈；先给一句人话
    if (!fs.existsSync(valOf('from-file'))) die('--from-file 指向的文件不存在：' + valOf('from-file') + '（管道请用 --emit 不带 --from-file）')
    lines = fs.readFileSync(valOf('from-file'), 'utf8').split(/\r?\n/)
  }
  else {
    // stdin 只在非 TTY 时读，否则挂在那里等键盘
    if (!process.stdin.isTTY) lines = fs.readFileSync(0, 'utf8').split(/\r?\n/)
    else die('--emit 需要从 stdin 管道或 --from-file 拿原文')
  }
  const fill = valOf('value-fill') || ''
  const route = (tag) => forced || (/短片段|字面量/.test(tag) ? 'pattern' : 'exact')
  // 第一遍：只认 ⚠ / · 两种条目行，@ 行**回挂**到最近一条（上游报告就是条目在前、@ 在后）。
  // 其它一切行（标题、统计、中文说明）一律丢弃——宁可不收，也不要把报告自己的话当文案。
  const entries = []
  const ITEM_STRICT = /^\s*(?:⚠\s*\[([^\]]+)\]\s*(.+)|·\s+(.+))$/
  const ITEM_BARE = /^\s*(?:(?:[-*]|\d+[.):])\s*)?(.+)$/
  for (const raw of lines) {
    const ctx = raw.match(/^\s*@\s+(.+)$/)
    if (ctx) { if (entries.length) entries[entries.length - 1].ctx = ctx[1].trim(); continue }
    if (!raw.trim()) continue
    if (!flags.has('--bare') && !/^\s*(⚠|·)/.test(raw)) continue // 报告标题 / 统计 / 中文说明一律丢掉
    const it = (flags.has('--bare') ? ITEM_BARE : ITEM_STRICT).exec(raw)
    if (!it) continue
    entries.push({ tag: it[1] || '', text: (it[2] || it[3] || (flags.has('--bare') ? it[1] : '') || '').trim() })
  }
  const seen = new Set()
  const items = []
  for (const e of entries) {
    let s = e.text
    if (!s) continue
    const q = s.match(/^"(.*)"$/s) || s.match(/^'(.*)'$/s)
    if (q) s = q[1]
    s = s.replace(/\\n/g, '\n')
    if (!s || seen.has(s)) continue
    seen.add(s)
    const note = [e.tag, e.ctx ? '@ ' + e.ctx : ''].filter(Boolean).join('  ') || '待翻'
    items.push({ section: route(e.tag), key: s, value: fill, note })
  }
  const bySection = items.reduce((a, x) => ((a[x.section] = (a[x.section] || 0) + 1), a), {})
  process.stdout.write(JSON.stringify({ generatedBy: 'dictapply.js --emit', add: items }, null, 2) + '\n')
  // --guidance：把译文规则吐到 stderr，正好和「骨架重定向到文件」配合，一份终端输出就能整段丢给 AI
  if (flags.has('--guidance')) process.stderr.write('\n' + GUIDANCE + '\n')
  process.stderr.write(`已生成 ${items.length} 条 add 骨架（${Object.entries(bySection).map(([k, v]) => k + ' ' + v).join('、')}；value 为${fill ? '占位 ' + short(fill) : '空，待填'}）。\n`
    + '注意：骨架里所有 value 都是空串，直接 --write 会被 lint 的结构检查拦住——先填译文（规则见 --guidance）。\n')
  process.exit(0)
}

function die (msg) {
  process.stderr.write('错误：' + msg + '\n')
  process.exit(1)
}

// --- load ---------------------------------------------------------------------
const listPath = pos[0]
if (!listPath) die('用法：node tools/dictapply.js <changelist.json> [--write]')
if (!fs.existsSync(listPath)) die('清单文件不存在：' + listPath)
if (!fs.existsSync(dictPath)) die('词典不存在：' + dictPath)

let list
try { list = JSON.parse(fs.readFileSync(listPath, 'utf8')) } catch (e) { die(`清单不是合法 JSON：${e.message}`) }
let dict
try { dict = JSON.parse(fs.readFileSync(dictPath, 'utf8')) } catch (e) { die(`dict.json 不是合法 JSON：${e.message}`) }

for (const s of SECTIONS) if (typeof dict[s] !== 'object' || dict[s] === null) die(`dict.json 缺少数组 ${s}`)
const unknownTop = Object.keys(list).filter((k) => !OPS.includes(k) && !['version', 'generatedBy', 'section', 'note'].includes(k))
if (unknownTop.length) die(`清单里有未知操作：${unknownTop.join('/')}，可选：${OPS.join('/')}`)

// --- 定位 ---------------------------------------------------------------------
function locate (section, needle, { wantHit = true } = {}) {
  if (!SECTIONS.includes(section)) return { status: 'BADSECTION', detail: `未知分区 ${short(section)}，可选：${SECTIONS.join('/')}` }
  const keys = Object.keys(dict[section])
  if (Object.prototype.hasOwnProperty.call(dict[section], needle)) {
    return wantHit ? { status: 'OK', key: needle, exact: true } : { status: 'TAKEN', key: needle }
  }
  const hits = keys.filter((k) => k.includes(needle))
  if (!wantHit) return hits.length ? { status: 'TAKEN', key: hits[0], via: 'contains' } : { status: 'FREE' }
  if (hits.length === 1) return { status: 'OK', key: hits[0], exact: false }
  if (hits.length === 0) return { status: 'MISS' }
  return { status: 'AMBIGUOUS', candidates: hits }
}

// --- 校验（只报告，不修改） -----------------------------------------------------
const problems = []
const plan = []
function push (op, section, resolvedKey, extra) { plan.push(Object.assign({ op, section, resolvedKey }, extra)) }

for (const item of list.del || []) {
  const where = `del ${short(item.key)}`
  const r = locate(item.section, item.key)
  if (r.status !== 'OK') { problems.push([r.status, where, describe(r, item)]); continue }
  push('del', item.section, r.key, { note: item.note })
}
for (const item of list.rename || []) {
  const where = `rename ${short(item.key)} → ${short(item.to)}`
  if (typeof item.to !== 'string' || !item.to) { problems.push(['BADARG', where, 'rename 缺少 to']); continue }
  const r = locate(item.section, item.key)
  if (r.status !== 'OK') { problems.push([r.status, where, describe(r, item)]); continue }
  const t = locate(item.section, item.to, { wantHit: false })
  if (t.status === 'TAKEN') { problems.push(['ADD_COLLISION', where, `新键已存在：${short(t.key)}`]); continue }
  // 插值数量不等的改名：译文原样带走必然违反 E3（旧插值不属于新键），与其写下去等 lint 还原，
  // 不如在写盘前就拒绝 —— 0.0.159 迁移里这条路径是真实会遇到的（模板被上游改形）。
  const na = (item.key.match(/\$\{[^}]*\}/g) || []).length
  const nb = (String(item.to).match(/\$\{[^}]*\}/g) || []).length
  if (item.value === undefined && na !== nb) {
    problems.push(['BADARG', where, `插值数量不等（${na} → ${nb}）又没给 value：译文没法自动同步，请显式给 value`])
    continue
  }
  push('rename', item.section, r.key, { to: item.to, value: item.value, note: item.note })
}
for (const item of list.set || []) {
  const where = `set ${short(item.key)}`
  if (typeof item.value !== 'string') { problems.push(['BADARG', where, 'set 的 value 必须是字符串']); continue }
  const r = locate(item.section, item.key)
  if (r.status !== 'OK') { problems.push([r.status, where, describe(r, item)]); continue }
  push('set', item.section, r.key, { value: item.value, note: item.note })
}
for (const item of list.add || []) {
  const where = `add ${short(item.key)}`
  if (typeof item.value !== 'string') { problems.push(['BADARG', where, 'add 的 value 必须是字符串（译文留空请用 ""，未定请用占位串）']); continue }
  const r = locate(item.section, item.key, { wantHit: false })
  if (r.status === 'TAKEN') {
    // 已存在不一定是错——上游改写了大小写/标点时，旧条目还在。给出旧值，让作者决定用 set 还是换键。
    problems.push(['ADD_COLLISION', where, `该分区已有 ${short(r.key)} → ${short(dict[item.section][r.key])}；若只是想补译文请改用 set`])
    continue
  }
  if (item.pos && item.pos !== 'end' && !Object.prototype.hasOwnProperty.call(dict[item.section], item.pos)) {
    problems.push(['BADANCHOR', where, `插入锚点 ${short(item.pos)} 不在 ${short(item.section)} 里，会静默落到末尾——要么写 "end"，要么给一个真实存在的键`])
    continue
  }
  push('add', item.section, item.key, { value: item.value, pos: item.pos, note: item.note })
}

function describe (r, item) {
  if (r.status === 'MISS') return `在 ${short(item.section)} 里找不到 ${short(item.key)}（可能已被更早的适配处理，或本就在 patches/ 里）`
  if (r.status === 'AMBIGUOUS') return `片段命中 ${r.candidates.length} 条，需要更长的唯一片段：\n      ↳ ${r.candidates.slice(0, 6).map((k) => short(k, 50)).join('\n      ↳ ')}`
  if (r.status === 'BADSECTION') return r.detail
  return r.status
}

// --- --check：AI（或人）填完的清单体检，纯只读 ---------------------------------
if (CHECK) {
    const CJK = /[㐀-䶿一-鿿぀-ヿ가-힯]/
  const issues = []
  let empty = 0, okCount = 0
  const everyValue = []
  for (const op of ['add', 'set']) for (const it of list[op] || []) everyValue.push({ op, it, key: it.key })
  for (const it of list.rename || []) if (it.value !== undefined) everyValue.push({ op: 'rename', it, key: it.to })
  for (const { op, it, key } of everyValue) {
    const v = it.value
    if (typeof v !== 'string') { issues.push(['TYPE', `${op} ${short(key)}`, 'value 不是字符串']); continue }
    if (v === '') { empty++; continue }
    if (v.startsWith('[EN]')) { okCount++; continue }
    if (it.section === 'code') {
      // 代码字面量：整条必须逐字节不动
      if (v !== key) issues.push(['G1', `${op} code ${short(key)}`, `value 必须与 key 完全相同（代码字面量），实得 ${short(v)}`])
      else okCount++
      continue
    }
    if (v === key) issues.push(['G3', `${op} ${short(key)}`, '译文与原文逐字节相同，等于没翻'])
    else if (!CJK.test(v)) issues.push(['G2', `${op} ${short(key)}`, `译文里没有中文字符：${short(v)}（有意保留英文请写 "[EN] …"）`])
    else okCount++
    // 键形态：截断的模板/三元残骸贴回 bundle 一定命中不了
    if (/^\$\{/.test(key) || /\$\{[^}]*$/.test(key) || /[?]\s*$/.test(key)) {
      issues.push(['G5', `${op} ${short(key)}`, '键像被截断的模板/三元片段，需补成完整字面量或改用 template 分区的合法锚'])
    }
  }
  process.stdout.write(`清单体检 ${path.basename(listPath)}：${everyValue.length} 条带 value 的操作\n`)
  process.stdout.write(`  合格 ${okCount} · 未填(value 为空) ${empty} · 问题 ${issues.length}\n`)
  for (const [code, where, why] of issues) process.stdout.write(`  ${code.padEnd(4)} ${where}\n       ${why}\n`)
  if (issues.length) { process.stdout.write('\n有硬问题，先修清单再 --write。（体检本身只读，未改动任何文件）\n'); process.exit(2) }
  process.stdout.write(empty ? `\n还有 ${empty} 条没填译文；填完再 --write。（体检本身只读）\n` : '\n体检通过，可以 dry-run / --write。（体检本身只读）\n')
  process.exit(0)
}

// --- 应用 ---------------------------------------------------------------------
const counts = { del: 0, rename: 0, set: 0, add: 0 }
function applyPlan () {
  for (const step of plan) {
    const sec = dict[step.section]
    if (step.op === 'del') {
      delete sec[step.resolvedKey]
      counts.del++
    } else if (step.op === 'set') {
      sec[step.resolvedKey] = step.value
      counts.set++
    } else if (step.op === 'rename') {
      // 原位换键（保序，diff 才不炸）。
      // 变量改名场景（minifier 把 ${or(e)} 换成 ${sr(e)}）必须同步改写译文里的插值，
      // 否则译文里的 ${or(e)} 就不属于新键了 —— lint 的 E3 会直接判成硬错误。
      // 位置配对：只按插值**出现顺序**配对，数量不等时不猜、原样带走并交 lint 判定。
      let nv = step.value !== undefined ? step.value : sec[step.resolvedKey]
      if (step.value === undefined && step.sync !== false && step.to.includes('${') && step.resolvedKey.includes('${')) {
        const a = step.resolvedKey.match(/\$\{[^}]*\}/g) || []
        const b = step.to.match(/\$\{[^}]*\}/g) || []
        if (a.length === b.length && a.some((x, n) => x !== b[n])) {
          let moved = nv
          for (let n = 0; n < a.length; n++) if (a[n] !== b[n]) moved = moved.split(a[n]).join(b[n])
          if (moved !== nv) { nv = moved; step.synced = a.map((x, n) => (x === b[n] ? null : x + '→' + b[n])).filter(Boolean).join(' ') }
        }
      }
      const out = {}
      for (const [k, v] of Object.entries(sec)) out[k === step.resolvedKey ? step.to : k] = k === step.resolvedKey ? nv : v
      dict[step.section] = out
      counts.rename++
    } else if (step.op === 'add') {
      if (!step.pos || step.pos === 'end') sec[step.resolvedKey] = step.value
      else {
        const out = {}
        for (const [k, v] of Object.entries(sec)) { out[k] = v; if (k === step.pos) out[step.resolvedKey] = step.value }
        if (!Object.prototype.hasOwnProperty.call(out, step.resolvedKey)) out[step.resolvedKey] = step.value
        dict[step.section] = out
      }
      counts.add++
    }
  }
}

if (!plan.length && !problems.length) die('清单里没有可执行的条目（四类操作都是空的？检查 section/key 字段名）')

// --- 每条操作的可读预览（dry-run 也要看得到内容，不然「先看报告」这一步是空的） ----
function preview (step) {
  const sec = dict[step.section]
  const oldVal = sec[step.resolvedKey]
  if (step.op === 'del') return `- 删 ${step.section}: ${short(step.resolvedKey)} → ${short(oldVal)}`
  if (step.op === 'set') return `= 改 ${step.section}: ${short(step.resolvedKey)} → ${short(oldVal)} ⇾ ${short(step.value)}`
  if (step.op === 'rename') {
    const a = (step.resolvedKey.match(/\$\{[^}]*\}/g) || [])
    const b = (String(step.to).match(/\$\{[^}]*\}/g) || [])
    const willSync = step.value === undefined && step.sync !== false && a.length === b.length && a.some((x, n) => x !== b[n])
    return `→ 迁 ${step.section}: ${short(step.resolvedKey)} ⇒ ${short(step.to)}${step.value !== undefined ? '（译文按给定值改写）' : willSync ? '（插值同步：' + a.map((x, n) => (x === b[n] ? null : x + '→' + b[n])).filter(Boolean).join(' ') + '）' : '（译文原样带走）'}`
  }
  return `+ 增 ${step.section}: ${short(step.resolvedKey)} → ${short(step.value)}${step.pos ? `（插在 ${short(step.pos)} 之后）` : ''}`
}
const previews = plan.map(preview)

// --- 报告 ---------------------------------------------------------------------
const rep = []
rep.push(`词典变更清单报告  ${list.version ? '版本 ' + list.version + '  ' : ''}${path.basename(listPath)}`)
rep.push(`  清单 ${OPS.reduce((n, k) => n + (list[k] || []).length, 0)} 项 → 可执行 ${plan.length} 项，问题 ${problems.length} 项`)
for (const op of OPS) {
  const n = (list[op] || []).length
  if (n) rep.push(`  ${op.padEnd(7)} ${n} 项  （计划执行 ${plan.filter((p) => p.op === op).length}）`)
}
if (problems.length) {
  rep.push('\n── 问题（存在任一问题时 --write 会整体拒绝）──')
  for (const [code, where, why] of problems) rep.push(`  ${code.padEnd(13)} ${where}\n                ${why}`)
}
if (plan.length) {
  rep.push(`\n── ${WRITE ? '已执行' : '将要执行'}的 ${plan.length} 项 ──`)
  for (const line of previews) rep.push('  ' + line)
}
process.stdout.write(rep.join('\n') + '\n')

if (!WRITE) {
  process.stdout.write('\n(dry-run，dict.json 未改动；确认无误后加 --write)\n')
  process.exit(problems.length ? 2 : 0)
}
if (problems.length) { process.stdout.write('\n带问题拒绝写入。修清单后重试。\n'); process.exit(2) }

applyPlan()
const backup = dictPath + '.before-dictapply'
fs.copyFileSync(dictPath, backup)
fs.writeFileSync(dictPath, JSON.stringify(dict, null, 2) + '\n')

// lint 后置闸门：不过就还原，绝不留半截词典
const lint = spawnSync(process.execPath, [path.join(REPO, 'tools', 'lint_dict.js'), dictPath], { encoding: 'utf8' })
const lintOut = (lint.stdout || '') + (lint.stderr || '')
if (lint.status !== 0) {
  fs.copyFileSync(backup, dictPath)
  process.stdout.write('\nlint_dict.js 未通过，已还原 dict.json（备份 ' + path.basename(backup) + '）。\n')
  process.stdout.write(lintOut.split('\n').slice(-30).join('\n') + '\n')
  process.exit(3)
}
process.stdout.write(`\n已写入 dict.json（原文件备份 ${path.basename(backup)}），lint 通过。\n`)
// lint 过了就不留备份：它是为了「还原」存在的，留着会在工作区越攒越多（而且同名会互相覆盖）
if (!flags.has('--keep-backup')) fs.rmSync(backup, { force: true })
else process.stdout.write('（--keep-backup：备份已保留）\n')
process.stdout.write(`下一步：bash build.sh 重构建，再 bash tools/update.sh 复核残留。\n`)
process.exit(0)
