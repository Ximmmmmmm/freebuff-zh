#!/usr/bin/env node
// audit-bad-entries.js — 审计某提交新增的词典词条，揪出代码语义污染词。
//
// 判定规则（保守，宁漏勿错）：key 在所有目标文件（主进程 .cjs/.html/package.json
// + UI 主 bundle）中，若【零次】出现在 UI 属性位置（children:/label:/title: 等）
// 且【零次】出现在普通字符串位置（函数实参/数组元素/JSX 文本——压缩代码里合法
// UI 文案的常态），却至少一次出现在代码位置（非 UI 属性值 word:"key"、枚举赋值
// ]="key"、case "key"、比较 =="key"），则判定危险——它不是界面文案，翻译它必然
// 破坏运行时。三元 ?"key" 视为中性（条件渲染 UI 与语法节点名都会出现）。
// （0.0.100 事故：LLM 批量翻译把 Lezer 节点名 "Emphasis" 翻成 "强调"，
//   resolve:"Emphasis" 等 4 处代码位置被污染，应用启动即崩。）
//
// 用法: node tools/audit-bad-entries.js <commit> <pristine-app.asar> <pristine-ui-dir>
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const os = require('os')

const ROOT = path.join(__dirname, '..')
const COMMIT = process.argv[2]
const PRISTINE_ASAR = process.argv[3]
const PRISTINE_UI = process.argv[4]

// 目标文件集合 = build.sh 实际套用词典的文件
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'))
execFileSync('npx', ['-y', '@electron/asar', 'extract', PRISTINE_ASAR, path.join(tmp, 'main')], { stdio: 'inherit' })
const targets = []
const mainDir = path.join(tmp, 'main', 'electron')
for (const f of fs.readdirSync(mainDir)) {
  if (f.endsWith('.cjs') || f.endsWith('.html') || f === 'package.json') targets.push(path.join(mainDir, f))
}
const uiBundle = fs.readdirSync(path.join(PRISTINE_UI, 'assets')).filter(f => /^index-.*\.js$/.test(f))
for (const f of uiBundle) targets.push(path.join(PRISTINE_UI, 'assets', f))
let src = ''
for (const f of targets) src += '\n' + fs.readFileSync(f, 'utf8')
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`扫描 ${targets.length} 个文件，共 ${src.length} 字符`)

const diff = execFileSync('git', ['show', `${COMMIT}`, '--', 'dict.json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const added = new Set()
const removed = new Set()
for (const line of diff.split('\n')) {
  const m = line.match(/^([-+])\s{4}"((?:[^"\\]|\\.)+)":\s*"/)
  if (!m) continue
  let key
  try { key = JSON.parse('"' + m[2] + '"') } catch { key = m[2] }
  if (m[1] === '+') added.add(key); else removed.add(key)
}
for (const k of removed) added.delete(k)
console.log(`新增词条 ${added.size} 条（去除同提交删除的改名项）`)

const UI_PROP = /(?:children|label|title|placeholder|aria-label|data-tooltip|confirmLabel|description|heading|subtitle|tooltip|alt)\s*:\s*["'`]$/
const CODE_PROP = /[{,]\s*[A-Za-z_$][\w$]*\s*:\s*["'`]$/   // 任意属性值位置（非 UI 属性名）
const CODE_ENUM = /\]\s*=\s*["']$/                          // t[t.Emphasis=25]="Emphasis"
const CODE_CASE = /case\s+["']$/
const CODE_CMP = /[=!]==?\s*["']$/

function scanKey(key) {
  let uiHits = 0, otherHits = 0
  const codeReasons = new Set()
  for (const needle of ['"' + key + '"', "'" + key + "'"]) {
    let from = 0, idx
    while ((idx = src.indexOf(needle, from)) !== -1) {
      const before = src.slice(Math.max(0, idx - 48), idx + 1) // 含起始引号，属性模式才能命中
      if (UI_PROP.test(before)) uiHits++
      else if (CODE_PROP.test(before)) codeReasons.add('prop')
      else if (CODE_ENUM.test(before)) codeReasons.add('enum')
      else if (CODE_CASE.test(before)) codeReasons.add('case')
      else if (CODE_CMP.test(before)) codeReasons.add('cmp')
      else otherHits++
      from = idx + needle.length
    }
  }
  return { uiHits, otherHits, codeReasons }
}

const bad = []
const detail = []
for (const key of added) {
  const { uiHits, otherHits, codeReasons } = scanKey(key)
  if (codeReasons.size > 0 && uiHits === 0 && otherHits === 0) {
    bad.push(key)
    detail.push({ key, reasons: [...codeReasons].join(',') })
  }
}
console.log(`危险词条 ${bad.length} 条（零 UI/普通位置 + 代码位置命中）：`)
for (const d of detail) console.log(`  [${d.reasons}] ${JSON.stringify(d.key)}`)
fs.writeFileSync(path.join(ROOT, 'work', 'bad-entries.json'), JSON.stringify(bad, null, 2))
