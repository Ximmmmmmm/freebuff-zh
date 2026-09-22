#!/usr/bin/env node
// patch_preflight / reanchor_patch 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 钉住三条：
//   1. 分诊必须分对：行号漂移（上下文都在 → 一条命令重锚定就好）vs 上游改写（上下文没了 →
//      只能人工重维护）。0.0.131 适配时这两者是我临时写脚本才分开的，且脚本当时还分错过一次
//      （把「空上下文行」丢掉，于是 consent-window.html 被判成「上游改写」）。
//   2. 重锚定必须真能修好漂移：--write 后预检要变绿，且**只改 @@ 头**（正文逐字节不变）。
//   3. 目标文本口径必须是「快照 + 词典」（build.sh 是先套词典再打补丁）。夹具因此按真实形态造：
//      hunk 的**上下文行**里放一句词典命中的双引号文案（原版是 `"Cancel"`，镜像里是 `"取消"`），
//      被改写的那几行只用单引号 / 模板——真实补丁正是这么写的（双引号位置早就被词典占了，
//      补丁只能碰词典够不到的地方）。这样「比对英文原版」会找不到、只有镜像能定位。
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const WORK = path.join(REPO, 'work', 'test-patch-preflight')
fs.rmSync(WORK, { recursive: true, force: true })

const write = (rel, body) => {
  const p = path.join(WORK, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}

// --- 夹具：一个迷你快照（含 electron/）------------------------------------------------
const filler = Array.from({ length: 60 }, (_, i) => `// filler ${i + 1}`)
const dist = filler.length + 1 // 被改写块的真实起始行（1 基）
const body = [
  'function greet(name) {',
  '  return `Hello ${name}`',
  '}',
  '',
  'const label = "Cancel"', // 词典命中（exact：Cancel → 取消），所以镜像里是双引号那行变中文
  'module.exports = { greet, label }',
  '',
  '// tail marker',
]
const snapshot = path.join(WORK, 'snap')
fs.mkdirSync(path.join(snapshot, 'electron'), { recursive: true })
fs.writeFileSync(path.join(snapshot, 'electron', 'sample.cjs'), filler.concat(body).join('\n') + '\n')
fs.writeFileSync(
  path.join(snapshot, 'snapshot.json'),
  JSON.stringify({ version: '0.0.0', components: ['test'] }, null, 2) + '\n',
)

const patchDir = path.join(WORK, 'patches')
fs.mkdirSync(patchDir, { recursive: true })
const hunkBody = [
  ' function greet(name) {',
  '-  return `Hello ${name}`',
  '+  return `Hi ${name}`',
  ' }',
  '', // 空上下文行（不是「一个空格」）
  ' const label = "取消"', // 上下文行：原版是 "Cancel"，只有镜像长这样
]

// A) 干净补丁：行号正确（注意上下文行里的中文来自词典，所以只有镜像能匹配）
write('patches/electron-a-clean.cjs.patch', ['--- a/electron/sample.cjs', '+++ b/electron/sample.cjs', `@@ -${dist},5 +${dist},5 @@`, ...hunkBody, ''].join('\n'))

// B) 行号漂移的补丁：同一段内容，但 @@ 头写的是文件开头的行号
write('patches/electron-b-drift.cjs.patch', ['--- a/electron/sample.cjs', '+++ b/electron/sample.cjs', '@@ -1,5 +1,5 @@', ...hunkBody, ''].join('\n'))

// C) 上游改写过的补丁：上下文在文件里根本不存在
write(
  'patches/electron-c-rewritten.cjs.patch',
  [
    '--- a/electron/sample.cjs',
    '+++ b/electron/sample.cjs',
    '@@ -1,3 +1,3 @@',
    ' function gone(name) {',
    "-  return `Goodbye ${name}`",
    "+  return `Bye ${name}`",
    '',
  ].join('\n'),
)

const run = (args) => {
  try {
    return { code: 0, out: execFileSync('node', args, { encoding: 'utf8' }) }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}
const preflight = (...extra) => run([path.join(REPO, 'tools', 'patch_preflight.js'), '--snapshot', snapshot, '--patches', patchDir, ...extra])
const reanchor = (...extra) =>
  run([path.join(REPO, 'tools', 'reanchor_patch.js'), '--all', '--snapshot', snapshot, '--patches', patchDir, ...extra])

let fail = 0
const chk = (ok, msg) => {
  console.log((ok ? '  ok  ' : '  FAIL ') + msg)
  if (!ok) fail++
}

// --- 1) 预检把 B / C 拦下，并给出不同结论 -----------------------------------------
const r1 = preflight()
chk(r1.code === 1, `有套不上的补丁 → rc 1（实际 ${r1.code}）`)
chk(/electron-b-drift\.cjs\.patch/.test(r1.out), '  B 漂移补丁被点名')
chk(/electron-c-rewritten\.cjs\.patch/.test(r1.out), '  C 改写补丁被点名')
chk(!/electron-a-clean\.cjs\.patch/.test(r1.out), '  A 干净补丁不出现在失败清单（上下文里的中文由镜像提供）')
chk(/行号漂移/.test(r1.out) && /reanchor_patch\.js/.test(r1.out), '  B 被判为行号漂移并给出重锚定修法')
chk(/上下游改写了这段|上游改写了这段/.test(r1.out), '  C 被判为上游改写')
chk(/hunk @@ -1/.test(r1.out), '  C 报出找不到的 hunk 行号')

// --- 2) 重锚定：修好漂移，且只改 @@ 头 -------------------------------------------
const patchB = path.join(patchDir, 'electron-b-drift.cjs.patch')
const before = fs.readFileSync(patchB, 'utf8')
const r2 = reanchor()
chk(r2.code === 1, `重锚定：只有「找不到」的补丁算失败 → rc 1（实际 ${r2.code}）`)
chk(/electron-b-drift\.cjs\.patch：1 个 hunk 行号漂移/.test(r2.out), '  B 的漂移被识别并报告')
const r2w = reanchor('--write')
chk(r2w.code === 1, '  带 --write 时仍如实报告 C 找不到（rc 1）')
const after = fs.readFileSync(patchB, 'utf8')
const bodyOf = (t) => t.split('\n').filter((l) => !l.startsWith('@@')).join('\n')
chk(bodyOf(before) === bodyOf(after), '重锚定只改 @@ 头，补丁正文逐字节不变')
chk(after.includes(`@@ -${dist},5 +${dist},5 @@`), `B 锚定到第 ${dist} 行（与内容一致）`)
chk(bodyOf(fs.readFileSync(patchB, 'utf8')) === bodyOf(before), '再跑一次不再改动（幂等）')
const r3 = preflight()
chk(!/electron-b-drift\.cjs\.patch/.test(r3.out), '重锚定后再预检：B 不再报错')
chk(/electron-c-rewritten\.cjs\.patch/.test(r3.out) && r3.code === 1, 'C 仍被拦下（重锚定救不了改写）')

// --- 3) 单元：空上下文行 / 镜像口径 ------------------------------------------------
const { reanchor: doReanchor, readTarget, buildMirror } = require(path.join(REPO, 'tools', 'reanchor_patch.js'))
const pristine = readTarget(path.join(snapshot, 'electron', 'sample.cjs'))
const bPatch = ['--- a/electron/sample.cjs', '+++ b/electron/sample.cjs', `@@ -${dist},5 +${dist},5 @@`, ...hunkBody, ''].join('\n')
chk(
  doReanchor(bPatch, pristine).results.some((x) => x.found === null),
  '同一 hunk 比对英文原版会找不到（上下文里的中文是词典处理后才有的）',
)

let mirror = null
try {
  mirror = buildMirror(snapshot)
  const mirrored = readTarget(path.join(mirror, 'electron', 'sample.cjs'))
  chk(mirrored.join('\n').includes('"取消"'), '镜像 = 快照 + 词典（双引号里的 Cancel 已变中文）')
  const rMir = doReanchor(bPatch, mirrored)
  chk(rMir.results.every((x) => x.found !== null), '同一 hunk 在镜像里能定位（跨空行的上下文行也参与匹配）')
  chk(rMir.results[0].found === dist, `定位到真实行 ${dist}`)
} finally {
  if (mirror) fs.rmSync(mirror, { recursive: true, force: true })
}

// --- 4) 参数 / 输入契约 ------------------------------------------------------------
chk(preflight('--bad').code === 2, '未知参数 → rc 2')
chk(run([path.join(REPO, 'tools', 'patch_preflight.js'), '--snapshot', path.join(WORK, 'nope')]).code === 2, '快照不存在 → rc 2')
chk(run([path.join(REPO, 'tools', 'patch_preflight.js'), '--snapshot', snapshot, '--patches', path.join(WORK, 'nope')]).code === 2, '补丁目录不存在 → rc 2')
// 快照挂错版本：补丁点名的文件一个都不在 → 必须报错退出，而不是「检查了 0 个 hunk 就算过」
const emptySnap = path.join(WORK, 'empty-snap')
fs.mkdirSync(path.join(emptySnap, 'electron'), { recursive: true })
chk(
  run([path.join(REPO, 'tools', 'reanchor_patch.js'), '--all', '--snapshot', emptySnap, '--patches', patchDir]).code === 2,
  'reanchor：快照里缺补丁点名的文件 → rc 2（不静默通过）',
)

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
