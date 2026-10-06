#!/usr/bin/env node
// build_key.js 自测（合成夹具，不联网、不碰真仓库的 output/，CI 可跑）。
//
// 这道工具的价值全在「它说可以复用的时候，产物真的与输入一一对应」——所以自测不测「它能算出
// 一个数」，而是钉住四类**会让复用变成事故**的情况：
//   1. 输入变了却说能复用：dict / patches / tools / manifest / 原版 asar / 原版 ui / build.sh
//      各改一个字节，指纹都必须变（`tools/**` 那条最容易漏——改了 apply.js，构建行为就变了）；
//   2. 产物被改动却说能复用：手改 output / 少一个文件 / 多一个文件，verify 都必须 rc 1 并点名；
//   3. 没有构建记录就说能复用（首次运行、缓存被删、缓存损坏）；
//   4. 指纹内容化：只改 mtime（`touch`）不该让指纹变，否则「重新 checkout 一次」就白丢缓存。
// 另外钉住四组输入「哪一组变了」的诊断输出——排障时这句话比一个哈希前缀有用得多。
'use strict'
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const TOOL = path.join(REPO, 'tools', 'build_key.js')
const WORK = path.join(REPO, 'work', 'test-build-key')
fs.rmSync(WORK, { recursive: true, force: true })

const R = path.join(WORK, 'repo')
const write = (rel, body) => {
  const p = path.join(R, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}
// 夹具仓库：输入侧（build.sh / dict / 登记表 / manifest / patches / tools）+ 产物侧（output/）+ 原版
const INPUTS = {
  'build.sh': '#!/usr/bin/env bash\necho build\n',
  'dict.json': JSON.stringify({ exact: { Hello: '你好' }, template: {}, code: {}, pattern: {} }, null, 2) + '\n',
  'intentional-english.json': JSON.stringify({ fragments: [], uiStrings: [] }, null, 2) + '\n',
  'manifest.json': JSON.stringify({ targetVersion: '0.0.0', packVersion: '0.0.0' }, null, 2) + '\n',
  'patches/electron-a.cjs.patch': '--- a/electron/a.cjs\n+++ b/electron/a.cjs\n@@ -1 +1 @@\n-const a = 1\n+const a = 2\n',
  'tools/apply.js': '// 夹具工具\n',
  'tools/semantic_guard.js': '// 夹具工具 2\n',
}
for (const [rel, body] of Object.entries(INPUTS)) write(rel, body)
write('orig/app.asar', 'ASAR-FIXTURE-v1')
write('orig/ui/index.html', '<html lang="en"><script src="./assets/index-A.js"></script></html>\n')
write('orig/ui/assets/index-A.js', 'var a="Hello";\n')
write('output/app.asar', 'PRODUCT-ASAR-v1')
write('output/ui/index.html', '<html lang="zh-CN"><script src="./assets/index-P.js"></script></html>\n')
write('output/ui/assets/index-P.js', 'var a="你好";\n')

const ASAR = path.join(R, 'orig', 'app.asar')
const UI = path.join(R, 'orig', 'ui')
const base = ['--root', R, '--asar', ASAR, '--ui', UI, '--out', path.join(R, 'output'), '--cache', path.join(R, 'work', 'build-cache.json')]
const run = (args) => {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
const keyNow = () => run(['key', ...base]).out.trim()
const [, , , asarArg, uiArg] = base // --out / --cache 不参与 key

let pass = 0
let fail = 0
const t = (name, cond, extra) => {
  if (cond) {
    pass++
    console.log('  ✓ ' + name)
  } else {
    fail++
    console.log('  ✗ ' + name + (extra ? '\n     ' + String(extra).split('\n').slice(0, 4).join('\n     ') : ''))
  }
}

console.log('build_key 自测  tmp=' + R)

// --- T1 指纹本身 -------------------------------------------------------------------
const k1 = keyNow()
t('T1 key 打印 64 位十六进制', /^[0-9a-f]{64}$/.test(k1), k1)
t('T1 同一输入两次算出同一个指纹', k1 === keyNow(), k1)
// 只改 mtime：内容没变就不该失效（重新 checkout / 拷贝文件不该白丢缓存）
const d = path.join(R, 'dict.json')
fs.utimesSync(d, new Date(2000, 1, 1), new Date(2000, 1, 1))
t('T1 只改 mtime（touch）不影响指纹', keyNow() === k1, keyNow())

// --- T2 七组输入，各改一个字节 → 指纹必须变 -----------------------------------------
const bump = (rel, mutate) => {
  const p = path.join(R, rel)
  const before = fs.readFileSync(p)
  fs.writeFileSync(p, mutate ? mutate(before.toString()) : before.toString() + 'x')
  const changed = keyNow() !== k1
  fs.writeFileSync(p, before)
  return changed
}
t('T2 词典改一个字节 → 指纹变（回到原样后又一致）', bump('dict.json'), keyNow())
for (const rel of ['build.sh', 'manifest.json', 'intentional-english.json', 'patches/electron-a.cjs.patch', 'tools/apply.js']) {
  t(`T2 ${rel} 改一个字节 → 指纹变`, bump(rel))
}
{
  const p = path.join(R, 'orig', 'ui', 'assets', 'index-A.js')
  const before = fs.readFileSync(p)
  fs.writeFileSync(p, 'var a="Hello!";\n')
  const changed = keyNow() !== k1
  fs.writeFileSync(p, before)
  t('T2 原版 ui 改一个字节 → 指纹变', changed)
  const oldAsar = ASAR
  const alt = write('orig/app-alt.asar', 'ASAR-FIXTURE-v2')
  const changed2 = run(['key', '--root', R, '--asar', alt, '--ui', UI]).out.trim() !== k1
  t('T2 原版 app.asar 换一份 → 指纹变', changed2 && !!oldAsar)
}
t('T2 全部还原后指纹回到原值', keyNow() === k1, keyNow())

// --- T3/T4 没有记录 / 记录后复用 ----------------------------------------------------
t('T3 没有构建记录 → verify rc 1 且说清原因', (() => {
  const r = run(['verify', '--key', k1, ...base])
  return r.code === 1 && /没有构建记录/.test(r.out)
})(), run(['verify', '--key', k1, ...base]).out)
const rec = run(['record', '--key', k1, ...base])
t('T4 record rc 0 并报出产物文件数', rec.code === 0 && /产物 3 个文件/.test(rec.out), rec.out)
const ok = run(['verify', '--key', k1, ...base])
t('T4 指纹与产物都对得上 → verify rc 0 可复用', ok.code === 0 && /可复用/.test(ok.out), ok.out)

// --- T5/T6/T7 产物侧：改动 / 缺文件 / 多文件都要拒绝 ---------------------------------
{
  const p = path.join(R, 'output', 'app.asar')
  const before = fs.readFileSync(p)
  fs.writeFileSync(p, 'PRODUCT-ASAR-tampered')
  const r = run(['verify', '--key', k1, ...base])
  t('T5 产物被改动 → rc 1 且点名该文件', r.code === 1 && /已改动：app\.asar/.test(r.out), r.out)
  fs.writeFileSync(p, before)
  t('T5 还原后重新可复用', run(['verify', '--key', k1, ...base]).code === 0)
}
{
  const p = path.join(R, 'output', 'ui', 'index.html')
  const before = fs.readFileSync(p)
  fs.rmSync(p)
  const r = run(['verify', '--key', k1, ...base])
  t('T6 产物缺文件 → rc 1 且点名缺哪个', r.code === 1 && /缺文件：ui\/index\.html/.test(r.out), r.out)
  fs.writeFileSync(p, before)
}
{
  const extra = write('output/stray.txt', '不属于这次构建的文件\n')
  const r = run(['verify', '--key', k1, ...base])
  t('T7 产物多出文件 → rc 1 且点名多出来的', r.code === 1 && /多出来的文件：stray\.txt/.test(r.out), r.out)
  fs.rmSync(extra)
  t('T7 删掉后重新可复用', run(['verify', '--key', k1, ...base]).code === 0)
}

// --- T8 指纹不匹配时要说清「哪一组输入变了」 -----------------------------------------
{
  const p = path.join(R, 'dict.json')
  const before = fs.readFileSync(p)
  fs.writeFileSync(p, before.toString().replace('你好', '您好'))
  const k2 = keyNow()
  const r = run(['verify', '--key', k2, ...base])
  t('T8 输入变了 → rc 1 并点名「词典 dict.json」这一组', r.code === 1 && /变了：词典 dict\.json/.test(r.out), r.out)
  t('T8 诊断里不会把没变的组也说成变了', !/变了：补丁/.test(r.out) && !/变了：工具/.test(r.out), r.out)
  fs.writeFileSync(p, before)
}

// --- T9 用法与环境 ------------------------------------------------------------------
t('T9 原版 asar 不存在 → rc 2（不能拿不存在的输入算指纹）', (() => {
  const r = run(['key', '--root', R, '--asar', path.join(R, 'nope.asar'), '--ui', UI])
  return r.code === 2 && /不存在/.test(r.out)
})())
t('T9 verify 缺 --key → rc 2', run(['verify', '--root', R]).code === 2)
t('T9 未知参数 → rc 2', run(['key', '--wat']).code === 2)
t('T9 -h 给出用法（三个子命令各一行）且 rc 0', (() => {
  const r = run(['-h'])
  return r.code === 0 && /build_key\.js key/.test(r.out) && /build_key\.js verify/.test(r.out) && /build_key\.js record/.test(r.out)
})())
t('T9 缓存读不出来（损坏的 JSON）→ 按「没有构建记录」处理', (() => {
  const c = path.join(R, 'work', 'build-cache.json')
  const before = fs.readFileSync(c, 'utf8')
  fs.writeFileSync(c, '{ 这不是 JSON')
  const r = run(['verify', '--key', k1, ...base])
  fs.writeFileSync(c, before)
  return r.code === 1 && /没有构建记录/.test(r.out)
})())

// --- T10b 调用方忘了给原版输入：必须 rc 1（宁重建，不可冒充可复用）并说清为什么 -----
// （这个坑真咬过一次：build.sh 的 verify 少传 --asar/--ui，指纹缺两组、永远对不上，
//   而诊断一句“变了”都说不出来——看着像工具坏了；现在要求它把「这次没提供」点出来）
t(
  'T10b verify 没给 --asar/--ui → rc 1 且点明「这次没提供」',
  (() => {
    run(['record', '--key', k1, ...base]) // 先确保有记录
    const r = run(['verify', '--key', k1, '--root', R, '--out', path.join(R, 'output'), '--cache', path.join(R, 'work', 'build-cache.json')])
    return r.code === 1 && /这次没提供：原版 app\.asar/.test(r.out) && /这次没提供：原版 ui\//.test(r.out)
  })(),
)

// --- T10 真仓库布局也能算（tools/ 66 个脚本 + patches/ 13 个补丁）--------------------
{
  const r = run(['key', '--root', REPO, '--asar', ASAR, '--ui', UI])
  const k = r.out.trim()
  const nTools = fs.readdirSync(path.join(REPO, 'tools')).length
  t(`T10 真仓库布局（tools/ ${nTools} 个文件）算得出指纹且稳定`, r.code === 0 && /^[0-9a-f]{64}$/.test(k) && run(['key', '--root', REPO, '--asar', ASAR, '--ui', UI]).out.trim() === k, r.out)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
fs.rmSync(WORK, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
