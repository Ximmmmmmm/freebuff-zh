#!/usr/bin/env node
// 补丁重生成（regen）：上游把补丁覆盖的那段代码**改写**了时，用补丁里既有的译文，把补丁重新
// 生成到新版原文上。
//
// 什么时候用它：tools/patch_preflight.js 把「套不上」分诊成两类——
//   · 行号漂移：上下文还在、只是 @@ 头的数字偏了 → tools/reanchor_patch.js 一条命令修好；
//   · 上游改写：hunk 的上下文在新版原文里根本不存在（上游在 hunk **中间**插行/改句）→
//     重锚定救不了，补丁正文本身要重维护，就是本工具的活。
// 0.0.142 适配时上游在 `consent-window.html` 与 `mcp-consent-bridge.cjs` 的 hunk 中间插了
// COD-642 的 Windows 无沙箱提示，两个补丁正是这么坏的。手工改的代价是两个坑——hunk 头上的
// 计数（上下文行 + 删除行）与行首缩进，错一处 git 只会说 `corrupt patch` /
// `patch does not apply`，而报错位置往往离真错处很远（手写时两个坑都踩了）。
//
// 本工具把这活变成机械操作：
//   1. 从现有补丁提取「英文行 → 中文行」映射（hunk 内相邻的删除块 / 新增块逐行配对）；
//   2. 把映射套到**与 build.sh 同口径**的目标文本上（reanchor_patch 的 buildMirror：
//      快照 + 词典 + LF，而不是英文原版——词典替换过的行是补丁的上下文）；
//   3. 用 `diff -u` 生成新补丁正文，**行号与计数交给工具算**；
//   4. 生成后在同一个镜像里 `git apply --check -p1` 复验（与 patch_preflight 同一命令口径）。
//
// 映射不够用时可以叠加来源（`--from <另一个补丁>`）：最常见的用法是把 git 里上一版补丁导出来
// 喂进去（`git show HEAD:patches/x.patch > /tmp/old.patch`），把这一版手工改坏时漏掉的译文补回来。
// 映射里对不上新版原文的行**不会静默丢**：逐条列出来（多半是上游把那句改写了，译文要按新句改）。
//
// 用法：
//   node tools/regen_patch.js <patch> [--target <electron/xxx>] [--from <补丁>]... \
//                             [--snapshot <含 electron/ 的目录>] [--write]
//   node tools/regen_patch.js --broken [--patches <目录>] [--snapshot <目录>] [--write]
//     --broken：只处理补丁目录里**当前套不上**的那些（预检报出来的），逐个重生成
//     --target：默认从补丁头的 `+++ b/<路径>` 推；一个补丁点名多个文件时要逐个处理
//   （不带 --write 只试运行：打印会生成几个 hunk 与复验结果，不落盘）
// 退出码：0 = 生成且复验通过（试运行也算）；1 = 块配不对或复验不通过（未写入）；2 = 用法/输入不对
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { buildMirror, latestSnapshot, targetsOf, readTarget } = require('./reanchor_patch.js')
const { checkApply } = require('./patch_preflight.js')

function usage(msg) {
  if (msg) console.error('ERROR: ' + msg)
  console.error('usage: node tools/regen_patch.js <patch> [--target <electron/xxx>] [--from <补丁>]... \\')
  console.error('                                  [--snapshot <含 electron/ 的目录>] [--write]')
  console.error('       node tools/regen_patch.js --broken [--patches <目录>] [--snapshot <目录>] [--write]')
  process.exit(2)
}

// 纯函数：补丁文本 → { map: [英文行, 中文行][], unpaired: 配不上对的行块[] }
// 配对规则：hunk 内相邻出现的「删除块 + 新增块」、且行数相等，才逐行配对。
// 行数不等说明这不是「同一批行换了措辞」（可能是整段重写），配对会把译文错位，所以只报告不动。
function translationMap(patchText) {
  const segs = []
  for (const raw of patchText.split('\n')) {
    const l = raw.replace(/\r$/, '')
    if (l.startsWith('@@ ') || l.startsWith('--- ') || l.startsWith('+++ ') || l.startsWith('diff ')) continue
    const type = l.startsWith('-') ? 'del' : l.startsWith('+') ? 'add' : null
    if (!type) continue
    const last = segs[segs.length - 1]
    if (last && last.type === type) last.lines.push(l.slice(1))
    else segs.push({ type, lines: [l.slice(1)] })
  }
  const map = []
  const unpaired = []
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].type !== 'del') continue
    const next = segs[i + 1]
    if (!next || next.type !== 'add' || next.lines.length !== segs[i].lines.length) {
      unpaired.push(segs[i].lines)
      continue
    }
    for (let k = 0; k < segs[i].lines.length; k++) map.push([segs[i].lines[k], next.lines[k]])
    i++
  }
  return { map, unpaired }
}

// 纯函数：把映射套到目标行上；同一条英文行给了两种译文时报冲突（保留先到的那条）
function applyMap(targetLines, map) {
  const byEn = new Map()
  const conflicts = []
  for (const [en, zh] of map) {
    if (byEn.has(en)) {
      if (byEn.get(en) !== zh) conflicts.push([en, byEn.get(en), zh])
      continue
    }
    byEn.set(en, zh)
  }
  const missing = [...byEn.keys()].filter((en) => !targetLines.includes(en))
  const lines = targetLines.map((l) => (byEn.has(l) ? byEn.get(l) : l))
  const replaced = targetLines.filter((l) => byEn.has(l)).length
  return { lines, replaced, missing, conflicts }
}

// 用 diff -u 生成补丁正文：`diff -u` 的退出码 1 = 有差异（正常），>1 才是真错
function buildDiff(aText, bText, target, dir) {
  const aFile = path.join(dir, 'a.txt')
  const bFile = path.join(dir, 'b.txt')
  fs.writeFileSync(aFile, aText)
  fs.writeFileSync(bFile, bText)
  let out = ''
  try {
    out = execFileSync('diff', ['-u', '--label', `a/${target}`, '--label', `b/${target}`, aFile, bFile], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (e) {
    if (e.status === 1) return String(e.stdout || '')
    if (e.code === 'ENOENT') usage('找不到 diff 命令（Windows 上请在 Git Bash / Git for Windows 的 PATH 下跑）')
    throw e
  }
  return out
}

// 处理一个补丁。镜像必须已经搭好（--broken 会复用同一个）。
function regenOne(mirror, patchFile, opts) {
  const { snapshot, fromFiles, write, targetOverride } = opts
  const text = fs.readFileSync(patchFile, 'utf8')
  const targets = targetsOf(text)
  if (targetOverride) targets.splice(0, targets.length, targetOverride)
  const rel = path.relative(process.cwd(), patchFile) || patchFile
  if (targets.length !== 1) {
    console.error(`  ✗ ${rel}：点名了 ${targets.length} 个目标文件（本工具一次处理一个）——${targets.join('、')}`)
    return { failed: true, changed: false }
  }
  const target = targets[0]
  const targetFile = path.join(mirror, target)
  if (!fs.existsSync(targetFile)) {
    console.error(`  ✗ ${rel}：镜像里没有 ${target}（快照缺这个文件？）`)
    return { failed: true, changed: false }
  }

  // 1) 映射：补丁自身 + --from 叠加
  const self = translationMap(text)
  const extra = []
  for (const f of fromFiles) {
    if (!fs.existsSync(f)) usage(`--from 的补丁不存在：${f}`)
    const r = translationMap(fs.readFileSync(f, 'utf8'))
    extra.push(...r.map)
  }
  const map = self.map.concat(extra)
  const selfMissing = self.map.filter(([en]) => !readTarget(targetFile).includes(en))

  // 2) 套到镜像（快照 + 词典）的目标文本上
  const before = fs.readFileSync(targetFile, 'utf8')
  const targetLines = readTarget(targetFile)
  const applied = applyMap(targetLines, map)
  const after = applied.lines.join('\n')

  console.log(`补丁重生成：${rel} → ${target}`)
  console.log(
    `  映射：自身 ${self.map.length} 条` +
      (fromFiles.length ? `、--from ${extra.length} 条` : '') +
      ` → 去重后 ${new Set(map.map(([en]) => en)).size} 条`,
  )
  for (const [en, first, second] of applied.conflicts) {
    console.log(`  ! 同一句有两份译文（保留先到的）：${JSON.stringify(en)}`)
    console.log(`      ${JSON.stringify(first)} ／ ${JSON.stringify(second)}`)
  }
  console.log(`  套用：替换 ${applied.replaced} 行 · 未命中 ${applied.missing.length} 行`)
  for (const en of applied.missing) console.log(`  ⚠ 新版原文里没有这一行（上游改写了那句？译文要按新句改）：${JSON.stringify(en)}`)
  if (self.unpaired.length) {
    console.error(`  ✗ 有 ${self.unpaired.length} 个删除块配不上对（行数不等）——需要人工看：`)
    for (const block of self.unpaired) console.error(`      ${JSON.stringify(block)}`)
    return { failed: true, changed: false }
  }

  // 3) 生成补丁正文并复验（复验口径 = patch_preflight：在镜像里 git apply --check -p1）
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regen-patch-'))
  try {
    const newText = buildDiff(before, after, target, dir)
    if (!newText.trim()) {
      console.log('  · 目标文件已是译文，无需改动（补丁可能早就重生成过了）')
      return { failed: false, changed: false }
    }
    const probe = path.join(dir, 'candidate.patch')
    fs.writeFileSync(probe, newText)
    const check = checkApply(mirror, probe)
    const hunks = newText.split('\n').filter((l) => l.startsWith('@@ ')).length
    if (!check.ok) {
      console.error(`  ✗ 生成出来的补丁在镜像里套不上（${hunks} 个 hunk）——未写入：`)
      for (const l of String(check.out).trim().split('\n').slice(0, 6)) console.error(`      git: ${l}`)
      return { failed: true, changed: false }
    }
    console.log(`  hunk：${hunks} 个 · git apply --check 通过 ✓`)
    if (write) {
      fs.writeFileSync(patchFile, newText)
      console.log(`  ✓ 已写入（${newText.split('\n').length - 1} 行）`)
    } else {
      console.log('  （试运行，未写入；确认后加 --write）')
    }
    return { failed: false, changed: true, missing: applied.missing.length, selfMissing: selfMissing.length, newText }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function main() {
  const argv = process.argv.slice(2)
  const write = argv.includes('--write')
  const broken = argv.includes('--broken')
  const take = (flag) => {
    const i = argv.indexOf(flag)
    if (i < 0) return null
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) usage(`${flag} 需要取值`)
    return v
  }
  const fromFiles = argv.reduce((acc, a, i) => (a === '--from' ? acc.concat(argv[i + 1]) : acc), [])
  for (const f of fromFiles) if (f === undefined || f.startsWith('--')) usage('--from 需要取值')
  const snapshot = latestSnapshot(take('--snapshot'))
  if (!snapshot) usage('需要含 electron/ 的原版快照（work/pristine/<版本>/），或显式 --snapshot <目录>')

  const patchDir = take('--patches') ? path.resolve(take('--patches')) : path.join(__dirname, '..', 'patches')
  if (!fs.existsSync(patchDir)) usage(`补丁目录不存在：${patchDir}`)

  let mirror = null
  try {
    mirror = buildMirror(snapshot)
    console.log(`目标：${snapshot}（快照 + 词典，与 build.sh 第 3 步前一致）`)
    console.log()

    if (broken) {
      const files = fs
        .readdirSync(patchDir)
        .filter((f) => /^electron-.*\.patch$/.test(f))
        .sort()
        .map((f) => path.join(patchDir, f))
      if (!files.length) usage(`目录里没有 electron-*.patch：${patchDir}`)
      const failedFiles = files.filter((f) => !checkApply(mirror, f).ok)
      if (!failedFiles.length) {
        console.log(`补丁目录里 ${files.length} 个补丁都能干净套用，没有需要重生成的 ✓`)
        process.exit(0)
      }
      console.log(`套不上的补丁 ${failedFiles.length} 个（共 ${files.length} 个）：`)
      for (const f of failedFiles) console.log(`  · ${path.relative(process.cwd(), f) || f}`)
      console.log()
      let failed = 0
      let changed = 0
      let missing = 0
      for (const f of failedFiles) {
        const r = regenOne(mirror, f, { snapshot, fromFiles, write })
        if (r.failed) failed++
        if (r.changed) changed++
        if (r.missing) missing += r.missing
      }
      console.log()
      console.log(
        `小结：重生成 ${changed} 个 / 失败 ${failed} 个` +
          (missing ? `；${missing} 条映射对不上新版原文（逐条核对）` : '') +
          `${write ? '；已写入（无失败项）' : '（试运行，未写入；确认后加 --write）'}`,
      )
      if (failed) {
        console.error('ERROR: 有补丁重生成失败，未写入。明细见上。')
        process.exit(1)
      }
      process.exit(0)
    }

    const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--from' && argv[i - 1] !== '--snapshot' && argv[i - 1] !== '--patches' && argv[i - 1] !== '--target')
    const patchFile = positional[0]
    if (!patchFile) usage('需要 <patch>（或 --broken 模式）')
    if (!fs.existsSync(patchFile)) usage(`补丁不存在：${patchFile}`)
    const r = regenOne(mirror, path.resolve(patchFile), {
      snapshot,
      fromFiles: fromFiles.map((f) => path.resolve(f)),
      write,
      targetOverride: take('--target'),
    })
    process.exit(r.failed ? 1 : 0)
  } finally {
    if (mirror) fs.rmSync(mirror, { recursive: true, force: true })
  }
}

if (require.main === module) main()

module.exports = { translationMap, applyMap, buildDiff }
