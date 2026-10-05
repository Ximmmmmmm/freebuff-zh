#!/usr/bin/env node
// fastloop.js 自测：全程在临时目录，绝不碰仓库 dict.json 与装机文件。
//   node tools/test_fastloop.js
//
// 覆盖的是这套判据里最容易出错、也最容易「测了个寂寞」的几处：
//   F0 夹具自证：模拟原版里必须真的带 \uXXXX 字面量，否则 F4 测的是空气
//   F1 干净词典全量覆盖 → rc 0
//   F2 新增一条原版里真存在的键 → rc 0 且报「增 1」
//   F3 新增一条原版里不存在的键 → rc 2，点名它并追问「是不是该进 patches/」
//   F4 键含弯撇号、源码里写成 \uXXXX 转义 → 仍判命中（这条曾真的把工具打回炉）
//   F5 原版里确实没有的 ${} 键 → 如实报未命中（负例，证明判据没宽松过头）
//   F6 lint 不过时归因给 lint，不冒充「命中失败」（两者处置完全不同）
//   F7 只删条目 → 不算错
//   F8 缺 / 错 --pristine → 启动即拒，不能退化成「只跑 lint」的假安全
//   F9 差集才是判据：基线里就存在的坏键，无改动时不该拦人；全量模式则如实报数
// 夹具说明：lint_dict.js 逐行解析，空分区会被写成 "code": {} 并被它误判成
//   「条目出现在任何分区之外」——所以每个分区都放至少一条真实条目。
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const TOOL = path.join(REPO, 'tools', 'fastloop.js')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbzh-fastloop-'))

// 「英文原版 bundle」：几种形态各放一条，弯撇号那条刻意写成 \uXXXX 转义（真实产物常见）
const BUNDLE = path.join(tmp, 'index-simulated1.js')
const BUNDLE_SRC = [
  'const a = "Delete thread permanently";',
  'const b = "tab\\u2019s session";',
  'const c = `You have ${n} unread message${n===1?"":"s"}`;',
  'const d = "Resume the paused run";',
  'const e = "Settings";',
  'const f = "Providers";',
  'const g = { run_file_change_hooks:"Hooks" };'
].join('\n')
fs.writeFileSync(BUNDLE, BUNDLE_SRC)

const BASE = {
  exact: { 'Resume the paused run': '继续已暂停的运行', Settings: '设置' },
  template: { 'You have ${n} unread message${n===1?"":"s"}': '你有 ${n} 条未读消息' },
  code: { 'run_file_change_hooks:"Hooks"': 'run_file_change_hooks:"文件变更钩子"' },
  pattern: { Providers: '提供商' }
}
let seq = 0
function writeDict (mutate, name) {
  const d = JSON.parse(JSON.stringify(BASE))
  if (mutate) mutate(d)
  const p = path.join(tmp, (name || 'dict-' + (++seq)) + '.json')
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n')
  return p
}
function run (dictPath, extra) {
  const r = spawnSync(process.execPath, [TOOL, '--once', '--pristine', BUNDLE, '--dict', dictPath].concat(extra || []),
    { encoding: 'utf8', cwd: tmp })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
let pass = 0, fail = 0
function t (name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n     ' + String(extra).split('\n').slice(0, 8).join('\n     ') : '')) }
}

console.log('fastloop 自测  tmp=' + tmp)

t('F0 夹具自证：bundle 含 \\u2019 字面量、且不是裸字符', BUNDLE_SRC.includes('tab\\u2019s') && !BUNDLE_SRC.includes('tab’s'), BUNDLE_SRC)

const clean = writeDict(null, 'clean')
t('F1 干净词典全量覆盖 → rc 0', run(clean).code === 0, run(clean).out)
{
  const r = spawnSync(process.execPath, [TOOL, '--once', '--dict', clean], { encoding: 'utf8', cwd: tmp })
  t('F8 不给 --pristine 直接拒，并说明理由', r.status === 1 && /假的安全感/.test((r.stdout || '') + (r.stderr || '')), '')
  const r2 = spawnSync(process.execPath, [TOOL, '--once', '--dict', clean, '--pristine', path.join(tmp, 'nope')], { encoding: 'utf8', cwd: tmp })
  t('F8b --pristine 指到不存在的路径也拒', r2.status === 1, '')
}

let r = run(writeDict((d) => { d.exact['Delete thread permanently'] = '永久删除该会话' }), ['--baseline', clean])
t('F2 新增命中得到的键 → rc 0 且报「增 1」', r.code === 0 && /增 1/.test(r.out), r.out)

r = run(writeDict((d) => { d.exact['This sentence exists nowhere'] = '原版没有的键' }), ['--baseline', clean])
t('F3 新增命中不到的键 → rc 2 并点名', r.code === 2 && /This sentence exists nowhere/.test(r.out), r.out)
t('F3 追问「该句是否已下线或只在主进程（那要进 patches/）」', /patches\//.test(r.out) && /MISSED/.test(r.out), r.out)

r = run(writeDict((d) => { d.exact['tab’s session'] = '该标签页的会话' }), ['--baseline', clean])
t('F4 弯撇号键（源码写 \\uXXXX）仍判命中', r.code === 0 && !/找不到/.test(r.out), r.out)

r = run(writeDict((d) => { d.template['Undone ${x} thing${x===1?"":"s"}'] = '已撤销 ${x} 项' }), ['--baseline', clean])
t('F5 原版里没有的 ${} 键 → 如实报未命中（负例）', r.code === 2 && /Undone/.test(r.out), r.out)

r = run(writeDict((d) => { d.exact['Resume the paused run'] = '继续 ${notInKey} 的运行' }), ['--baseline', clean])
t('F6 lint 不过时报 lint 错、不冒充命中失败', r.code === 2 && /lint_dict 未通过/.test(r.out) && !/找不到/.test(r.out), r.out)

{
  const fewer = writeDict((d) => { delete d.exact.Settings }, 'fewer')
  r = run(fewer, ['--baseline', clean])
  t('F7 只删一条 → 不算错，报「删 1 / 增 0」', r.code === 0 && /删 1/.test(r.out) && /增 0/.test(r.out), r.out)
}

{
  const withStale = writeDict((d) => { d.exact['Not here at all'] = '原版没有的老条目' }, 'stale')
  const r1 = run(withStale, ['--baseline', withStale])
  t('F9 无改动时不因历史坏键报错', r1.code === 0 && /词条无变化/.test(r1.out), r1.out)
  const r2 = run(withStale)
  t('F9b 全量模式如实报出历史未命中条数', r2.code === 0 && /1 条在本版原版命中不了/.test(r2.out), r2.out)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
