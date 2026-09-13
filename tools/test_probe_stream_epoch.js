#!/usr/bin/env node
// probe_stream_epoch 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 为什么需要它：探针最重要的一条纪律是「拿不到证据就直说」——抽不到函数时必须 rc 2
// （无法取证），而不是悄悄报 rc 0/1 让人以为「缺陷已消失」或「补丁没生效」。这三者混起来
// 会直接误导维护决策（要么白留一个补丁，要么误删一个还需要的补丁）。这里把 rc 2 的
// 几条入口钉住；缺陷在 / 不在两类判决靠真实 bundle 由 tools/update.sh 与构建后取证覆盖。
//
// 覆盖：
//   1. 非 bundle 文本（抽不到锚点）→ rc 2；
//   2. 文件不存在 → rc 2；
//   3. 参数不足 / --expect 取值非法 → rc 2；
//   4. probe() 直接调用时对垃圾输入抛错（而不是返回「缺陷不在」）；
//   5. `--expect` 只在能取证时才可能给出 0/1，无法取证时 rc 2 优先于期望值。
//
// 用法：node tools/test_probe_stream_epoch.js        # 退出码非 0 表示回归
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const { probe } = require('./probe_stream_epoch.js')

const WORK = path.join(__dirname, '..', 'work', 'test-probe-stream-epoch')
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
    const out = execFileSync(process.execPath, [path.join(__dirname, 'probe_stream_epoch.js'), ...args], { encoding: 'utf8' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }
  }
}

const garbage = path.join(WORK, 'garbage.js')
fs.writeFileSync(garbage, 'const x = 1;\nfunction unrelated(){return 2}\n')

// 1) 抽不到锚点 → 无法取证
const g = runCli([garbage, '--expect', 'present'])
chk(g.code === 2, `1) 非 bundle 文本 → rc 2（实际 ${g.code}）`)
chk(/无法取证/.test(g.out), '1) 输出里有「无法取证」而不是判决词')
chk(!/缺陷已消除|缺陷可复现/.test(g.out), '1) 不冒充判决结论')

// 2) 文件不存在
const missing = runCli([path.join(WORK, 'nope.js'), '--expect', 'absent'])
chk(missing.code === 2, `2) 文件不存在 → rc 2（实际 ${missing.code}）`)
chk(/无法读取/.test(missing.out), '2) 输出里点明是读取失败')

// 3) 参数问题
chk(runCli([]).code === 2, '3) 不给参数 → rc 2')
chk(runCli([garbage, '--expect', 'maybe']).code === 2, '3) --expect 取值非法 → rc 2')

// 4) probe() 直接调用：垃圾输入必须抛错，不能返回「缺陷不在」
let threw = false
try {
  probe('const x = 1;')
} catch {
  threw = true
}
chk(threw, '4) probe() 对垃圾输入抛错（不会静默返回缺陷状态）')

// 5) 无法取证时，rc 2 优先于期望值（哪怕期望是 absent —— 最容易被误读成「修好了」的那个）
const a = runCli([garbage, '--expect', 'absent'])
chk(a.code === 2, `5) --expect absent + 抽不到 → 仍 rc 2（实际 ${a.code}）`)

console.log(fail ? `\n${fail} 项失败` : '\n全部通过（5 组用例）')
process.exit(fail ? 1 : 0)
