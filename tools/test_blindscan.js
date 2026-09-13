#!/usr/bin/env node
// blindscan 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 为什么需要它：blindscan 的判据是「原版里有、产物里原样还在」，它一旦退化成
// 「什么都说残留」或「什么都扫不到」，都不会让任何构建失败——前者让报告没人看，
// 后者让盲区重新长回来。这里用合成的原版 / 产物片段把两类误判都钉住。
//
// 覆盖：
//   1. 原版有、产物也原样有 → 进「疑似文案」；
//   2. 原版有、产物已汉化 → 不进（这是工具的主要用途）；
//   3. 产物新增、原版没有的英文 → 不进（那是版本新增，归 uipos / regress 管）；
//   4. 不与引号相邻的代码片段（`typeof b`）→ 不进；
//   5. 引号相邻的单字（模型名 / 键名）→ 默认不进，--words 1 时才进；
//   6. `children:[cond?"A":"B"]` 三元分支与模板插值内部的英文 → 能命中
//      （这正是 uipos / fieldscan 覆盖不到的位置）；
//   7. 目录参数：给 ui/ 目录能自己找到 index.html 里的主 bundle；
//   8. CLI 退出码：有疑似文案 → 1，没有 → 0。
//
// 用法：node tools/test_blindscan.js        # 退出码非 0 表示回归
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const blindscan = require('./blindscan.js')

const WORK = path.join(__dirname, '..', 'work', 'test-blindscan')
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

// --- 合成的原版 / 产物 ----------------------------------------------------------
// 原版：一串界面文案（有的是 children 三元分支、有的在模板插值里 —— uipos 的盲区）
const pristineSrc = [
  'const a=["x",t?"Community setup guide":"Setup documentation"];',
  'const b=`${s?`${e.enabled?"Disable MCP server":"Enable MCP server"}`:"Nothing here"}`;',
  'const c="Connection states are unavailable.";',
  'const d="This one is already translated in the output.";',
  'const e="A label that is adjacent to a quote";',
  'function f(){ return typeof b!=="object"&&a.length>0 }',
  'const g=t?"Enter":"";',
].join('\n')

// 产物：前三条原样保留（残留），其余已汉化；最后一条是只在产物里出现的新句
const outputSrc = [
  'const a=["x",t?"Community setup guide":"Setup documentation"];',
  'const b=`${s?`${e.enabled?"Disable MCP server":"Enable MCP server"}`:"这里没有内容"}`;',
  'const c="Connection states are unavailable.";',
  'const d="这句在产物里已经翻好了。";',
  'const e="已翻译的标签";',
  'function f(){ return typeof b!=="object"&&a.length>0 }',
  'const g=t?"Enter":"";',
  'const h="A brand new sentence that only exists in the output";',
].join('\n')

const res = blindscan.compare(pristineSrc, outputSrc)
const texts = res.confirmed.map((e) => e.text)
const otherTexts = res.other.map((e) => e.text)
const all = [...texts, ...otherTexts]

// --- 1) 原版有、产物原样有 → 进结果（桶 A = 句子感强，桶 B = 短标签 / 术语）------
chk(all.includes('Community setup guide'), '1) children 三元分支里的文案进了结果')
chk(texts.includes('Connection states are unavailable.'), '1) 普通字符串里的整句进了「疑似文案」')

// --- 2) 原版有、产物已汉化 → 不进 ---------------------------------------------
chk(!all.some((t) => t.includes('This one is already translated')), '2) 已汉化的句子不进结果')
chk(!all.some((t) => t.includes('A label that is adjacent')), '2) 已汉化的短标签不进结果')

// --- 3) 产物新增 → 不进（归 uipos / regress 管）--------------------------------
chk(!all.some((t) => t.includes('only exists in the output')), '3) 只有产物有的新句不进结果')

// --- 4) 代码位置（未与引号相邻）→ 不进 -----------------------------------------
chk(!all.includes('typeof b'), '4) 代码里的 `typeof b` 不进结果（未与引号相邻）')

// --- 5) 引号相邻的单字：默认不报，--words 1 才报 -------------------------------
chk(!all.includes('Enter'), '5) 默认（--words 2）不报单字标签')
chk(!blindscan.looksLikeCopy('Enter', 2), '5) looksLikeCopy(Enter, 2) 为假')
chk(blindscan.looksLikeCopy('Enter', 1), '5) looksLikeCopy(Enter, 1) 为真')
const res1 = blindscan.compare(pristineSrc, outputSrc, 1)
chk(res1.confirmed.concat(res1.other).some((e) => e.text === 'Enter'), '5) --words 1 时单字标签会报出来')

// --- 6) 模板插值内部的英文也命中（uipos 的盲区）--------------------------------
chk(all.includes('Disable MCP server'), '6) 模板插值 `?\"Disable MCP server\"` 里的文案进了结果')
chk(all.includes('Enable MCP server'), '6) 三元另一分支也进了结果')

// --- 7) 上下文提示可用 ----------------------------------------------------------
const entry = [...res.confirmed, ...res.other].find((e) => e.text === 'Community setup guide')
chk(!!entry && /community/i.test(entry.ctx), '7) 结果带原版上下文（便于人工判断位置）')

// --- 8) 目录参数 + CLI 退出码 ---------------------------------------------------
const uiDir = path.join(WORK, 'ui')
fs.mkdirSync(path.join(uiDir, 'assets'), { recursive: true })
fs.writeFileSync(path.join(uiDir, 'index.html'), '<script type="module" src="./assets/index-abc.js"></script>')
fs.writeFileSync(path.join(uiDir, 'assets', 'index-abc.js'), outputSrc)
const pristineFile = path.join(WORK, 'pristine.js')
fs.writeFileSync(pristineFile, pristineSrc)
chk(blindscan.resolveBundle(uiDir, () => {}) === path.join(uiDir, 'assets', 'index-abc.js'), '8) 给定 ui/ 目录能解析到主 bundle')

const runCli = (args) => {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'blindscan.js'), ...args], { encoding: 'utf8' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') }
  }
}
const hasFindings = runCli([pristineFile, uiDir, '--no-ctx'])
chk(hasFindings.code === 1, `8) 有疑似文案时 exit 1（实际 ${hasFindings.code}）`)
chk(/## 疑似文案/.test(hasFindings.out), '8) 报告里有「疑似文案」小节')
fs.writeFileSync(path.join(WORK, 'clean.js'), 'const x = "产物里没有原版的英文文案";\n')
const clean2 = runCli([path.join(WORK, 'clean.js'), uiDir, '--no-ctx'])
chk(clean2.code === 0 && !/## 疑似文案/.test(clean2.out), `8) 无疑似文案时 exit 0（实际 ${clean2.code}）`)
const badArgs = runCli([pristineFile])
chk(badArgs.code === 2, `8) 参数不足时 exit 2（实际 ${badArgs.code}）`)

console.log(fail ? `\n${fail} 项失败` : '\n全部通过（8 组用例）')
process.exit(fail ? 1 : 0)
