#!/usr/bin/env node
// mainscan 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 为什么需要它：mainscan 的价值全在「判得准」——它一旦退化成
//   a) 把注释里的英文也算成残留（主进程一大半英文都在注释里），报告会瞬间淹掉，没人看；
//   b) 或者反过来什么都扫不到，主进程的漏翻就重新变回静默失败；
//   c) 或者把「已判定保留」的文案倒进疑似桶，逼着每次适配都人肉重过一遍同样的名单。
// 这里用合成的原版 / 产物把这三类退化钉住，另外覆盖词法细节（注释 / 转义 / 模板插值 /
// 正则字面量）——这些地方改错都会**静默**误判，只有自测能提前发现。
//
// 覆盖：
//   1. 原版有、产物也原样有 + 句子感 → 「疑似文案」；
//   2. 原版有、产物已汉化 → 不进任何桶（工具的主要用途）；
//   3. 产物新增、原版没有的英文 → 不进（那是版本新增，归 blindscan / regress 管）；
//   4. 注释里的英文（行注释 / 块注释 / 行尾注释）与 shebang → 一点都不进（与朴素 grep 的关键差别）；
//   5. 字符串里的 `//` 不是注释（`https://…`）→ 该字符串整条能被判成残留/已译；
//   6. 转义引号（`'Don\'t …'`）不会把字面量截断；
//   7. 正则字面量（`/["']/`）不破坏其后的扫描，也不把引号当成字符串起点；
//   8. 模板插值内部的字面量也能命中（词典够不着的位置）；
//   9. `INTENTIONAL` 名单命中 → 进「约定保留」并带理由，而不是「疑似文案」；
//  10. 单字标签默认不报（`--words 2`），`--words 1` 时进「短标签待过目」；
//  11. 目录解析：解包目录 / 上层 resources 布局 / 单个文件都能定位；
//  12. 退出码契约：有疑似文案 → 1，没有 → 0，用法 / 输入错误 → 2。
//
// 用法：node tools/test_mainscan.js        # 退出码非 0 表示回归
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const mainscan = require('./mainscan.js')

const WORK = path.join(__dirname, '..', 'work', 'test-mainscan')
fs.rmSync(WORK, { recursive: true, force: true })
const PRIS = path.join(WORK, 'pristine', 'electron')
const OUT = path.join(WORK, 'built', 'electron')
const CLEAN = path.join(WORK, 'built-clean', 'electron')
for (const d of [PRIS, OUT, CLEAN]) fs.mkdirSync(d, { recursive: true })

let fail = 0
const chk = (cond, label) => {
  if (cond) console.log(`  ok  ${label}`)
  else {
    console.log(`  FAIL ${label}`)
    fail++
  }
}

// --- 合成的原版 / 产物 ----------------------------------------------------------
// 行尾注释、块注释里的句子都刻意写得「像文案」，用来证明它们会被跳过。
const pristineSrc = `#!/usr/bin/env node
'use strict'
// A comment that no one should ever see in the report: it is prose, not copy.
/* A block comment
   with several words in it as well. */
const t = require('./thing.cjs') // trailing comment that mentions a sentence here

const untranslated = 'Connection states are unavailable.'
const translated = 'This one is already translated in the output.'
const shortLabel = t ? 'Invalid open request' : 'Invalid open target'
const escaped = 'Don\\'t stop the orchestrator'
const url = 'See https://freebuff.com/docs for // the details'
const templated = \`Command: \${name} \${t ? 'Alpha label for the dialog' : 'Beta label for the dialog'}\`
const re = /["']/
const afterRegex = 'The sentence hidden behind a regex literal'
const single = t ? 'Cancel' : 'Quit'
const known = 'this host has no secure storage'
console.log('[updater] update reported with no version')
`

// 英文 → 中文。产物把其中大部分译掉，留下 LEFTOVER，模拟「词典够不着的漏翻」。
const TR = [
  ['Connection states are unavailable.', '连接状态不可用。'],
  ['This one is already translated in the output.', '这句在产物里已经翻好了。'],
  ["Don\\'t stop the orchestrator", '不要停止编排器'],
  ['See https://freebuff.com/docs for // the details', '参见 https://freebuff.com/docs 了解详情'],
  ['Alpha label for the dialog', '对话框的甲标签'],
  ['Beta label for the dialog', '对话框的乙标签'],
  ['Invalid open request', '打开请求无效'],
  ['Invalid open target', '打开目标无效'],
  ['The sentence hidden behind a regex literal', '藏在正则之后的句子'],
]
const LEFTOVER = new Set([
  'Connection states are unavailable.', // 整句 → 疑似文案
  'The sentence hidden behind a regex literal', // 正则之后 → 疑似文案
  'Invalid open request', // 短标签 → 待过目
  'Invalid open target', // 短标签 → 待过目
  'Beta label for the dialog', // 模板插值内部 → 疑似文案
])
const translate = (src, only) =>
  TR.reduce((s, [en, zh]) => (only && !only(en) ? s : s.split(en).join(zh)), src)

const outputSrc =
  translate(pristineSrc, (en) => !LEFTOVER.has(en)) +
  "const brandNew = 'A brand new sentence that only exists in the output'\n"
const cleanSrc = translate(pristineSrc, () => true)

fs.writeFileSync(path.join(PRIS, 'main.cjs'), pristineSrc)
fs.writeFileSync(path.join(OUT, 'main.cjs'), outputSrc)
// 产物里多出来的文件不该参与对差（对差按原版文件列表走）
fs.writeFileSync(path.join(OUT, 'extra.cjs'), "console.log('only in the output build')\n")
fs.writeFileSync(path.join(CLEAN, 'main.cjs'), cleanSrc)

const lits = mainscan.extractLiterals(pristineSrc).map((l) => l.value)
const res = mainscan.compare(PRIS, OUT)
const texts = res.confirmed.map((e) => e.text)
const reviews = res.review.map((e) => e.text)
const kepts = res.kept.map((e) => e.text)
const all = [...texts, ...reviews, ...kepts]

// --- 1) 未翻译的整句 → 「疑似文案」-----------------------------------------------
chk(texts.includes('Connection states are unavailable.'), '1) 未翻译的整句进「疑似文案」')
chk(texts.includes('The sentence hidden behind a regex literal'), '1) 正则字面量之后的整句也能命中')
const one = res.confirmed.find((e) => e.text === 'Connection states are unavailable.')
chk(!!one && one.file === 'main.cjs' && one.line > 0, '1) 结果带文件名与行号（能直接指到位置）')
chk(!!one && /Connection states/.test(one.ctx), '1) 结果带原版上下文')

// --- 2) 已汉化 → 不进任何桶 -----------------------------------------------------
chk(!all.some((t) => t.includes('already translated')), '2) 已汉化的句子不进任何桶')
chk(!all.some((t) => t.includes('不要停止编排器')), '2) 已汉化的转义句不进任何桶')
chk(!all.some((t) => t.includes('Alpha label')), '2) 已汉化的模板插值内标签不进任何桶')
chk(!all.some((t) => t.includes('freebuff.com')), '2) 已汉化的 URL 句子不进任何桶')

// --- 3) 产物新增、原版没有 → 不进 ----------------------------------------------
chk(!all.some((t) => t.includes('only exists in the output')), '3) 只有产物才有的新英文不进结果')
chk(!all.some((t) => t.includes('only in the output build')), '3) 产物多出来的文件不参与对差')

// --- 4) 注释与 shebang ----------------------------------------------------------
chk(!all.some((t) => t.includes('no one should ever see')), '4) 行注释里的英文不进结果')
chk(!all.some((t) => t.includes('with several words in it')), '4) 块注释里的英文不进结果')
chk(!all.some((t) => t.includes('mentions a sentence here')), '4) 行尾注释里的英文不进结果')
chk(!lits.some((v) => /no one should ever see|as well\.|mentions a sentence/.test(v)), '4) 注释从未进入字面量列表（不是靠事后过滤）')
chk(!lits.some((v) => v.startsWith('#!')), '4) shebang 不进结果')

// --- 5/6/7) 词法：字符串里的 `//`、转义引号、正则字面量 --------------------------
chk(lits.includes('See https://freebuff.com/docs for // the details'), '5) 字符串里的 `//` 不被当注释（整条收下）')
chk(lits.includes("Don\\'t stop the orchestrator"), '6) 转义引号不截断字面量（整条收下）')
chk(!all.some((t) => /stop the orchestrator/.test(t)), '6) 转义句已汉化后不留半截残留')
chk(lits.includes('The sentence hidden behind a regex literal'), '7) 正则字面量不破坏其后的扫描')
chk(!lits.some((v) => v.includes('["')), '7) 正则字面量里的引号不被当成字符串起点')

// --- 8) 模板插值内部的字面量 ---------------------------------------------------
chk(lits.includes('Alpha label for the dialog'), '8) 模板插值内部的字面量也能提取')
chk(texts.includes('Beta label for the dialog'), '8) 插值内未翻译的标签进「疑似文案」')

// --- 9) INTENTIONAL 名单 → 保留桶 ----------------------------------------------
const keptEntry = res.kept.find((e) => e.text === 'this host has no secure storage')
chk(!!keptEntry && /bridge/i.test(keptEntry.why), '9) 名单里的 bridge 错误进「约定保留」并带理由')
chk(!texts.includes('this host has no secure storage'), '9) 名单里的文案不进「疑似文案」')
const keptLog = res.kept.find((e) => e.text.includes('[updater]'))
chk(!!keptLog && /日志/.test(keptLog.why), '9) 日志前缀进「约定保留」（理由：日志 / 控制台）')

// --- 10) 短标签与 --words ------------------------------------------------------
chk(reviews.includes('Invalid open request') && reviews.includes('Invalid open target'), '10) 多词短标签进「短标签待过目」')
chk(!all.includes('Cancel') && !all.includes('Quit'), '10) 单字标签默认（--words 2）不报')
const res1 = mainscan.compare(PRIS, OUT, { minWords: 1 })
chk(res1.review.some((e) => e.text === 'Cancel'), '10) --words 1 时单字标签进「待过目」')
chk(!res1.confirmed.some((e) => e.text === 'Cancel'), '10) 单字标签不会进「疑似文案」（不会逼人无脑翻）')

// --- 11) 目录解析 --------------------------------------------------------------
const die = (m) => {
  throw new Error(m)
}
chk(mainscan.findElectronDir(PRIS, die) === PRIS, '11) 直接给 electron 目录可用')
chk(mainscan.findElectronDir(path.join(WORK, 'pristine'), die) === PRIS, '11) 给上层目录能自动下钻到 electron/')
chk(mainscan.findElectronDir(path.join(WORK, 'pristine', 'electron', 'main.cjs'), die) === PRIS, '11) 给单个文件能取到它所在目录')

// --- 12) CLI 退出码 ------------------------------------------------------------
const runCli = (args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(__dirname, 'mainscan.js'), ...args], { encoding: 'utf8' }) }
  } catch (e) {
    return { code: e.status, out: String(e.stdout || ''), err: String(e.stderr || '') }
  }
}
const dirty = runCli([path.join(WORK, 'pristine'), path.join(WORK, 'built'), '--no-ctx'])
chk(dirty.code === 1, `12) 有疑似文案时 exit 1（实际 ${dirty.code}）`)
chk(/## 疑似文案/.test(dirty.out), '12) 报告里有「疑似文案」小节')
chk(/main\.cjs:\d+/.test(dirty.out), '12) 逐条带 file:line（可直接定位）')
const clean = runCli([path.join(WORK, 'pristine'), path.join(WORK, 'built-clean'), '--no-ctx'])
chk(clean.code === 0, `12) 无疑似文案时 exit 0（实际 ${clean.code}）`)
chk(!/## 疑似文案/.test(clean.out), '12) 干净时没有「疑似文案」小节')
const badArgs = runCli([PRIS])
chk(badArgs.code === 2, `12) 参数不足时 exit 2（实际 ${badArgs.code}）`)
const badWords = runCli([PRIS, OUT, '--words', 'zero'])
chk(badWords.code === 2, `12) --words 非整数时 exit 2（实际 ${badWords.code}）`)
const missing = runCli([path.join(WORK, 'nope'), OUT])
chk(missing.code === 2, `12) 路径不存在时 exit 2（实际 ${missing.code}）`)
const notElectron = runCli([WORK, OUT])
chk(notElectron.code === 2, `12) 目录里没有 electron 文件时 exit 2（实际 ${notElectron.code}）`)

console.log(fail ? `\n${fail} 项失败` : '\n全部通过（12 组用例）')
process.exit(fail ? 1 : 0)
