#!/usr/bin/env node
// 补丁重锚定：把 patches/electron-*.patch 里每个 hunk 的行号重新锚定到**目标文件的真实位置**，
// 只改 @@ 头里的两个数字，补丁正文一个字节不动。
//
// 为什么需要它：上游在补丁覆盖区之前插了几行（0.0.131 那次是 macOS 应用菜单 / File 菜单各插
// 一条 `Settings…`），后面所有 hunk 的旧行号就整体偏了。git apply 的 hunk 搜索窗口受相邻 hunk
// 行号约束，偏移大的 hunk 会搜不到（报 "patch failed: electron/main.cjs:1500"），**即使那段
// 上下文在文件里逐字节存在**。两种情况必须分开：
//   · 上下文找得到、只是行号漂了 → 本工具一条命令修好（上游插行，补丁内容仍然有效）；
//   · 上下文根本找不到 → 上游改写了这段代码，补丁内容本身要人工重维护（重锚定救不了）。
// tools/patch_preflight.js 会先替你把两种情况分开，再决定跑 --write 还是动手改。
//
// 目标文件的口径必须与 build.sh 一致，否则全是误报：build.sh 是「先套词典（tools/apply.js）、
// 再去掉 CR、最后 git apply」，所以补丁的上下文里**可能带中文**（如 consent-window.html 的
// `Cancel/Approve` → `取消/批准`）。本工具因此默认搭一个「快照 + 词典」的预处理镜像当目标
// （buildMirror），而不是直接比对英文原版：
//   · hunk 的上下文行写成空行（不是「一个空格 + 空」）时也是上下文——早期实现把它当噪音丢掉，
//     结果跨过空行的 hunk 一律误报「上下文找不到」。
//
// 用法：
//   node tools/reanchor_patch.js <patch> <目标文件> [--write]        # 单个补丁（目标文件自备）
//   node tools/reanchor_patch.js --all [--snapshot <含 electron/ 的目录>] [--patches <目录>] [--write]
//                                                                    # 全部补丁（默认最新快照 + 仓库 patches/）
//   （不带 --write 只试运行，打印会改几个 hunk，不落盘）
// 退出码：0 = 每个 hunk 都定位到（可能改了行号）；1 = 有 hunk 的上下文找不到（需人工重维护）；2 = 参数/输入不对
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

function usage(msg) {
  if (msg) console.error('ERROR: ' + msg)
  console.error('usage: node tools/reanchor_patch.js <patch> <目标文件> [--write]')
  console.error('       node tools/reanchor_patch.js --all [--snapshot <含 electron/ 的目录>] [--patches <目录>] [--write]')
  process.exit(2)
}

// 读目标文件：去掉行尾 CR（build.sh 在打补丁前会统一成 LF）
function readTarget(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
}

// 纯函数：拿补丁文本和目标文件的行数组，返回重锚定后的文本与逐 hunk 结果
function reanchor(patchText, targetLines) {
  const hadFinalNewline = patchText.endsWith('\n')
  const lines = patchText.split('\n')
  if (hadFinalNewline) lines.pop() // 末尾换行切出来的空元素不算 hunk 行
  const out = []
  const results = []
  let i = 0
  let delta = 0 // 「+」侧相对「-」侧的累计偏移
  let searchFrom = 0 // 下一个 hunk 的 preimage 从哪一行开始找（保持 hunk 顺序）
  while (i < lines.length) {
    const line = lines[i]
    if (!line.startsWith('@@')) {
      out.push(line)
      i++
      continue
    }
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line)
    if (!m) {
      out.push(line)
      i++
      continue
    }
    const oldStart = Number(m[1])
    const oldCount = m[2] === undefined ? 1 : Number(m[2])
    const newCount = m[4] === undefined ? 1 : Number(m[4])
    const hadCounts = m[2] !== undefined && m[4] !== undefined
    const tail = m[5] || '' // 「@@」后面那段函数名上下文，原样保留
    const body = []
    i++
    while (i < lines.length && !lines[i].startsWith('@@ ') && !lines[i].startsWith('--- ') && !lines[i].startsWith('diff ')) {
      body.push(lines[i])
      i++
    }
    // 上下文行有三种写法：' ' 开头、'-' 开头、以及**空行**（等同于「一个空格」）
    const preimage = body.filter((l) => l === '' || l.startsWith(' ') || l.startsWith('-')).map((l) => l.slice(1))

    let found = -1
    for (let s = searchFrom; s + preimage.length <= targetLines.length; s++) {
      let ok = true
      for (let k = 0; k < preimage.length; k++) {
        if (targetLines[s + k] !== preimage[k]) {
          ok = false
          break
        }
      }
      if (ok) {
        found = s
        break
      }
    }
    if (found < 0) {
      results.push({ oldStart, found: null, moved: false })
      out.push(line)
      out.push(...body)
      continue
    }
    const trueOldStart = found + 1
    const moved = trueOldStart !== oldStart
    results.push({ oldStart, found: trueOldStart, moved })
    // 只在数字真的变了才重写这一行，避免顺手把 `@@ -1 +1 @@` 改写成 `@@ -1,1 +1,1 @@`
    out.push(
      moved
        ? `@@ -${trueOldStart}${hadCounts ? `,${oldCount}` : ''} +${trueOldStart + delta}${hadCounts ? `,${newCount}` : ''} @@${tail}`
        : line,
    )
    out.push(...body)
    delta += newCount - oldCount
    searchFrom = found + preimage.length
  }
  return { text: out.join('\n') + (hadFinalNewline ? '\n' : ''), results }
}

// 补丁里点名的目标文件（-p1 口径：b/<路径>）
function targetsOf(patchText) {
  return [...patchText.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1].replace(/\r$/, ''))
}

// 快照目录：显式给了就用；否则取 work/pristine 里版本号最大且含 electron/ 的
function latestSnapshot(dir) {
  if (dir) return path.resolve(dir)
  const base = path.join(__dirname, '..', 'work', 'pristine')
  if (!fs.existsSync(base)) return null
  const withElectron = fs.readdirSync(base).filter((d) => fs.existsSync(path.join(base, d, 'electron')))
  for (const d of withElectron.sort().reverse()) return path.join(base, d)
  return null
}

// 「快照 + 词典」预处理镜像：build.sh 打补丁是**在套完词典之后**，所以补丁上下文里可能带中文。
// 直接比对英文原版会把这类 hunk 误判成「上游改写了」（0.0.131 的 consent-window.html 就是这样
// 被误报的）。这里只拷 electron/ 下的文本文件（无需解包 asar），跑一遍 apply.js 再统一成 LF，
// 得到的文本与 build.sh 第 3 步前的状态一致。调用方负责删除返回的临时目录。
function buildMirror(snapshot, outDir) {
  const src = path.join(snapshot, 'electron')
  if (!fs.existsSync(src)) usage(`快照里没有 electron/：${snapshot}`)
  const dir = outDir || fs.mkdtempSync(path.join(os.tmpdir(), 'hanhua-mirror-'))
  fs.mkdirSync(path.join(dir, 'electron'), { recursive: true })
  const files = fs.readdirSync(src).filter((f) => /\.(cjs|html)$/.test(f))
  for (const f of files) fs.copyFileSync(path.join(src, f), path.join(dir, 'electron', f))
  const applyJs = path.join(__dirname, 'apply.js')
  for (const f of files) {
    execFileSync(process.execPath, [applyJs, path.join(dir, 'electron', f), '--write', '--quiet'])
  }
  for (const f of files) {
    const p = path.join(dir, 'electron', f)
    const body = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
    fs.writeFileSync(p, body)
  }
  return dir
}

function main() {
  const argv = process.argv.slice(2)
  const write = argv.includes('--write')
  const rest = argv.filter((a) => a !== '--write')
  const snapIdx = rest.indexOf('--snapshot')
  const patchIdx = rest.indexOf('--patches')

  if (rest[0] === '--all') {
    const snap = latestSnapshot(snapIdx >= 0 ? rest[snapIdx + 1] : null)
    if (!snap) usage('--all 需要含 electron/ 的原版快照（work/pristine/<版本>/），或显式 --snapshot <目录>')
    const patchDir = patchIdx >= 0 ? path.resolve(rest[patchIdx + 1]) : path.join(__dirname, '..', 'patches')
    if (!fs.existsSync(patchDir)) usage(`补丁目录不存在：${patchDir}`)
    const files = fs.readdirSync(patchDir).filter((f) => /^electron-.*\.patch$/.test(f)).sort()
    if (!files.length) usage(`目录里没有 electron-*.patch：${patchDir}`)
    let mirror = null
    let failed = 0
    let movedTotal = 0
    let skipped = 0
    try {
      mirror = buildMirror(snap)
      console.log(`补丁重锚定：${files.length} 个补丁 ← ${snap}（目标＝快照 + 词典）`)
      for (const f of files) {
        const p = path.join(patchDir, f)
        let text = fs.readFileSync(p, 'utf8')
        let movedFile = 0
        let lostFile = []
        for (const t of targetsOf(text)) {
          const target = path.join(mirror, t)
          if (!fs.existsSync(target)) {
            console.log(`  ! ${f}：快照里没有 ${t}，跳过（换 --snapshot 指向含该文件的版本）`)
            skipped++
            continue
          }
          const r = reanchor(text, readTarget(target))
          movedFile += r.results.filter((x) => x.moved).length
          lostFile.push(...r.results.filter((x) => x.found === null).map((x) => x.oldStart))
          text = r.text
        }
        movedTotal += movedFile
        if (lostFile.length) {
          failed++
          console.log(`  ✗ ${f}：${lostFile.length} 个 hunk 的上下文在目标文件里找不到 → 上游改写了这段，需人工重维护`)
          for (const s of lostFile) console.log(`      · hunk @@ -${s}`)
        } else if (movedFile) {
          console.log(`  ✓ ${f}：${movedFile} 个 hunk 行号漂移（${write ? '已写入' : '试运行，未写入'}）`)
        }
        if (write && !lostFile.length) fs.writeFileSync(p, text)
      }
    } finally {
      if (mirror) fs.rmSync(mirror, { recursive: true, force: true })
    }
    console.log(
      `\n共 ${movedTotal} 个 hunk 需要重锚定，${failed} 个补丁有 hunk 找不到` +
        (skipped ? `，${skipped} 个目标文件在快照里没有（未参与判定）` : '') +
        `${write ? '；已写入（无 hunk 找不到的补丁）' : '（试运行，未写入；确认后加 --write）'}`,
    )
    // 一个 hunk 都没真正检查过就不算通过（快照挂错版本时最容易发生）
    if (skipped && movedTotal === 0 && failed === 0) {
      console.error('ERROR: 没有检查到任何 hunk——快照里缺少补丁点名的目标文件，请核对 --snapshot ')
      process.exit(2)
    }
    process.exit(failed ? 1 : 0)
  }

  // 位置参数 = 非选项、且不是 --snapshot / --patches 的取值
  const positional = rest.filter((a, i) => !a.startsWith('--') && !['--snapshot', '--patches'].includes(rest[i - 1]))
  const [patchPath, targetPath] = positional
  if (!patchPath || !targetPath) usage('需要 <patch> 与 <目标文件>')
  if (!fs.existsSync(patchPath)) usage(`补丁不存在：${patchPath}`)
  if (!fs.existsSync(targetPath)) usage(`目标文件不存在：${targetPath}`)
  const r = reanchor(fs.readFileSync(patchPath, 'utf8'), readTarget(targetPath))
  const failed = r.results.filter((x) => x.found === null)
  for (const x of failed) console.error(`  ! hunk @@ -${x.oldStart} 的上下文在 ${targetPath} 里找不到`)
  if (write && !failed.length) fs.writeFileSync(patchPath, r.text)
  console.log(
    `  重新锚定 ${r.results.filter((x) => x.moved).length} 个 hunk，失败 ${failed.length} 个` +
      `（${write ? '已写入' : '试运行，未写入'}）`,
  )
  process.exit(failed.length ? 1 : 0)
}

if (require.main === module) main()
module.exports = { reanchor, targetsOf, latestSnapshot, readTarget, buildMirror }
