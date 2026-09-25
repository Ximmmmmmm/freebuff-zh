#!/usr/bin/env node
// regen_patch 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 钉住四条：
//   1. 映射提取：hunk 内相邻的「删除块 / 新增块」逐行配对；行数不等的块**不许瞎配**（只报告）；
//   2. 目标口径：套用的目标必须是「快照 + 词典」镜像——词典替换过的行才是补丁的上下文
//      （夹具里放一句 `const label = "Cancel"`，它只会以「取消」的样子出现在生成结果里）；
//   3. 真实场景：上游在 hunk 中间插行 → 旧补丁的上下文在新版里根本不存在（套不上），
//      regen 只用映射就把它重新生成成**能干净套用**的补丁，且 --write 落盘后幂等；
//   4. 失败要响：块配不上对 → rc 1 且不写盘；映射行在新版找不到 → 只警告（可能是上游删了那句）。
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { translationMap, applyMap } = require('./regen_patch.js')
const { buildMirror } = require('./reanchor_patch.js')
const { checkApply } = require('./patch_preflight.js')

const REPO = path.join(__dirname, '..')
const WORK = path.join(REPO, 'work', 'test-regen-patch')
const REGEN = path.join(REPO, 'tools', 'regen_patch.js')
fs.rmSync(WORK, { recursive: true, force: true })

const write = (rel, body) => {
  const p = path.join(WORK, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}
const run = (args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (e) {
    return { code: e.status === undefined ? 1 : e.status, out: String(e.stdout || '') + String(e.stderr || '') }
  }
}
// 与 patch_preflight 同口径：把补丁放回镜像里 git apply --check -p1
const applies = (patchFile, snapshot) => {
  const mirror = buildMirror(snapshot)
  try {
    return checkApply(mirror, patchFile)
  } finally {
    fs.rmSync(mirror, { recursive: true, force: true })
  }
}

// --- 夹具：迷你快照（含 electron/）------------------------------------------------------
const filler = Array.from({ length: 40 }, (_, i) => `// filler ${i + 1}`)
const snapshot = path.join(WORK, 'snap')
fs.mkdirSync(path.join(snapshot, 'electron'), { recursive: true })
fs.writeFileSync(
  path.join(snapshot, 'electron', 'sample.cjs'),
  filler
    .concat(['const label = "Cancel"', '', 'function greet(name) {', '  return `Hello ${name}`', '}', '', 'module.exports = { greet, label }'])
    .join('\n') + '\n',
)

// 旧补丁：上下文是上一版的（上游在 hunk 中间插/删了行）→ 在新版上根本套不上，但映射有效
const oldPatch = write(
  'patches/electron-old.cjs.patch',
  [
    '--- a/electron/sample.cjs',
    '+++ b/electron/sample.cjs',
    '@@ -1,6 +1,6 @@',
    ' // 上游早就删掉的老上下文',
    '-  return `Hello ${name}`',
    '+  return `你好 ${name}`',
    ' // 另一行老上下文',
    '',
  ].join('\n'),
)

// 块行数不等的补丁：删除块 2 行 / 新增块 1 行 —— 配不上对，必须拒绝而不是错位配对
const unpairedPatch = write(
  'patches/electron-unpaired.cjs.patch',
  [
    '--- a/electron/sample.cjs',
    '+++ b/electron/sample.cjs',
    '@@ -43,4 +43,3 @@',
    ' function greet(name) {',
    '-  return `Hello ${name}`',
    '-  // 上游删掉的一行',
    '+  return `你好 ${name}`',
    ' }',
    '',
  ].join('\n'),
)

// 只有「词典已经处理过的那行」的映射：在镜像里找不到 → 应当只警告（--from 的典型用途是补漏，
// 而不是保证每条都对得上）
const fromPatch = write(
  'patches/electron-from.cjs.patch',
  [
    '--- a/electron/sample.cjs',
    '+++ b/electron/sample.cjs',
    '@@ -41,4 +41,4 @@',
    ' const label = "Cancel"',
    '-const label = "Cancel"',
    '+const label = "取消"',
    '',
    '',
  ].join('\n'),
)

let fail = 0
const chk = (ok, msg) => {
  console.log((ok ? '  ok  ' : '  FAIL ') + msg)
  if (!ok) fail++
}

// --- 1) 纯函数：配对与套用 ------------------------------------------------------------
const m = translationMap(fs.readFileSync(oldPatch, 'utf8'))
chk(m.map.length === 1 && m.unpaired.length === 0, `单块配对：1 条映射 / 0 个配不上（实际 ${m.map.length}/${m.unpaired.length}）`)
chk(m.map[0][1] === '  return `你好 ${name}`', '映射的中文侧原样保留缩进')
const mBad = translationMap(fs.readFileSync(unpairedPatch, 'utf8'))
chk(mBad.unpaired.length === 1 && mBad.map.length === 0, `行数不等的块不许配对（实际 unpaired=${mBad.unpaired.length}）`)

const mirror = buildMirror(snapshot)
const mirrored = fs.readFileSync(path.join(mirror, 'electron', 'sample.cjs'), 'utf8').split('\n')
const applied = applyMap(mirrored, m.map)
chk(applied.replaced === 1 && applied.missing.length === 0, `套用：替换 ${applied.replaced} 行 / 未命中 ${applied.missing.length} 行`)
chk(applied.lines.join('\n').includes('return `你好 ${name}`'), '套用后目标文本里出现译文')
chk(
  applyMap(mirrored, [['不存在的英文行', '某个中文']]).missing.length === 1,
  '对不上的映射行进 missing 清单（不是静默丢掉）',
)
const conflicts = applyMap(mirrored, [['  return `Hello ${name}`', '甲'], ['  return `Hello ${name}`', '乙']])
chk(conflicts.conflicts.length === 1 && conflicts.lines.join('\n').includes('甲'), '同一句两份译文 → 报冲突并保留先到的')
fs.rmSync(mirror, { recursive: true, force: true })

// --- 2) 端到端：真跑一遍 CLI（先确认旧补丁确实套不上）---------------------------------
chk(applies(oldPatch, snapshot).ok === false, '夹具前置条件：旧补丁在镜像里确实套不上（上游插行的形态）')
const dry = run([REGEN, oldPatch, '--snapshot', snapshot])
chk(dry.code === 0, `试运行 rc 0（实际 ${dry.code}）`)
chk(/git apply --check 通过/.test(dry.out), '  试运行也复验一遍（git apply --check 通过）')
chk(/试运行，未写入/.test(dry.out), '  试运行不落盘')
chk(fs.readFileSync(oldPatch, 'utf8').includes('@@ -1,6'), '  试运行后补丁文件原样未动')

const before = fs.readFileSync(oldPatch, 'utf8')
const wrote = run([REGEN, oldPatch, '--snapshot', snapshot, '--write'])
chk(wrote.code === 0 && /已写入/.test(wrote.out), `--write rc 0 且落盘（实际 ${wrote.code}）`)
const after = fs.readFileSync(oldPatch, 'utf8')
chk(after !== before, '写入后内容变了（重生成过）')
chk(/const label = "取消"/.test(after), '生成的上下文来自「快照 + 词典」镜像（中文由词典提供）')
chk(!/老上下文/.test(after), '旧上下文没被搬进新补丁')
chk(applies(oldPatch, snapshot).ok === true, '重生成的补丁在镜像里能干净套用 ✓')
chk(run([REGEN, oldPatch, '--snapshot', snapshot, '--write']).code === 0, '再跑一次仍然 rc 0（幂等可重跑）')
chk(fs.readFileSync(oldPatch, 'utf8') === after, '再跑一次内容不再变化（幂等）')

// --- 3) --from 叠加映射 + 未命中只警告 -------------------------------------------------
const dryFrom = run([REGEN, oldPatch, '--snapshot', snapshot, '--from', fromPatch])
chk(dryFrom.code === 0, `--from 叠加后 rc 0（实际 ${dryFrom.code}）`)
chk(/新版原文里没有这一行/.test(dryFrom.out), '  对不上的映射行只警告（词典已把那行变成中文）')
chk(/self|自身/.test(dryFrom.out), '  报告里区分「自身映射」与 --from 的来源')

// --- 4) 失败要响：块配不上对 → rc 1 且不写盘 -------------------------------------------
const badBefore = fs.readFileSync(unpairedPatch, 'utf8')
const badRun = run([REGEN, unpairedPatch, '--snapshot', snapshot, '--write'])
chk(badRun.code === 1, `配不上对 → rc 1（实际 ${badRun.code}）`)
chk(/配不上对/.test(badRun.out), '  报出配不上对的行块')
chk(fs.readFileSync(unpairedPatch, 'utf8') === badBefore, '  失败时不写盘')

// --- 5) 参数 / 输入契约 ---------------------------------------------------------------
chk(run([REGEN]).code === 2, '不给参数 → rc 2')
chk(run([REGEN, oldPatch, '--snapshot', path.join(WORK, 'nope')]).code === 2, '快照不存在 → rc 2')
chk(run([REGEN, path.join(WORK, 'nope.patch'), '--snapshot', snapshot]).code === 2, '补丁不存在 → rc 2')
chk(run([REGEN, oldPatch, '--snapshot', snapshot, '--from']).code === 2, '--from 缺取值 → rc 2')

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
