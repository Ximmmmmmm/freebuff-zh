#!/usr/bin/env node
// ci_gates.sh 自测（不依赖 Freebuff 产物、不联网，CI 可跑）。
//
// 这个脚本守的是「PR 阶段就能拦下写坏的词典 / 补丁 / 漏翻」。它自己最容易出两类问题，必须钉住：
//   1. **假绿灯**：闸门失败却因为 run_gate 的返回值 / FAILED 判据写错而 rc 0——那样 CI 就是
//      装饰品。这里四道闸门各配一个负向夹具（词条被当路径用、界面位置有未登记英文、主进程漏翻、
//      上一版译过而这一版变回英文），断言 rc 1，并断言**具体是哪一道**在报、其余各自给出结论。
//   2. **跳过路径冒充通过**：本版还没发 Release（取不到快照）或取不到上一版包时脚本打
//      ::warning:: 且不拦 CI，这是有意设计（本地 update.sh / release.sh 的同名闸门更严格），
//      但必须让它在输出里说清楚，而且**不得**打印「全部通过」——否则「跳过」和「通过」在
//      CI 上看不出差别。
//
// 夹具一律用 --snapshot / --patches / --prev 显式传入：自测不联网（脚本里那两条从 Release 取
// 快照 / 取上一版包的路径由 workflow 上的真实运行覆盖）。
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

// --- 夹具：三个迷你快照 + 两个「上一版」迷你包 + 一份两边都套得上的补丁 ------------------
// 每个负向夹具只喂一道闸门，失败时才一眼看得出是谁在报：
//   · other.cjs 把词典词条 Cancel 当路径用        → 闸四（位置形态：文件系统调用参数）
//   · leak.cjs 一条多词英文（≥2 词 + 常见小词）   → 闸一（主进程漏翻）
//   · ui 里的 Widgetry 落在 `label:` 这类属性锚点上 → 闸三（uipos 只认属性名锚点）
//   · ui 里那句 7 词英文不在属性锚点上             → 闸二（regress 的片段口径 ≥3 词，uipos 看不见）
// 注意别用 Settings 这类**词典里已有**的单词标签做夹具：apply.js 会先把它翻掉，闸三就报不出来
// 了（夹具自己踩过这个坑）。sample.cjs 两边逐字节相同，补丁 / 字面量检查都对着它。
const sample = ['// sample fixture', 'const greet = () => 1', 'module.exports = { greet }', ''].join('\n')
const uiOk = 'var a={title:"已翻译的标题"},b={label:"已翻译"}\n'
const uiGap = 'var a={label:"Widgetry"}\n'
const uiRegress = 'var msg="This project will be deleted permanently"\n'
const leakLine = "const note = 'Delete this project permanently'\n"
const indexHtml = (bundle) => `<script type="module" crossorigin src="./assets/${bundle}"></script>\n`

for (const [name, extra, ui] of [
  ['snap-bad', { 'electron/other.cjs': "const profile = path.join(root, 'Cancel')\n", 'electron/leak.cjs': leakLine }, uiGap],
  ['snap-ok', {}, uiOk],
  ['snap-regress', {}, uiRegress],
]) {
  write(`${name}/snapshot.json`, JSON.stringify({ version: '0.0.0', components: ['ui', 'electron'] }, null, 2) + '\n')
  write(`${name}/electron/sample.cjs`, sample)
  for (const [rel, body] of Object.entries(extra)) write(`${name}/${rel}`, body)
  write(`${name}/ui/assets/index-X.js`, ui)
  write(`${name}/ui/index.html`, indexHtml('index-X.js'))
}
// 上一版基线的迷你「已发布产物」：regress / uipos_gap 都按目录找主 bundle（ui/index.html
// 里那条 src，或 ui/assets/index-*.js）。prev-same 是闸二的反向夹具——上一版就有那句英文，
// 于是这一版再出现它不算回归；少了它，「闸二恒报错」也能骗过上面那些断言。
for (const [name, ui] of [
  ['prev-ok', 'var a={label:"已翻译的标题"}\n'],
  ['prev-same', uiRegress],
]) {
  write(`${name}/ui/assets/index-P.js`, ui)
  write(`${name}/ui/index.html`, indexHtml('index-P.js'))
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
const SNAP = (n) => path.join(WORK, n)
const PATCHES = path.join(WORK, 'patches')
const PREV_OK = path.join(WORK, 'prev-ok')
const base = (snap, prev) => ['--snapshot', SNAP(snap), '--patches', PATCHES, ...(prev ? ['--prev', prev] : [])]
// ✓ 那行的形状：`   ✓ <闸门名> 通过`——按 includes 判，不跟转义较劲
const passed = (out, g) => out.split('\n').some((l) => l.includes(`✓ ${g}`) && l.includes('通过'))

// --- 坏快照：闸一 / 闸三 / 闸四 各报各的，rc 1（假绿灯防线）--------------------------
const bad = run(base('snap-bad', PREV_OK))
chk(bad.code === 1, `坏快照 → rc 1（实际 ${bad.code}）`)
chk(/::error::.*闸一/.test(bad.out), '闸一（主进程漏翻）报 ::error::')
chk(/Delete this project permanently/.test(bad.out), '闸一 点出漏翻的那句')
chk(/::error::.*闸三/.test(bad.out), '闸三（未登记的界面位置英文）报 ::error::')
chk(/· Widgetry/.test(bad.out), '闸三 列出未登记的那条')
chk(/::error::.*闸四/.test(bad.out), '闸四（词条被当路径用）报 ::error::')
chk(/文件系统调用参数/.test(bad.out) && /"Cancel"/.test(bad.out), '闸四 指出是哪个词条、哪种形态')
chk(passed(bad.out, '闸二'), '闸二 在坏快照上仍通过（没有 ≥3 词的回归片段，不该误报）')
chk(/全部通过/.test(bad.out) === false, '失败时不得打印「全部通过」')
chk(/本地复现/.test(bad.out), '失败时给出本地复现命令')

// --- 干净快照：四道全过，rc 0 -------------------------------------------------------
const ok = run(base('snap-ok', PREV_OK))
chk(ok.code === 0, `干净快照 → rc 0（实际 ${ok.code}）`)
chk(/四道发布闸门 \+ 补丁锚点预检全部通过/.test(ok.out), '干净快照报「全部通过」')
chk(['闸一', '闸二', '闸三', '闸四', '附加·补丁锚点预检'].every((g) => passed(ok.out, g)), '五道各自的 ✓ 都打印')
chk(!/::error::/.test(ok.out), '干净快照没有任何 ::error:: 注解')
chk(!/::warning::/.test(ok.out), '干净快照没有任何 ::warning:: 注解')

// --- 回归闸门：上一版译过、这一版变回英文 → 只有闸二报 -------------------------------
const regressBad = run(base('snap-regress', PREV_OK))
chk(regressBad.code === 1, `回归夹具 → rc 1（实际 ${regressBad.code}）`)
chk(/::error::.*闸二/.test(regressBad.out), '闸二（变回英文的静默回归）报 ::error::')
chk(/This project will be deleted permanently/.test(regressBad.out), '闸二 列出回归的那句')
chk(passed(regressBad.out, '闸一'), '闸一 在这个夹具上仍通过')
chk(passed(regressBad.out, '闸三'), '闸三 在这个夹具上仍通过（那句不在界面属性锚点上）')
chk(passed(regressBad.out, '闸四'), '闸四 在这个夹具上仍通过')

// --- 回归闸门的反向夹具：同一句在上一版里就有 ⇒ 不算回归，rc 0 -------------------------
const regressOk = run(base('snap-regress', path.join(WORK, 'prev-same')))
chk(regressOk.code === 0, `反向夹具 → rc 0（实际 ${regressOk.code}）`)
chk(passed(regressOk.out, '闸二'), '闸二 对「上一版也有」不误报')

// --- 没有基线：闸二明说未执行、闸三退回看全量，且不许打印「全部通过」------------------
const noBaseline = run([...base('snap-ok'), '--no-baseline'])
chk(noBaseline.code === 0, `--no-baseline → rc 0（实际 ${noBaseline.code}）`)
chk(/::warning::.*闸二/.test(noBaseline.out) && /未执行/.test(noBaseline.out), '闸二 打 ::warning:: 并说明未执行')
chk(/通过（未执行：闸二/.test(noBaseline.out), '汇总里点出未执行的闸门')
chk(/全部通过/.test(noBaseline.out) === false, '有闸门未执行时不得说「全部通过」')
chk(passed(noBaseline.out, '闸三'), '闸三 退回看全量后照样给出结论')

// --- 补丁坏掉：附加闸门拦下，闸一明说镜像建不出来，闸三 / 闸四 仍各自给结论 ------------
fs.mkdirSync(path.join(WORK, 'patches-broken'), { recursive: true })
fs.writeFileSync(
  path.join(WORK, 'patches-broken', 'electron-sample.cjs.patch'),
  ['--- a/electron/sample.cjs', '+++ b/electron/sample.cjs', '@@ -1,3 +1,3 @@', ' const gone = 1', '-const alsoGone = 2', '+const alsoGone = 3', ''].join('\n'),
)
const brokenPatch = run(['--snapshot', SNAP('snap-ok'), '--patches', path.join(WORK, 'patches-broken'), '--prev', PREV_OK])
chk(brokenPatch.code === 1, `补丁套不上 → rc 1（实际 ${brokenPatch.code}）`)
chk(/::error::.*附加·补丁锚点预检/.test(brokenPatch.out), '附加闸门（补丁锚点预检）报 ::error::')
chk(/上游改写了这段/.test(brokenPatch.out), '附加闸门给出「上游改写」的分诊结论')
chk(/::error::.*闸一未执行/.test(brokenPatch.out), '闸一 明说未执行（镜像建不出来，不冒充结论）')
chk(passed(brokenPatch.out, '闸三') && passed(brokenPatch.out, '闸四'), '闸三 / 闸四 在补丁坏掉时仍各自给出结论')

// --- 补丁目录空着：镜像不可信，闸一必须拒绝给结论（而不是把补丁翻好的句子报成漏翻）------
fs.mkdirSync(path.join(WORK, 'patches-empty'), { recursive: true })
const noPatches = run(['--snapshot', SNAP('snap-ok'), '--patches', path.join(WORK, 'patches-empty'), '--no-baseline'])
chk(noPatches.code === 1, `补丁目录空着 → rc 1（实际 ${noPatches.code}）`)
chk(/::error::[^\n]*没有 electron-\*\.patch/.test(noPatches.out), '明说补丁目录里没有 electron-*.patch')
chk(/::error::闸一未执行/.test(noPatches.out), '闸一 拒绝在不可信的镜像上给结论')
chk(passed(noPatches.out, '闸四'), '闸四 不受影响，照常给出结论')

// --- 参数契约 ----------------------------------------------------------------------
chk(run(['--bad']).code === 2, '未知参数 → rc 2')
chk(run(['--snapshot', SNAP('nope'), '--patches', PATCHES]).code === 2, '快照不存在 → rc 2')
chk(run(['--snapshot', SNAP('snap-ok'), '--patches', PATCHES, '--prev', SNAP('nope')]).code === 2, '--prev 路径不存在 → rc 2')

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
