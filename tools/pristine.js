#!/usr/bin/env node
// 英文原版快照仓库（pristine）——把「上一版英文原版」变成一件可跨机器搬运的东西。
//
// 为什么需要它：tools/upstreamdiff.js 要「上一版英文原版 vs 本版英文原版」才能列出本版上游新增的
// 文案，但**上一版的原版在本机是会被抹掉的**：
//   · 装机目录的英文原版被自动更新覆盖（0.0.114 那次连 hanhua-backup-* 一起清了）；
//   · Freebuff 的更新下载缓存（`%LOCALAPPDATA%/@codebufffreebuff-desktop-updater/`）里没有安装包
//     ——electron-updater 装完即删，只剩一个 current.blockmap；
//   · 临时目录里只会有**本版**的安装包（`%TEMP%/Freebuff-<版本>-win-x64.exe`）。
// `build.sh` 每跑一次就把本版英文原版归档下来，但那份归档只活在本机的 `work/` 里：换机器、
// 清空 work/、或者让另一台机器发布，基线就没了（正是本工具要治的「静默降级」）。
//
// 三条搬运路径：
//   1. 本机挖掘（capture）：hanhua-backup-* 备份、装机当前的英文原版、已解包目录，以及更新缓存 /
//      临时目录里的 NSIS 安装包（需要 7-Zip，见下）；
//   2. 显式搬运（export / import）：单文件 `.json.gz`（Node 内置 zlib，无外部依赖、逐字节可校验），
//      拷到任意机器 `import` 回来即可用；
//   3. 走我们自己的 Release（publish / import --from-release）：release.sh 发布时会把本版快照
//      作为资产附上，任何机器一条命令取回，不必手工传文件。
//
// 快照里装的是什么：`ui/index.html` + 主 bundle + `electron/` 下的 .cjs/.html（与 mainscan 的枚举口径
// 一致，含 consent-window.html）——正好是 upstreamdiff / mainscan 这两支对差工具需要的全部。
// **它不是可构建的完整原版**：不含 app.asar 里的
// node_modules / src，要构建仍然得装一次 Freebuff（或拿安装包解出的 app.asar）。
// `list` 会把只有 ui 部分的快照标出来：那种能用于 upstreamdiff，不能用于 mainscan / 发布闸门。
//
// 关于安装包：Windows 的安装包是 NSIS 自解压包，app.asar 套在 `app-64.7z` 里，解它需要 7-Zip
// （依次找 `--7z` / PATH 上的 7z/7za/7zz / Windows 常见安装路径）。没有 7-Zip 时用图形界面手工
// 解包后 `capture <解包目录>`，或干脆走 import / --from-release。官方发布源上的旧版安装包
// **永久可下载**（GitHub Release，见 `list --remote`），所以「上一版从哪来」永远有答案。
//
// 用法：
//   node tools/pristine.js list [--remote] [--versions a,b,c]   # 仓库里有什么 / 本机能挖到什么
//        --remote 顺便探官方发布源上有哪些版本的安装包（HEAD，不计 API 配额）
//   node tools/pristine.js capture [<路径>] [选项]           # 把一份英文原版登记成快照
//        （不给路径 = --install：hanhua-backup-* → 装机英文原版）
//        <路径>            已解包目录（resources / 备份目录 / 解包后的 asar 树 / ui 目录）、app.asar、安装包 .exe
//        --asar <app.asar> --ui <ui 目录>      显式给两侧
//        --main-src <目录> 只给已解包的主进程树（含 electron/ 与 package.json）
//        --exe <安装包>    从 NSIS 安装包解（需要 7-Zip；--7z <路径> 指定）
//        --version <x.y.z> 推断不出来时显式给；给了它就能走「已归档就直接跳过」的构建快路径
//        --force 已存在也重写   --quiet 只打一行
//   node tools/pristine.js export <版本|--all> [--out <文件|目录>]   # 单文件快照（.json.gz）
//   node tools/pristine.js import <文件|目录>
//   node tools/pristine.js import --from-release <版本|latest> [--repo R]
//   node tools/pristine.js publish [<版本>] [--repo R] [--tag pack-vX]   # 附到我们自己的 Release
//   node tools/pristine.js path <版本> [--require-electron]              # 打印快照目录（给 shell 脚本用）
// 退出码：0 正常（含「已存在且一致，跳过」）；1 需要人工处理（快照损坏 / 版本冲突）；
//         2 用法、依赖或来源不可用。
// 自测：node tools/test_pristine.js（CI 会跑）。
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const zlib = require('zlib')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
// 快照仓库位置。正常用不到环境变量：它只是自测的隔离出口（CI 不能往仓库真实的 work/pristine/ 里写）。
const SNAP_ROOT = process.env.HANHUA_PRISTINE_DIR ? path.resolve(process.env.HANHUA_PRISTINE_DIR) : path.join(ROOT, 'work', 'pristine')
const LEGACY_ROOT = path.join(ROOT, 'work', 'upstream')
const DIST = path.join(ROOT, 'dist')
const MANIFEST = path.join(ROOT, 'manifest.json')
const KIND = 'freebuff-pristine-snapshot'
const SCHEMA = 2
const PACK_REPO = 'Ximmmmmmm/freebuff-zh'
const UPSTREAM_REPO = 'CodebuffAI/codebuff-community'
// 解包 app.asar 的命令模板（测试注入假解包器用；生产就是 npx）。后面会拼 ` extract <asar> <dest>`。
const ASAR_CMD = process.env.HANHUA_ASAR_CMD || 'npx -y @electron/asar'
// 7-Zip 的命令（测试注入假 7z 用）。设了它就跳过「本机找 7z」那一步。
const SEVEN_ZIP_CMD = process.env.HANHUA_7Z_CMD || null

// 用法/依赖类问题：调用方按 rc 2 处理（配置或环境不对，不是数据坏了）
class UsageError extends Error {}
// 数据类问题：rc 1（快照损坏、版本冲突——需要人来决定怎么办）
class DataError extends Error {}

// --- 小工具 ---------------------------------------------------------------------

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex')
const human = (n) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
const mkdirp = (d) => fs.mkdirSync(d, { recursive: true })
const rmrf = (d) => {
  try {
    fs.rmSync(d, { recursive: true, force: true })
  } catch {
    /* Windows 上偶发被占用：清理失败不该决定结论，调用方按需提示 */
  }
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
const writeJson = (f, obj) => {
  mkdirp(path.dirname(f))
  fs.writeFileSync(f, JSON.stringify(obj, null, 2) + '\n')
}
// 走到 shell 的参数一律加引号——但**引号形式必须按平台来**：POSIX sh 的双引号里 `$` 与反引号
// 仍会展开，而 NSIS 安装包解出来的目录名恰好就叫 `$PLUGINSDIR`，用双引号包它就会被展开成空
// 路径（Linux 上 capture --exe 必挂，Windows 的 cmd.exe 却完全正常，所以本地跑不出来）；
// 而 cmd.exe 又不认单引号。于是：Windows 用双引号（剔掉内部引号），POSIX 用单引号（内部
// 单引号按 '\'' 转义）。platform 参数只为自测能同时验证两条分支。
function quoteArg(s, platform = process.platform) {
  const str = String(s)
  if (platform === 'win32') return `"${str.replace(/"/g, '')}"`
  return `'${str.replace(/'/g, `'\\''`)}'`
}
const q = (s) => quoteArg(s)

function run(cmd, { allowFail = false } = {}) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0 && !allowFail) {
    throw new UsageError(`命令失败（rc=${r.status}）：${cmd}\n${(r.stderr || r.stdout || '').trim().split('\n').slice(-5).join('\n')}`)
  }
  return r
}

// 版本号：只认 x.y.z(.w)，顺便挡住 `../` 这类往仓库外写的东西
function checkVersion(v) {
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(String(v || ''))) throw new UsageError(`版本号不合法：${v}（期望 x.y.z）`)
  return String(v)
}

// --- 快照仓储 work/pristine/<版本>/ ----------------------------------------------

const snapDir = (v) => path.join(SNAP_ROOT, v)

function readMeta(version) {
  const f = path.join(snapDir(version), 'snapshot.json')
  if (!fs.existsSync(f)) return null
  let meta
  try {
    meta = readJson(f)
  } catch (e) {
    throw new DataError(`快照元数据读不出来：${f}（${e.message}）`)
  }
  if (meta.kind !== KIND) throw new DataError(`${f} 不是本工具写的快照（kind=${meta.kind}）`)
  return meta
}

// 完整性：文件在不在、字节数与 sha1 对不对。别只信 snapshot.json——work/ 里的东西会被手工删、
// 会跨机器拷，这正是「快照看起来有、其实是坏的」最容易发生的地方。
function verifySnapshot(version) {
  let meta
  try {
    meta = readMeta(version)
  } catch (e) {
    return { ok: false, reason: 'bad-meta', error: e.message, meta: null, dir: snapDir(version) }
  }
  if (!meta) return { ok: false, reason: 'missing', meta: null, dir: snapDir(version) }
  const missing = []
  const mismatch = []
  for (const f of meta.files || []) {
    const p = path.join(snapDir(version), f.path)
    if (!fs.existsSync(p)) missing.push(f.path)
    else {
      const buf = fs.readFileSync(p)
      if (buf.length !== f.bytes || sha1(buf) !== f.sha1) mismatch.push(f.path)
    }
  }
  const ok = !missing.length && !mismatch.length
  return { ok, reason: ok ? '' : missing.length ? 'missing-files' : 'mismatch', meta, missing, mismatch, dir: snapDir(version) }
}

function listVersions() {
  if (!fs.existsSync(SNAP_ROOT)) return []
  return fs
    .readdirSync(SNAP_ROOT)
    .filter((n) => fs.existsSync(path.join(SNAP_ROOT, n, 'snapshot.json')))
    .sort((a, b) => cmpVersion(b, a))
}

function cmpVersion(a, b) {
  const A = String(a).split('.').map(Number)
  const B = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const d = (A[i] || 0) - (B[i] || 0)
    if (d) return d
  }
  return 0
}

// 从 ui 目录的 index.html 找主 bundle（与 build.sh / upstreamdiff 同一套口径）
function bundleRelFromIndex(uiDir) {
  const idx = path.join(uiDir, 'index.html')
  if (!fs.existsSync(idx)) return null
  const m = /src="\.\/(assets\/[^"]+\.js)"/.exec(fs.readFileSync(idx, 'utf8'))
  if (!m) return null
  return fs.existsSync(path.join(uiDir, m[1])) ? m[1] : null
}

function hasIndexHtml(dir) {
  return !!dir && fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, 'assets'))
}

// 把一份原版写成快照（先写 .tmp 再整体改名，中途失败不会留下半份）
function writeSnapshot({ version, source, sourceLabel, uiDir, mainDir, force, quiet }) {
  checkVersion(version)
  const cur = verifySnapshot(version)
  const wantElectron = !!mainDir
  const curHasElectron = !!(cur.meta && (cur.meta.components || []).includes('electron'))
  if (cur.ok && !force && (!wantElectron || curHasElectron)) {
    // 一行也要打（--quiet 只是「简短」）：构建日志里必须看得见「本版原版已经登记好了」，
    // 否则基线是不是真的存下来了只能靠翻 work/ 猜——这正是这套流程要消灭的静默。
    console.log(`原版快照已就位：work/pristine/${version}（${(cur.meta.components || []).join('+')}，未重写）`)
    return 0
  }

  const staging = snapDir(version) + '.tmp'
  rmrf(staging)
  mkdirp(staging)
  const files = []
  const add = (srcFile, relPath) => {
    const buf = fs.readFileSync(srcFile)
    const dest = path.join(staging, relPath)
    mkdirp(path.dirname(dest))
    fs.writeFileSync(dest, buf)
    files.push({ path: relPath.split(path.sep).join('/'), bytes: buf.length, sha1: sha1(buf) })
  }

  let bundle = null
  if (uiDir) {
    const rel = bundleRelFromIndex(uiDir)
    if (!rel) throw new UsageError(`${uiDir} 里找不到主 bundle（index.html 引用的 assets/*.js 不存在），ui 部分没法用于对差`)
    add(path.join(uiDir, 'index.html'), path.join('ui', 'index.html'))
    add(path.join(uiDir, rel), path.join('ui', rel))
    bundle = path.basename(rel)
  }
  if (mainDir) {
    const eDir = path.join(mainDir, 'electron')
    if (!fs.existsSync(eDir)) throw new UsageError(`${mainDir} 里没有 electron/ 目录——这不是已解包的 app.asar 树`)
    // 与 mainscan 的枚举口径一致：.cjs **和 .html**（MCP 同意窗口是 consent-window.html）。
    // 只收 .cjs 会让快照缺一个文件，而 mainscan 的循环是「两边都有才比」——那个文件就被
    // 静默跳过，快照当基线的发布机上漏翻也就查不出来（正是这套流程在治的那类沉默）。
    const names = fs.readdirSync(eDir).filter((n) => /\.(cjs|html)$/.test(n) && !/\.test\./.test(n)).sort()
    if (!names.length) throw new UsageError(`${mainDir}/electron 里没有 .cjs / .html 文件`)
    for (const n of names) add(path.join(eDir, n), path.join('electron', n))
  }
  if (!files.length) throw new UsageError('没有收集到任何文件（既没有 ui 也没有主进程树）')

  const meta = {
    kind: KIND,
    schema: SCHEMA,
    version,
    bundle,
    bundleSha1: bundle ? files.find((f) => path.basename(f.path) === bundle).sha1 : null,
    capturedAt: new Date().toISOString(),
    source,
    sourceLabel,
    host: `${process.platform}-${process.arch}`,
    components: [uiDir ? 'ui' : null, mainDir ? 'electron' : null].filter(Boolean),
    files,
  }
  writeJson(path.join(staging, 'snapshot.json'), meta)
  rmrf(snapDir(version))
  fs.renameSync(staging, snapDir(version))

  const bytes = files.reduce((a, f) => a + f.bytes, 0)
  if (quiet) {
    console.log(`原版快照：work/pristine/${version}（${meta.components.join('+')}，${human(bytes)}）`)
  } else {
    console.log(`原版快照已登记：work/pristine/${version}`)
    console.log(`  来源：${sourceLabel}`)
    if (bundle) console.log(`  ui：index.html + ${bundle}（${human(files.find((f) => f.path.endsWith(bundle)).bytes)}）`)
    const mainCount = files.filter((f) => f.path.startsWith('electron/')).length
    console.log(`  主进程：${meta.components.includes('electron') ? `electron/ 下 ${mainCount} 个文件（.cjs/.html）` : '未包含（这份快照只能用于 upstreamdiff）'}`)
    if (!meta.components.includes('electron')) {
      console.log('  ! 缺主进程部分：mainscan / release.sh 的主进程闸门用不了它（要 ui+electron 得给 app.asar 或已解包树）')
    }
    console.log(`  对差：node tools/upstreamdiff.js --auto`)
    console.log(`  搬运：node tools/pristine.js export ${version} --out dist/pristine-${version}.json.gz`)
  }
  return 0
}

// --- 本机原版来源 ----------------------------------------------------------------

function which(cmd) {
  const p = run(process.platform === 'win32' ? `where ${q(cmd)}` : `which ${q(cmd)}`, { allowFail: true })
  if (p.status !== 0) return null
  return (p.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || null
}

// 装机目录：Windows 是主战场；mac / linux 的常见位置也一并列上（跨平台搬快照的人用得上）
function installDirs() {
  const home = os.homedir()
  const cands = []
  if (process.env.LOCALAPPDATA) cands.push(path.join(process.env.LOCALAPPDATA, 'Programs', '@codebufffreebuff-desktop'))
  cands.push(path.join(home, 'Applications', 'Freebuff.app', 'Contents'))
  cands.push('/Applications/Freebuff.app/Contents')
  cands.push('/opt/Freebuff')
  return cands.filter((d) => fs.existsSync(d))
}

// resources / Resources 两种大小写都认（mac 是 Resources）
function resourcesOf(dir) {
  for (const n of ['resources', 'Resources']) {
    const p = path.join(dir, n)
    if (fs.existsSync(p)) return p
  }
  return null
}

const uiOfResources = (res) => [path.join(res, 'orchestrator', 'ui'), path.join(res, 'ui')].find(hasIndexHtml) || null

// `hanhua-backup-*/` 备份：apply.sh / restore.sh 存英文原版的地方（自动更新会把它一起清掉，所以先看它）
function backupDirs() {
  const out = []
  for (const dir of installDirs()) {
    const res = resourcesOf(dir)
    if (!res) continue
    for (const n of fs.readdirSync(res)) {
      if (!n.startsWith('hanhua-backup-')) continue
      const p = path.join(res, n)
      if (fs.existsSync(path.join(p, 'app.asar'))) out.push(p)
    }
  }
  return out
}

function isLocalizedInstall() {
  for (const dir of installDirs()) {
    const res = resourcesOf(dir)
    if (!res) continue
    const ui = uiOfResources(res)
    if (ui && /<html lang="zh-CN">/.test(fs.readFileSync(path.join(ui, 'index.html'), 'utf8'))) return true
  }
  return false
}

// 更新下载缓存：electron-updater 的 pending/*.exe / installer.exe
function updaterCacheDirs() {
  const home = os.homedir()
  const roots = [process.env.LOCALAPPDATA, path.join(home, 'Library', 'Caches'), path.join(home, '.cache')].filter(Boolean)
  return roots.map((r) => path.join(r, '@codebufffreebuff-desktop-updater')).filter((d) => fs.existsSync(d))
}

// 本机所有安装包（更新缓存 + 临时目录）——「上一版安装包」的候选
function findInstallers() {
  const out = []
  const seen = new Set()
  const push = (p) => {
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return
    const key = path.resolve(p).toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(p)
  }
  for (const d of updaterCacheDirs()) {
    for (const sub of ['', 'pending']) {
      const dir = path.join(d, sub)
      if (!fs.existsSync(dir)) continue
      for (const n of fs.readdirSync(dir)) push(path.join(dir, n))
    }
  }
  const stamps = [os.tmpdir(), process.env.TEMP, process.env.TMP].filter(Boolean)
  for (const t of stamps) {
    let names = []
    try {
      names = fs.readdirSync(t)
    } catch {
      continue
    }
    for (const n of names) if (/^Freebuff.*\.(exe|zip|dmg|AppImage)$/i.test(n)) push(path.join(t, n))
  }
  return out.filter((p) => /\.(exe|zip|dmg|AppImage)$/i.test(p))
}

const versionFromName = (p) => {
  const m = /Freebuff[-_ ]?(?:Setup[-_ ]?)?(\d+\.\d+\.\d+(?:\.\d+)?)/i.exec(path.basename(p))
  return m ? m[1] : null
}

// 7z 的调用形态：环境变量给的是整条命令（测试注入假 7z），否则就是可执行文件路径
const sevenZip = (spec) => SEVEN_ZIP_CMD || q(spec)

function find7z(explicit) {
  if (SEVEN_ZIP_CMD) return SEVEN_ZIP_CMD
  const cands = []
  if (explicit) cands.push(explicit)
  for (const n of ['7z', '7za', '7zz']) {
    const p = which(n)
    if (p) cands.push(p)
  }
  if (process.env.ProgramFiles) cands.push(path.join(process.env.ProgramFiles, '7-Zip', '7z.exe'))
  if (process.env['ProgramFiles(x86)']) cands.push(path.join(process.env['ProgramFiles(x86)'], '7-Zip', '7z.exe'))
  cands.push('C:\\Program Files\\7-Zip\\7z.exe')
  return cands.find((p) => p && fs.existsSync(p)) || null
}

const NO_7Z_HELP = [
  '解 NSIS 安装包需要 7-Zip（里面的 app.asar 套在 app-64.7z 里，Node 自带 zlib 解不了 LZMA）：',
  '  · 装一个 7-Zip（如 winget install 7zip.7zip）后重跑；或用 --7z <7z.exe 路径> 指定',
  '  · 或用 7-Zip 图形界面手工解包安装包（先解出 $PLUGINSDIR/app-64.7z，再解它），',
  '    然后 node tools/pristine.js capture <解包出来的目录>',
  '  · 或完全绕开安装包：在别的机器上 export 快照后 import，',
  '    或 node tools/pristine.js import --from-release <版本>（我们自己的 Release 上就有）',
].join('\n')

// 解包 app.asar → 临时目录（主进程树 + package.json）
function extractAsar(asar, dest) {
  mkdirp(dest)
  run(`${ASAR_CMD} extract ${q(asar)} ${q(dest)}`)
  if (!fs.existsSync(path.join(dest, 'electron'))) {
    throw new UsageError(`解包结果里没有 electron/：${dest}（asar 不对？或是别的应用的 asar）`)
  }
  return dest
}

// NSIS 安装包 → 应用目录（含 resources/app.asar）→ 主进程树
function extractInstaller(exe, sevenZipBin, tmp) {
  const stage1 = path.join(tmp, 'nsis')
  run(`${sevenZip(sevenZipBin)} x ${q(exe)} -o${q(stage1)} -y`)
  const walk = (dir, re, depth = 3) => {
    if (depth < 0 || !fs.existsSync(dir)) return null
    for (const n of fs.readdirSync(dir)) {
      const p = path.join(dir, n)
      const st = fs.statSync(p)
      if (st.isDirectory()) {
        const hit = walk(p, re, depth - 1)
        if (hit) return hit
      } else if (re.test(n)) return p
    }
    return null
  }
  // electron-builder 的 NSIS 包里，应用文件打成 $PLUGINSDIR/app-64.7z；少数配置直接落 app.asar
  const inner = walk(stage1, /^app-\d+\.7z$/i) || walk(stage1, /^app\.asar$/i)
  if (!inner) throw new UsageError(`在 ${exe} 里没找到 app-64.7z / app.asar（不是 electron-builder 的 NSIS 包？）`)
  let appRoot = null
  let asar = null
  if (/\.7z$/i.test(inner)) {
    appRoot = path.join(tmp, 'app')
    run(`${sevenZip(sevenZipBin)} x ${q(inner)} -o${q(appRoot)} -y`)
    asar = walk(appRoot, /^app\.asar$/i)
  } else {
    appRoot = path.dirname(inner)
    asar = inner
  }
  if (!asar) throw new UsageError(`解出的应用目录里没有 app.asar：${appRoot}`)
  const res = path.dirname(asar)
  return { asar, uiDir: uiOfResources(res) || uiOfResources(appRoot) || null }
}

// 把「一个来源」解析成 { version?, uiDir, mainDir, source, sourceLabel }
function resolveSource({ positional, flags, tmp }) {
  const explicitUi = flags.ui
  const explicitMain = flags['main-src']
  const explicitAsar = flags.asar
  const explicitExe = flags.exe

  if ((explicitAsar || explicitUi || explicitMain) && !positional.length) {
    const mainDir = explicitMain ? extractDirAsMain(explicitMain) : explicitAsar ? extractAsar(explicitAsar, path.join(tmp, 'main')) : null
    let uiDir = explicitUi || null
    if (!uiDir && explicitAsar) uiDir = uiOfResources(path.dirname(explicitAsar)) || null
    if (!uiDir && !mainDir) throw new UsageError('--asar / --ui / --main-src 至少要能给出一侧内容')
    return { uiDir, mainDir, source: explicitAsar ? 'asar' : 'ui', sourceLabel: explicitAsar ? `app.asar ${explicitAsar}` : explicitUi }
  }

  if (explicitExe || /\.exe$/i.test(positional[0] || '')) {
    const exe = explicitExe || positional[0]
    if (!fs.existsSync(exe)) throw new UsageError(`安装包不存在：${exe}`)
    const sevenZip = find7z(flags['7z'])
    if (!sevenZip) throw new UsageError(`${NO_7Z_HELP}\n（找不到 7-Zip；也可以用 --7z <路径> 指定）`)
    const r = extractInstaller(exe, sevenZip, tmp)
    return {
      version: versionFromName(exe),
      uiDir: r.uiDir,
      mainDir: extractAsar(r.asar, path.join(tmp, 'main')),
      source: 'installer',
      sourceLabel: `安装包 ${path.basename(exe)}`,
    }
  }

  const p = positional[0]
  if (p) {
    if (!fs.existsSync(p)) throw new UsageError(`路径不存在：${p}`)
    if (/\.asar$/i.test(p)) {
      return {
        uiDir: uiOfResources(path.dirname(p)) || null,
        mainDir: extractAsar(p, path.join(tmp, 'main')),
        source: 'asar',
        sourceLabel: `app.asar ${p}`,
      }
    }
    if (/\.(json|json\.gz)$/i.test(p)) throw new UsageError(`${p} 像是导出的快照文件，请用 node tools/pristine.js import ${p}`)
    if (/\.js$/i.test(p)) {
      throw new UsageError(
        `单个 bundle 文件不足以成为快照（还要 index.html 与主进程树）。\n` +
          `  · 要给单个 bundle 对差，直接用 node tools/upstreamdiff.js <旧> <新>；\n` +
          `  · 要登记快照，给 ui 目录 / resources 目录 / app.asar。`
      )
    }
    if (!fs.statSync(p).isDirectory()) throw new UsageError(`既不认识的来源：${p}`)
    // 目录：可能是 resources / 备份目录（含 app.asar）／ui 目录／已解包的 asar 树
    const asar = [path.join(p, 'app.asar'), path.join(p, 'resources', 'app.asar'), path.join(p, 'Resources', 'app.asar')].find((x) => fs.existsSync(x))
    const uiDir =
      [path.join(p, 'ui'), path.join(p, 'orchestrator', 'ui'), path.join(p, 'resources', 'orchestrator', 'ui'), path.join(p, 'Resources', 'orchestrator', 'ui')].find(hasIndexHtml) ||
      (hasIndexHtml(p) ? p : null)
    const mainTree = fs.existsSync(path.join(p, 'electron')) && fs.existsSync(path.join(p, 'package.json')) ? p : null
    if (!asar && !uiDir && !mainTree) {
      throw new UsageError(
        `${p} 里没找到原版内容（期望 app.asar、ui/index.html 或 electron/ + package.json 之一）。\n` +
          `  若这是从安装包手工解出来的目录，目录结构应是 <解包目录>/resources/app.asar 或 <解包目录>/resources/orchestrator/ui。`
      )
    }
    return {
      uiDir,
      mainDir: mainTree || (asar ? extractAsar(asar, path.join(tmp, 'main')) : null),
      source: mainTree && !asar ? 'main-src' : 'path',
      sourceLabel: `${asar && !mainTree ? '目录（含 app.asar）' : mainTree && !asar ? '已解包的主进程树' : '目录'} ${p}`,
    }
  }

  // 默认 / --install：备份优先，其次装机目录里那份还没汉化的英文原版
  const bk = backupDirs().sort().reverse()[0]
  if (bk) {
    return {
      uiDir: hasIndexHtml(path.join(bk, 'ui')) ? path.join(bk, 'ui') : uiOfResources(path.dirname(bk)),
      mainDir: extractAsar(path.join(bk, 'app.asar'), path.join(tmp, 'main')),
      source: 'backup',
      sourceLabel: `安装备份 ${path.basename(bk)}`,
    }
  }
  for (const dir of installDirs()) {
    const res = resourcesOf(dir)
    if (!res || !fs.existsSync(path.join(res, 'app.asar'))) continue
    const ui = uiOfResources(res)
    if (ui && /<html lang="zh-CN">/.test(fs.readFileSync(path.join(ui, 'index.html'), 'utf8'))) continue
    return {
      uiDir: ui,
      mainDir: extractAsar(path.join(res, 'app.asar'), path.join(tmp, 'main')),
      source: 'install',
      sourceLabel: `装机目录 ${res}`,
    }
  }
  if (isLocalizedInstall()) {
    throw new UsageError(
      '安装目录已是汉化版且没有 hanhua-backup-* 备份，无法确定英文原版。\n' +
        '  · 先 bash restore.sh 还原英文再 capture；\n' +
        '  · 或从安装包 capture --exe <安装包>；\n' +
        '  · 或直接 import 别处导出的快照（node tools/pristine.js import --from-release <版本>）。'
    )
  }
  throw new UsageError(
    '本机找不到英文原版：没有 hanhua-backup-*、没有安装 Freebuff。\n' +
      '  · 显式给路径：node tools/pristine.js capture <resources 目录|app.asar|已解包树>\n' +
      '  · 或从安装包：node tools/pristine.js capture --exe <Freebuff-x.y.z-win-x64.exe>\n' +
      '  · 或从我们自己的 Release 取：node tools/pristine.js import --from-release <版本|latest>'
  )
}

function extractDirAsMain(dir) {
  if (!fs.existsSync(path.join(dir, 'electron'))) throw new UsageError(`${dir} 里没有 electron/（--main-src 要指向已解包的 app.asar 树）`)
  return dir
}

// 版本：显式 > 主进程树里的 package.json（内容真值）> 安装包文件名
function resolveVersion({ explicit, mainDir, exePath, uiDir }) {
  if (explicit) return checkVersion(explicit)
  let fromPkg = null
  if (mainDir) {
    const pkg = path.join(mainDir, 'package.json')
    if (fs.existsSync(pkg)) fromPkg = readJson(pkg).version || null
  }
  const fromName = exePath ? versionFromName(exePath) : null
  if (fromPkg && fromName && fromPkg !== fromName) {
    // 不一致就说出来（例如安装包被改过名 / 装错了版本）——静默选一个才是坑
    console.warn(`WARN: 安装包文件名说 v${fromName}，包内 app.asar 说 v${fromPkg}：按包内那份登记；要覆盖请用 --version`)
  }
  const v = fromPkg || fromName
  if (v) return checkVersion(v)
  const hint = uiDir ? '（ui 目录里没有版本号：bundle 名不带版本，得用 app.asar 的 package.json 或 --version）' : ''
  throw new UsageError(`推断不出 Freebuff 版本号${hint}——请用 --version x.y.z 显式给一个`)
}

// --- 子命令：list ----------------------------------------------------------------

async function cmdList(argv) {
  const remote = argv.includes('--remote')
  const vFlag = argv[argv.indexOf('--versions') + 1]
  const extra = argv.includes('--versions') && vFlag ? vFlag.split(',').map((s) => s.trim()).filter(Boolean) : []
  const versions = listVersions()
  console.log(`英文原版快照仓库 ${path.relative(ROOT, SNAP_ROOT) || SNAP_ROOT}`)
  let bad = 0
  if (!versions.length) console.log('  （空）—— 跑一次 bash build.sh 会自动登记本版，或下面的 capture / import')
  for (const v of versions) {
    const st = verifySnapshot(v)
    const m = st.meta || {}
    const bytes = (m.files || []).reduce((a, f) => a + f.bytes, 0)
    const comp = (m.components || []).join('+') || '?'
    if (st.ok) {
      const partial = comp === 'ui' ? '  (只有 ui：对差可用，发布闸门用不了)' : ''
      console.log(`  ✓ ${v}  ${comp}  ${human(bytes)}  ${m.capturedAt || ''}  来源 ${m.source || '?'}${partial}`)
    } else {
      bad++
      const why = st.reason === 'missing-files' ? `缺文件 ${st.missing.join(', ')}` : st.reason === 'mismatch' ? `内容与元数据不符 ${st.mismatch.join(', ')}` : st.reason === 'bad-meta' ? st.error : '快照不完整'
      console.log(`  ✗ ${v}  ${comp}  ${why}`)
    }
  }

  // 旧式单文件归档：upstreamdiff --auto 仍会读它，只是新的 capture 往快照仓库写
  if (fs.existsSync(LEGACY_ROOT)) {
    const legacy = fs.readdirSync(LEGACY_ROOT).filter((n) => n.endsWith('.js'))
    if (legacy.length) {
      console.log(`\n旧式单文件归档 ${path.relative(ROOT, LEGACY_ROOT)}（仍可对差；新的 capture 不再写这里）`)
      for (const n of legacy) console.log(`  · ${n}`)
    }
  }

  // 本机能挖到什么
  console.log('\n本机可挖的原版来源：')
  const bks = backupDirs()
  console.log(bks.length ? `  ✓ 安装备份     ${bks.map((b) => path.basename(b)).join(', ')}（含 app.asar + ui）` : '  · 安装备份     无（apply.sh 会在首次装机时留一份）')
  if (installDirs().length) {
    const loc = isLocalizedInstall()
    console.log(loc ? '  · 装机目录     已是汉化版（没有 hanhua-backup-* 时无法确定原版）' : '  ✓ 装机目录     当前是英文原版，可直接 capture')
  } else {
    console.log('  · 装机目录     未安装 Freebuff')
  }
  const caches = updaterCacheDirs()
  if (!caches.length) console.log('  · 更新缓存     无（没跑过 Freebuff 的自动更新？）')
  for (const c of caches) {
    const files = fs.readdirSync(c).filter((n) => /\.(exe|zip|dmg|AppImage)$/i.test(n))
    console.log(
      files.length
        ? `  ✓ 更新缓存     ${c}：${files.join(', ')}`
        : `  · 更新缓存     ${c}：无安装包（electron-updater 装完即删，只剩 blockmap/yml）`
    )
  }
  const insts = findInstallers()
  if (insts.length) {
    console.log('  · 本机安装包（上一版的候选；解包需要 7-Zip）：')
    for (const p of insts) {
      const v = versionFromName(p)
      console.log(`      ${v ? `v${v}` : '版本未知'}  ${human(fs.statSync(p).size)}  ${p}`)
    }
  }
  const z = find7z()
  console.log(`  解包依赖       ${z ? `✓ ${z}` : '· 未找到 7-Zip（要用安装包解原版就得装它）'}`)

  if (remote) await listRemote(extra)
  else console.log('\n（--remote 可看官方发布源上还有哪些版本的安装包、以及我们自己的 Release 上已有哪些快照）')

  console.log('\n跨机器怎么搬：')
  console.log('  导出  node tools/pristine.js export <版本|--all> --out dist/')
  console.log('  导入  node tools/pristine.js import <文件>   或   node tools/pristine.js import --from-release <版本|latest>')
  return bad ? 1 : 0
}

// 官方发布源上的某个版本还在不在：直接按资产 URL HEAD（不走 API 配额，拿到 content-length）
async function remoteInstaller(ver, kind) {
  const base = `https://github.com/${UPSTREAM_REPO}/releases/download/freebuff-desktop-v${ver}`
  const name = kind === 'win' ? `Freebuff-${ver}-win-x64.exe` : `Freebuff-${ver}-mac-arm64.zip`
  try {
    const res = await fetch(`${base}/${name}`, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(20000) })
    if (!res.ok) return null
    return { url: `${base}/${name}`, size: Number(res.headers.get('content-length')) || 0 }
  } catch {
    return null
  }
}

// 官方发布源不提供「历史版本列表」（仓库里混着 codebuff CLI 的上百个 Release），所以按版本号向下探测。
// 探测的是 GitHub Release 上的**永久资产 URL**，HEAD 不计入 API 配额。
async function listRemote(extra = []) {
  let target = null
  try {
    target = checkVersion(manifest().targetVersion || '')
  } catch {
    /* manifest 里没版本就不猜 */
  }
  const cands = []
  const push = (v) => {
    if (v && /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(v) && !cands.includes(v)) cands.push(v)
  }
  for (const v of extra) push(v)
  if (target) {
    const [a, b, c] = target.split('.').map(Number)
    for (let d = 0; d <= 3; d++) push(`${a}.${b}.${c - d}`)
  }
  for (const v of listVersions()) push(v)

  console.log(`\n官方发布源（${UPSTREAM_REPO} 的 GitHub Release，旧版安装包永久可下）：`)
  console.log('  （按版本号向下探测；官方不提供历史列表。win 是 NSIS，解包需要 7-Zip）')
  let any = false
  for (const v of cands) {
    const win = await remoteInstaller(v, 'win')
    if (!win) {
      console.log(`  · ${v}  （该版本没有 win 安装包）`)
      continue
    }
    any = true
    console.log(`  ✓ ${v}  win ${human(win.size)}`)
    console.log(`      ${win.url}`)
    const have = verifySnapshot(v).ok
    console.log(`      本地快照：${have ? '有 ✓' : '没有——下载上面这个包后 capture --exe 它（或 import 别处导出的快照）'}`)
  }
  if (!any) console.log('  ! 一个都没探到（离线？或版本号猜偏了；可用 --versions a,b,c 显式给）')

  console.log(`\n我们自己的 Release（${PACK_REPO}）上的原版快照：`)
  let ours = []
  try {
    const rels = await fetchJson(`https://api.github.com/repos/${PACK_REPO}/releases?per_page=100`)
    ours = rels
      .map((r) => ({ tag: r.tag_name, ver: (r.tag_name || '').replace(/^pack-v/, ''), asset: (r.assets || []).find((a) => /^pristine-.*\.json\.gz$/.test(a.name)) }))
      .filter((r) => r.asset)
    if (!ours.length) console.log('  （还没有——下一次 bash tools/release.sh 发布会自动附上本版快照）')
    for (const r of ours.slice(0, 8)) console.log(`  ✓ ${r.ver}  ${r.asset.name}  ${human(r.asset.size)}  （tag ${r.tag}）`)
  } catch (e) {
    console.log(`  ! 取不到我们自己的 Release（离线？）：${e.message}`)
  }
  const missing = ours.filter((o) => !verifySnapshot(o.ver).ok)
  if (missing.length) console.log(`\n  提示：node tools/pristine.js import --from-release ${missing.map((o) => o.ver).slice(-1)[0]}`)
}

// --- 子命令：capture -------------------------------------------------------------

function cmdCapture(argv) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--install' || a === '--force' || a === '--quiet') flags[a.slice(2)] = true
    else if (['--asar', '--ui', '--main-src', '--exe', '--7z', '--version'].includes(a)) {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new UsageError(`${a} 需要一个值`)
      flags[a.replace(/^--/, '')] = v
    } else if (a.startsWith('--')) throw new UsageError(`未知参数：${a}`)
    else positional.push(a)
  }

  // 快路径：版本已知且快照完好就直接跳过（build.sh 每次构建都调一次，不能白解 28 MB 的 asar）。
  // 只有「这次能给出主进程部分」而现有快照却没有时才继续。
  const wantsElectron = !!(flags.asar || flags['main-src'] || flags.exe || flags.install || !positional.length)
  if (flags.version && !flags.force) {
    const st = verifySnapshot(checkVersion(flags.version))
    const hasElectron = !!(st.meta && (st.meta.components || []).includes('electron'))
    if (st.ok && (!wantsElectron || hasElectron)) {
      console.log(`原版快照已就位：work/pristine/${flags.version}（${(st.meta.components || []).join('+')}，未重写）`)
      return 0
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pristine-'))
  try {
    const src = resolveSource({ positional, flags, tmp })
    const version = resolveVersion({ explicit: flags.version, mainDir: src.mainDir, exePath: flags.exe || positional[0], uiDir: src.uiDir })
    return writeSnapshot({
      version,
      source: src.source,
      sourceLabel: src.sourceLabel,
      uiDir: src.uiDir,
      mainDir: src.mainDir,
      force: !!flags.force,
      quiet: !!flags.quiet,
    })
  } finally {
    rmrf(tmp)
  }
}

// --- 子命令：export / import ------------------------------------------------------

function exportBuffer(version) {
  const st = verifySnapshot(version)
  if (!st.ok) {
    throw new DataError(
      st.reason === 'missing'
        ? `没有 v${version} 的快照（先 capture 或 import）`
        : `v${version} 的快照校验不过：${st.reason}${st.missing ? ' 缺 ' + st.missing.join(', ') : ''}${st.mismatch ? ' 不符 ' + st.mismatch.join(', ') : ''}`
    )
  }
  const meta = st.meta
  const payload = {
    ...meta,
    embedded: true,
    exportedAt: new Date().toISOString(),
    files: meta.files.map((f) => ({
      ...f,
      data: fs.readFileSync(path.join(snapDir(version), f.path)).toString('base64'),
    })),
  }
  return zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 })
}

function cmdExport(argv) {
  const flags = { out: null }
  const positional = []
  let all = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--all') all = true
    else if (a === '--out') {
      flags.out = argv[++i]
      if (!flags.out) throw new UsageError('--out 需要一个路径')
    } else if (a.startsWith('--')) throw new UsageError(`未知参数：${a}`)
    else positional.push(a)
  }
  if (!all && !positional.length) throw new UsageError('用法：node tools/pristine.js export <版本|--all> [--out <文件|目录>]')

  const versions = all ? listVersions() : [checkVersion(positional[0])]
  if (!versions.length) throw new DataError('仓库里一份快照都没有，没什么可导出的')

  const single = !all && versions.length === 1
  // 单版本时 --out 指文件（.json/.json.gz 结尾）还是目录？已存在的目录算目录，否则看扩展名。
  // 多版本（--all）一律当目录。
  const out = flags.out || (single ? path.join(DIST, `pristine-${versions[0]}.json.gz`) : DIST)
  const outIsDir = !single || (fs.existsSync(out) ? fs.statSync(out).isDirectory() : !/\.json(\.gz)?$/i.test(out))

  for (const v of versions) {
    const buf = exportBuffer(v)
    const file = outIsDir ? path.join(out, `pristine-${v}.json.gz`) : out
    mkdirp(path.dirname(file))
    fs.writeFileSync(file, buf)
    const meta = verifySnapshot(v).meta
    console.log(`已导出 v${v} → ${path.relative(ROOT, file) || file}（${human(buf.length)}，含 ${(meta.files || []).length} 个文件，${(meta.components || []).join('+')}）`)
  }
  console.log('  另一台机器：node tools/pristine.js import <文件>   然后 node tools/upstreamdiff.js --auto')
  return 0
}

// 导入单份快照（文件内容 → work/pristine/<版本>/）
function importBuffer(buf, { force, quiet, origin }) {
  let obj = null
  // 先按 gzip 解；解不开再当纯 JSON 试（手工改过的快照也能导）
  try {
    obj = JSON.parse(zlib.gunzipSync(buf).toString('utf8'))
  } catch {
    try {
      obj = JSON.parse(buf.toString('utf8'))
    } catch {
      throw new DataError(`${origin} 既不是 gzip 也不是 JSON，读不出来`)
    }
  }
  if (obj.kind !== KIND) throw new DataError(`${origin} 不是本工具导出的快照（kind=${obj.kind}）`)
  const version = checkVersion(obj.version)
  if (!Array.isArray(obj.files) || !obj.files.length) throw new DataError(`${origin} 里没有文件列表`)

  const files = obj.files.map((f) => {
    const rel = String(f.path || '').split('\\').join('/')
    if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) throw new DataError(`${origin} 里的路径不合法：${f.path}`)
    if (typeof f.data !== 'string') throw new DataError(`${origin} 里的 ${rel} 没有内嵌数据（这不是导出文件，而是目录里的 snapshot.json？）`)
    const data = Buffer.from(f.data, 'base64')
    if (data.length !== f.bytes || sha1(data) !== f.sha1) throw new DataError(`${origin} 里的 ${rel} 校验不过（字节数或 sha1 与元数据不符）`)
    return { path: rel, bytes: f.bytes, sha1: f.sha1, data }
  })

  const cur = verifySnapshot(version)
  if (cur.meta && !force) {
    if (!cur.ok) {
      // 现有的这份本身就是坏的（缺件 / 内容与元数据不符）：不能因为「名字一样」就当导入成功，
      // 那样仓库里会留着一份永远校验不过的快照。
      const why = cur.reason === 'missing-files' ? `缺文件 ${cur.missing.join(', ')}` : cur.reason === 'mismatch' ? `内容与元数据不符 ${cur.mismatch.join(', ')}` : cur.reason
      throw new DataError(`v${version} 已存在但**校验不过**（${why}）——确认要用导入的这份替换它，请加 --force。`)
    }
    const same =
      (cur.meta.bundleSha1 || '') === (obj.bundleSha1 || '') &&
      cur.meta.files.length === files.length &&
      cur.meta.files.every((f) => files.some((g) => g.path === f.path && g.sha1 === f.sha1))
    if (same) {
      if (!quiet) console.log(`v${version} 已存在且内容一致，跳过（--force 可重写，例如刷新来源记录）`)
      return 0
    }
    throw new DataError(
      `v${version} 已存在且内容**不一致**（现有来自 ${cur.meta.source}，导入的是 ${obj.source || '?'}）。\n` +
        `  确认要用导入的这份覆盖，请加 --force。`
    )
  }

  const staging = snapDir(version) + '.tmp'
  rmrf(staging)
  mkdirp(staging)
  for (const f of files) {
    const dest = path.join(staging, f.path)
    mkdirp(path.dirname(dest))
    fs.writeFileSync(dest, f.data)
  }
  // 保留原快照的来源信息（导出→导入 往返后除 importedAt 外应当逐字段一致，便于比对漂移），
  // 搬运轨迹另记在 importedFrom / importedAt 里，不覆盖原来源。
  const meta = {
    kind: KIND,
    schema: obj.schema || SCHEMA,
    version,
    bundle: obj.bundle || null,
    bundleSha1: obj.bundleSha1 || null,
    capturedAt: obj.capturedAt || null,
    source: obj.source || 'import',
    sourceLabel: obj.sourceLabel || null,
    host: obj.host || null,
    components: obj.components || [],
    importedFrom: origin,
    importedAt: new Date().toISOString(),
    files: files.map(({ path: p, bytes, sha1: s }) => ({ path: p, bytes, sha1: s })),
  }
  writeJson(path.join(staging, 'snapshot.json'), meta)
  rmrf(snapDir(version))
  fs.renameSync(staging, snapDir(version))
  if (!quiet) {
    const bytes = meta.files.reduce((a, f) => a + f.bytes, 0)
    console.log(`已导入 v${version} → work/pristine/${version}（${(meta.components || []).join('+')}，${human(bytes)}）`)
    if (!(meta.components || []).includes('electron')) console.log('  ! 这份快照只有 ui 部分：可用于 upstreamdiff，发布闸门用不了')
  }
  return 0
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'freebuff-zh-pristine' },
    signal: AbortSignal.timeout(25000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}（${url}）`)
  return res.json()
}

async function fetchBuf(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'freebuff-zh-pristine' }, signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}（${url}）`)
  return Buffer.from(await res.arrayBuffer())
}

// 我们自己的 Release 上取快照资产（仓库是公开的，匿名 API 就够；万一变私有则回退到 gh）
async function fetchFromRelease(want, repo) {
  const rels = await fetchJson(`https://api.github.com/repos/${repo}/releases?per_page=30`)
  const withAsset = rels.map((r) => ({
    tag: r.tag_name || '',
    ver: (r.tag_name || '').replace(/^pack-v/, ''),
    asset: (r.assets || []).find((a) => /^pristine-.*\.json\.gz$/.test(a.name)),
  }))
  let pick
  if (want === 'latest') pick = withAsset.filter((r) => r.asset).sort((a, b) => cmpVersion(b.ver, a.ver))[0]
  else pick = withAsset.find((r) => r.ver === want || r.tag === want)
  if (!pick || !pick.asset) {
    const known = withAsset.filter((r) => r.asset).map((r) => r.ver)
    const what = want === 'latest' ? '带快照的最新版本' : `w${want}`
    throw new DataError(`Release 上没有 ${what} 的原版快照资产。已带快照的版本：${known.join(', ') || '（无）'}\n  下一次 bash tools/release.sh 发布会自动附上本版快照；也可以直接 import 别人给你的 .json.gz 文件。`)
  }
  return { buf: await fetchBuf(pick.asset.browser_download_url), name: pick.asset.name, ver: pick.ver }
}

async function cmdImport(argv) {
  const flags = { repo: PACK_REPO, fromRelease: null, force: false, quiet: false }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--force') flags.force = true
    else if (a === '--quiet') flags.quiet = true
    else if (a === '--repo' || a === '--from-release') {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new UsageError(`${a} 需要一个值`)
      if (a === '--repo') flags.repo = v
      else flags.fromRelease = v
    } else if (a.startsWith('--')) throw new UsageError(`未知参数：${a}`)
    else positional.push(a)
  }

  if (flags.fromRelease) {
    const want = flags.fromRelease === 'latest' ? 'latest' : checkVersion(flags.fromRelease)
    console.log(`从 ${flags.repo} 的 Release 取原版快照：${want}`)
    let got
    try {
      got = await fetchFromRelease(want, flags.repo)
    } catch (e) {
      if (e instanceof DataError) throw e
      throw new UsageError(
        `取不到 Release 资产（${e.message}）。\n` +
          `  · 离线时改用文件搬运：在别的机器 node tools/pristine.js export <版本> --out dist/ 后拷过来 import；\n` +
          `  · 仓库变私有时用 gh：gh release download pack-v<版本> -R ${flags.repo} -p 'pristine-*.json.gz' -D dist && node tools/pristine.js import dist/pristine-<版本>.json.gz`
      )
    }
    if (!flags.quiet) console.log(`  取到 ${got.name}（${human(got.buf.length)}）`)
    return importBuffer(got.buf, { force: flags.force, quiet: flags.quiet, origin: `${flags.repo} ${got.name}` })
  }

  if (!positional.length) throw new UsageError('用法：node tools/pristine.js import <文件|目录> | --from-release <版本|latest>')
  const p = positional[0]
  if (!fs.existsSync(p)) throw new UsageError(`文件不存在：${p}`)
  if (fs.statSync(p).isDirectory()) {
    const files = fs.readdirSync(p).filter((n) => /\.json(\.gz)?$/.test(n)).sort()
    if (!files.length) throw new UsageError(`${p} 里没有 .json / .json.gz 快照文件`)
    for (const n of files) importBuffer(fs.readFileSync(path.join(p, n)), { force: flags.force, quiet: flags.quiet, origin: path.join(p, n) })
    return 0
  }
  return importBuffer(fs.readFileSync(p), { force: flags.force, quiet: flags.quiet, origin: p })
}

// --- 子命令：publish / path -------------------------------------------------------

function manifest() {
  return readJson(MANIFEST)
}

// 把本版快照附到我们自己的 Release（release.sh 发布完自动调；失败只 WARN，不该拦住发布）
function cmdPublish(argv) {
  const flags = { repo: PACK_REPO, tag: null, dryRun: false, quiet: false }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') flags.dryRun = true
    else if (a === '--quiet') flags.quiet = true
    else if (a === '--repo' || a === '--tag') {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new UsageError(`${a} 需要一个值`)
      if (a === '--repo') flags.repo = v
      else flags.tag = v
    } else if (a.startsWith('--')) throw new UsageError(`未知参数：${a}`)
    else positional.push(a)
  }
  const m = manifest()
  const version = checkVersion(positional[0] || m.targetVersion)
  const tag = flags.tag || `pack-v${m.packVersion || m.targetVersion}`
  const st = verifySnapshot(version)
  if (!st.ok) {
    throw new DataError(
      `没有可发布的 v${version} 快照（${st.reason}）。先 node tools/pristine.js capture --install --version ${version}（或 import）。`
    )
  }
  const file = path.join(DIST, `pristine-${version}.json.gz`)
  fs.writeFileSync(file, exportBuffer(version))
  const size = fs.statSync(file).size
  if (flags.dryRun) {
    console.log(`（--dry-run）会附上 ${path.relative(ROOT, file)}（${human(size)}）到 ${flags.repo} 的 Release ${tag}`)
    return 0
  }
  if (!which('gh')) throw new UsageError(`未装 gh CLI，无法上传。手工上传：gh release upload ${tag} ${file} -R ${flags.repo}`)
  const exists = run(`gh release view ${q(tag)} -R ${q(flags.repo)}`, { allowFail: true })
  if (exists.status !== 0) {
    throw new UsageError(`Release ${tag} 不存在（快照要附在已发布的汉化包上）。先 bash tools/release.sh，或用 --tag 指向别的 tag。`)
  }
  run(`gh release upload ${q(tag)} ${q(file)} -R ${q(flags.repo)} --clobber`)
  // 一行也要打（--quiet 只是「简短」）：发布日志里必须看得见快照真的附上去了，
  // 否则「上一版原版有没有跟着发布」只能去 Release 页面手工核对。
  console.log(`原版快照已附上：${tag} ← ${path.basename(file)}（${human(size)}）`)
  if (!flags.quiet) {
    console.log(`  别的机器：node tools/pristine.js import --from-release ${version}`)
    console.log(`  ⚠ 快照里是 Freebuff 的英文原版代码（与已发布的汉化包同源），按 README 声明同样仅限`)
    console.log(`    已合法获取 Freebuff 的用户自用；若不想发布它，删掉该资产即可，其余流程不受影响。`)
  }
  return 0
}

function cmdPath(argv) {
  const needElectron = argv.includes('--require-electron')
  const version = checkVersion(argv.find((a) => !a.startsWith('--')) || '')
  const st = verifySnapshot(version)
  const hasElectron = !!(st.meta && (st.meta.components || []).includes('electron'))
  if (!st.ok || (needElectron && !hasElectron)) {
    console.error(`没有可用的 v${version} 快照${needElectron ? '（且需要含 electron/）' : ''}：${st.reason || 'ui-only'}`)
    return 1
  }
  console.log(st.dir)
  return 0
}

// --- 入口 -----------------------------------------------------------------------

const USAGE = `英文原版快照仓库（work/pristine/<版本>/）—— 上一版英文原版的可搬运载体

  node tools/pristine.js list [--remote]
  node tools/pristine.js capture [<路径>] [--install] [--asar <a> --ui <u>] [--main-src <目录>] [--exe <安装包>]
                                [--7z <路径>] [--version <x.y.z>] [--force] [--quiet]
  node tools/pristine.js export <版本|--all> [--out <文件|目录>]
  node tools/pristine.js import <文件|目录> | --from-release <版本|latest> [--repo R] [--force]
  node tools/pristine.js publish [<版本>] [--repo R] [--tag pack-vX] [--dry-run]
  node tools/pristine.js path <版本> [--require-electron]

退出码：0 正常；1 需要人工处理（快照损坏 / 版本冲突）；2 用法、依赖或来源不可用。`

async function main(argv) {
  const cmd = argv[0]
  const rest = argv.slice(1)
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(USAGE)
    return cmd ? 0 : 2
  }
  switch (cmd) {
    case 'list':
      return cmdList(rest)
    case 'capture':
      return cmdCapture(rest)
    case 'export':
      return cmdExport(rest)
    case 'import':
      return cmdImport(rest)
    case 'publish':
      return cmdPublish(rest)
    case 'path':
      return cmdPath(rest)
    default:
      throw new UsageError(`未知子命令：${cmd}\n\n${USAGE}`)
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((rc) => process.exit(rc))
    .catch((e) => {
      const rc = e instanceof UsageError ? 2 : e instanceof DataError ? 1 : 1
      console.error(`${e instanceof UsageError ? 'ERROR' : 'FAIL'}: ${e.message}`)
      process.exit(rc)
    })
}

module.exports = { main, verifySnapshot, writeSnapshot, exportBuffer, importBuffer, cmpVersion, listVersions, snapDir, checkVersion, quoteArg }
