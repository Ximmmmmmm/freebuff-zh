#!/usr/bin/env node
// regress（回归闸门）自测：只测「有意保留英文」登记表这条新增路径与退出码契约，
// 片段提取口径由 tools/test_upstreamdiff.js 覆盖（两者共用 collectFragmentsFromSource）。
//
// 覆盖：
//   1. 未登记的新增英文片段 → rc 1，并提示登进 intentional-english.json；
//   2. 已登记 → 不进失败判定，rc 0，且把理由一并打印出来；
//   3. 登记项在产物里已消失（整串都没了）→ 提醒可清理，但不失败；
//      而「在产物里、但抽不成片段」的（只被别条通道登记）**不算**死条目；
//      本版没有任何新增片段时也要跑这道提醒（以前挂在「已登记」分支里，常规全绿时永远看不到）；
//   4. --no-allow → 忽略登记表（临时想看真实的全清单）；
//   5. --allow-file 指向不存在的文件 / 非法 JSON / 未知参数 → 该报的报（2 或 0）。
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const WORK = path.join(REPO, 'work', 'test-regress')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

// 夹具：两版产物各含一句散文（片段级要 ≥3 词 + 常见小词），新版多一句新的英文
const mk = (name, lines) => {
  const dir = path.join(WORK, name, 'assets')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index-X.js'), lines.join('\n') + '\n')
  fs.writeFileSync(path.join(WORK, name, 'index.html'), '<script type="module" crossorigin src="./assets/index-X.js"></script>\n')
  return path.join(WORK, name)
}
const shared = 'var a="Your balance is unavailable today.",b=`Allow ${x} to continue?`;'
const oldDir = mk('old', [shared])
const newDir = mk('new', [shared, 'var c="A brand new sentence with the queue.";'])

const allowFile = path.join(WORK, 'allow.json')
fs.writeFileSync(
  allowFile,
  JSON.stringify({ fragments: [{ text: 'A brand new sentence with the queue.', why: '夹具：说明理由' }] }, null, 2) + '\n',
)
const goneFile = path.join(WORK, 'allow-gone.json')
fs.writeFileSync(
  goneFile,
  JSON.stringify(
    {
      fragments: [
        { text: 'A brand new sentence with the queue.', why: '夹具：说明理由' },
        { text: 'This line disappeared in the new build.', why: '夹具：已消失' },
      ],
    },
    null,
    2,
  ) + '\n',
)
// 一个单词文案的产物：片段级要 ≥3 词，`"Theme"` 抽不成片段（但确实在产物里）
const labelDir = mk('label', [shared, 'var d={label:"Theme"};'])
// 只登记那个单词文案：它在 labelDir 的产物里（所以不算死），但片段级（≥3 词）本来就抽不出来
const allowLabelFile = path.join(WORK, 'allow-label.json')
fs.writeFileSync(
  allowLabelFile,
  JSON.stringify(
    { fragments: [{ text: 'Theme', why: '夹具：单词文案，片段级（≥3 词）本来就抽不出来' }] },
    null,
    2,
  ) + '\n',
)
fs.writeFileSync(path.join(WORK, 'allow-bad.json'), '{ not json')

const run = (args) => {
  try {
    return { code: 0, out: execFileSync('node', [path.join(REPO, 'tools', 'regress.js'), ...args], { encoding: 'utf8' }) }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}
let fail = 0
const chk = (ok, msg) => {
  console.log((ok ? '  ok  ' : '  FAIL ') + msg)
  if (!ok) fail++
}

// 1) 无登记表（--no-allow）→ 新片段必须拦下
const r1 = run([oldDir, newDir, '--no-allow'])
chk(r1.code === 1, `未登记的新增片段 → rc ${r1.code}（期望 1）`)
chk(/A brand new sentence with the queue\./.test(r1.out), '  新片段被列出')
chk(/intentional-english\.json/.test(r1.out), '  提示登进 intentional-english.json')

// 2) 登记在册 → 放过，并打印理由
const r2 = run([oldDir, newDir, '--allow-file', allowFile])
chk(r2.code === 0, `已登记 → rc ${r2.code}（期望 0）`)
chk(/已登记的「有意保留英文」1 处/.test(r2.out), '  报出「已登记」计数')
chk(/夹具：说明理由/.test(r2.out), '  把登记表里的理由一并打印')
chk(/未发现未登记的新增英文片段/.test(r2.out), '  结论写「未发现未登记的新增片段」而不是笼统的「未发现新增」')

// 3) 登记项已消失 → 只提醒
const r3 = run([oldDir, newDir, '--allow-file', goneFile])
chk(r3.code === 0, `登记项消失不影响退出码（rc ${r3.code}）`)
chk(/可以清理/.test(r3.out) && /This line disappeared in the new build\./.test(r3.out), '  列出已消失的登记项')

// 3b) 登记项还在产物里（只是抽不成片段）→ 不算死条目
const rLabel = run([oldDir, labelDir, '--allow-file', allowLabelFile])
chk(rLabel.code === 0, `单词文案不成片段也不影响退出码（rc ${rLabel.code}）`)
chk(!/可以清理/.test(rLabel.out), '在产物里但进不了片段集合的登记项不算死条目（旧判据会误报）')

// 3c) 本版没有任何新增片段时也要提醒清理死条目（以前这段挂在 kept 分支里）
const rGoneOnly = run([oldDir, oldDir, '--allow-file', goneFile])
chk(rGoneOnly.code === 0, `无新增片段 + 有死条目 → rc ${rGoneOnly.code}（期望 0）`)
chk(
  /可以清理/.test(rGoneOnly.out) && /This line disappeared in the new build\./.test(rGoneOnly.out),
  '  没有新增片段时照样提醒清理死条目',
)

// 4) 默认走仓库根的登记表：夹具片段不在里面 → 仍然拦下
const r4 = run([oldDir, newDir])
chk(r4.code === 1, `默认登记表不含夹具片段 → 仍拦下（rc ${r4.code}）`)

// 5) 参数契约
chk(run([oldDir]).code === 2, '只给一个位置参数 → rc 2')
chk(run([oldDir, newDir, '--bad']).code === 2, '未知参数 → rc 2')
// 登记表文件不存在 → 当作空表：没有新片段的两版照样 rc 0，有新片段的照样拦下
const rMissing = run([oldDir, oldDir, '--allow-file', path.join(WORK, 'nope.json')])
chk(rMissing.code === 0, `登记表不存在 → 当作空表（无新片段时 rc ${rMissing.code}）`)
const rMissing2 = run([oldDir, newDir, '--allow-file', path.join(WORK, 'nope.json')])
chk(rMissing2.code === 1 && /A brand new sentence with the queue\./.test(rMissing2.out), '登记表不存在时新片段仍拦下')
const rBad = run([oldDir, newDir, '--allow-file', path.join(WORK, 'allow-bad.json')])
chk(rBad.code === 2, `登记表 JSON 坏了 → rc ${rBad.code}（期望 2）`)

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
