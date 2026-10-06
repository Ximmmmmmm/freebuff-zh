#!/usr/bin/env node
// 接线守卫：tools/test_*.js 与 ci.yml 里**真的跑到**的那批自测，必须一一对应。
//
// 为什么单独立一道：CI 里的自测是在 workflow 里逐个点名的（不是通配），于是「本地新加了一个自测、
// 忘了在 ci.yml 里加一步」是一种**静默**失败——本地 `node tools/test_x.js` 绿着、CI 也全绿，而那个
// 自测从来没在 CI 上跑过。反方向（删了文件留了步骤）会以 node 的 module not found 出现，读起来像
// 「工具坏了」而不像「接线断了」。两种都在这道守卫里点名。
//
// 判据只读文本、不引 YAML 依赖（工具链全是零依赖 node 脚本）：
//   · 只扫 `run:`：单行形态与 `run: |` / `run: >` 折叠块都收，块内以 `#` 开头的行按注释丢掉。
//     ——本仓库的注释爱提文件名，「注释里提到的名字不算接线」必须钉死，否则守卫自己就会误报；
//   · 只认 `node <路径>`，路径落在 tools/ 下、basename 以 `test_` 开头；
//   · 磁盘侧 = tools/ 目录里 basename 匹配 `test_*.js` 的文件（与「工具脚本语法冒烟」同一口径）。
// 另有三类「接进去了但未必真跑」，只警告不拦 CI（它们不等于接线断了）：
//   · 同一个自测被多处引用（白跑一遍）；
//   · 所在步骤带 `if:`（在别的 runner 上会被跳过）；
//   · 触发 `paths` 不再覆盖 `tools/**`（改了 tools/ 不触发 CI，等于没接）。
//
// 用法：node tools/ci_wiring.js [--ci <ci.yml>] [--tools <目录>] [--list] [-h]
//   --ci / --tools 是给自测与排障用的（拿合成夹具跑，不必碰真仓库）；
//   --list 逐个打印「自测 ← workflow 行号 / 步骤名」。
// 退出码：0 接线完整；1 有漏接线 / 悬空引用；2 环境不对（workflow 或目录读不到、参数不对）
'use strict'
const fs = require('fs')
const path = require('path')

const REPO = path.join(__dirname, '..')
const argv = process.argv.slice(2)

// --- 参数 -------------------------------------------------------------------------
let ciPath = path.join(REPO, '.github', 'workflows', 'ci.yml')
let toolsDir = path.join(REPO, 'tools')
let LIST = false
const die = (msg) => {
  console.error(`ERROR: ${msg}`)
  process.exit(2)
}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '-h' || a === '--help') {
    console.log(
      [
        '用法：node tools/ci_wiring.js [--ci <ci.yml>] [--tools <目录>] [--list]',
        '  校验 tools/test_*.js 与 workflow 里真的跑到的自测一一对应。',
        '  退出码：0 接线完整；1 有漏接线 / 悬空引用；2 环境不对。',
      ].join('\n'),
    )
    process.exit(0)
  }
  if (a === '--list') {
    LIST = true
  } else if (a === '--ci' || a === '--tools') {
    const v = argv[++i]
    if (!v) die(`${a} 需要一个值`)
    if (a === '--ci') ciPath = path.resolve(v)
    else toolsDir = path.resolve(v)
  } else {
    die(`未知参数：${a}（支持 --ci <ci.yml> / --tools <目录> / --list）`)
  }
}

// 打印路径时尽量给仓库内相对路径，读起来短
const show = (p) => {
  const rel = path.relative(REPO, p)
  const s = rel && !rel.startsWith('..') ? rel : p
  return s.replace(/\\/g, '/')
}

if (!fs.existsSync(ciPath)) die(`workflow 不存在：${ciPath}`)
if (!fs.existsSync(toolsDir) || !fs.statSync(toolsDir).isDirectory()) die(`tools 目录不存在：${toolsDir}`)
const workflow = fs.readFileSync(ciPath, 'utf8')
if (!workflow.trim()) die(`workflow 是空文件：${ciPath}`)

// 去掉 YAML 值外层的引号（只去**成对**的那种：`if: 'x'` 去引号，而 `runner.os == 'Windows'`
// 尾引号属于值本身，拿去就会把警告里的条件原文写残）
const unquote = (v) => (/^(['"]).*\1$/.test(v) ? v.slice(1, -1) : v)

// --- 把 workflow 里的 `run:` 脚本抠出来（含它属于哪个步骤、步骤带不带 if）------------
// 行扫描而非 YAML 解析：依赖为零、结果可复算，代价是只认「run: 写在键位置」这一种写法——
// 本仓库的 workflow 全用这种写法，真换了形态也会因为「一个自测都没扫到」而在这里报错，不会静默放行。
function extractRuns(text) {
  const lines = text.split(/\r?\n/)
  const runs = []
  let step = ''
  let stepIf = ''
  let blockEnd = -1 // 折叠块吃掉的行，不再当键值看
  for (let i = 0; i < lines.length; i++) {
    if (i <= blockEnd) continue
    const line = lines[i]
    if (/^\s*-\s+\S/.test(line)) {
      step = '' // 新步骤开始
      stepIf = ''
    }
    const nm = line.match(/^\s*(?:-\s+)?name:\s*(.+?)\s*$/)
    if (nm) step = unquote(nm[1])
    const im = line.match(/^\s*(?:-\s+)?if:\s*(.+?)\s*$/)
    if (im) stepIf = unquote(im[1])
    const rm = line.match(/^(\s*)(?:-\s+)?run:\s*(.*?)\s*$/)
    if (!rm) continue
    const indent = rm[1].length
    const value = rm[2]
    if (value === '' || /^[|>][-+]?\d*$/.test(value)) {
      const body = []
      let j = i + 1
      for (; j < lines.length; j++) {
        const l = lines[j]
        if (l.trim() === '') {
          body.push(l)
          continue
        }
        if (l.match(/^\s*/)[0].length <= indent) break
        if (l.trim().startsWith('#')) continue // 块内注释：提到文件名也不算接线
        body.push(l)
      }
      blockEnd = j - 1
      runs.push({ script: body.join('\n'), line: i + 1, step, ifCond: stepIf })
    } else {
      runs.push({ script: value, line: i + 1, step, ifCond: stepIf })
    }
  }
  return runs
}

const runs = extractRuns(workflow)

// --- 从 run 脚本里挑出「跑自测」的引用（其它 node 调用如 --check / -e 不参与）----------
const refs = []
for (const r of runs) {
  for (const m of r.script.matchAll(/\bnode\s+([^\s"';|&()<>]*\.js)/g)) {
    const raw = m[1].replace(/\\/g, '/')
    const base = path.posix.basename(raw)
    if (!/^test_.*\.js$/.test(base)) continue // 非自测（lint_dict / apply / ci_gates …）
    if (!/(?:^|\/)tools\//.test(raw)) continue // 自测按约定只住在 tools/
    refs.push({ file: base, line: r.line, step: r.step, ifCond: r.ifCond })
  }
}

// --- 两侧集合 --------------------------------------------------------------------
const onDisk = fs
  .readdirSync(toolsDir)
  .filter((n) => /^test_.*\.js$/.test(n))
  .sort()
if (onDisk.length === 0) die(`${show(toolsDir)} 里一个 test_*.js 都没有——目录给错了吧`)
const wired = [...new Set(refs.map((r) => r.file))].sort()

const errors = []
const warns = []

// E1 漏接线：文件在，workflow 里没人跑它
for (const n of onDisk.filter((n) => !wired.includes(n))) {
  errors.push(
    `E1 漏接线：tools/${n} 在磁盘上，但 ${show(ciPath)} 里没有任何一步跑它` +
      `——新加自测就把 \`node tools/${n}\` 接进 dict-lint 的步骤里`,
  )
}
// E2 悬空引用：workflow 里跑了，磁盘上没有
for (const n of wired.filter((n) => !onDisk.includes(n))) {
  const r = refs.find((x) => x.file === n)
  errors.push(
    `E2 悬空引用：${show(ciPath)}:${r.line} 跑了 tools/${n}，但磁盘上没有这个文件` +
      `${r.step ? `（步骤「${r.step}」）` : ''}`,
  )
}
// W1 重复接线
for (const n of wired) {
  const rs = refs.filter((r) => r.file === n)
  if (rs.length > 1) {
    warns.push(`W1 重复接线：tools/${n} 被 ${rs.length} 处跑到（${rs.map((r) => `:${r.line}`).join('、')}）——白跑一遍，删掉多余的那步`)
  }
}
// W2 步骤带 if:（别的 runner 上不跑）
for (const r of refs) {
  if (!r.ifCond) continue
  warns.push(
    `W2 会被跳过：tools/${r.file}（${show(ciPath)}:${r.line}${r.step ? `，步骤「${r.step}」` : ''}）所在步骤带 ` +
      `\`if: ${r.ifCond}\`——其它 runner 上这一步不跑，自测在那边等于没接`,
  )
}
// W3 触发路径不覆盖 tools/
const pathsLists = [...workflow.matchAll(/^\s*paths:\s*\[([^\]]*)\]/gm)].map((m) => m[1])
if (pathsLists.length > 0 && !pathsLists.some((v) => /tools\//.test(v))) {
  warns.push('W3 触发路径：workflow 的 paths 过滤里没有 tools/**——改 tools/ 不触发 CI，接线等于白接')
}

// --- 汇总 ------------------------------------------------------------------------
console.log(`ci_wiring: ${show(ciPath)} ←→ ${show(toolsDir)}`)
console.log(
  `  · 磁盘上 ${onDisk.length} 个自测，workflow 里点到 ${wired.length} 个（${refs.length} 处引用，` +
    `分布在 ${new Set(refs.map((r) => r.line)).size} 个 run 步骤）`,
)
if (LIST) {
  for (const n of wired) {
    const r = refs.find((x) => x.file === n)
    console.log(`  · tools/${n} ← ${path.basename(ciPath)}:${r.line}${r.step ? `（${r.step}）` : ''}`)
  }
}
if (warns.length) {
  console.log(`\n警告 ${warns.length} 条:`)
  for (const w of warns) console.log('  ! ' + w)
}
if (errors.length) {
  console.log(`\n错误 ${errors.length} 条:`)
  for (const e of errors) console.log('  ✗ ' + e)
  console.log(`\n::error::ci_wiring：有 ${errors.length} 处接线问题——tools/test_*.js 与 ${path.basename(ciPath)} 里跑到的必须一一对应。`)
  process.exit(1)
}
console.log(`\n✓ 接线完整：${onDisk.length} 个自测与 ${path.basename(ciPath)} 里跑到的集合一一对应。`)
