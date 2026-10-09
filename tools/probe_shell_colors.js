#!/usr/bin/env node
// 「窗口按钮区（— □ ×）的颜色/高度跟不跟得上界面」的**取证探针**：把装机 main.cjs 里的
// `HANHUA_SHELL_COLORS` 原样抽出来跑一遍，再拿界面 CSS 独立解一遍，两边比对。
//
// 为什么要有这个工具：这处补丁是**产物改动**（不是译文），它的全部工作是把 UI 的 CSS 变量喂给
// `titleBarOverlay`。哨兵只能证明那段代码**在**（`overlay: HANHUA_SHELL_COLORS.overlay,` 还写着），
// 证不了它**值对**——0.0.154 装机后右上角那块颜色对不上的矩形就是这么漏过去的：
//
//   · CSS 最外那层写的是 `--chrome: var(--shell-base)`（同一选择器声明了四次，后一份生效）；
//   · 旧实现把 `var(--shell-base)` 这个**字符串**当颜色交给了 Electron。字符串不是颜色，
//     Electron 只好回落成系统默认的窗口底色（中性灰 #f0f0f0），而标签条按 CSS 画的是
//     `--shell-base` = #e3e7e4 —— 于是按钮区右侧露出一块 13 级色差的矩形；
//   · 哨兵照旧全绿，因为那段文本一个字节都没变。
//
// 判据因此是**差分**（两侧独立实现，不复用补丁的代码）：
//   ① **overlay 必须全透明**：按钮区自己不画底色，露出来的才是标签条自己的背景（`.shell-tab-row`
//      的 `--shell-base`；开壁纸时它是 transparent）。一旦被改回不透明色，开壁纸时右上角就会重新
//      露出一块与旁边对不上的实心矩形 —— 这正是本探针守的那条线；
//   ② 图标色必须是**颜色字面量**（`var(…)` 这种转发没解到底，直接判负），且等于界面 CSS 级联出来
//      的实际值（`:root` 与 `:root[data-theme=light]` 两个选择器分别解，浅色按优先级取后者）；
//   ③ 高度必须等于「标签条高度 − 标签条底部 1px 边框」（overlay 的高度决定系统按钮的位置与留白）。
//
// 怎么取「界面 CSS」：那块代码是按 `process.resourcesPath/orchestrator/ui` 找 CSS 的，而本机的 ui
// 往往不在这个布局里（仓库里是 output/ui，装机目录才是 resources/orchestrator/ui）。探针因此搭一个
// 只含 index.html + 那一份 CSS 的临时舞台目录（块只读这两个文件），再把 resourcesPath 指过去——
// **否则块读不到 CSS 就会静默回落成写死值**，反例也会被照成绿色（早期实现这么错过一次）。
//
// 用法：
//   node tools/probe_shell_colors.js <electron/main.cjs | 含 electron/ 的目录 | ui 的上级目录> [--ui <ui 目录>]
//                                    [--expect ok|missing] [--quiet]
//     --ui      界面目录（含 index.html 与其 assets/*.css）。默认按 main.cjs 的位置推：
//               <x>/electron/main.cjs → <x>/orchestrator/ui，推不出来就用仓库的 output/ui。
//     --expect ok       产物：块必须在、且必须与界面 CSS 一致（rc 0）；不一致 rc 1
//     --expect missing  英文原版：块必须不存在（rc 0）；存在 rc 1（说明我们打进去了，选错了文件）
//     不带 --expect 时只报告：把不一致的原因写出来，但 rc 0（与另两个探针同一份退出码契约）。
//   抽不到块 / 读不到 CSS / CSS 里解不出颜色（例如变量成环）→ rc 2「无法取证」，调用方只警告不拦。
//
// 退出码：0 = 符合预期（或仅报告）；1 = 取证成功但不达标；2 = 无法取证（参数/输入不对也算）
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

// 补丁注入的那一块。名字带 HANHUA_ 前缀是**固定契约**（不与 minifier 的短名相撞），
// 所以这里可以按名字定位；上游把 main.cjs 压缩掉或改写这一节时抽不到 → 无法取证，而不是猜。
//
// 注：块里用的 `fs` / `path` 是 main.cjs **模块级**的绑定（不是它自己 require 的），所以沙箱必须
// 把这两个名字一并注进去 —— 少了它们块会进 catch、静默回落成写死值，探针就会把「读不到 CSS」
// 误当成「值不对」（早期实现这么错过一次）。
const ANCHOR = /const\s+HANHUA_SHELL_COLORS\s*=\s*\(\(\)\s*=>\s*\{/
// 非压缩产物的结束行（补丁写的就是这个形状）；换成压缩写法时抽不到 ⇒ rc 2。
const TERMINATOR = '\n})()'

const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/

const isColor = (v) => typeof v === 'string' && COLOR.test(v.trim())

/**
 * 从 main.cjs 文本里原样取出 `(() => { … })()`（抽不到返回 null）。
 * 顺带把块自己那张写死值（`const fallback = {…}`）读出来：五个字段全等于它，说明块**回落**了
 * （没读到 CSS 或抛了异常），报出来的原因要比「色值不对」更具体。
 */
function extractShellColors(src) {
  const m = ANCHOR.exec(src)
  if (!m) return null
  const start = src.indexOf('((', m.index)
  const end = src.indexOf(TERMINATOR, start)
  if (start < 0 || end < 0) return null
  const iife = src.slice(start, end + TERMINATOR.length).trim()
  const fb = /const fallback = \{([^}]*)\}/.exec(iife)
  const fallback = {}
  if (fb) {
    for (const kv of fb[1].split(',')) {
      const i = kv.indexOf(':')
      if (i < 0) continue
      const k = kv.slice(0, i).trim()
      const v = kv.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
      fallback[k] = /^[\d.]+$/.test(v) ? Number(v) : v
    }
  }
  return { iife, fallback: Object.keys(fallback).length ? fallback : null }
}

/** 取出该选择器的所有声明（同一变量后一份覆盖前一份），返回 `--flag: value` 映射。 */
function declarationsOf(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const out = {}
  for (const m of css.matchAll(new RegExp(esc + '\\s*\\{([^}]*)\\}', 'g'))) {
    for (const decl of m[1].split(';')) {
      const i = decl.indexOf(':')
      if (i < 0) continue
      const name = decl.slice(0, i).trim()
      if (!name.startsWith('--')) continue
      out[name] = decl.slice(i + 1).trim()
    }
  }
  return out
}

/** 顺着 var() 引用解到颜色字面量；解不到（缺变量、成环、不是颜色）返回 null。 */
function resolveColor(vars, value, depth = 0) {
  if (typeof value !== 'string' || depth > 6) return null
  const m = value.trim().match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+?))?\s*\)$/)
  if (!m) return isColor(value) ? value.trim() : null
  if (m[1] in vars) return resolveColor(vars, vars[m[1]], depth + 1)
  return m[2] ? resolveColor(vars, m[2], depth + 1) : null
}

/**
 * 全透明色（alpha = 0）判定：`rgba(r,g,b,0)` / `#RRGGBB00` / `#RGBA`（第四位为 0）/ `hsla(…,0)` /
 * 字面量 `transparent`。按钮区靠这个把底色交还给界面，所以它必须是「真的不画」，不能是深色近似。
 */
function isFullyTransparent(v) {
  if (typeof v !== 'string') return false
  const s = v.trim().toLowerCase()
  if (s === 'transparent') return true
  let m = s.match(/^rgba\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*([\d.]+)\s*\)$/)
  if (m) return parseFloat(m[1]) === 0
  m = s.match(/^hsla\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([\d.]+)\s*\)$/)
  if (m) return parseFloat(m[1]) === 0
  m = s.match(/^#([0-9a-f]{8})$/)
  if (m) return m[1].slice(6) === '00'
  m = s.match(/^#([0-9a-f]{4})$/)
  if (m) return m[1][3] === '0'
  return false
}

/**
 * 独立解出界面 CSS 的期望值（不复用补丁里的代码：两侧各写一遍，差出来的才是问题）。
 * 读不到 / 解不出颜色时返回 null（调用方转 rc 2，不冒充判决）。
 */
function resolveCssVars(css) {
  const darkVars = declarationsOf(css, ':root')
  // CSS 级联：:root[data-theme=light] 命中时优先级高于 :root，但只覆盖它自己声明的那些变量。
  const lightVars = { ...darkVars, ...declarationsOf(css, ':root[data-theme=light]') }

  const dark = { faint: resolveColor(darkVars, darkVars['--faint']) }
  const light = { faint: resolveColor(lightVars, lightVars['--faint']) }

  const heights = [...css.matchAll(/--tabbar-height:\s*([\d.]+)px/g)]
  const barHeight = heights.length ? Math.round(parseFloat(heights[heights.length - 1][1])) : null
  const barRule = [...css.matchAll(/\.tabbar\s*\{([^}]*)\}/g)].map((m) => m[1]).find((b) => b.includes('border-bottom'))
  const border = (barRule || '').match(/border-bottom:\s*([\d.]+)px/)
  const height = barHeight == null ? null : Math.max(0, barHeight - (border ? parseFloat(border[1]) : 0))

  if (!dark.faint || !light.faint || height == null) return null
  return { dark, light, height }
}

/**
 * 在只给 resourcesPath 的沙箱里跑那段块（它就是读 resourcesPath/orchestrator/ui 的）。
 * `fs` / `path` 按 main.cjs 里的模块级绑定注入（见文件头那条注），缺一个块就会静默回落。
 */
function evaluateShellColors(iife, resourcesPath) {
  const fn = new Function('require', 'process', 'fs', 'path', 'return ' + iife)
  return fn(require, { resourcesPath, platform: process.platform }, fs, path)
}

/**
 * 搭一个 `<舞台>/orchestrator/ui`（= 装机后的布局），只放 index.html 与它引用的那份 CSS。
 * 块只读这两个文件，所以复制它们就够——但**必须真读得到**，否则它会静默回落成写死值。
 */
function withStagedUi(uiDir, fn) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'hanhua-shell-ui-'))
  try {
    const dst = path.join(stage, 'orchestrator', 'ui')
    fs.mkdirSync(path.join(dst, 'assets'), { recursive: true })
    const html = fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8')
    fs.writeFileSync(path.join(dst, 'index.html'), html)
    const href = html.match(/href="\.?\/?assets\/([^"]+\.css)"/)
    if (href) fs.copyFileSync(path.join(uiDir, 'assets', href[1]), path.join(dst, 'assets', href[1]))
    return fn(stage)
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }
}

/** ui 目录 → 界面 CSS 文本（index.html 里那条 assets/*.css） */
function readUiCss(uiDir) {
  const html = fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8')
  const href = html.match(/href="\.?\/?assets\/([^"]+\.css)"/)
  if (!href) throw new Error(`index.html 里没找到 assets/*.css：${uiDir}`)
  return fs.readFileSync(path.join(uiDir, 'assets', href[1]), 'utf8')
}

/** 参数里的路径 → main.cjs 路径 */
function resolveMainPath(arg) {
  if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
    for (const cand of [path.join(arg, 'electron', 'main.cjs'), path.join(arg, 'main.cjs')]) {
      if (fs.existsSync(cand)) return cand
    }
    return null
  }
  return fs.existsSync(arg) ? arg : null
}

/** main.cjs 的位置 → 默认的 ui 目录 */
function defaultUiDir(mainPath) {
  const guess = path.resolve(mainPath, '..', '..', 'orchestrator', 'ui')
  if (fs.existsSync(path.join(guess, 'index.html'))) return guess
  const repo = path.resolve(__dirname, '..', 'output', 'ui')
  return fs.existsSync(path.join(repo, 'index.html')) ? repo : guess
}

/**
 * 取证：抽块 + 独立解 CSS + 比对。
 * 返回 { evidence, ok, reasons, expected, actual }；拿不到证据时抛出（调用方转 rc 2）。
 */
function verdict({ mainPath, uiDir }) {
  if (!mainPath || !fs.existsSync(mainPath)) throw new Error(`找不到 main.cjs：${mainPath}`)
  const mainText = fs.readFileSync(mainPath, 'utf8')
  const extracted = extractShellColors(mainText)
  if (!extracted) {
    return { evidence: false, ok: false, reasons: ['main.cjs 里没有 HANHUA_SHELL_COLORS（英文原版，或补丁未套用 / 上游改写了这一节）'] }
  }
  if (!uiDir || !fs.existsSync(path.join(uiDir, 'index.html'))) throw new Error(`UI 目录不可用（需要 index.html）：${uiDir}`)
  const expected = resolveCssVars(readUiCss(uiDir))
  if (!expected) throw new Error('界面 CSS 里解不出 --chrome / --faint / --tabbar-height（变量缺失或成环）')

  const { iife, fallback } = extracted
  const actual = withStagedUi(uiDir, (stage) => evaluateShellColors(iife, stage))

  const reasons = []
  const fellBack =
    fallback &&
    ['overlay', 'symbolLight', 'symbolDark', 'height'].every((k) => String(actual[k]) === String(fallback[k]))
  if (fellBack) {
    reasons.push(
      `按钮区回落到了块里写死的那组值（${JSON.stringify(fallback)}）—— 说明它没读到 UI 的 CSS：` +
        '装机布局里 resources/orchestrator/ui 必须可读，否则图标色 / 高度全按老值画，和标签条对不上',
    )
  }
  if (!fellBack && !isFullyTransparent(actual.overlay)) {
    reasons.push(
      `overlay（按钮区底色）：${JSON.stringify(actual.overlay)} 不是全透明 —— 按钮区会盖住标签条自己的背景，` +
        '开壁纸时右上角就会露出一块与旁边对不上的实心矩形',
    )
  }
  const pairs = [
    ['symbolLight（浅色图标色）', actual.symbolLight, expected.light.faint],
    ['symbolDark（深色图标色）', actual.symbolDark, expected.dark.faint],
  ]
  for (const [label, got, want] of (fellBack ? [] : pairs)) {
    if (!isColor(got)) {
      reasons.push(`${label}：${JSON.stringify(got)} 不是颜色字面量 —— 变量转发没解到底（Electron 会回落成系统默认图标色）`)
    } else if (got.trim().toLowerCase() !== want.trim().toLowerCase()) {
      reasons.push(`${label}：按钮区要画成 ${got}，界面实际用的是 ${want}（CSS 级联的结果）`)
    }
  }
  if (!fellBack && (!Number.isInteger(actual.height) || actual.height !== expected.height)) {
    reasons.push(`height（按钮区高度）：按钮区要画成 ${JSON.stringify(actual.height)}，界面标签条的高度是 ${expected.height}（标签条高度 − 底部边框）`)
  }
  return { evidence: true, ok: reasons.length === 0, reasons, expected, actual }
}

module.exports = { verdict, extractShellColors, resolveCssVars, isColor, isFullyTransparent, defaultUiDir }

function main() {
  const argv = process.argv.slice(2)
  let expect = null
  let uiDir = null
  let quiet = false
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--expect') expect = argv[++i]
    else if (a === '--ui') uiDir = path.resolve(argv[++i] || '')
    else if (a === '--quiet') quiet = true
    else rest.push(a)
  }
  const log = (m) => {
    if (!quiet) console.log(m)
  }
  if (!rest.length || (expect !== null && !['ok', 'missing'].includes(expect))) {
    console.error('usage: node tools/probe_shell_colors.js <main.cjs|目录> [--ui <ui 目录>] [--expect ok|missing] [--quiet]')
    process.exit(2)
  }
  const mainPath = resolveMainPath(path.resolve(rest[0]))
  if (!mainPath) {
    console.error(`ERROR: 找不到 main.cjs：${rest[0]}`)
    process.exit(2)
  }

  let result
  try {
    result = verdict({ mainPath, uiDir: uiDir || defaultUiDir(mainPath) })
  } catch (e) {
    console.log(`无法取证：${e.message}`)
    process.exit(2)
  }

  if (!result.evidence) {
    if (expect === 'missing') {
      log(`符合预期：${path.basename(mainPath)} 里没有窗口按钮区补丁（英文原版）`)
      process.exit(0)
    }
    console.log(`无法取证：${result.reasons[0]}`)
    process.exit(expect === 'ok' ? 2 : 0)
  }

  const { actual, expected } = result
  log(`窗口按钮区（${path.basename(mainPath)}）：overlay=${actual.overlay} symbolLight=${actual.symbolLight} symbolDark=${actual.symbolDark} height=${actual.height}`)
  log(`界面 CSS 级联：            faintLight=${expected.light.faint} faintDark=${expected.dark.faint} height=${expected.height}`)

  if (expect === 'missing') {
    console.log('缺陷可复现：按钮区补丁已套用（本文件不该是英文原版）')
    process.exit(1)
  }
  if (result.ok) {
    log('按钮区颜色 / 高度与界面一致')
    process.exit(0)
  }
  console.log('按钮区与界面 CSS 对不上：')
  for (const r of result.reasons) console.log('  · ' + r)
  // 不带 --expect 时只报告（rc 0）：判决由调用方按自己的 --expect 给，工具不替它下结论。
  process.exit(expect === 'ok' ? 1 : 0)
}

if (require.main === module) main()
