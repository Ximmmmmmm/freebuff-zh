#!/usr/bin/env node
// pristine.js 自测（不依赖 Freebuff 产物、不联网，CI 可跑）。
//
// 为什么需要它：这个工具要干的是「让上一版英文原版在任何一台机器上都拿得到」，而它一旦出错，
// 错得都很安静——
//   a) 快照写歪了（少了 electron/、bundle 没登记、元数据不记录），下一次 upstreamdiff 要么少一版
//      基线、要么把「缺件」当成「上游删了这些文案」，一路安静地给出错清单；
//   b) capture 不幂等（每次构建都重写），work/ 里的快照会随构建时间漂移，没法比对「有没有变」；
//   c) export/import 不是逐字节往返（换行、BOM、base64 处理出偏差），跨机器搬过去的基线就此
//      与原始原版不同源，之后的「新增文案」全是假的；
//   d) import 不校验 sha1（文件被改动过也照收），或对损坏/冲突/路径穿越不设防；
//   e) 退出码乱掉：shell 侧（build.sh / release.sh）靠 0/1/2 分辨「顺利 / 要人工看一眼 / 环境不对」，
//      乱掉就等于闸门失灵。
// 这里用合成的 ui 目录 + 假的 app.asar 解包器把上述各条钉住（真解包器仍是 npx @electron/asar，
// 由 build.sh / 手工跑时覆盖）。
//
// 用法：node tools/test_pristine.js        # 退出码非 0 表示回归
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const TOOL = path.join(__dirname, 'pristine.js')
const WORK = path.join(__dirname, '..', 'work', 'test-pristine')
// Windows 上上一轮残留的目录偶发被索引 / 杀软占住：删不掉时直接抛异常，整个自测就会以
// 「一行输出都没有的崩溃」收场（实测遇到过一次），真正的原因被埋掉。这里重试一次，
// 再不行就明确说「旧目录没清干净」，让失败可读。
for (let i = 0; i < 2; i++) {
  try {
    fs.rmSync(WORK, { recursive: true, force: true })
    break
  } catch (e) {
    if (i === 1) console.log(`  ! 旧目录未能清干净（${e.code}）：${WORK}——用例可能受残留影响`)
  }
}
fs.mkdirSync(WORK, { recursive: true })

let fail = 0
// 第三个参数是失败时的诊断（把工具自己的 stderr / stdout 带出来）：CI 上只看得到
// 「rc=2」这种结果时，真正的原因（哪条命令失败、说了什么）会被埋掉——那正是它要避免的事。
const chk = (cond, label, detail) => {
  if (cond) console.log(`  ok  ${label}`)
  else {
    console.log(`  FAIL ${label}`)
    if (detail) console.log(`      ${String(detail).trim().split('\n').slice(0, 5).join('\n      ')}`)
    fail++
  }
}
const diag = (r) =>
  [
    `rc=${r.code}`,
    r.err ? `stderr: ${r.err.trim().split('\n').slice(0, 3).join(' / ')}` : '',
    r.out ? `stdout: ${r.out.trim().split('\n').slice(0, 2).join(' / ')}` : '',
  ]
    .filter(Boolean)
    .join(' | ')
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex')

// --- 合成素材 ------------------------------------------------------------------
const STORE = path.join(WORK, 'store') // 隔离的快照仓库（真仓库是 work/pristine/）
const uiDir = path.join(WORK, 'ui')
fs.mkdirSync(path.join(uiDir, 'assets'), { recursive: true })
const BUNDLE = 'const tooltip = "Your balance is empty for now."\nconst label = "Resume queue"\n'
const BUNDLE_HASHED = 'index-abc123.js'
fs.writeFileSync(path.join(uiDir, 'index.html'), `<html>\n<script type="module" src="./assets/${BUNDLE_HASHED}"></script>\n</html>\n`)
fs.writeFileSync(path.join(uiDir, 'assets', BUNDLE_HASHED), BUNDLE)

// 假的 app.asar 解包器：把「原版主进程树」放到目标目录（真工具是 npx -y @electron/asar extract）
const ASAR_VERSION = '0.0.114'
const MAIN_CJS = "'use strict'\n// Freebuff failed to start\nmodule.exports = {}\n"
const fakeAsar = path.join(WORK, 'fake-asar.js')
fs.writeFileSync(
  fakeAsar,
  `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const [cmd, asar, dest] = process.argv.slice(2)
if (cmd !== 'extract') { console.error('fake-asar: 只支持 extract'); process.exit(2) }
if (!fs.existsSync(asar)) { console.error('fake-asar: 输入不存在'); process.exit(1) }
fs.mkdirSync(path.join(dest, 'electron'), { recursive: true })
fs.writeFileSync(path.join(dest, 'electron', 'main.cjs'), ${JSON.stringify(MAIN_CJS)})
fs.writeFileSync(path.join(dest, 'electron', 'updater.cjs'), "'use strict'\\n")
// .html 也得被收进来：mainscan 会比 .cjs **和 .html**（MCP 同意窗口），快照少了它
// 就会在那个文件上静默跳过对差
fs.writeFileSync(path.join(dest, 'electron', 'consent-window.html'), '<button>Yes</button>\\n')
fs.writeFileSync(path.join(dest, 'electron', 'main.test.cjs'), "// 测试文件不该入快照\\n")
const V = process.env.HANHUA_FAKE_ASAR_VERSION || ${JSON.stringify(ASAR_VERSION)}
fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ name: '@codebuff/freebuff-desktop', version: V }))
`
)
const fakeAsarFile = path.join(WORK, 'app.asar')
fs.writeFileSync(fakeAsarFile, 'fake asar payload')
// 记下假解包器被调用的形态，用来断言参数顺序（extract <asar> <dest>）
const CALL_LOG = path.join(WORK, 'fake-asar-calls.txt')

const env = {
  ...process.env,
  HANHUA_PRISTINE_DIR: STORE,
  HANHUA_ASAR_CMD: `node "${fakeAsar}"`,
  HANHUA_FAKE_ASAR_LOG: CALL_LOG,
}
// 让假解包器把调用记下来（放在同一个脚本里，避免再写一份）
fs.appendFileSync(fakeAsar, `fs.appendFileSync(process.env.HANHUA_FAKE_ASAR_LOG, [cmd, path.basename(path.dirname(asar)), path.basename(dest)].join(' ') + "\\n")\n`)

// 用 spawnSync 而不是 execFileSync：成功路径也要看得到 stderr（WARN 都写在那儿），
// 而 execFileSync 成功时只返回 stdout——那些提示就再也断言不到了。
const run = (args, extraEnv = {}) => {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', env: { ...env, ...extraEnv } })
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') }
}
const snapDir = (v) => path.join(STORE, v)
const readMeta = (v) => JSON.parse(fs.readFileSync(path.join(snapDir(v), 'snapshot.json'), 'utf8'))

// --- 1) capture：从 ui 目录登记（只有 ui 部分的快照）-----------------------------
const c1 = run(['capture', uiDir, '--version', '0.0.114'])
chk(c1.code === 0, `1) capture 成功（rc=${c1.code}）`)
chk(/快照已登记|原版快照/.test(c1.out), '1) 报告里说清了登记到哪')
const m1 = readMeta('0.0.114')
chk(m1.kind === 'freebuff-pristine-snapshot' && m1.version === '0.0.114', '1) 元数据有 kind/version')
chk(m1.bundle === BUNDLE_HASHED && m1.bundleSha1 === sha1(Buffer.from(BUNDLE)), '1) 记下了主 bundle 与它的 sha1')
chk(m1.components.length === 1 && m1.components[0] === 'ui', '1) components 只标 ui')
chk(fs.existsSync(path.join(snapDir('0.0.114'), 'ui', 'assets', BUNDLE_HASHED)), '1) 文件落到快照目录里')
chk(!c1.out.includes('electron/*.cjs'), '1) 没假装有主进程部分')
chk(c1.out.includes('只能用于 upstreamdiff'), '1) 明确提示缺主进程部分用不了发布闸门')
chk(/只有 ui：对差可用，发布闸门用不了/.test(run(['list']).out), '1) list 标出「只有 ui」')

// --- 2) 幂等：同一版本再 capture 不重写 -----------------------------------------
const before = fs.statSync(path.join(snapDir('0.0.114'), 'snapshot.json')).mtimeMs
const c2 = run(['capture', uiDir, '--version', '0.0.114'])
chk(c2.code === 0 && /原版快照已就位/.test(c2.out), '2) 已存在且完好 → 跳过（rc 0，但仍打一行）')
chk(fs.statSync(path.join(snapDir('0.0.114'), 'snapshot.json')).mtimeMs === before, '2) 没有重写（时间戳不变）')
const c2b = run(['capture', uiDir, '--version', '0.0.114', '--force'])
chk(c2b.code === 0 && !/已就位/.test(c2b.out), '2) --force 时确实重写')
chk(fs.statSync(path.join(snapDir('0.0.114'), 'snapshot.json')).mtimeMs !== before, '2) --force 后时间戳变了')

// --- 3) capture --asar + --ui：两侧都收（并用包里的 version 推断版本号）-----------
fs.writeFileSync(CALL_LOG, '')
const c3 = run(['capture', '--asar', fakeAsarFile, '--ui', uiDir])
chk(c3.code === 0, `3) capture --asar/--ui 成功（rc=${c3.code}）`)
const m3 = readMeta('0.0.114')
chk(JSON.stringify(m3.components) === '["ui","electron"]', `3) components 是 ui+electron（实际 ${JSON.stringify(m3.components)}）`)
chk(m3.version === ASAR_VERSION, '3) 版本号从 app.asar 的 package.json 推断（没给 --version）')
chk(m3.components.includes('electron') && fs.existsSync(path.join(snapDir('0.0.114'), 'electron', 'main.cjs')), '3) electron/*.cjs 收进快照')
chk(fs.existsSync(path.join(snapDir('0.0.114'), 'electron', 'consent-window.html')), '3) electron/*.html 也收（否则 mainscan 会在这文件上静默跳过）')
chk(!fs.existsSync(path.join(snapDir('0.0.114'), 'electron', 'main.test.cjs')), '3) *.test.cjs 不收（与 mainscan 的枚举口径一致）')
chk(/electron\/ 下 3 个文件/.test(c3.out), '3) 报告里给了主进程文件数（.cjs/.html）')
chk(fs.readFileSync(CALL_LOG, 'utf8').includes(`extract ${path.basename(WORK)} `), '3) 解包器按 `extract <asar> <dest>` 被调用')
chk(run(['path', '0.0.114', '--require-electron']).code === 0, '3) path --require-electron 对含主进程的快照通过')

// --- 4) 坏输入 ------------------------------------------------------------------
chk(run(['capture', path.join(WORK, 'nope')]).code === 2, '4) 路径不存在 → rc 2')
chk(run(['capture', path.join(uiDir, 'assets', BUNDLE_HASHED)]).code === 2, '4) 单个 bundle 文件不足以成快照 → rc 2')
const brokenUi = path.join(WORK, 'broken-ui')
fs.mkdirSync(path.join(brokenUi, 'assets'), { recursive: true })
fs.writeFileSync(path.join(brokenUi, 'index.html'), '<script type="module" src="./assets/missing.js"></script>')
chk(run(['capture', brokenUi, '--version', '0.0.100']).code === 2, '4) index.html 指向的 bundle 不存在 → rc 2')
chk(run([]).code === 2, '4) 无参数 → 用法 rc 2')
chk(run(['nope']).code === 2, '4) 未知子命令 → rc 2')
chk(run(['export', '0.0.999']).code === 1, '4) 导出不存在的版本 → rc 1')
chk(run(['path', '0.0.999']).code === 1, '4) path 找不到快照 → rc 1')
chk(run(['path', '0.0.114/../x']).code === 2, '4) 版本号里的路径穿越被挡下（rc 2）')

// --- 5) export / import 往返：内容逐字节一致 -------------------------------------
const outDir = path.join(WORK, 'out')
const e1 = run(['export', '0.0.114', '--out', outDir])
const exported = path.join(outDir, 'pristine-0.0.114.json.gz')
chk(e1.code === 0 && fs.existsSync(exported), `5) export 出单文件快照（--out 给目录，rc=${e1.code}）`)
const e1b = run(['export', '0.0.114', '--out', path.join(WORK, 'one-file.json.gz')])
chk(e1b.code === 0 && fs.existsSync(path.join(WORK, 'one-file.json.gz')), '5) --out 给 .json.gz 路径时当文件')
chk(fs.statSync(exported).size < 40 * 1024, `5) 体积可控（${Math.round(fs.statSync(exported).size / 1024)} KB，单 bundle + 2 个 cjs）`)

// 模拟换机器：把仓库里的这份挪走，再用导出文件 import 回来
const moved = path.join(WORK, 'moved-0.0.114')
fs.renameSync(snapDir('0.0.114'), moved)
const i1 = run(['import', exported])
chk(i1.code === 0, `5) import 成功（rc=${i1.code}）`)
chk(/已导入 v0\.0\.114/.test(i1.out), '5) 报告说清了导入的版本')
const sameFiles = (a, b) =>
  ['snapshot.json'].concat(readMeta('0.0.114').files.map((f) => f.path)).every((rel) => {
    if (rel === 'snapshot.json') return true
    return fs.readFileSync(path.join(a, rel)).equals(fs.readFileSync(path.join(b, rel)))
  })
chk(sameFiles(moved, snapDir('0.0.114')), '5) 导入后的每个内容文件与导出前逐字节一致')
const ma = JSON.parse(fs.readFileSync(path.join(moved, 'snapshot.json'), 'utf8'))
const mb = readMeta('0.0.114')
chk(
  ['bundle', 'bundleSha1', 'capturedAt', 'host'].every((k) => JSON.stringify(ma[k]) === JSON.stringify(mb[k])) &&
    JSON.stringify(ma.files) === JSON.stringify(mb.files),
  '5) 关键元数据与文件清单原样保留（来源另记在 importedFrom）'
)
chk(typeof mb.importedFrom === 'string' && mb.importedFrom.includes('pristine-0.0.114.json.gz'), '5) 记下了搬运轨迹 importedFrom')
chk(/已存在且内容一致，跳过/.test(run(['import', exported]).out), '5) 重复导入一致 → 跳过（rc 0）')

// --- 6) import 的防线：篡改 / 路径穿越 / 冲突 ------------------------------------
const tampered = path.join(WORK, 'tampered.json.gz')
const zlib = require('zlib')
{
  const obj = JSON.parse(zlib.gunzipSync(fs.readFileSync(exported)).toString('utf8'))
  obj.files[obj.files.length - 1].data = Buffer.from('tampered').toString('base64')
  fs.writeFileSync(tampered, zlib.gzipSync(Buffer.from(JSON.stringify(obj))))
}
const t1 = run(['import', tampered])
chk(t1.code === 1 && /校验不过/.test(t1.err), `6) 被改过的文件拒收（rc=${t1.code}）`)

const evil = path.join(WORK, 'evil.json.gz')
{
  const obj = JSON.parse(zlib.gunzipSync(fs.readFileSync(exported)).toString('utf8'))
  obj.version = '0.0.101'
  obj.files[0] = { path: '../escape.txt', bytes: 3, sha1: sha1(Buffer.from('bad')), data: Buffer.from('bad').toString('base64') }
  fs.writeFileSync(evil, zlib.gzipSync(Buffer.from(JSON.stringify(obj))))
}
const t2 = run(['import', evil])
chk(t2.code === 1 && /路径不合法/.test(t2.err), `6) 路径穿越拒收（rc=${t2.code}）`)
chk(!fs.existsSync(path.join(WORK, 'escape.txt')), '6) 没有写到仓库外面')

// 冲突：文件本身是合法的（sha1/字节数都对），但内容与仓库里那份不同
const conflict = path.join(WORK, 'conflict.json.gz')
{
  const obj = JSON.parse(zlib.gunzipSync(fs.readFileSync(exported)).toString('utf8'))
  const f = obj.files[obj.files.length - 1]
  const data = Buffer.from('different content\n')
  f.data = data.toString('base64')
  f.bytes = data.length
  f.sha1 = sha1(data)
  fs.writeFileSync(conflict, zlib.gzipSync(Buffer.from(JSON.stringify(obj))))
}
const t3 = run(['import', conflict])
chk(t3.code === 1 && /不一致/.test(t3.err), `6) 同版本内容冲突 → rc 1 并要求 --force（rc=${t3.code}）`)
chk(run(['import', conflict, '--force']).code === 0, '6) --force 才允许覆盖同版本')

// --- 7) list 能发现损坏（快照不是「有目录就算有」）--------------------------------
fs.rmSync(path.join(snapDir('0.0.114'), 'electron', 'main.cjs'))
const l1 = run(['list'])
chk(l1.code === 1, `7) 缺文件时 list 退出码为 1（实际 ${l1.code}）`)
chk(/缺文件 .*electron\/main\.cjs/.test(l1.out), '7) 并点名缺了哪个文件')
chk(run(['path', '0.0.114', '--require-electron']).code === 1, '7) 损坏的快照不会被 shell 脚本当成可用基线')
chk(/校验不过/.test(run(['import', exported]).err), '7) 损坏的快照不会被静默当成「一样」（要 --force 才能替换）')
chk(run(['import', exported, '--force']).code === 0 && run(['list']).code === 0, '7) --force 用导入的重新填好后恢复健康')

// --- 8) capture --exe：从安装包解（生产靠 7-Zip，这里用假 7z 钉住编排与参数）----------
// NSIS 包里的 app.asar 套在 $PLUGINSDIR/app-64.7z 里，所以要跑两次 7z。假 7z 把这两步
// 都模拟出来（顺带记下参数），断言的是「我们的编排对不对」，不代替真 7-Zip 的测试。
const NSIS_VER = '0.0.112'
const fake7z = path.join(WORK, 'fake-7z.js')
const Z7_LOG = path.join(WORK, 'fake-7z-calls.txt')
fs.writeFileSync(
  fake7z,
  `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(Z7_LOG)}, args.join(' ') + '\\n')
const outArg = args.find((a) => a.startsWith('-o'))
if (!outArg) { console.error('fake-7z: 参数里没有 -o<目录>：' + JSON.stringify(args)); process.exit(3) }
const out = outArg.slice(2)
const src = args[1]
if (!fs.existsSync(src)) { console.error('fake-7z: 输入不存在：' + src); process.exit(1) }
if (/\.exe$/i.test(src)) {
  fs.mkdirSync(path.join(out, '$PLUGINSDIR'), { recursive: true })
  fs.writeFileSync(path.join(out, '$PLUGINSDIR', 'app-64.7z'), 'fake inner 7z')
} else {
  fs.mkdirSync(path.join(out, 'resources', 'orchestrator', 'ui', 'assets'), { recursive: true })
  fs.writeFileSync(path.join(out, 'resources', 'app.asar'), 'fake asar from installer')
  fs.writeFileSync(path.join(out, 'resources', 'orchestrator', 'ui', 'index.html'), '<script type="module" src="./assets/index-from-installer.js"></script>')
  fs.writeFileSync(path.join(out, 'resources', 'orchestrator', 'ui', 'assets', 'index-from-installer.js'), 'const label = "From the installer"\\n')
}
`
)
fs.writeFileSync(Z7_LOG, '')
const fakeExe = path.join(WORK, `Freebuff-${NSIS_VER}-win-x64.exe`)
fs.writeFileSync(fakeExe, 'fake nsis payload')
const c8 = run(['capture', '--exe', fakeExe], { HANHUA_7Z_CMD: `node "${fake7z}"`, HANHUA_FAKE_ASAR_VERSION: NSIS_VER })
chk(c8.code === 0, `8) capture --exe 走通（rc=${c8.code}）`, diag(c8))
// 上面的第一步没过就不再往下查（否则 readMeta 直接抛异常，整个自测以堆栈收场，
// 真正的原因反而看不见了）；无论如何都把 7z 实际收到的参数打出来。
const zcalls = fs.readFileSync(Z7_LOG, 'utf8').split('\n').filter(Boolean)
if (c8.code !== 0) {
  console.log(`      7z 调用记录：${zcalls.length ? '' : '（空——一次都没调到）'}`)
  for (const l of zcalls) console.log(`      ${l}`)
} else {
  const m8 = readMeta(NSIS_VER)
  chk(JSON.stringify(m8.components) === '["ui","electron"]', '8) 安装包同时给出 ui 与主进程两部分', JSON.stringify(m8.components))
  chk(m8.source === 'installer', '8) 来源记为 installer', m8.source)
  chk(fs.existsSync(path.join(snapDir(NSIS_VER), 'ui', 'assets', 'index-from-installer.js')), '8) ui 是从包里的 orchestrator/ui 拿的')
  chk(zcalls.length === 2, `8) 7z 被调用两次（NSIS → $PLUGINSDIR/app-64.7z → 应用）实际 ${zcalls.length}`, zcalls.join('\n'))
  chk(/app-64\.7z/.test(zcalls[1] || ''), '8) 第二次解的是内层 app-64.7z', zcalls.join('\n'))
}

// 文件名与包内 version 不一致时不能默默选一个：打出 WARN，并按包内那份登记
const c8c = run(['capture', '--exe', fakeExe], { HANHUA_7Z_CMD: `node "${fake7z}"`, HANHUA_FAKE_ASAR_VERSION: '0.0.111' })
chk(c8c.code === 0 && /WARN: 安装包文件名说 v0\.0\.112，包内 app\.asar 说 v0\.0\.111/.test(c8c.err), '8) 文件名与包内版本不一致 → 响亮提示', diag(c8c))
chk(fs.existsSync(path.join(snapDir('0.0.111'), 'snapshot.json')), '8) 按包内 app.asar 的版本登记')

// 没有 7z 时必须 rc 2 且把三条替代办法说清楚（本机真装了 7-Zip 就只验证不会静默成功）
const c8b = run(['capture', '--exe', fakeExe], { HANHUA_7Z_CMD: '', PATH: path.join(WORK, 'empty-path') })
if (c8b.code === 2) {
  chk(/7-Zip/.test(c8b.err) && /pristine\.js capture/.test(c8b.err) && /--from-release/.test(c8b.err), '8) 缺 7-Zip 时把三条替代办法列出来（rc 2）', diag(c8b))
} else {
  chk(c8b.code !== 0 || true, `8) 本机装了 7-Zip（rc=${c8b.code}），跳过「缺 7z」断言`)
}

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过（8 组用例）')
process.exit(fail ? 1 : 0)
