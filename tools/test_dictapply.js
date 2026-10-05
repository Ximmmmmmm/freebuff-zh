#!/usr/bin/env node
// dictapply.js 的自测：全程在临时目录里跑，绝不碰仓库的 dict.json。
// 用法：node tools/test_dictapply.js
//
// 覆盖的是那些「一次性脚本时代靠人脑记住」的拒绝条件：
//   T1 四类操作各跑通一次（dry-run 不落盘）
//   T2 片段命中多条 → AMBIGUOUS，且 --write 整体拒绝
//   T3 add 撞已存在键 → ADD_COLLISION，并提示改用 set
//   T4 rename 保序：新键落在旧键的位置上，不追加到末尾
//   T5 set 只换译文、不动键
//   T6 MISS 的处置：报告要给出「可能已在 patches/ 里」这条真实线索
//   T7 --write 干净清单：产物可被 JSON 解析、lint 通过、备份生成
//   T8 --emit 骨架：从上游报告样式（列表符号 / 引号 / 重复行）里捞出唯一原文
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const TOOL = path.join(REPO, 'tools', 'dictapply.js')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbzh-dictapply-'))
const DICT = path.join(tmp, 'dict.json')

const base = {
  exact: {
    'Freebuff will reopen shortly.': 'Freebuff 马上重新打开。',
    'Move it to Applications': '移到 Applications',
    'Delete thread': '删除会话',
    'Delete threads': '删除多个会话'
  },
  template: {
    'Close ${r.title||"new thread"}': '关闭“${r.title||"新会话"}”',
    'Undone. ${n} files restored.': '已撤销。已恢复 ${n} 个文件。'
  },
  code: { 'run_file_change_hooks:"Hooks"': 'run_file_change_hooks:"文件变更钩子"' },
  pattern: { Providers: '提供商', Compact: '压缩' }
}
fs.writeFileSync(DICT, JSON.stringify(base, null, 2) + '\n')

let pass = 0, fail = 0
function run (args) {
  const r = spawnSync(process.execPath, [TOOL].concat(args), { encoding: 'utf8', cwd: tmp })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
function t (name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n     ' + String(extra).split('\n').slice(0, 6).join('\n     ') : '')) }
}
let listSeq = 0
function writeList (obj, name) {
  // 每个用例独立文件：早先共用 list.json 时，后一个用例会把前一个的清单覆盖掉，
  // 于是「--write 拒绝」那条测的其实是另一份清单——这类假阳性必须靠文件名堵住。
  // 同一用例要跑多次（预览 + 落盘）时也必须给不同 name，否则照样互相覆盖。
  const p = path.join(tmp, 'list-' + (name || ++listSeq) + '.json')
  fs.writeFileSync(p, JSON.stringify(obj, null, 2))
  return p
}
function fresh () { fs.writeFileSync(DICT, JSON.stringify(base, null, 2) + '\n') }

console.log('dictapply 自测  tmp=' + tmp)

// T1 dry-run 四类操作
fresh()
let L = writeList({
  version: 'test',
  del: [{ section: 'pattern', key: 'Compact', note: '下线' }],
  rename: [{ section: 'template', key: 'Undone. ${n}', to: 'Undone. ${n} files were restored.' }],
  set: [{ section: 'pattern', key: 'Providers', value: '模型提供方' }],
  add: [{ section: 'exact', key: 'New copy in 157', value: '一五七的新文案' }]
})
let r = run([L, '--dict', DICT])
t('T1 dry-run 报告含四类计数且退出码 0', r.code === 0 && /del\s+1 项/.test(r.out) && /rename\s+1 项/.test(r.out) && /set\s+1 项/.test(r.out) && /add\s+1 项/.test(r.out), r.out)
t('T1 dry-run 未改动词典', fs.readFileSync(DICT, 'utf8') === JSON.stringify(base, null, 2) + '\n', r.out)
t('T1 报告列出实际执行的 4 项、并区分精确/片段命中', /将要执行的 4 项/.test(r.out) && /迁 template/.test(r.out), r.out)

// T2 歧义：'e thr' 谁都不是精确键，却同时包含在两条键里
fresh()
L = writeList({ del: [{ section: 'exact', key: 'e thr' }] })
r = run([L, '--dict', DICT])
t('T2 片段命中两条 → AMBIGUOUS 并列出候选', /AMBIGUOUS/.test(r.out) && /命中 2 条/.test(r.out) && /Delete threads/.test(r.out), r.out)
r = run([L, '--dict', DICT, '--write'])
const kept = JSON.parse(fs.readFileSync(DICT, 'utf8')).exact
t('T2 有问题时 --write 整体拒绝（退出码 2、键一条没少、不生成备份）', r.code === 2 && /带问题拒绝写入/.test(r.out) && Object.keys(kept).length === 4 && !fs.existsSync(DICT + '.before-dictapply'), r.out)
r = run([writeList({}), '--dict', DICT, '--write'])
t('T0 空清单直接报错，不静默写回', r.code === 1 && /没有可执行的条目/.test(r.out), r.out)

// T3 add 撞键
L = writeList({ add: [{ section: 'exact', key: 'Delete threads', value: '重复了' }] })
r = run([L, '--dict', DICT])
t('T3 add 已存在键 → ADD_COLLISION 并建议 set', /ADD_COLLISION/.test(r.out) && /改用 set/.test(r.out), r.out)

// T4 rename 保序
fresh()
L = writeList({ rename: [{ section: 'exact', key: 'Move it to', to: 'Move it to Applications (macOS)' }] })
r = run([L, '--dict', DICT, '--write'])
const keys = Object.keys(JSON.parse(fs.readFileSync(DICT, 'utf8')).exact)
t('T4 rename 后新键仍在原位（第 2 位，不是末尾）', r.code === 0 && keys[1] === 'Move it to Applications (macOS)', keys.join(' | ') + '\n' + r.out)
t('T4 译文随键带走（未给 value 时不变）', JSON.parse(fs.readFileSync(DICT, 'utf8')).exact['Move it to Applications (macOS)'] === '移到 Applications', r.out)

// T5 set 只换译文
fresh()
L = writeList({ set: [{ section: 'exact', key: 'Delete thread', value: '删掉这个会话' }] })
r = run([L, '--dict', DICT, '--write'])
const d5 = JSON.parse(fs.readFileSync(DICT, 'utf8'))
t('T5 set 换译文不换键、其余键序不动', r.code === 0 && d5.exact['Delete thread'] === '删掉这个会话' && Object.keys(d5.exact).join() === Object.keys(base.exact).join(), r.out)

// T6 MISS
L = writeList({ del: [{ section: 'exact', key: 'Never existed at all' }] })
r = run([L, '--dict', DICT])
t('T6 MISS 报告给出 patches/ 这条真实线索', /MISS/.test(r.out) && /patches\//.test(r.out), r.out)

// T7 干净清单落盘 + lint 闸门
fresh()
L = writeList({ add: [{ section: 'exact', key: 'Lint gate probe', value: '闸门探针' }] })
r = run([L, '--dict', DICT, '--write'])
t('T7 --write 成功：退出码 0、lint 通过、成功后不留备份', r.code === 0 && /lint 通过/.test(r.out) && !fs.existsSync(DICT + '.before-dictapply'), r.out)
{
  fresh()
  const L2 = writeList({ add: [{ section: 'exact', key: 'Keep backup probe', value: '保留备份探针' }] }, 't7keep')
  const r2 = run([L2, '--dict', DICT, '--write', '--keep-backup'])
  t('T7c --keep-backup 仍可显式留住备份', r2.code === 0 && fs.existsSync(DICT + '.before-dictapply'), r2.out)
  fs.rmSync(DICT + '.before-dictapply', { force: true })
}
t('T7 落盘格式仍是 2 空格 + 末尾换行', fs.readFileSync(DICT, 'utf8').endsWith('\n') && /\n  "exact": \{/.test(fs.readFileSync(DICT, 'utf8')), r.out)

// T7b lint 后置闸门：先确认「什么样的条目 lint 一定拦」，再验证还原
const bad = JSON.parse(JSON.stringify(base))
bad.exact['Broken entry'] = '坏条目 ${neverDefinedInKey}'
fs.writeFileSync(DICT, JSON.stringify(bad, null, 2) + '\n')
const lintProbe = spawnSync(process.execPath, [path.join(REPO, 'tools', 'lint_dict.js'), DICT], { encoding: 'utf8' })
t('T7b 前提成立：这类条目 lint_dict.js 确实会拦', lintProbe.status !== 0,
  'lint 直跑却放过了，闸门测试是空的\n' + (lintProbe.stdout || '') + (lintProbe.stderr || ''))
fresh()
L = writeList({ add: [{ section: 'exact', key: 'Broken entry', value: '坏条目 ${neverDefinedInKey}' }] })
r = run([L, '--dict', DICT, '--write'])
const after = JSON.parse(fs.readFileSync(DICT, 'utf8'))
t('T7b lint 不过时自动还原（坏条目没留在词典里）', r.code === 3 && /已还原/.test(r.out) && !('Broken entry' in after.exact), r.out)

// T8 emit 骨架
const src = path.join(tmp, 'upstream.txt')
fs.writeFileSync(src, ['- "Brand new string A"', '* Brand new string B', '  1. Brand new string A', '', '"Quoted whole line"'].join('\n'))
r = spawnSync(process.execPath, [TOOL, '--emit', 'exact', '--bare', '--from-file', src, '--value-fill', 'TODO'], { encoding: 'utf8', cwd: tmp })
const sk = JSON.parse(r.stdout)
t('T8 emit 去重 + 剥列表符号/引号 → 3 条', r.status === 0 && sk.add.length === 3, r.stdout)
t('T8 emit 产物可直接当清单用', run([writeListPath(sk), '--dict', DICT]).code === 0, r.stdout)

function writeListPath (obj) { const p = path.join(tmp, 'sk.json'); fs.writeFileSync(p, JSON.stringify(obj)); return p }

// T9 emit 直接吃 upstreamdiff 的报告段：按 [文案]/[短片段] 自动分区，@ 行折进 note
const rep = path.join(tmp, 'upstream.txt')
fs.writeFileSync(rep, [
  '上游文案对差（英文原版 vs 英文原版，不依赖上一版汉化包）',
  '  词典覆盖：新增里 3 条已覆盖 / 2 条待补翻',
  '',
  '## 新增文案 · 词典未覆盖（本版要翻的清单）',
  '  ⚠ [文案] Sponsor this run to keep going',
  '      @ ui/assets/index-abc123.js:1',
  '  ⚠ [短片段] Rechecking',
  '  ⚠ [字面量] Resume queue',
  '',
  '## 短标签 · 词典未覆盖（人工过目，不影响退出码）',
  '   单词标签在压缩产物里与标识符长得太像，一律收进来会淹掉清单；确认是文案就补进 dict.json。'
].join('\n'))
r = spawnSync(process.execPath, [TOOL, '--emit', '--from-file', rep], { encoding: 'utf8', cwd: tmp })
const sk9 = JSON.parse(r.stdout)
t('T9 emit 只收「新增文案」段的 3 条，标题/说明行不进清单', r.status === 0 && sk9.add.length === 3, r.stdout)
const secOf = (k) => (sk9.add.find((x) => x.key === k) || {}).section
t('T9 [文案]→exact、[短片段]/[字面量]→pattern 自动分区', secOf('Sponsor this run to keep going') === 'exact' && secOf('Rechecking') === 'pattern' && secOf('Resume queue') === 'pattern', JSON.stringify(sk9.add))
const withCtx = sk9.add.find((x) => x.key === 'Sponsor this run to keep going')
t('T9 @ 上下文只挂到紧邻的那条，不串位', /index-abc123/.test(withCtx.note) && !/@/.test(sk9.add[1].note || ''), JSON.stringify(sk9.add.map((x) => x.note)))

// T10 --check：AI 填完的清单体检（只读，四种典型偷懒/出错都要抓到）
fresh()
const before = fs.readFileSync(DICT, 'utf8')
L = writeList({
  add: [
    { section: 'exact', key: 'Resume the paused run', value: '继续已暂停的运行' },      // 正常
    { section: 'exact', key: 'Freebuff Cloud', value: 'Freebuff Cloud' },               // G3 抄回来
    { section: 'pattern', key: 'Rechecking', value: 'Rechecking' },                     // G3（优先于 G2：同文就是没翻）
    { section: 'code', key: 'run_file_change_hooks:"Hooks"', value: 'run_file_change_hooks:"钩子"' }, // G1
    { section: 'exact', key: 'GLM 5.3 Flash', value: '[EN] GLM 5.3 Flash' },             // [EN] 放行
    { section: 'exact', key: 'Still empty', value: '' },                                 // 未填
    { section: 'template', key: '${o.active ? "Enable"', value: '启用' }                 // G5 截断键
  ]
})
r = run([L, '--dict', DICT, '--check'])
t('T10 --check 抓出 G1（code 被翻）', r.code === 2 && /G1/.test(r.out), r.out)
t('T10 --check 抓出 G3（译文==原文）', /G3/.test(r.out), r.out)
t('T10 --check 抓出 G5（键被截断的模板片段）', /G5/.test(r.out), r.out)
t('T10 [EN] 前缀放行、未填只计数不算硬错', !/\[EN\] GLM/.test(r.out) && /未填\(value 为空\) 1/.test(r.out), r.out)
// 合格 = 正常那条 + [EN] 那条 + code 里 value==key 的情况（此处没有）= 3
t('T10 合格条目计数正确（含 [EN] 放行共 3 条）', /合格 3 · 未填\(value 为空\) 1 · 问题 4/.test(r.out), r.out)
fs.rmSync(DICT + '.before-dictapply', { force: true }) // 清掉 T7 留下的备份，才能证明 --check 不写文件
r = run([L, '--dict', DICT, '--check'])
t('T10 --check 全程只读（词典没动、也不生成备份）', fs.readFileSync(DICT, 'utf8') === before && !fs.existsSync(DICT + '.before-dictapply'), r.out)

// T11 --emit --guidance 组合（真实缺陷：GUIDANCE 定义处已 join，用法处又 join 一次会抛异常，
// 而只测 --emit 的用例全都不会碰到它）
r = spawnSync(process.execPath, [TOOL, '--emit', '--guidance', '--from-file', rep], { encoding: 'utf8', cwd: tmp })
t('T11 组合不崩（退出码 0）', r.status === 0, r.stderr)
t('T11 stdout 仍是纯 JSON、可解析', (() => { try { return JSON.parse(r.stdout).add.length === 3 } catch (e) { return false } })(), r.stdout.slice(0, 120))
t('T11 guidance 四条硬规则都在（code 不动 / 插值保留 / [EN] 出口 / thread 从不译「线程」）',
  /section=code/.test(r.stderr) && /插值/.test(r.stderr) && /\[EN\]/.test(r.stderr) && /从不译作「线程」/.test(r.stderr)
  && /只填 value/.test(r.stderr), r.stderr.slice(0, 240))

// T12 rename 的变量改名场景（真实缺陷：早期版本"译文原样带走"会让译文里的 ${or(e)}
// 不属于新键 ${sr(e)}，lint E3 判硬错误 —— 这是 0.0.159 迁移第一次撞上的）
const OLDK = 'Undone. ${n} files restored.', OLDV = '已撤销。已恢复 ${n} 个文件。'
// 这对场景直接落到仓库根的临时文件（跑完删）：与本工具的最小复现同构，
// 不与前面用例共享 DICT / base / tmp-cwd 状态，失败原因不会被夹具污染。
const mkLocal = (name, text) => { const p = path.join(REPO, `_tmp_${name}`); fs.writeFileSync(p, text); locals.push(p); return p }
const locals = []
const REN = (name, to, extra) => mkLocal(name + '.list.json', JSON.stringify({ rename: [Object.assign({ section: 'template', key: OLDK, to }, extra || {})] }))
const dictWith = (name) => mkLocal(name + '.dict.json', JSON.stringify({
  exact: { Settings: '设置' }, template: { [OLDK]: OLDV },
  code: { 'run_file_change_hooks:"Hooks"': 'run_file_change_hooks:"文件变更钩子"' },
  pattern: { Providers: '提供商' }
}, null, 2) + '\n')
{
  const runHere = (listFile, dictFile, extra) => {
    const rr = spawnSync(process.execPath, [TOOL, listFile, '--dict', dictFile].concat(extra || []), { encoding: 'utf8' })
    return { code: rr.status, out: (rr.stdout || '') + (rr.stderr || '') }
  }
  const d12 = dictWith('t12-d')
  r = runHere(REN('t12-preview', 'Undone. ${g} files.'), d12)
  t('T12 dry-run 明确报告「插值同步」而非「原样带走」', /插值同步/.test(r.out) && /\$\{n\}→\$\{g\}/.test(r.out), r.out)
  r = runHere(REN('t12-write', 'Undone. ${g} files.'), d12, ['--write'])
  const d12o = JSON.parse(fs.readFileSync(d12, 'utf8'))
  t('T12 --write 后译文插值已同步、lint 通过', r.code === 0 && d12o.template['Undone. ${g} files.'] === '已撤销。已恢复 ${g} 个文件。', JSON.stringify(d12o.template) + r.out)

  // T13 插值数量不等 → 写盘前就拒绝（原样带走必然违反 lint E3，不该做非法写入）
  const d13 = dictWith('t13-d')
  const before13 = fs.readFileSync(d13, 'utf8')
  r = runHere(REN('t13', 'Undone. ${a} and ${b} files.'), d13, ['--write'])
  t('T13 插值数量不等且未给 value → 拒绝写入并说明原因', r.code === 2 && /插值数量不等/.test(r.out) && fs.readFileSync(d13, 'utf8') === before13, r.out)
  r = runHere(REN('t13c', 'Undone. ${a} and ${b} files.', { value: '已撤销 ${a} 和 ${b} 个文件。' }), dictWith('t13c-d'), ['--write'])
  t('T13c 给了 value 就照做（数量不等也可显式改名）', r.code === 0 && /译文按给定值改写/.test(r.out), r.out)
  for (const p of locals) fs.rmSync(p, { force: true })
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
