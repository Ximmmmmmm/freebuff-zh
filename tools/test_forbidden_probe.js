#!/usr/bin/env node
// forbidden_probe 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 为什么需要它：这个探针的价值全在「判得准」，而它最容易悄悄退化的地方正好都不报错——
//   a) asar 读错了（读短、偏移算错）：主进程补丁状态会变成 unknown，风险被降级成「判不了」；
//   b) 判定表写反了：把「实例跑着换文件之前那套代码」这种**确凿风险**算成正常，探针就成了
//      安慰剂——它本来是为了不再靠人肉推理才写的；
//   c) 拿不到进程信息时返回 0：那就把「不知道」冒充成「没问题」，比不写这个工具更坏。
// 这里用合成的装机夹具与注入的进程列表把这三类退化钉住，另外覆盖两个纯函数的边界
// （日志端口解析、/healthz 判读）——它们错了同样是静默误判。
//
// asar 夹具是自己写的（格式按实测的真实 app.asar 布局），所以另有一条「如果本机有真实装机
// 就用它核对一次」的可选用例，防止测试与实现共用同一处理解。
//
// 覆盖：
//   1. asar 读取：合成的 asar 能取到文件原文；条目不存在 / 不是 asar → null；
//   2. classifyMain：带补丁 / 原始形态 / 两种都不像 → unknown；
//   3. rendererUsesLaunchHeader：带 / 不带 / 读不到；
//   4. parseOrchestratorPort：单段 / 追加多段取最后一次 / 没有；
//   5. classifyHealthResponse：401 → 强制令牌，200 "ok" → 放行，其它 → unknown；
//   6. 判定表：补丁齐全且无实例 → 无风险；装机未打补丁 / 混合态 → 风险；
//      证据不足（进程拿不到、渲染前提失效、main 判不了）→ unknown（不许报 0）；
//   7. 容差：实例比装机文件只早一点点不算混合态；早于 ui/index.html 也算混合态；
//   8. 退出码契约：0 / 1 / 2 三条路径 + --help / 未知参数 / 坏 --processes。
//
// 用法：node tools/test_forbidden_probe.js        # 退出码非 0 表示回归
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const probe = require('./forbidden_probe.js')

const WORK = path.join(__dirname, '..', 'work', 'test-forbidden-probe')
fs.rmSync(WORK, { recursive: true, force: true })

let fail = 0
let groups = 0
const chk = (cond, label) => {
  if (cond) console.log(`  ok  ${label}`)
  else {
    console.log(`  FAIL ${label}`)
    fail++
  }
}
const group = (name) => {
  groups++
  console.log(`\n${groups}) ${name}`)
}

// ------------------------------------------------------------------ 夹具
// 最小 asar 打包器：布局与读取器成对，格式取自实测的真实 app.asar
// （u32@0=4、u32@4=headerPickle 长度、JSON 从 hdr[8] 起、内容起始 = 8+headerPickle 长度）。
function buildAsar(files) {
  const tree = { files: {} }
  const entries = []
  for (const [p, content] of Object.entries(files)) {
    const buf = Buffer.from(content, 'utf8')
    const segs = p.split('/')
    let node = tree
    for (const seg of segs.slice(0, -1)) {
      if (!node.files[seg]) node.files[seg] = { files: {} }
      node = node.files[seg]
    }
    const leaf = { size: buf.length, offset: 0 }
    node.files[segs[segs.length - 1]] = leaf
    entries.push({ leaf, buf })
  }
  let offset = 0
  for (const e of entries) {
    e.leaf.offset = offset
    offset += e.buf.length
  }
  const json = Buffer.from(JSON.stringify(tree), 'utf8')
  const jsonLen = json.length
  const pad = (4 - (jsonLen % 4)) % 4
  const headerSize = 8 + jsonLen + pad
  const hdr = Buffer.alloc(headerSize)
  hdr.writeUInt32LE(jsonLen, 0) // 真实 asar 这里放补齐后的长度；读取器用不到
  hdr.writeUInt32LE(jsonLen, 4)
  json.copy(hdr, 8)
  const head = Buffer.alloc(8)
  head.writeUInt32LE(4, 0)
  head.writeUInt32LE(headerSize, 4)
  return Buffer.concat([head, hdr, ...entries.map((e) => e.buf)])
}

const PATCHED_MAIN = [
  "'use strict'",
  'function startOrchestrator(requestedPort = 0) {',
  '  const launchId = apiLaunchToken ?? randomUUID()',
  '  apiLaunchToken = launchId',
  '  return launchId',
  '}',
  '',
].join('\n')
const ORIGINAL_MAIN = [
  "'use strict'",
  'function startOrchestrator(requestedPort = 0) {',
  '  const launchId = randomUUID()',
  '  apiLaunchToken = launchId',
  '  return launchId',
  '}',
  '',
].join('\n')
const BUNDLE_WITH_HEADER = 'fetch(t,{headers:{"x-freebuff-launch-id":o}});let mg;function ID(){if(mg===void 0)mg=null;return mg}\n'
const BUNDLE_WITHOUT_HEADER = 'fetch(t);let mg;function ID(){if(mg===void 0)mg=null;return mg}\n'

/**
 * 造一个「装机目录」夹具；main 传 null 表示 asar 里不放 main.cjs。
 * 注意真实装机的布局：app.asar 里只有主进程（electron/*），渲染侧（ui/index.html + assets）
 * 是磁盘文件——所以主 bundle 也写磁盘，与探针的读取路径一致。
 */
function makeInstall(name, { main, bundle }) {
  const dir = path.join(WORK, name)
  const uiDir = path.join(dir, 'resources', 'orchestrator', 'ui')
  fs.mkdirSync(path.join(uiDir, 'assets'), { recursive: true })
  const entries = {}
  if (main !== null && main !== undefined) entries['electron/main.cjs'] = main
  fs.writeFileSync(path.join(dir, 'resources', 'app.asar'), buildAsar(entries))
  if (bundle !== undefined && bundle !== null) {
    fs.writeFileSync(path.join(uiDir, 'assets', 'index-fixture.js'), bundle)
  }
  fs.writeFileSync(
    path.join(uiDir, 'index.html'),
    '<!doctype html>\n<html lang="zh-CN">\n<head><meta name="hanhua-pack" content="0.0.124"></head>\n<body><script type="module" src="./assets/index-fixture.js"></script></body>\n</html>\n',
  )
  return dir
}

const GOOD = makeInstall('good', { main: PATCHED_MAIN, bundle: BUNDLE_WITH_HEADER })
const BAD = makeInstall('bad', { main: ORIGINAL_MAIN, bundle: BUNDLE_WITH_HEADER })
const NO_MAIN = makeInstall('no-main', { main: null, bundle: BUNDLE_WITH_HEADER })
const NO_HEADER = makeInstall('no-header', { main: PATCHED_MAIN, bundle: BUNDLE_WITHOUT_HEADER })
const EMPTY_LOGS = path.join(WORK, 'empty-logs')
fs.mkdirSync(EMPTY_LOGS, { recursive: true })

const writeProcFile = (name, list) => {
  const f = path.join(WORK, `${name}.json`)
  fs.writeFileSync(f, JSON.stringify(list))
  return f
}
const NO_PROCS = writeProcFile('no-procs', [])
const OLD_PROCS = writeProcFile('old-procs', [
  { pid: 4242, startedAt: '2020-01-01T00:00:00.000Z', commandLine: 'C:\\...\\Freebuff.exe' },
])
const NEW_PROCS = writeProcFile('new-procs', [
  { pid: 4243, startedAt: '2999-01-01T00:00:00.000Z', commandLine: 'C:\\...\\Freebuff.exe' },
])

const runCli = (args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(__dirname, 'forbidden_probe.js'), ...args], { encoding: 'utf8' }) }
  } catch (e) {
    return { code: e.status, out: String(e.stdout || ''), err: String(e.stderr || '') }
  }
}
// CLI 用例统一注入进程与日志，避免依赖真机环境（否则 CI 上判定会飘）
const cliBase = ['--logs', EMPTY_LOGS, '--no-http']

// ------------------------------------------------------------------ 1) asar 读取
group('asar 读取（不依赖 @electron/asar）')
{
  const asar = path.join(GOOD, 'resources', 'app.asar')
  const got = probe.readAsarEntry(asar, 'electron/main.cjs')
  chk(got === PATCHED_MAIN, '1) 取出的 electron/main.cjs 与写入内容逐字节一致（含 CRLF/长度）')
  chk(probe.readAsarEntry(asar, 'electron/nope.cjs') === null, '1) 条目不存在 → null')
  chk(probe.readAsarEntry(asar, 'electron') === null, '1) 给目录路径而不是文件 → null')
  const notAsar = path.join(GOOD, 'resources', 'orchestrator', 'ui', 'index.html')
  chk(probe.readAsarEntry(notAsar, 'electron/main.cjs') === null, '1) 不是 asar 的文件 → null（不抛）')
  chk(probe.readAsarEntry(path.join(WORK, 'nothing-here.asar'), 'electron/main.cjs') === null, '1) 文件不存在 → null')
  chk(probe.readAsarEntry(realAsarPath(), 'electron/main.cjs') !== null || !fs.existsSync(realAsarPath()), '1) 真实 app.asar 也能读（有装机时）')
}
function realAsarPath() {
  const real = probe.findInstall(null)
  return real ? real.asarPath : path.join(WORK, 'no-real-install.asar')
}

// ------------------------------------------------------------------ 2) classifyMain
group('classifyMain（装机补丁形态）')
{
  chk(probe.classifyMain(PATCHED_MAIN).verdict === 'patched', '2) apiLaunchToken ?? randomUUID() → patched')
  chk(probe.classifyMain(ORIGINAL_MAIN).verdict === 'unpatched', '2) const launchId = randomUUID() → unpatched')
  chk(probe.classifyMain('const x = 1\n').verdict === 'unknown', '2) 两种形态都没有 → unknown（不许猜成安全）')
  chk(probe.classifyMain(null).verdict === 'unknown', '2) 读不到内容 → unknown')
}

// ------------------------------------------------------------------ 3) 渲染前提
group('rendererUsesLaunchHeader（探针前提）')
{
  chk(probe.rendererUsesLaunchHeader(BUNDLE_WITH_HEADER) === true, '3) 带 x-freebuff-launch-id → true')
  chk(probe.rendererUsesLaunchHeader(BUNDLE_WITHOUT_HEADER) === false, '3) 不带 → false')
  chk(probe.rendererUsesLaunchHeader(null) === null, '3) 读不到 → null')
}

// ------------------------------------------------------------------ 4) 日志端口
group('parseOrchestratorPort（日志里的 orchestrator 端口）')
{
  chk(probe.parseOrchestratorPort('freebuff-desktop orchestrator listening on http://127.0.0.1:17514\n') === 17514, '4) 单段会话取出端口')
  chk(
    probe.parseOrchestratorPort(
      'listening on http://127.0.0.1:17514\n[restart 1] …\nlistening on http://127.0.0.1:18888\n',
    ) === 18888,
    '4) 追加多段（崩溃重启过）取最后一次',
  )
  chk(probe.parseOrchestratorPort('nothing here') === null, '4) 没有端口 → null')
  chk(probe.parseOrchestratorPort(null) === null, '4) 不是字符串 → null')
}

// ------------------------------------------------------------------ 5) /healthz 判读
group('classifyHealthResponse（orchestrator 要不要令牌）')
{
  chk(probe.classifyHealthResponse(401, '{"error":"invalid launch id"}') === 'token-required', '5) 401 → 强制令牌')
  chk(probe.classifyHealthResponse(200, 'ok') === 'open', '5) 200 "ok" → 没设 LAUNCH_ID（写操作放行）')
  chk(probe.classifyHealthResponse(200, '{"ok":true}') === 'unknown', '5) 200 但形状态不认识 → unknown（不猜）')
  chk(probe.classifyHealthResponse(500, 'boom') === 'unknown', '5) 500 → unknown')
}

// ------------------------------------------------------------------ 6) 判定表
group('evaluate（判定表：只有确凿证据才算风险，拿不到证据一律 unknown）')
{
  const files = { asar: { path: 'app.asar', mtimeMs: Date.parse('2026-09-19T02:25:00Z') }, ui: { path: 'index.html', mtimeMs: Date.parse('2026-09-19T02:25:00Z') } }
  const install = { path: 'X', asarPath: 'X/app.asar', uiIndexPath: 'X/ui/index.html', bundlePath: 'X/bundle.js' }
  const base = (over) => ({
    install,
    main: { verdict: 'patched', evidence: 'patched' },
    renderer: true,
    files,
    instances: { ok: true, list: [], reason: null },
    health: [],
    ...over,
  })

  const noRisk = probe.evaluate(base({}))
  chk(!noRisk.risk && !noRisk.unknown, '6) 补丁在 + 没有实例在跑 → 无风险、无 unknown')

  const unpatched = probe.evaluate(base({ main: { verdict: 'unpatched', evidence: 'const launchId = randomUUID()' } }))
  chk(unpatched.risk, '6) 装机未打补丁 → 风险（下次崩溃重启必中）')
  chk(/randomUUID/.test(JSON.stringify(unpatched.findings)), '6) 风险条目里带上证据原文（可直接核对）')

  const stale = probe.evaluate(
    base({ instances: { ok: true, list: [{ pid: 111, startedAtMs: Date.parse('2026-09-19T02:12:34Z'), commandLine: 'Freebuff.exe' }], reason: null } }),
  )
  chk(stale.risk, '6) 实例启动早于装机文件 → 混合态，风险')
  chk(/混合态/.test(JSON.stringify(stale.findings)), '6) 明确点出「混合态」而不是含糊的「可能有问题」')

  const fresh = probe.evaluate(
    base({ instances: { ok: true, list: [{ pid: 112, startedAtMs: Date.parse('2026-09-19T03:00:00Z'), commandLine: 'Freebuff.exe' }], reason: null } }),
  )
  chk(!fresh.risk && !fresh.unknown, '6) 实例启动晚于装机文件 → 加载的就是当前文件，无风险')

  const noProcs = probe.evaluate(base({ instances: { ok: false, list: [], reason: '非 Windows' } }))
  chk(noProcs.unknown && !noProcs.risk, '6) 拿不到进程信息 → unknown（绝不报 0）')
  chk(/非 Windows/.test(JSON.stringify(noProcs.findings)), '6) unknown 条目带上拿不到证据的原因')

  const badMain = probe.evaluate(base({ main: { verdict: 'unknown', evidence: '没找到 launchId' } }))
  chk(badMain.unknown, '6) main.cjs 判不了 → unknown')

  const badRenderer = probe.evaluate(base({ renderer: false }))
  chk(badRenderer.unknown, '6) 渲染进程不再用 launch-id 头 → 前提失效，unknown')

  const noInstall = probe.evaluate(base({ install: null }))
  chk(noInstall.unknown && !noInstall.risk, '6) 找不到装机目录 → unknown（用法问题在 CLI 层表现为 rc 2）')

  const healthNote = probe.evaluate(
    base({ health: [{ file: 'a.log', port: 17514, state: 'token-required', detail: 'HTTP 401' }] }),
  )
  chk(!healthNote.risk && /强制 launch id/.test(JSON.stringify(healthNote.findings)), '6) /healthz 只作事实记录，不单独构成风险')
}

// ------------------------------------------------------------------ 7) 容差与 ui 侧
group('混合态判定细节')
{
  const uiNewer = { asar: { path: 'app.asar', mtimeMs: Date.parse('2026-09-19T02:00:00Z') }, ui: { path: 'ui/index.html', mtimeMs: Date.parse('2026-09-19T02:30:00Z') } }
  chk(
    probe.evaluate({
      install: { path: 'X', asarPath: '', uiIndexPath: '', bundlePath: '' },
      main: { verdict: 'patched', evidence: '' },
      renderer: true,
      files: uiNewer,
      instances: { ok: true, list: [{ pid: 1, startedAtMs: Date.parse('2026-09-19T02:10:00Z'), commandLine: '' }], reason: null },
      health: [],
    }).risk,
    '7) 只换了 ui/index.html（asar 更旧）也算混合态',
  )
  chk(
    probe.compareStale(Date.parse('2026-09-19T02:25:00Z') - probe.MIX_TOLERANCE_MS + 500, { asar: { path: 'a', mtimeMs: Date.parse('2026-09-19T02:25:00Z') } }) === null,
    '7) 只早于装机文件不到容差 → 不算混合态（刚换完文件就被拉起是正常时序）',
  )
  chk(
    probe.compareStale(Date.parse('2026-09-19T02:25:00Z') - probe.MIX_TOLERANCE_MS - 500, { asar: { path: 'a', mtimeMs: Date.parse('2026-09-19T02:25:00Z') } }) !== null,
    '7) 超出容差 → 算混合态',
  )
  chk(probe.compareStale(1, {}) === null, '7) 没有装机时间戳时不报混合态（缺证据不冤枉）')
}

// ------------------------------------------------------------------ 8) CLI 退出码契约
group('CLI 退出码契约（0 / 1 / 2）')
{
  const help = runCli(['--help'])
  chk(help.code === 0 && /用法/.test(help.out), `8) --help → 0（实际 ${help.code}）`)
  const badArg = runCli(['--nope'])
  chk(badArg.code === 2, `8) 未知参数 → 2（实际 ${badArg.code}）`)
  const missingLogsValue = runCli(['--logs'])
  chk(missingLogsValue.code === 2, `8) --logs 缺值 → 2（实际 ${missingLogsValue.code}）`)
  const noInstall = runCli([...cliBase, '--install', path.join(WORK, 'no-such-install'), '--processes', NO_PROCS])
  chk(noInstall.code === 2, `8) 装机不存在 → 2（实际 ${noInstall.code}）`)

  const clean = runCli([...cliBase, '--install', GOOD, '--processes', NO_PROCS])
  chk(clean.code === 0, `8) 补丁在 + 没有实例 → 0（实际 ${clean.code}）`)
  chk(/没发现会触发 403/.test(clean.out), '8) 结论行是「没发现会触发 403 forbidden 的条件」')

  const risky = runCli([...cliBase, '--install', BAD, '--processes', NO_PROCS])
  chk(risky.code === 1, `8) 装机未打补丁 → 1（实际 ${risky.code}）`)
  chk(/randomUUID/.test(risky.out), '8) 报告里能看到证据原文')

  const mixed = runCli([...cliBase, '--install', GOOD, '--processes', OLD_PROCS])
  chk(mixed.code === 1, `8) 混合态（实例早于装机文件）→ 1（实际 ${mixed.code}）`)
  chk(/混合态/.test(mixed.out), '8) 报告点名「混合态」')

  const fresh = runCli([...cliBase, '--install', GOOD, '--processes', NEW_PROCS])
  chk(fresh.code === 0, `8) 实例比装机文件新 → 0（实际 ${fresh.code}）`)

  const badProcs = runCli([...cliBase, '--install', GOOD, '--processes', path.join(WORK, 'broken.json')])
  chk(badProcs.code === 2, `8) --processes 文件读不了 → 2（拿不到证据不许报 0，实际 ${badProcs.code}）`)

  const noMain = runCli([...cliBase, '--install', NO_MAIN, '--processes', NO_PROCS])
  chk(noMain.code === 2, `8) asar 里没有 main.cjs → 2（实际 ${noMain.code}）`)

  const noHeader = runCli([...cliBase, '--install', NO_HEADER, '--processes', NO_PROCS, '--json'])
  chk(noHeader.code === 2 && /x-freebuff-launch-id/.test(noHeader.out), '8) 前提失效 → 2，且 JSON 里能看到原因')

  const json = runCli([...cliBase, '--install', GOOD, '--processes', NO_PROCS, '--json'])
  const parsed = (() => {
    try {
      return JSON.parse(json.out)
    } catch {
      return null
    }
  })()
  chk(json.code === 0 && parsed && parsed.risk === false && parsed.unknown === false, '8) --json 输出结构化且字段齐全')
}

// ------------------------------------------------------------------ 9) 真实装机（可选）
group('真实装机核对（本机有 Freebuff 装机时才跑，防止「自造自读」共模）')
{
  const real = probe.findInstall(null)
  if (!real || !fs.existsSync(real.asarPath)) {
    console.log('  --  本机没有可核对的装机，跳过（CI 上属正常）')
  } else {
    const src = probe.readAsarEntry(real.asarPath, 'electron/main.cjs')
    const verdict = probe.classifyMain(src)
    chk(typeof src === 'string' && src.length > 10000, `9) 真实 app.asar 里读出了 electron/main.cjs（${src ? src.length : 0} 字节）`)
    chk(verdict.verdict === 'patched' || verdict.verdict === 'unpatched', `9) 真实装机补丁状态判得出（${verdict.verdict}）`)
  }
}

console.log(fail ? `\n${fail} 项失败` : `\n全部通过（${groups} 组用例）`)
process.exit(fail ? 1 : 0)
