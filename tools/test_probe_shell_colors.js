#!/usr/bin/env node
// probe_shell_colors 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 为什么需要它：这处补丁守的是「窗口按钮区与标签条对得上」，而它有两种**静默**坏法：
//   · overlay 被改回不透明色 —— 开壁纸时右上角重新露出一块实心矩形（0.0.154 那块色差的同族问题）；
//   · 图标色那侧的变量转发没解到底（把 `var(…)` 当颜色交出去）。
// 两者哨兵都照旧全绿。差一点点也会写出一条会误报的探针（早期实现就误报过两次：一次把舞台搭错，
// 块读不到 CSS 静默回落成写死值；一次只删了校验、没还原旧的直返写法，于是反例被照成绿色）。
// 所以纪律要钉住：
//   a) 判决必须**跟着补丁走**：同一份源码，修好的版本 rc 0，两种反例各 rc 1（原因要指到位）；
//   b) 块本身必须是从 `patches/electron-main.cjs.patch` 的**新增行**拼出来的——补丁改坏了，本自测就红；
//   c) 拿不到证据时必须 rc 2（缺块 / CSS 解不出颜色 / 参数不对），不冒充判决。
//
// 覆盖：
//   1. 补丁正文里的块（overlay 全透明 + `--faint` 解到底）→ rc 0，值必须都对；
//   2. 反例：overlay 不透明 → rc 1（「不是全透明」）；
//   2b. 反例：图标色写成直返 `lastVar(...) || fallback.x`（var 转发没解到底）→ rc 1；
//   3. 界面 CSS 解不出颜色（变量成环）→ rc 2；英文原版里的缺失 → `--expect missing` rc 0 / `--expect ok` rc 2；
//   4. CLI 退出码契约：不给参数 / --expect 非法 / 文件不存在 → rc 2；
//   5. 本机有英文原版快照与产物 ui 时，顺带对真实补丁产物取证一次（CI 上没有就跳过）。
//
// 用法：node tools/test_probe_shell_colors.js        # 退出码非 0 表示回归
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const WORK = path.join(REPO, 'work', 'test-probe-shell-colors')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

let fail = 0
const chk = (cond, label) => {
  if (cond) console.log(`  ok  ${label}`)
  else {
    console.log(`  FAIL ${label}`)
    fail++
  }
}

const runCli = (args) => {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'probe_shell_colors.js'), ...args], {
      encoding: 'utf8',
      cwd: REPO,
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') }
  }
}

// --- 补丁正文里的块 ------------------------------------------------------------
// 从第一个 hunk 的新增行里拼出块本身（与装机产物逐字一致的那段），再套进一个最小的 main.cjs。
const patch = fs.readFileSync(path.join(REPO, 'patches', 'electron-main.cjs.patch'), 'utf8').split('\n')
const added = []
let inFirstHunk = false
for (const line of patch) {
  if (line.startsWith('@@')) {
    if (inFirstHunk) break
    inFirstHunk = true
    continue
  }
  if (inFirstHunk && line.startsWith('+')) added.push(line.slice(1))
}
const blockText = added.join('\n')

/** 界面 CSS 的夹具：忠实照抄真实形态（两段 :root；标签条 60 → 48 覆盖） */
const CSS = [
  ':root{--shell-base: #292b2a;--workspace-surface: #1c1d1c;--bg: var(--workspace-surface);--chrome: var(--shell-base);--faint: #858984;}',
  ':root[data-theme=light]{--shell-base: #e3e7e4;--workspace-surface: #f0f2ef;--bg: var(--workspace-surface);--chrome: var(--shell-base);--faint: #667168;}',
  ':root{--tabbar-height: 60px}',
  '.app-workspace{--tabbar-height: 48px}.tabbar{height: var(--tabbar-height);border-bottom: 1px solid var(--border)}',
].join('')
/** 同一份夹具，但深色 `--faint` 走一层 var 转发 —— 用来钉住「转发没解到底」那条反例 */
const CSS_FORWARD = CSS.replace('--faint: #858984;', '--faint-base: #858984;--faint: var(--faint-base);')
const HTML = '<html><head><link rel="stylesheet" href="./assets/index-fixture.css"></head><body></body></html>'

function makeUi(dir, css = CSS) {
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), HTML)
  fs.writeFileSync(path.join(dir, 'assets', 'index-fixture.css'), css)
  return dir
}
function makeMain(name, block) {
  const f = path.join(WORK, name)
  fs.writeFileSync(f, `const fs = require('fs')\nconst path = require('path')\nlet appUrl = null\n\n${block}\n\nconst SHELL_THEMES = { light: { overlay: HANHUA_SHELL_COLORS.overlay } }\n`)
  return f
}

/** 旧写法（0.0.154 装机后右上角那块色差的成因）：把 shellColor 换回直返 lastVar(...) */
const toOldStyle = (block) =>
  block.replace(/shellColor\((.*?), '(\w+)', fallback\.(\w+)\)/g, (_m, re, name, fb) => `lastVar(${re}, '${name}') || fallback.${fb}`)

;(() => {
  console.log('1) 补丁正文里的块（overlay 全透明 + 图标色解 var 转发）')
  chk(blockText.includes('const HANHUA_SHELL_COLORS = (() => {'), '从补丁新增行里抽到了块')
  chk(blockText.includes("overlay: 'rgba(0, 0, 0, 0)'"), '块里的 overlay 是全透明色（不画底色）')
  chk(blockText.includes('shellColor('), '图标色用的是会解 var() 转发的 shellColor')
  const ui = makeUi(path.join(WORK, 'ui'))
  const fixedMain = makeMain('fixed-main.cjs', blockText)
  const ok = runCli([fixedMain, '--ui', ui, '--expect', 'ok'])
  chk(ok.code === 0, `修好的块 → rc 0（实际 ${ok.code}）`)
  chk(/overlay=rgba\(0, 0, 0, 0\)/.test(ok.out), '检出 overlay 全透明')
  chk(/symbolLight=#667168/.test(ok.out), '浅色图标色解到了 --faint 的字面量 #667168')
  chk(/height=47/.test(ok.out), '高度按「标签条 48 − 底部边框 1」算成 47')

  console.log('\n2) 反例：overlay 被改回不透明色（开壁纸时右上角那块实心矩形）')
  const opaqueBlock = blockText.replace("overlay: 'rgba(0, 0, 0, 0)'", "overlay: '#292b2a'")
  chk(opaqueBlock !== blockText, '反例确实改到了 overlay 那一行')
  const bad = runCli([makeMain('opaque-main.cjs', opaqueBlock), '--ui', ui, '--expect', 'ok'])
  chk(bad.code === 1, `不透明 overlay → rc 1（实际 ${bad.code}）`)
  chk(/不是全透明/.test(bad.out), '原因指到「不是全透明」')

  console.log('\n2b) 反例：图标色写成直返 lastVar(...)（var 转发没解到底）')
  const uiForward = makeUi(path.join(WORK, 'ui-forward'), CSS_FORWARD)
  const oldMain = makeMain('old-main.cjs', toOldStyle(blockText))
  const badFwd = runCli([oldMain, '--ui', uiForward, '--expect', 'ok'])
  chk(badFwd.code === 1, `旧写法 → rc 1（实际 ${badFwd.code}）`)
  chk(/不是颜色字面量/.test(badFwd.out), '原因指到「不是颜色字面量」（而不是笼统的「对不上」）')

  console.log('\n3) 拿不到证据 → rc 2')
  const cyclic = makeUi(path.join(WORK, 'ui-cyclic'), ':root{--faint: #0f0f0f} :root[data-theme=light]{--faint: var(--a);--a: var(--b);--b: var(--a)} .tabbar{border-bottom: 1px solid red}')
  chk(runCli([fixedMain, '--ui', cyclic, '--expect', 'ok']).code === 2, 'CSS 里变量成环 → rc 2')
  const plain = makeMain('plain-main.cjs', '// 英文原版：没有这一节\nconst SHELL_THEMES = { light: { overlay: "#e3e7e4" } }')
  chk(runCli([plain, '--ui', ui, '--expect', 'missing']).code === 0, '没有块 + --expect missing → rc 0（英文原版）')
  chk(runCli([plain, '--ui', ui, '--expect', 'ok']).code === 2, '没有块 + --expect ok → rc 2（抽不到，不猜）')

  console.log('\n4) CLI 退出码契约')
  chk(runCli([]).code === 2, '不给参数 → rc 2')
  chk(runCli([fixedMain, '--ui', ui, '--expect', 'maybe']).code === 2, '--expect 取值非法 → rc 2')
  chk(runCli([path.join(WORK, 'nope.cjs'), '--ui', ui]).code === 2, '文件不存在 → rc 2')
  chk(runCli([fixedMain, '--ui', ui]).code === 0, '不带 --expect 只报告 → rc 0（一致时）')
  const reportOnly = runCli([oldMain, '--ui', uiForward])
  chk(reportOnly.code === 0 && /不是颜色字面量/.test(reportOnly.out), '不带 --expect 时不一致也只报告，rc 0 但写出原因')

  console.log('\n5) 真实补丁产物（本机有快照 + 产物 ui 时才跑）')
  const snapRoot = path.join(REPO, 'work', 'pristine')
  const outUi = path.join(REPO, 'output', 'ui')
  let realSnapshot = null
  try {
    const versions = fs.readdirSync(snapRoot).sort()
    for (const v of versions.slice().reverse()) {
      const main = path.join(snapRoot, v, 'electron', 'main.cjs')
      if (fs.existsSync(main)) {
        realSnapshot = main
        break
      }
    }
  } catch {
    /* 没有快照 */
  }
  if (realSnapshot && fs.existsSync(path.join(outUi, 'index.html'))) {
    try {
      const { buildMirror } = require('./reanchor_patch.js')
      const mirror = buildMirror(path.dirname(path.dirname(realSnapshot)), path.join(WORK, 'mirror'))
      execFileSync('git', ['apply', '-p1', path.join(REPO, 'patches', 'electron-main.cjs.patch')], { cwd: mirror, stdio: 'pipe' })
      const real = runCli([path.join(mirror, 'electron', 'main.cjs'), '--ui', outUi, '--expect', 'ok'])
      chk(real.code === 0, `真实「快照 + 补丁」产物 → rc 0（实际 ${real.code}）`)
      if (real.code !== 0) console.log(real.out.trim().split('\n').map((l) => '      ' + l).join('\n'))
    } catch (e) {
      console.log(`  --  跳过：镜像/补丁套用失败（${e.message}）`)
    }
  } else {
    console.log('  --  本机没有英文原版快照或 output/ui，跳过（CI 上属正常）')
  }

  fs.rmSync(WORK, { recursive: true, force: true })
  console.log(fail ? `\n${fail} 项失败` : '\n全部通过（6 组用例）')
  process.exit(fail ? 1 : 0)
})()
