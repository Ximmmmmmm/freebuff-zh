#!/usr/bin/env node
// ci_gates.sh 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 这个脚本守的是「PR 阶段就能拦下写坏的词典 / 补丁」。它自己最容易出两类问题，必须钉住：
//   1. **假绿灯**：闸门失败却因为 run_gate 的返回值/`FAILED` 判据写错而 rc 0——那样 CI 就是
//      装饰品。这里用两个夹具（一个埋了「词条被当路径用」+「界面位置有未登记英文」的坏快照、
//      一个干净的）分别断言 rc 1 / rc 0，并断言坏的那次**具体是哪两道**在报。
//   2. **跳过路径冒充通过**：本版还没发 Release（取不到快照）时脚本打 ::warning:: 并 rc 0，
//      这是有意设计（本地 update.sh / release.sh 同名闸门更严格），但必须让它在输出里说清楚，
//      而且不能把「有快照、但闸门真失败」也归到这条路上。
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const WORK = path.join(REPO, 'work', 'test-ci-gates')
fs.rmSync(WORK, { recursive: true, force: true })

const write = (rel, body) => {
  const p = path.join(WORK, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}

// --- 夹具：两个迷你快照 + 一份两边都套得上的补丁 ---------------------------------------
// sample.cjs 两边逐字节相同（补丁 / 占用检查都对着它），差别只在别的文件里：
//   snap-bad 多一个 other.cjs，里面把词典词条 Cancel 当路径用（闸门 A 该报）；// snap-bad 的 ui 主 bundle 里有个未登记的界面位置英文（闸门 C 该报）。注意别用 Settings 这类
// **词典里已有**的单词标签做夹具：apply.js 会先把它翻掉，uipos 就报不出来了（夹具自己踩过）。
const sample = ['// sample fixture', 'const greet = () => 1', 'module.exports = { greet }', ''].join('\n')
const uiOk = 'var a={title:"已翻译的标题"},b={label:"已翻译"}\n'
const uiBad = 'var a={label:"Widgetry"}\n'
for (const [name, extra, ui] of [
  ['snap-bad', "const profile = path.join(root, 'Cancel')\n", uiBad],
  ['snap-ok', '', uiOk],
]) {
  write(`${name}/snapshot.json`, JSON.stringify({ version: '0.0.0', components: ['ui', 'electron'] }, null, 2) + '\n')
  write(`${name}/electron/sample.cjs`, sample)
  write(`${name}/ui/assets/index-X.js`, ui)
  write(`${name}/ui/index.html`, '<script type="module" crossorigin src="./assets/index-X.js"></script>\n')
  if (extra) write(`${name}/electron/other.cjs`, extra)
}
const patch = [
  '--- a/electron/sample.cjs',
  '+++ b/electron/sample.cjs',
  '@@ -1,3 +1,3 @@',
  ' // sample fixture',
  '-const greet = () => 1',
  '+const greet = () => 2',
  ' module.exports = { greet }',
  '',
].join('\n')
write('patches/electron-sample.cjs.patch', patch)

const run = (args) => {
  try {
    return { code: 0, out: execFileSync('bash', [path.join(REPO, 'tools', 'ci_gates.sh'), ...args], { encoding: 'utf8' }) }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}
let fail = 0
const chk = (ok, msg) => {
  console.log((ok ? '  ok  ' : '  FAIL ') + msg)
  if (!ok) fail++
}

// --- 坏快照：闸门 A 与 C 必须报，rc 1（假绿灯防线）----------------------------------
const bad = run(['--snapshot', path.join(WORK, 'snap-bad'), '--patches', path.join(WORK, 'patches')])
chk(bad.code === 1, `坏快照 → rc 1（实际 ${bad.code}）`)
chk(/::error::.*闸门 A/.test(bad.out), '闸门 A（词条被当路径用）报 ::error::')
chk(/文件系统调用参数/.test(bad.out) && /"Cancel"/.test(bad.out), '闸门 A 指出是哪个词条、哪种形态')
chk(/::error::.*闸门 C/.test(bad.out), '闸门 C（未登记的界面位置英文）报 ::error::')
chk(/· Widgetry/.test(bad.out), '闸门 C 列出未登记的那条')
chk(!/::error::.*闸门 B/.test(bad.out), '闸门 B 在坏快照上仍通过（补丁能套用，不该误报）')
chk(/三道闸门全部通过/.test(bad.out) === false, '失败时不得打印「全部通过」')
chk(/本地复现/.test(bad.out), '失败时给出本地复现命令')

// --- 干净快照：三道全过，rc 0 -------------------------------------------------------
const ok = run(['--snapshot', path.join(WORK, 'snap-ok'), '--patches', path.join(WORK, 'patches')])
chk(ok.code === 0, `干净快照 → rc 0（实际 ${ok.code}）`)
chk(/三道闸门全部通过/.test(ok.out), '干净快照报「三道闸门全部通过」')
chk(/闸门 A：[^\n]*通过/.test(ok.out) && /闸门 B：[^\n]*通过/.test(ok.out) && /闸门 C：[^\n]*通过/.test(ok.out), '三道各自的 ✓ 都打印')
chk(!/::error::/.test(ok.out), '干净快照没有任何 ::error:: 注解')

// --- 补丁坏掉时闸门 B 要拦（用不存在的补丁目录 / 内容对不上的补丁）-------------------
fs.mkdirSync(path.join(WORK, 'patches-broken'), { recursive: true })
fs.writeFileSync(
  path.join(WORK, 'patches-broken', 'electron-sample.cjs.patch'),
  ['--- a/electron/sample.cjs', '+++ b/electron/sample.cjs', '@@ -1,3 +1,3 @@', ' const gone = 1', '-const alsoGone = 2', '+const alsoGone = 3', ''].join('\n'),
)
const brokenPatch = run(['--snapshot', path.join(WORK, 'snap-ok'), '--patches', path.join(WORK, 'patches-broken')])
chk(brokenPatch.code === 1, `补丁套不上 → rc 1（实际 ${brokenPatch.code}）`)
chk(/::error::.*闸门 B/.test(brokenPatch.out), '闸门 B 报 ::error::')
chk(/上游改写了这段/.test(brokenPatch.out), '闸门 B 给出「上游改写」的分诊结论')
chk(/闸门 A：[^\n]*通过/.test(brokenPatch.out) && /闸门 C：[^\n]*通过/.test(brokenPatch.out), 'A / C 在补丁坏掉时仍各自给出结论')

// --- 参数契约 ----------------------------------------------------------------------
chk(run(['--bad']).code === 2, '未知参数 → rc 2')
chk(run(['--snapshot', path.join(WORK, 'nope'), '--patches', path.join(WORK, 'patches')]).code === 2, '快照不存在 → rc 2')

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
