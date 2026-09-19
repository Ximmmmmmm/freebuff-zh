#!/usr/bin/env node
// 主进程英文扫描（mainscan）：找出「英文原版 `electron/` 里有、汉化产物里也原样还在」的英文文案。
//
// 为什么需要它（与 blindscan 的分工）：
//   · `uipos` / `fieldscan` / `blindscan` / `regress` **全都只看 UI bundle**；
//   · 主进程的文案（原生对话框、菜单、`shell:openIn` 的报错、MCP 同意窗口）历来靠
//     `patches/electron-*.patch` 手写补丁，而词典的 `exact` 只替换双引号字面量，
//     单引号 / 模板字符串里的文案根本不经过词典；
//   · 于是「某条文案没被写进补丁」这件事在每一版都能静静躺着——0.0.113 适配时一次扫出
//     29 处（Bun 崩溃对话框、标签页右键菜单、`Get Compatibility Build` 按钮、
//     `shell:openIn` 六条报错、MCP 同意窗口的说明行与按钮组），其中有些是 0.0.104 以前就有的。
//
// 判据只有一条，与 blindscan 相同：片段在**原版**里存在、在**产物**里原样还在 ⇒ 没被翻过
// （翻过的会变中文）。比较按**文件**进行，所以报告能直接指到 `main.cjs:495` 这样的位置。
//
// 结果分三桶：
//   · **疑似文案**——多词 + 含常见小词（判据直接复用 `blindscan.js` 的 `isLikelyCopy`，
//     两个工具的「像句子吗」结论才不会互相打架）。这桶非空就是「该翻没翻」，退出码 1；
//   · **短标签待过目**——多词但判不出句子感（`Invalid open request`、`Get Compatibility Build`
//     这类短标签就在这里），人工看一眼决定翻译还是登记；
//   · **约定保留**——命中 `INTENTIONAL` 名单（每条都写着理由）或看起来就是标识符 / 路径。
//     「修好了」的标准不是零英文，而是**只剩这桶**。
//
// 为什么这里可以写词法扫描（blindscan 刻意不写）：
//   · 主进程是 27 个可读的 CJS 文件（约 250 KB），没有 2.4 MB minified bundle 那种
//     含正则字面量与怪模板的怪物；
//   · 而且这里的**主要噪音是注释**——`electron/*.cjs` 里大段英文注释占了一半以上，
//     朴素扫描会把它们全报成「未翻译的文案」。所以 mainscan 逐个字符扫：进字符串、
//     跳注释、识别正则字面量，只收真正在代码里的字符串字面量（模板插值内部也收）。
//
// 用法：node tools/mainscan.js <原版 electron 目录|resources 目录|解包目录|单个文件> \
//                              <产物 electron 目录|output 目录|单个文件> [--words N] [--no-ctx] [--verbose]
//   · 目录参数会自动找 `electron/`（`<dir>`、`<dir>/electron`、`<dir>/resources/electron`）；
//   · --words N 最少词数，默认 2（单字标签默认不报；找短标签用 --words 1，噪音大）；
//   · --verbose 连「约定保留」也逐条展开（默认只给分类计数，因为那桶又长又不需要改）；
//   · 两个参数都给同一侧（原版 vs 原版）会全绿——那是自检，不是漏翻。
// 退出码：0 = 没有「疑似文案」；1 = 有（该补翻，或进 INTENTIONAL 名单并写明理由）；
//         2 = 用法 / 输入错误。
// 自测：node tools/test_mainscan.js（CI 会跑）。
'use strict'

const fs = require('fs')
const path = require('path')
const { looksLikeCopy, isLikelyCopy } = require('./blindscan.js')

// --- 代码扫描：只收字符串字面量，跳过注释，认得出正则字面量 ----------------------
// 返回 [{ value, quote, line }]；value 保留转义原样（`\n` 就是反斜杠 n），
// 因为比较的是同一版本的原版与产物，转义形态必然一致。
const REGEX_OK_BEFORE = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>', '\n'])
const REGEX_OK_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else',
  'yield', 'await', 'throw',
])

function wordBefore(src, at) {
  let i = at
  while (i > 0 && /[A-Za-z_$]/.test(src[i - 1])) i--
  return src.slice(i, at)
}

function regexAllowed(src, at) {
  let j = at - 1
  while (j >= 0 && /[ \t]/.test(src[j])) j--
  if (j < 0) return true
  const prev = src[j]
  if (/[A-Za-z_$]/.test(prev)) return REGEX_OK_KEYWORDS.has(wordBefore(src, j + 1))
  return REGEX_OK_BEFORE.has(prev)
}

function skipRegex(src, at) {
  let i = at + 1
  let inClass = false
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '\n') return i // 未闭合的正则：别把文件吞掉
    if (inClass) {
      if (c === ']') inClass = false
    } else if (c === '[') inClass = true
    else if (c === '/') {
      i++
      while (i < src.length && /[a-z]/i.test(src[i])) i++
      return i
    }
    i++
  }
  return i
}

// 从 at（引号）处读一个字符串字面量，返回 { value, end }；模板里的 `${…}` 会递归收内部字面量
function readLiteral(src, at, out, line) {
  const quote = src[at]
  let i = at + 1
  let value = ''
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      value += src.slice(i, i + 2)
      i += 2
      continue
    }
    if (c === quote) return { value, end: i + 1, line }
    if (quote === '`' && c === '$' && src[i + 1] === '{') {
      // 插值：原样收进 value，同时把里面的字符串字面量也收下（`? "A" : "B"` 这种）
      value += '${'
      i += 2
      let depth = 1
      while (i < src.length && depth > 0) {
        const ch = src[i]
        if (ch === '\n') {
          line++
          value += ch
          i++
          continue
        }
        if (ch === '{') depth++
        else if (ch === '}') depth--
        if (depth === 0) break
        if (ch === '"' || ch === "'") {
          const inner = readLiteral(src, i, out, line)
          out.push({ value: inner.value, quote: ch, line })
          line = inner.line
          value += src.slice(i, inner.end)
          i = inner.end
          continue
        }
        if (ch === '/' && src[i + 1] === '/') {
          while (i < src.length && src[i] !== '\n') i++
          continue
        }
        value += ch
        i++
      }
      value += '}'
      i++
      continue
    }
    if (c === '\n' && quote !== '`') return { value, end: i, line, unterminated: true }
    if (c === '\n') line++
    value += c
    i++
  }
  return { value, end: i, line }
}

function extractLiterals(src) {
  const out = []
  let i = 0
  let line = 1
  while (i < src.length) {
    const c = src[i]
    if (c === '\n') {
      line++
      i++
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++
        i++
      }
      i += 2
      continue
    }
    if (c === '/' && regexAllowed(src, i)) {
      i = skipRegex(src, i)
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const lit = readLiteral(src, i, out, line)
      out.push({ value: lit.value, quote: c, line })
      line = lit.line + (src.slice(i, lit.end).match(/\n/g) || []).length
      i = lit.end
      continue
    }
    i++
  }
  return out
}

// --- 约定保留：这些英文是有意不翻的，进「保留」桶而不是「疑似文案」桶 -------------
// 精确文本（不是正则）：名单短、每条都是一个人做过的判断，改主意时把它删掉即可。
// 分类只是给人看的分组。
const INTENTIONAL = new Map()
const keep = (reason, texts) => {
  for (const t of texts) INTENTIONAL.set(t, reason)
}
keep('日志 / 控制台', [
  '[orchestrator] bun runtime: ${choice.runtimeFlavor} (${choice.reason})',
  '[orchestrator] process ${pid} ended (code ${code ?? none}, signal ${signal ?? none})',
  '[orchestrator] startup timed out; retrying once with a clean process',
  '[orchestrator] the standard runtime crashed before ready; retrying on the baseline runtime',
  '[orchestrator] could not create stderr log:',
  '[orchestrator] could not append to stderr log:',
  '[orchestrator] diagnostic action failed:',
  '[launcher] ${err.message}',
  '[boot] ${name} unavailable, continuing without it:',
  '[updater] check failed:',
  '[updater] update download failed:',
  '[updater] update install failed:',
  '[updater] could not cancel download:',
  '[updater] update reported with no version',
  '[updater] powerMonitor unavailable:',
  '[linux-launch] ${details.type} process failed to launch after startup: ${details.reason}',
  '[linux-launch] could not show the failure dialog:',
  '[shell-lifetime] worker failed: ${error.message}',
  '[path-repair] shell=${shell ?? (none)} (${source})',
  '[renderer] ${name}: ${message}',
  '[unserializable params]',
  '[restart ${restartAttempts}] ${header}',
  '[${new Date().toISOString()}] Starting Freebuff orchestrator',
  'discord presence connected',
])
keep('启动诊断（内部错误串，经 errorMessage 才有样式）', [
  'orchestrator stopped before becoming ready',
  'orchestrator did not come up within ${timeoutMs}ms',
  'Could not resolve the shell lifetime server port',
  'Shell lifetime worker exited unexpectedly (code ${code})',
  'update check timed out',
  'only binary',
  'probe ran',
  'probe failed',
  // Discord Rich Presence 的内部错误串：只用于重试判定与日志，从不展示给用户
  // （用户可见的只有 activityFor 里那几句，已由 patches/electron-discord-presence.cjs.patch 翻译）。
  'handshake timed out',
  'closed before ready',
])
keep('bridge / CDP 的 HTTP 协议错误（调用方按 kind 判定，不是给用户读的文案）', [
  'request body too large',
  'body too large',
  'forbidden host',
  'missing or invalid token',
  'unsupported method',
  'invalid JSON body',
  'method must be a string',
  'webContentsId must be an integer',
  'capturePage returned an empty image',
  'this host has no secure storage',
  'key is not in a namespace this bridge serves',
  'set needs a string value',
  'value is too large',
  'op must be get, set or delete',
  'name and a runnable spec are required',
  'another connector is awaiting approval',
])
keep('遥测', ['Bun crash'])
keep('JS 指令（不是文案）', ['use strict'])
keep('诊断串片段（拼进 [linux-launch] 那行日志）', [' forced-on by FREEBUFF_FORCE_SANDBOX'])
keep('品牌名 / 应用名 / 字体名（产品名，且被用于探测与匹配）', [
  'Visual Studio Code',
  'Microsoft VS Code',
  'Windows Terminal',
  'Command Prompt',
  'File Explorer',
  'Finder',
  'Task Manager',
  'Activity Monitor',
  'Segoe UI',
])
keep('命令（用户要照抄运行 / 报错里给出的命令行）', [
  '  ./Freebuff.AppImage --disable-gpu',
  '  ./Freebuff.AppImage --no-sandbox',
])

// --- 对差 ----------------------------------------------------------------------
function isCommentFreeString(src) {
  return /[A-Za-z]/.test(src)
}

function collectFile(file) {
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const byValue = new Map()
  for (const lit of extractLiterals(src)) {
    if (!isCommentFreeString(lit.value)) continue
    if (!byValue.has(lit.value)) byValue.set(lit.value, lit)
  }
  return { src, byValue }
}

function listFiles(target) {
  const st = fs.statSync(target)
  if (st.isFile()) return { dir: path.dirname(target), only: [path.basename(target)] }
  const names = fs
    .readdirSync(target)
    .filter((f) => /\.(cjs|html)$/.test(f) && !/\.test\./.test(f))
    .sort()
  return { dir: target, only: names }
}

// 目录 → 真正放 electron 文件的那一层
function findElectronDir(p, fail) {
  let st
  try {
    st = fs.statSync(p)
  } catch {
    return fail(`ERROR: 路径不存在：${p}`)
  }
  if (st.isFile()) return path.dirname(p)
  const candidates = [p, path.join(p, 'electron'), path.join(p, 'resources', 'electron')]
  for (const c of candidates) {
    if (!fs.existsSync(c) || !fs.statSync(c).isDirectory()) continue
    const has = fs.readdirSync(c).some((f) => /\.(cjs|html)$/.test(f) && !/\.test\./.test(f))
    if (has) return c
  }
  return fail(`ERROR: 在 ${p} 下找不到 electron/ 里的 .cjs 文件`)
}

function compare(pristineDir, outputDir, { minWords = 2, only = null } = {}) {
  const names = (only || fs.readdirSync(pristineDir).filter((f) => /\.(cjs|html)$/.test(f) && !/\.test\./.test(f))).sort()
  const confirmed = []
  const review = []
  const kept = []
  let pristineCount = 0
  let outputCount = 0
  let sawInBoth = 0
  for (const name of names) {
    const pFile = path.join(pristineDir, name)
    const oFile = path.join(outputDir, name)
    if (!fs.existsSync(pFile) || !fs.existsSync(oFile)) continue
    const pristine = collectFile(pFile)
    const output = collectFile(oFile)
    pristineCount += pristine.byValue.size
    outputCount += output.byValue.size
    for (const [value, lit] of pristine.byValue) {
      if (!output.byValue.has(value)) continue // 产物里已经变了（译文 / 改写）⇒ 不算遗留
      sawInBoth++
      if (INTENTIONAL.has(value)) {
        kept.push({ file: name, line: lit.line, text: value, why: INTENTIONAL.get(value) })
        continue
      }
      if (!looksLikeCopy(value, minWords)) continue
      const entry = { file: name, line: lit.line, text: value, n: output.byValue.get(value)?.n || 1 }
      entry.ctx = contextOf(pristine.src, value)
      // 三桶：句子感强（一定要看）/ 短标签与术语（人工过目）/ 名单里已判过（保留）
      if (isLikelyCopy(value, minWords)) confirmed.push(entry)
      else review.push(entry)
    }
  }
  const byWhere = (a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file))
  confirmed.sort(byWhere)
  kept.sort(byWhere)
  return { files: names.length, pristineCount, outputCount, sawInBoth, confirmed, review, kept }
}

function contextOf(src, value) {
  const at = src.indexOf(value)
  if (at < 0) return ''
  return src.slice(Math.max(0, at - 60), at + value.length + 60).replace(/\s+/g, ' ').trim()
}

function main(argv) {
  const flags = argv.filter((a) => a.startsWith('--'))
  const wordsArg = argv.indexOf('--words')
  let minWords = 2
  if (wordsArg !== -1) {
    minWords = Number(argv[wordsArg + 1])
    if (!Number.isInteger(minWords) || minWords < 1) {
      console.error('ERROR: --words 需要一个正整数')
      return 2
    }
  }
  const args = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--words')
  if (args.length < 2) {
    console.error('usage: node tools/mainscan.js <原版 electron 目录|resources 目录|解包目录> <产物目录> [--words N] [--no-ctx] [--verbose]')
    return 2
  }
  const die = (msg) => {
    console.error(msg)
    process.exit(2)
  }
  const pristineDir = findElectronDir(args[0], die)
  const outputDir = findElectronDir(args[1], die)
  const only = fs.statSync(args[0]).isFile() ? { only: [path.basename(args[0])] } : {}
  const noCtx = flags.includes('--no-ctx')
  const verbose = flags.includes('--verbose')

  const res = compare(pristineDir, outputDir, { minWords, ...only })
  console.log(
    `主进程英文扫描：原版 ${res.files} 个文件 / ${res.pristineCount} 条字符串字面量，` +
      `产物 ${res.outputCount} 条，两边都有 ${res.sawInBoth} 条`
  )
  console.log(`  疑似文案（多词 + 常见小词，多半该翻）：${res.confirmed.length} 条`)
  console.log(`  短标签待过目（不满足句子判据的短词，人工看一眼）：${res.review.length} 条`)
  console.log(`  约定保留（品牌 / 协议 / 路径 / 命令 / 日志 / 有意保留的诊断串）：${res.kept.length} 条`)

  const show = (e) =>
    console.log(`${e.file}:${e.line}\t${e.n ? `${e.n}\t` : ''}${e.text}${noCtx || !e.ctx ? '' : `\n\t@ ${e.ctx}`}`)
  if (res.confirmed.length) {
    console.log('\n## 疑似文案（逐条补进 patches/electron-*.patch，或在 mainscan.js 的 INTENTIONAL 里写明理由）')
    for (const e of res.confirmed) show(e)
  }
  if (res.review.length && (verbose || res.review.length <= 40)) {
    console.log('\n## 短标签待过目（多词但不带常见小词，判不出是不是文案；--verbose 时连保留桶也展开）')
    for (const e of res.review) show(e)
  } else if (res.review.length) {
    console.log(`\n## 短标签待过目：${res.review.length} 条（较多，用 --verbose 逐条看）`)
  }
  const keptByReason = new Map()
  for (const e of res.kept) keptByReason.set(e.why, (keptByReason.get(e.why) || 0) + 1)
  if (keptByReason.size) {
    console.log('\n## 约定保留（分类计数；--verbose 逐条展开）')
    for (const [why, n] of [...keptByReason].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${why}`)
    if (verbose) for (const e of res.kept) show(e)
  }
  return res.confirmed.length ? 1 : 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))

module.exports = { extractLiterals, regexAllowed, compare, findElectronDir, INTENTIONAL }
