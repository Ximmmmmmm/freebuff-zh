#!/usr/bin/env node
// 字面量占用检查：词典里的这个词条，会不会**同时被当成路径 / 标识符 / 协议值**用？
//
// 为什么需要它：词典按「完整字符串字面量」替换，它分不清「给人看的标签」和「代码里的值」。
// 0.0.131 适配实测：`Cookies` 在 electron/browser-import.cjs 里既是文件选择器的筛选器名
// （该翻），又是磁盘上要找的目录名 `path.join(profile.root, 'Cookies')`（翻掉就让导入
// 静默找不到文件）。当时是我临时写脚本逐条数「同一字面量还被谁占用」才发现的，
// 而这类错一旦发生，构建全绿、界面正常，只有真去用那个功能才会暴露。
//
// 判据只认**字符串字面量**位置（先扫出主进程文件里所有字面量及其坐标，再看它落在什么位置）：
//   1. 文件系统调用参数：`path.join(..., 'Cookies')`、`existsSync('x')` 等 → 翻译必然改行为；
//   2. 比较位置：`x === 'KEY'`、`x.includes('KEY')`、`case 'KEY'` → 协议常量 / 状态码；
//   3. IPC / 事件名：`ipcMain.handle('KEY')`、`.send('KEY')`、`new Event('KEY')` → 通道名。
// 命中任一条 = 该词条不能留在词典里（要翻就得写成 patches/electron-*.patch）。
// 另给一条提示性的「同一字面量出现在 ≥2 个主进程文件」统计（多半是跨文件复用的常量）。
//
// 用法：node tools/lint_collisions.js [--electron <本版 electron 目录>] [--dict <dict.json>] [--verbose]
// 退出码：0 = 没有「会被写坏」的词条；1 = 有；2 = 输入不对
'use strict'

const fs = require('fs')
const path = require('path')

function usage(msg) {
  if (msg) console.error('ERROR: ' + msg)
  console.error('usage: node tools/lint_collisions.js [--electron <electron 目录>] [--dict <dict.json>] [--verbose]')
  process.exit(2)
}

// 参数位置就在这些调用里的字面量，是磁盘上要找的东西（目录名 / 文件名 / 模块名）
const FS_CALLS = new Set([
  'existsSync',
  'readFileSync',
  'readFile',
  'readdirSync',
  'readdir',
  'statSync',
  'lstatSync',
  'writeFileSync',
  'mkdirSync',
  'unlinkSync',
  'rmSync',
  'copyFileSync',
  'createReadStream',
  'createWriteStream',
  'require',
  'resolve',
])
// IPC / 事件通道名
const IPC_CALLS = new Set([
  'ipcMain.handle',
  'ipcMain.on',
  'ipcMain.emit',
  'webContents.send',
  'sendToRenderer',
  'on',
  'addListener',
  'dispatchEvent',
])
const CMP_BEFORE = /(?:===|!==|==|!=|\.includes\s*\(|\.startsWith\s*\(|\.endsWith\s*\(|\bcase\s+)\s*$/

// 扫出 src 里所有字符串字面量（含模板字面量固定段与 ${…} 内部的字面量），带坐标
function literals(src, base) {
  base = base || 0
  const out = []
  for (let i = 0; i < src.length; i++) {
    const q = src[i]
    if (q !== '"' && q !== "'" && q !== '`') continue
    let j = i + 1
    let raw = ''
    while (j < src.length) {
      const ch = src[j]
      if (ch === '\\') {
        raw += src.slice(j, j + 2)
        j += 2
        continue
      }
      if (ch === q) break
      if (q === '`' && ch === '$' && src[j + 1] === '{') {
        // 模板插值：跳到配对的 '}'，并**递归**扫描插值内部的字面量
        // （`${cond ? "Collapse" : "Expand"}` 这种三元素里也是要替换的文案）
        let d = 1
        let k = j + 2
        while (k < src.length && d > 0) {
          const c2 = src[k]
          if (c2 === '\\') k += 2
          else {
            if (c2 === '{') d++
            else if (c2 === '}') d--
            k++
          }
        }
        const innerEnd = d === 0 ? k - 1 : k
        for (const lit of literals(src.slice(j + 2, innerEnd), base + j + 2)) out.push(lit)
        raw += ' ' // 插值占位（内容已单独收集）
        j = k
        continue
      }
      raw += ch
      j++
    }
    if (raw) out.push({ start: base + i, value: raw })
    i = j
  }
  return out
}

// 该字面量落在哪个调用的参数里：往前找最近的 '( '，中间不被 ';' / ')' 截断
function enclosingCall(src, pos) {
  let depth = 0
  for (let i = pos - 1, steps = 0; i >= 0 && steps < 400; i--, steps++) {
    const c = src[i]
    if (c === ')' || c === ']' || c === '}') depth++
    else if (c === '(') {
      if (depth === 0) {
        const m = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*$/.exec(src.slice(Math.max(0, i - 60), i))
        return m ? m[1] : null
      }
      depth--
    } else if (c === ';' && depth === 0) return null
  }
  return null
}

// 这个字面量在代码里是什么形态？（提示项用它把「标签」和「候选值」区分开）
// 实测例：`Cookies` 在 browser-native.cjs 是 `filters: [{ name: 'Cookies' }]`（键值），
// 在 browser-import.cjs 是 `for (const suffix of ['Network/Cookies', 'Cookies'])`（数组元素），
// 后者之后会被喂给 path.join —— 看到「数组元素」就该去追这个数组的去向。
function posKind(src, pos) {
  const keyed = /([A-Za-z_$][\w$]*)\s*:\s*$/.exec(src.slice(Math.max(0, pos - 80), pos))
  if (keyed) return `键值（${keyed[1]}: …）`
  let depth = 0
  for (let i = pos - 1, steps = 0; i >= 0 && steps < 300; i--, steps++) {
    const c = src[i]
    if (c === ')' || c === ']' || c === '}') depth++
    else if (c === '(' || c === '[' || c === '{') {
      if (depth === 0) return c === '[' ? '数组元素' : c === '(' ? '调用参数' : '对象值'
      depth--
    } else if (c === ';' && depth === 0) return '语句位置'
  }
  return '其它'
}

function readElectron(dir) {
  if (!dir) return []
  if (!fs.existsSync(dir)) usage(`找不到 electron 目录：${dir}`)
  if (fs.statSync(dir).isFile()) dir = path.dirname(dir)
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(cjs|html)$/.test(f))
    .map((f) => ({ file: f, src: fs.readFileSync(path.join(dir, f), 'utf8') }))
}

function main() {
  const argv = process.argv.slice(2)
  const opt = { verbose: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--verbose') opt.verbose = true
    else if (a === '--electron') opt.electron = argv[++i]
    else if (a === '--dict') opt.dict = argv[++i]
    else usage(`未知参数：${a}`)
  }
  const dictPath = path.resolve(opt.dict || path.join(__dirname, '..', 'dict.json'))
  if (!fs.existsSync(dictPath)) usage(`找不到词典：${dictPath}`)
  const rawFiles = readElectron(opt.electron ? path.resolve(opt.electron) : null)
  if (!rawFiles.length) {
    console.log('（没给 --electron，也没有 electron 目录可供比对，跳过）')
    process.exit(0)
  }

  const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'))
  // 预扫：每个文件的全部字面量 + 坐标，之后按词条比对
  const files = rawFiles.map((f) => ({ file: f.file, src: f.src, lits: literals(f.src) }))

  const hard = []
  const soft = new Map() // key -> Set(file)
  for (const part of ['exact', 'pattern', 'code']) {
    for (const key of Object.keys(dict[part] || {})) {
      if (!key || key.length > 60) continue // 长句子不可能当路径 / 通道名
      const hits = []
      const fileHits = new Set()
      const kinds = new Map() // file -> 位置形态（提示项用）
      for (const f of files) {
        let seen = false
        for (const lit of f.lits) {
          // pattern 分区替换的是字面量**内部**的子串，所以这里按包含判断
          const isTarget = part === 'pattern' ? lit.value.includes(key) : lit.value === key
          if (!isTarget) continue
          seen = true
          if (!kinds.has(f.file)) kinds.set(f.file, posKind(f.src, lit.start))
          const before = f.src.slice(Math.max(0, lit.start - 60), lit.start)
          if (CMP_BEFORE.test(before)) hits.push({ file: f.file, why: '比较位置（协议常量 / 状态码）' })
          const call = enclosingCall(f.src, lit.start)
          if (call) {
            const tail = call.split('.').pop()
            if (FS_CALLS.has(tail) || /^path\./.test(call))
              hits.push({ file: f.file, why: `文件系统调用参数（${call}(…)）` })
            else if (IPC_CALLS.has(call) || IPC_CALLS.has(call.split('.').slice(-2).join('.')) || /^ipcMain\./.test(call))
              hits.push({ file: f.file, why: `IPC / 事件通道名（${call}(…)）` })
          }
        }
        if (seen) fileHits.add(f.file)
      }
      if (hits.length) hard.push({ part, key, hits })
      else if (fileHits.size >= 2) soft.set(key, [...kinds.entries()].map(([f, k]) => `${f}（${k}）`))
    }
  }

  console.log(`字面量占用检查：${path.relative(process.cwd(), dictPath)} × ${files.length} 个主进程文件`)
  if (hard.length) {
    console.log(`\n## ❌ 会被写坏（字面量在代码里当值用，翻掉就改行为）—— ${hard.length} 条`)
    for (const h of hard) {
      const uniq = [...new Set(h.hits.map((x) => `${x.file} ← ${x.why}`))]
      console.log(`   · [${h.part}] ${JSON.stringify(h.key)}`)
      for (const u of uniq) console.log(`       ${u}`)
    }
    console.log('   处理：把它从 dict 里撤掉，改写成 patches/electron-*.patch（只改该翻的那一处），')
    console.log('         或把两处用法拆开（例如给目录名换个不冲突的写法）。')
  }
  if (soft.size) {
    const list = [...soft.entries()]
    console.log(`\n## ℹ 同一字面量出现在 ≥2 个主进程文件（${soft.size} 条，多半是跨文件复用的常量，人工扫一眼即可）`)
    for (const [k, places] of list.slice(0, opt.verbose ? list.length : 8))
      console.log(`   · ${JSON.stringify(k)}　← ${places.join('、')}`)
    if (!opt.verbose && list.length > 8) console.log(`   … 其余 ${list.length - 8} 条用 --verbose 看全`)
  }
  if (!hard.length) console.log('\n✓ 没有词条被代码占用')

  if (hard.length) {
    console.error(`\nERROR: 有 ${hard.length} 处词条会被代码占用（清单见上）`)
    process.exit(1)
  }
  process.exit(0)
}

if (require.main === module) main()
module.exports = { literals, enclosingCall, posKind, FS_CALLS, IPC_CALLS, CMP_BEFORE }
