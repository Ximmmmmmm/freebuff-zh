#!/usr/bin/env node
// missed_diagnose 自测（不依赖 Freebuff 产物，CI 可跑）。用具名夹具覆盖四类归属与退出码契约。
//
// 覆盖：
//   1. 命中本版 UI bundle → ok；
//   2. 只在 electron/*.cjs 出现 → mainOnly（这就是 0.0.131 适配踩的坑，必须单独成一类）；
//   3. 只在上一版 UI bundle 出现 → prevOnly（上游改写/下线）；
//   4. 两边都没有 → nowhere（历史死词条）；
//   5. 退出码：有够不着的就 1（构建会失败），全命中 0，参数/输入不对 2；
//   6. 目录形态的 --ui / --prev-ui 必须能自己找到 index-*.js（update.sh 传的是目录）。
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const WORK = path.join(REPO, 'work', 'test-missed-diagnose')
fs.rmSync(WORK, { recursive: true, force: true })

const write = (rel, body) => {
  const p = path.join(WORK, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}

// 夹具：本版 UI 里只有 A/B 两句；上一版 UI 里还有 C；主进程里有 D；E 谁都没有。
const uiDir = path.join(WORK, 'ui', 'assets')
fs.mkdirSync(uiDir, { recursive: true })
const uiBundle = path.join(uiDir, 'index-AAA.js')
fs.writeFileSync(uiBundle, 'var a="Alpha line.",b="Beta line.";\n')
write('ui/index.html', '<script type="module" crossorigin src="./assets/index-AAA.js"></script>\n')
const prevDir = path.join(WORK, 'prev', 'assets')
fs.mkdirSync(prevDir, { recursive: true })
fs.writeFileSync(path.join(prevDir, 'index-BBB.js'), 'var a="Alpha line.",c="Gamma line.";\n')
const electronDir = write('electron/main.cjs', 'const x = "Delta main only."\n')

const cases = {
  'dict-ok.json': { exact: { 'Alpha line.': '甲', 'Beta line.': '乙' } },
  'dict-main.json': { exact: { 'Alpha line.': '甲', 'Delta main only.': '丁' } },
  'dict-prev.json': { exact: { 'Alpha line.': '甲', 'Gamma line.': '丙' } },
  'dict-nowhere.json': { exact: { 'Alpha line.': '甲', 'Epsilon gone.': '戊' } },
}
for (const [n, body] of Object.entries(cases)) write(n, JSON.stringify(body, null, 2) + '\n')

const run = (args) => {
  try {
    return { code: 0, out: execFileSync('node', [path.join(REPO, 'tools', 'missed_diagnose.js'), ...args], { encoding: 'utf8' }) }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}
let fail = 0
const chk = (ok, msg) => {
  console.log((ok ? '  ok  ' : '  FAIL ') + msg)
  if (!ok) fail++
}
const base = ['--ui', path.join(WORK, 'ui'), '--electron', electronDir, '--prev-ui', path.join(WORK, 'prev')]

const casesRun = [
  ['dict-ok.json', 0, '命中的词条都过'],
  ['dict-main.json', 1, '只在主进程出现 → 拦下'],
  ['dict-prev.json', 1, '只在上版 UI 出现 → 拦下'],
  ['dict-nowhere.json', 1, '两边都没有 → 拦下'],
]
for (const [dictFile, want, label] of casesRun) {
  const r = run(['--dict', path.join(WORK, dictFile), ...base])
  chk(r.code === want, `${label}（rc ${r.code}，期望 ${want}）`)
}
const rMain = run(['--dict', path.join(WORK, 'dict-main.json'), ...base])
chk(/只在主进程出现/.test(rMain.out) && /Delta main only\./.test(rMain.out), '  报出「只在主进程出现」清单并给出文件名')
chk(/patches\/electron-\*\.patch/.test(rMain.out), '  提示写成 patches/ 并从句典删掉')
const rPrev = run(['--dict', path.join(WORK, 'dict-prev.json'), ...base])
chk(/只在上一版 UI 出现/.test(rPrev.out), '  报出「只在上一版 UI 出现」')
const rNo = run(['--dict', path.join(WORK, 'dict-nowhere.json'), ...base])
chk(/两边都没有/.test(rNo.out), '  报出「两边都没有」')
const rOk = run(['--dict', path.join(WORK, 'dict-ok.json'), ...base])
chk(/✓ 2 条词条都能在本版 UI bundle 里命中/.test(rOk.out), '  全命中时给出计数并 rc 0')

// 参数 / 输入契约
chk(run(['--ui', path.join(WORK, 'ui')]).code === 2, '缺 --dict → rc 2')
chk(run(['--dict', path.join(WORK, 'dict-ok.json')]).code === 2, '缺 --ui → rc 2')
chk(run(['--dict', path.join(WORK, 'nope.json'), ...base]).code === 2, '词典不存在 → rc 2')
chk(run(['--dict', path.join(WORK, 'dict-ok.json'), '--ui', path.join(WORK, 'empty')]).code === 2, '目录里找不到 index-*.js → rc 2')
chk(run(['--dict', path.join(WORK, 'dict-ok.json'), ...base, '--bad']).code === 2, '未知参数 → rc 2')
// 没有上一版基线时：prevOnly 那档退化成 nowhere（仍然拦下，只是分类说法不同）
const rNoPrev = run(['--dict', path.join(WORK, 'dict-prev.json'), '--ui', path.join(WORK, 'ui'), '--electron', electronDir])
chk(rNoPrev.code === 1 && /两边都没有/.test(rNoPrev.out), '没有上一版基线时退化为「两边都没有」并仍拦下')

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
