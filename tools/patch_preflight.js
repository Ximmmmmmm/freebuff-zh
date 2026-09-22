#!/usr/bin/env node
// 补丁锚点预检：patches/electron-*.patch 还套得上吗？套不上是「行号漂移」还是「上游改写」？
//
// 为什么需要它：build.sh 第 3 步套补丁失败时只会说一句「补丁未干净套用：xxx（原版文件与补丁
// 预期不符？需重新维护 patches）」，而实际情况分两种，处置完全不同：
//   · 行号漂移：上游在补丁覆盖区之前插了几行，hunk 的旧行号整体偏了。git apply 的搜索窗口受
//     相邻 hunk 行号约束，偏移大的 hunk 搜不到——但那段上下文逐字节还在。修法：一条命令
//     重锚定（tools/reanchor_patch.js），补丁内容不动。
//   · 上游改写：那段代码真的被改写了，补丁正文要人工重维护。
// 这一区分在 0.0.131 适配时是我临时写脚本才做出来的（当时 main.cjs 的菜单补丁正是行号漂移，
// 而 consent-window.html 的补丁因为「空上下文行」被脚本误报成改写）。本工具把分诊固化下来。
//
// 目标文本的口径与 build.sh 一致：补丁是**套完词典之后**才打的，所以这里也用
// 「快照 + 词典」镜像（tools/reanchor_patch.js 的 buildMirror），而不是直接比对英文原版——
// 否则 consent-window.html 那类上下文带中文的补丁会一律误报。
//
// 用法：
//   node tools/patch_preflight.js [--snapshot <含 electron/ 的目录>] [--patches <目录>] [--verbose]
// 退出码：0 = 每个补丁都能干净套用；1 = 有补丁套不上（附分诊与修法）；2 = 参数/输入不对
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { reanchor, targetsOf, latestSnapshot, readTarget, buildMirror } = require('./reanchor_patch.js')

function usage(msg) {
  if (msg) console.error('ERROR: ' + msg)
  console.error('usage: node tools/patch_preflight.js [--snapshot <含 electron/ 的目录>] [--patches <目录>] [--verbose]')
  process.exit(2)
}

// 在镜像里跑 git apply --check -p1（与 build.sh 同一命令、同一工作目录口径）
function checkApply(mirrorDir, patchFile) {
  try {
    execFileSync('git', ['apply', '--check', '-p1', patchFile], { cwd: mirrorDir, stdio: 'pipe' })
    return { ok: true }
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.stdout || e.message || '') }
  }
}

function main() {
  const argv = process.argv.slice(2)
  let snapArg = null
  let patchDir = path.join(__dirname, '..', 'patches')
  let verbose = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--snapshot') snapArg = argv[++i]
    else if (a === '--patches') patchDir = path.resolve(argv[++i])
    else if (a === '--verbose') verbose = true
    else usage(`未知参数：${a}`)
  }
  if (!fs.existsSync(patchDir)) usage(`补丁目录不存在：${patchDir}`)
  const snap = latestSnapshot(snapArg)
  if (!snap) usage('需要含 electron/ 的原版快照（work/pristine/<版本>/），或显式 --snapshot <目录>')

  const files = fs.readdirSync(patchDir).filter((f) => /^electron-.*\.patch$/.test(f)).sort()
  if (!files.length) usage(`目录里没有 electron-*.patch：${patchDir}`)

  let mirror = null
  const broken = []
  try {
    mirror = buildMirror(snap)
    console.log(`补丁锚点预检：${files.length} 个补丁 ← ${snap}（目标＝快照 + 词典，与 build.sh 第 3 步前一致）`)
    for (const f of files) {
      const p = path.join(patchDir, f)
      const r = checkApply(mirror, p)
      if (r.ok) {
        if (verbose) console.log(`  ✓ ${f}`)
        continue
      }
      // 套不上 → 分诊：逐 hunk 试着定位（上下文在不在）
      const text = fs.readFileSync(p, 'utf8')
      const lost = []
      for (const t of targetsOf(text)) {
        const target = path.join(mirror, t)
        if (!fs.existsSync(target)) {
          lost.push({ file: t, hunks: ['（镜像里没有这个文件）'] })
          continue
        }
        const res = reanchor(text, readTarget(target))
        const miss = res.results.filter((x) => x.found === null).map((x) => x.oldStart)
        if (miss.length) lost.push({ file: t, hunks: miss })
      }
      broken.push({ f, out: r.out, lost, targets: targetsOf(text) })
    }
  } finally {
    if (mirror) fs.rmSync(mirror, { recursive: true, force: true })
  }

  if (!broken.length) {
    console.log(`  ✓ ${files.length} 个补丁都能干净套用`)
    process.exit(0)
  }

  console.log(`\n## ❌ 套不上的补丁 ${broken.length} 个`)
  for (const b of broken) {
    console.log(`   · ${b.f}`)
    if (verbose && b.out) for (const l of b.out.trim().split('\n')) console.log(`       git: ${l}`)
    if (!b.lost.length) {
      console.log('       → 每个 hunk 的上下文都在（行号漂移），补丁内容有效：')
      for (const t of b.targets) {
        console.log(`         node tools/reanchor_patch.js "${path.join(path.relative(process.cwd(), patchDir), b.f)}" <镜像里的 ${t}> --write`)
      }
      console.log('         （或在仓库根直接跑：node tools/reanchor_patch.js --all --write，再重跑本预检）')
    } else {
      console.log('       → 以下 hunk 的上下文在目标文件里找不到（上游改写了这段，重锚定救不了）：')
      for (const l of b.lost) console.log(`         ${l.file}：hunk @@ -${l.hunks.join('、@@ -')}`)
      console.log('         需按新版原文改写补丁正文（find/apply 两侧都对一遍）。')
    }
  }
  console.error(`\nERROR: 有 ${broken.length} 个补丁套不上（分诊与修法见上）`)
  process.exit(1)
}

if (require.main === module) main()
module.exports = { checkApply }
