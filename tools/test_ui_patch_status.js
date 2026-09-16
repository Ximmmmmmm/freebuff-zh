#!/usr/bin/env node
// ui_patch_status 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 为什么需要它：退场判定的两个失败方向都很贵——把「该保留」判成「可退场」会让缺陷回来
// 且下次适配才发现；把「没有证据」当成「缺陷已消失」同理。所以这里钉三件事：
//   1. 决策表（锚点维度 × 缺陷维度 → KEEP / REWRITE / RETIRE / UNKNOWN）逐行；
//   2. CLI 退出码契约（0/1/2/3），尤其是「拿产物来判定必须被拒绝」这条护栏；
//   3. 退场删除清单里点名的文件真实存在——清单是给人照着删的，文件改名后它不该静默腐烂。
//
// 真实 bundle 上的四类判决由 tools/update.sh 的 2/7 步覆盖（那是本项目里唯一有原版 bundle 的地方）。
//
// 用法：node tools/test_ui_patch_status.js        # 退出码非 0 表示回归
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const { decide, retireChecklist } = require('./ui_patch_status.js')
const { SENTINELS, PATCHES } = require('./apply_ui_code_patch.js')

const REPO = path.join(__dirname, '..')
const WORK = path.join(REPO, 'work', 'test-ui-patch-status')
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

// --- 1) 决策表 -------------------------------------------------------------------
const table = [
  [{ anchorsOk: true, defect: 'present' }, 'KEEP'],
  [{ anchorsOk: false, defect: 'present' }, 'REWRITE'],
  [{ anchorsOk: true, defect: 'absent' }, 'RETIRE'],
  [{ anchorsOk: false, defect: 'absent' }, 'RETIRE'],
  [{ anchorsOk: true, defect: 'unknown' }, 'UNKNOWN'],
  [{ anchorsOk: false, defect: 'unknown' }, 'UNKNOWN'],
  [{ anchorsOk: true, defect: 'unprobed' }, 'UNKNOWN'],
]
for (const [dims, want] of table) {
  const got = decide(dims)
  chk(got === want, `1) ${JSON.stringify(dims)} → ${want}（实际 ${got}）`)
}
chk(decide({ anchorsOk: true, defect: 'unknown' }) !== 'RETIRE', '1) 无法取证绝不判成 RETIRE')

// --- 2) 删除清单的完整性 ----------------------------------------------------------
const fakeGroup = { defect: 'stream-epoch', patches: PATCHES.filter((p) => p.defect === 'stream-epoch') }
const checklist = retireChecklist(fakeGroup).join('\n')
chk(checklist.includes('tools/apply_ui_code_patch.js'), '2) 清单点名要删的补丁文件')
const named = new Set(checklist.match(/[\w\u4e00-\u9fff./@-]+\.(?:js|sh|yml|md)/g) || [])
chk(named.size >= 5, `2) 清单点名了多个待处理文件（${named.size} 个）`)
for (const rel of named) {
  chk(fs.existsSync(path.join(REPO, rel)), `2) 清单点名的文件存在：${rel}`)
}
chk(fakeGroup.patches.length >= 1 && fakeGroup.patches.every((p) => checklist.includes(p.id)), '2) 清单列出该缺陷组的每条补丁 id')

// --- 3) CLI 退出码契约 ------------------------------------------------------------
const runCli = (args) => {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'ui_patch_status.js'), ...args], {
      encoding: 'utf8',
    })
    return { code: 0, out, err: '' }
  } catch (e) {
    return { code: e.status, out: String(e.stdout || ''), err: String(e.stderr || '') }
  }
}

const missing = runCli([path.join(WORK, 'nope.js')])
chk(missing.code === 2, `3) 路径不存在 → rc 2（实际 ${missing.code}）`)

// 护栏：已打补丁的产物里缺陷必然“复现不出”，据此删补丁是错的
const patched = path.join(WORK, 'patched.js')
fs.writeFileSync(patched, 'const x = 1;\n// ' + SENTINELS.join(' | ') + '\n')
const guarded = runCli([patched])
chk(guarded.code === 2, `3) 已打补丁的产物 → rc 2 拒绝（实际 ${guarded.code}）`)
chk(/已打补丁的产物/.test(guarded.err), '3) 拒绝理由点明「已打补丁的产物」')

// 无哨兵、又抽不到函数：只能是 UNKNOWN（rc 3），不能是 RETIRE
const junk = path.join(WORK, 'junk.js')
fs.writeFileSync(junk, 'const x = 1;\n')
const unknown = runCli([junk])
chk(unknown.code === 3, `3) 无法取证 → rc 3（实际 ${unknown.code}）`)
chk(/^ {2}判定：UNKNOWN$/m.test(unknown.out), '3) 该组判定行是 UNKNOWN')
chk(/^小结：KEEP 0 \/ RETIRE 0 \/ REWRITE 0 \/ UNKNOWN 1$/m.test(unknown.out), '3) 小结里计入 UNKNOWN 而不是 RETIRE')

console.log(fail ? `\n${fail} 项失败` : '\n全部通过（3 组用例）')
process.exit(fail ? 1 : 0)
