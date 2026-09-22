#!/usr/bin/env node
// uipos_gap 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 这道体检补的是「单词级文案」这个系统性盲区：upstreamdiff 的片段级（≥3 词）与字面量级
// （≥2 词）都进不来，regress 的片段提取同样只认句子。所以它自己的口径必须钉死：
//   1. 解析 uipos 输出时只认 `## 小节` 之后的「数字+制表符」行——`\t@ 上下文` 续行
//      （--ctx）和小节之前的统计行都不能进集合，否则两侧差集会假报；
//   2. 差集 = 本版 − 上一版 − 登记表；上一版就有的（品牌名/模型名/代码）不算新增；
//   3. 有未登记新增 → rc 1（构建流程要拦）；全登记 → rc 0；参数/输入不对 → rc 2；
//   4. 登记表里本版已看不见的条目要提醒清理，但不失败。
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { parseUipos } = require(path.join(__dirname, 'uipos_gap.js'))

const REPO = path.join(__dirname, '..')
const WORK = path.join(REPO, 'work', 'test-uipos-gap')
fs.rmSync(WORK, { recursive: true, force: true })

const write = (rel, body) => {
  const p = path.join(WORK, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}
const pack = (name, bundle) => {
  write(`${name}/ui/index.html`, '<script type="module" crossorigin src="./assets/index-AAA.js"></script>\n')
  write(`${name}/ui/assets/index-AAA.js`, bundle)
  return path.join(WORK, name)
}

// 上一版产物：Settings / Old knob / Shared label
const prevDir = pack('prev', 'var a={label:"Settings"},b={label:"Old knob"},c={children:"Shared label"}\n')
// 本版产物：多了 Theme（这就是「单词级新文案」），Shared label 仍在
const curDir = pack('cur', 'var a={label:"Settings"},b={label:"Theme"},c={children:"Shared label"}\n')
const emptyDir = path.join(WORK, 'no-bundle')
fs.mkdirSync(emptyDir, { recursive: true })

// 只登记上一版就有的那条（Settings）；Theme 是「本版新增、词典还没覆盖」的样子
const allowSettings = write('allow-settings.json', JSON.stringify({ uiStrings: [{ text: 'Settings', why: '测试：上一版就有' }] }, null, 2))
const allowAll = write('allow-all.json', JSON.stringify({ uiStrings: [{ text: 'Settings', why: '测试' }, { text: 'Theme', why: '测试' }] }, null, 2))
const allowStale = write(
  'allow-stale.json',
  JSON.stringify({ uiStrings: [{ text: 'Settings', why: '测试' }, { text: 'Vanished', why: '上游已删' }] }, null, 2),
)

const run = (args) => {
  try {
    return { code: 0, out: execFileSync('node', [path.join(REPO, 'tools', 'uipos_gap.js'), ...args], { encoding: 'utf8' }) }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}
let fail = 0
const chk = (ok, msg) => {
  console.log((ok ? '  ok  ' : '  FAIL ') + msg)
  if (!ok) fail++
}

// --- 单元：uipos 输出解析 -----------------------------------------------------------
const sample = [
  'remaining UI-position English: 3',
  'some preamble 99\tNOT A SECTION',
  '',
  '## label (2)',
  '4\tSettings',
  '\t@ ...label:"Settings"',
  '1\tTheme',
  '',
  '## children (1)',
  '2\tShared label',
  '',
].join('\n')
const parsed = parseUipos(sample)
chk(parsed.size === 3, `解析：只取小节内的「数字+制表符」行（得 ${parsed.size}，期望 3）`)
chk(parsed.has('Settings') && parsed.has('Theme') && parsed.has('Shared label'), '解析：条目文本去掉首尾空白后入集合')
chk(!parsed.has('NOT A SECTION'), '解析：小节之前的行不算')
chk(![...parsed].some((x) => x.startsWith('@')), '解析：\\t@ 上下文续行不算')

// --- 端到端：差集 -----------------------------------------------------------------
const rGap = run(['--bundle', curDir, '--prev', prevDir, '--allow', allowSettings])
chk(rGap.code === 1, `有未登记新增 → rc 1（实际 ${rGap.code}）`)
chk(/本版界面位置英文 3 处，上一版 3 处/.test(rGap.out), '报告里给出两侧计数')
chk(/本版独有 1 处/.test(rGap.out), '扣除登记表后只剩 1 处')
chk(/· Theme/.test(rGap.out), '列出未覆盖的新增项 Theme')
chk(!/· Settings/.test(rGap.out), '登记表已覆盖的不再列出')
chk(!/· Old knob/.test(rGap.out) && !/· Shared label/.test(rGap.out), '上一版就有的不进「本版独有」')

const rClean = run(['--bundle', curDir, '--prev', prevDir, '--allow', allowAll])
chk(rClean.code === 0 && /没有未登记的新增项/.test(rClean.out), '新增项全部登记 → rc 0')

const rNoPrev = run(['--bundle', curDir, '--allow', allowSettings])
chk(rNoPrev.code === 1 && /本版界面位置英文 3 处/.test(rNoPrev.out), '没有上一版基线时看全量（仍按登记表扣除）')

const rStale = run(['--bundle', curDir, '--prev', prevDir, '--allow', allowStale])
chk(/可以清理/.test(rStale.out) && /Vanished/.test(rStale.out), '登记表里本版已看不见的条目提醒清理')
chk(rStale.code === 1, '清理提醒本身不变成 rc 0（真正的新增项照样拦）')

const rRegistered = run(['--bundle', curDir, '--prev', prevDir, '--allow', allowSettings, '--quiet'])
chk(!/本版界面位置英文/.test(rRegistered.out) && rRegistered.code === 1, '--quiet 只留清单，去掉统计行')

// --- 参数 / 输入契约 ---------------------------------------------------------------
chk(run(['--prev', prevDir]).code === 2, '缺 --bundle → rc 2')
chk(run(['--bundle', path.join(WORK, 'nope')]).code === 2, 'bundle 路径不存在 → rc 2')
chk(run(['--bundle', emptyDir]).code === 2, '目录里找不到主 bundle → rc 2')
chk(run(['--bundle', curDir, '--prev', path.join(WORK, 'nope')]).code === 2, '--prev 路径不存在 → rc 2')
chk(run(['--bundle', curDir, '--bad']).code === 2, '未知参数 → rc 2')

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
