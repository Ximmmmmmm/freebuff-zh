#!/usr/bin/env node
// 「无法打开标签页: forbidden」体检 —— 一条命令回答「这台机器现在/下次会不会再中」。
//
// 为什么需要它：这条报错在本机已经出现过好几次（消息未发送 / 无法停止当前轮次 / 无法编辑消息 /
// 无法打开标签页，全是同一个原因），而每次都要把那串因果重新推一遍。把它固化成工具之前，先写下
// 结论本身（下面每一条都在装机文件里核对过，不是推测）：
//
//   · 界面文案来自 dict.json 的 "Could not open tab" → 「无法打开标签页」；
//   · 触发点是 POST /api/threads（渲染进程 openTab → le.createThread），即「打开标签页」这个动作
//     本身就是一次**写操作**；
//   · 本机 orchestrator（Bun 进程，监听 127.0.0.1 随机端口）里返回 {"error":"forbidden"} 的地方
//     **只有一处**：`requiresLaunchToken(method, pathname) && !isAuthorizedMutation(LAUNCH_ID, header)`，
//     即写方法（POST/PUT/PATCH/DELETE）+ /api/ 路径要求请求头 x-freebuff-launch-id 与它启动时从
//     FREEBUFF_LAUNCH_ID 拿到的值**完全相等**（LAUNCH_ID 为空则一律放行；/healthz 的不匹配返回
//     401 "invalid launch id"，是探针用来判断「这个实例到底要不要令牌」的那把尺子）；
//   · 渲染进程那边，这个令牌**只读一次就永久缓存**（preload.cjs 的 apiToken() → bundle 里的
//     模块级变量），读到的即使是 null 也照样缓存；
//   · 所以「令牌对不上」只有一个来源：orchestrator 换了新 id，而页面的缓存还是旧的。汉化包的
//     patches/electron-main.cjs.patch 让崩溃重启沿用同一 id，治的就是这一条。
//
// 于是体检要回答两个问题：
//   1) 装机 app.asar 里的 electron/main.cjs 有没有那条补丁？（没有 ⇒ 下次崩溃重启就会中）
//   2) 现在跑着的实例，加载的是不是**换文件之前**的代码？（装机文件是运行中进程按需从磁盘读的：
//      渲染进程每次窗口加载/重载都重读，主进程只在进程启动时读一次。热换文件会留下「界面是新的、
//      主进程是旧的」混合态——旧的那套没有补丁，崩一次之后每个写操作都 403。）
//
// 退出码：0 = 没发现风险；1 = 有确凿风险；2 = 判不了（拿不到证据或用法错误）。
// 「判不了」不许冒充「正常」：拿不到进程信息时一律 2，不报 0。
//
// 用法：
//   node tools/forbidden_probe.js                        # 自动定位装机、进程、日志
//   node tools/forbidden_probe.js --install <目录>       # 指定装机目录（非默认路径 / 测试用）
//   node tools/forbidden_probe.js --processes <json>     # 注入进程列表（拿不到 WMI 的机器、自测）
//   node tools/forbidden_probe.js --logs <文件或目录>     # 指定 orchestrator 日志（默认扫 %APPDATA%）
//   node tools/forbidden_probe.js --no-http              # 不发 /healthz 请求
//   node tools/forbidden_probe.js --json                 # 结构化输出
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const DEFAULT_INSTALL_SUFFIX = path.join('Programs', '@codebufffreebuff-desktop')
// 装机目录里我们关心的三个文件
const ASAR_REL = path.join('resources', 'app.asar')
const UI_INDEX_REL = path.join('resources', 'orchestrator', 'ui', 'index.html')
const MAIN_ENTRY = 'electron/main.cjs'

// 进程启动时间与装机文件写入时间相差在这个范围内不算「混合态」——同一次操作的两个时间戳本来
// 就有先后，不设容差会把「刚换完文件、应用刚被拉起」这种正常情形误报成风险。
const MIX_TOLERANCE_MS = 2000

// ------------------------------------------------------------------ asar 读取
// 只读 asar 里的单个文件，**不依赖 @electron/asar**：体检工具要在离线、没有 npx 缓存的机器上
// 也能跑。头部布局（electron/asar 的 Pickle，已在真实 app.asar 上逐字节核对）：
//   [u32 = 4][u32 = headerPickle 长度][u32 = JSON 补齐后长度][u32 = JSON 原始长度][JSON][文件内容…]
// JSON 从偏移 8 起、长 hdr[4..8]；文件内容起始 = 8 + headerPickle 长度，节点里的 offset 相对它。
// 注意 readSync 会短读（真实 app.asar 上实测一次只拿到 80034/81184 字节），所以必须循环读满。
function readFully(fd, buf, position) {
  let read = 0
  while (read < buf.length) {
    const n = fs.readSync(fd, buf, read, buf.length - read, position + read)
    if (n <= 0) break
    read += n
  }
  return read
}

/** 取 asar 内某个文件的文本；读不到（文件不存在 / 结构不认识 / 不是文件）返回 null。 */
function readAsarEntry(asarPath, innerPath) {
  let fd = null
  try {
    fd = fs.openSync(asarPath, 'r')
    const head = Buffer.alloc(8)
    if (readFully(fd, head, 0) !== 8) return null
    const headerSize = head.readUInt32LE(4)
    if (!headerSize || headerSize > 64 * 1024 * 1024) return null
    const hdr = Buffer.alloc(headerSize)
    if (readFully(fd, hdr, 8) !== headerSize) return null
    const jsonLen = hdr.readUInt32LE(4)
    if (jsonLen <= 0 || jsonLen > headerSize - 8) return null
    const tree = JSON.parse(hdr.toString('utf8', 8, 8 + jsonLen))
    let node = tree
    for (const seg of String(innerPath).split('/')) {
      if (!node || !node.files) return null
      node = node.files[seg]
    }
    if (!node || node.files || node.size === undefined) return null
    const size = Number(node.size)
    if (!Number.isFinite(size) || size < 0) return null
    const buf = Buffer.alloc(size)
    if (readFully(fd, buf, 8 + headerSize + Number(node.offset)) !== size) return null
    return buf.toString('utf8')
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        /* 关不掉就算了，进程马上退出 */
      }
    }
  }
}

// ------------------------------------------------------------------ 判定（纯函数）
/**
 * 装机 app.asar 里的 launch id 补丁状态。
 * 两种形态互斥；两种都没找到说明上游改写了启动流程，属于「判不了」，不能猜成安全。
 */
const MAIN_PATCHED_RE = /apiLaunchToken\s*\?\?\s*randomUUID\s*\(/
const MAIN_ORIGINAL_RE = /const\s+launchId\s*=\s*randomUUID\s*\(/

function classifyMain(src) {
  if (typeof src !== 'string' || !src) {
    return { verdict: 'unknown', evidence: '读不到 app.asar 里的 electron/main.cjs（asar 结构不认识？）' }
  }
  const patched = MAIN_PATCHED_RE.test(src)
  const original = MAIN_ORIGINAL_RE.test(src)
  if (patched && !original) {
    return { verdict: 'patched', evidence: 'const launchId = apiLaunchToken ?? randomUUID()' }
  }
  if (original && !patched) {
    return { verdict: 'unpatched', evidence: 'const launchId = randomUUID()' }
  }
  return { verdict: 'unknown', evidence: 'launchId 的两种形态都没找到（上游可能改写了启动流程）' }
}

/**
 * 渲染进程是否仍然把令牌放进出站请求头。这是整个判断的前提：上游哪天改成别的鉴权方式，
 * 探针的结论就不再成立，此时必须说「判不了」而不是继续报安全。
 */
function rendererUsesLaunchHeader(bundleSrc) {
  if (typeof bundleSrc !== 'string' || !bundleSrc) return null
  return bundleSrc.includes('x-freebuff-launch-id')
}

/** 从 orchestrator 日志里取最后一次启动的端口（同一文件可能是追加的多段会话）。 */
function parseOrchestratorPort(text) {
  if (typeof text !== 'string') return null
  const re = /listening on https?:\/\/127\.0\.0\.1:(\d+)/g
  let last = null
  let m
  while ((m = re.exec(text)) !== null) last = Number(m[1])
  return last
}

/**
 * /healthz 的回应说明这个 orchestrator 要不要令牌：LAUNCH_ID 有值而我们没带（也带不对）时
 * 必然 401 "invalid launch id"；返回 200 只可能是 LAUNCH_ID 为空（此时写操作一律放行）。
 */
function classifyHealthResponse(status, body) {
  if (status === 401) return 'token-required'
  if (status === 200 && /^ok$/.test(String(body == null ? '' : body).trim())) return 'open'
  return 'unknown'
}

/**
 * 判定核心。所有证据都是参数，不在这里碰文件系统 / 进程 / 网络，便于自测把判定表钉死。
 *
 * @param {object} input
 *   install   {path, asarPath, uiIndexPath, bundlePath} | null
 *   main      {verdict: 'patched'|'unpatched'|'unknown', evidence}
 *   renderer  true | false | null（true = 仍带 x-freebuff-launch-id）
 *   files     {asar: {path, mtimeMs}|null, ui: {path, mtimeMs}|null}
 *   instances {ok: boolean, reason?: string, list: [{pid, commandLine, startedAtMs}]}
 *   health    [{file, port, state, detail}]
 */
function evaluate(input) {
  const findings = []
  let risk = false
  let unknown = false
  const add = (level, title, detail) => findings.push({ level, title, detail: detail || '' })
  const addRisk = (t, d) => {
    risk = true
    add('risk', t, d)
  }
  const addUnknown = (t, d) => {
    unknown = true
    add('unknown', t, d)
  }

  const { install, main, renderer, files, instances, health } = input

  if (!install) {
    addUnknown('找不到 Freebuff 装机目录', '用 --install <目录> 指定（默认取 %LOCALAPPDATA%/Programs/@codebufffreebuff-desktop）')
    return { risk, unknown, findings, advice: [] }
  }

  // 1) 装机里的补丁
  if (main.verdict === 'patched') {
    add('ok', '装机 app.asar 带 launch id 复用补丁', main.evidence)
  } else if (main.verdict === 'unpatched') {
    addRisk(
      '装机 app.asar 是未打补丁的 main.cjs',
      `${main.evidence} —— 该进程里 orchestrator 崩一次重启就会换新 launch id，` +
        '此后每个写操作都 403 forbidden（打开标签页 / 发消息 / 停止 / 编辑…）',
    )
  } else {
    addUnknown('装机 main.cjs 的补丁状态判不了', main.evidence)
  }

  // 2) 渲染进程前提
  if (renderer === true) {
    add('ok', '渲染进程仍用 x-freebuff-launch-id 鉴权（探针前提成立）', '')
  } else if (renderer === false) {
    addUnknown(
      '渲染进程主 bundle 里没有 x-freebuff-launch-id',
      '上游可能换了鉴权方式：本次结论不再适用，请重新核对 orchestrator 的 401/403 判定',
    )
  } else {
    addUnknown('渲染进程主 bundle 读不到', '无法确认鉴权前提（ui/assets 下的主 bundle 缺失？）')
  }

  // 3) 运行中的实例：加载的是换文件之前那套代码吗
  const list = (instances && instances.list) || []
  if (instances && instances.ok) {
    if (list.length === 0) {
      add('ok', '当前没有 Freebuff 实例在跑', '没有实例就没有缓存了旧令牌的页面')
    }
    for (const p of list) {
      const tag = instanceLabel(p)
      const started = p.startedAtMs
      if (!Number.isFinite(started)) {
        addUnknown(`${tag} 的启动时间读不到`, '拿不到启动时间就没法判断它加载的是不是旧的装机文件')
        continue
      }
      const stale = compareStale(started, files)
      if (stale) {
        addRisk(
          `${tag} 跑的是换文件之前那套代码（混合态）`,
          `它启动于 ${iso(started)}，而 ${path.basename(stale.path)} 写于 ${iso(stale.mtimeMs)}` +
            `（晚 ${Math.round((stale.mtimeMs - started) / 1000)} 秒）——该进程的渲染侧会从磁盘读到新` +
            '文件（界面是中文），主进程还停在旧的 main.cjs；旧的那套若没有 launch id 复用补丁，' +
            'orchestrator 崩一次重启之后每个写操作都会 403',
        )
      } else {
        add('ok', `${tag} 加载的是当前装机文件`, `启动于 ${iso(started)}，不早于装机文件写入时间`)
      }
    }
  } else {
    addUnknown(
      '无法确认当前有没有实例在跑',
      (instances && instances.reason) || '拿不到进程列表（用 --processes <json> 注入）',
    )
  }

  // 4) orchestrator 要不要令牌（事实，不单独构成风险）
  const hs = (health || []).filter(Boolean)
  if (hs.length) {
    for (const h of hs) {
      if (h.state === 'token-required') {
        add('note', `${path.basename(h.file)}（端口 ${h.port}）在强制 launch id`, '这是 403 的必要条件，不是问题本身')
      } else if (h.state === 'open') {
        add('note', `${path.basename(h.file)}（端口 ${h.port}）没设 LAUNCH_ID`, '写操作不会被令牌挡住（本次不是 403 的场景）')
      } else {
        add('note', `${path.basename(h.file)}（端口 ${h.port}）的 /healthz 探不到`, h.detail || '')
      }
    }
  }

  const advice = []
  if (risk) {
    advice.push('彻底退出 Freebuff 再启动（不要只重载窗口：重载只换渲染侧，主进程仍是旧的）')
    advice.push('若现在这个窗口遇到 forbidden：Ctrl+R 重载窗口可临时恢复（新文档会重读令牌）')
    advice.push('重跑本体检确认；仍有风险就 bash build.sh 后 bash apply.sh（先把应用退干净）')
  } else if (unknown) {
    advice.push('证据不足，不要据此认为「没问题」：按上面的 unknown 项补证据后重跑')
  } else {
    advice.push('下次中招时先别重载，把 %APPDATA%\\Freebuff*\\logs\\orchestrator-stderr.log 留一份：')
    advice.push('  里面出现 [restart N] 就等于抓到了「orchestrator 崩溃重启」这个现行')
  }
  return { risk, unknown, findings, advice }
}

/** 进程是否早于装机文件的写入时间（留 MIX_TOLERANCE_MS 容差，避免正常时序误报）。 */
function compareStale(startedAtMs, files) {
  for (const key of ['asar', 'ui']) {
    const f = files && files[key]
    if (f && Number.isFinite(f.mtimeMs) && startedAtMs + MIX_TOLERANCE_MS < f.mtimeMs) return f
  }
  return null
}

function iso(ms) {
  try {
    return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
  } catch {
    return String(ms)
  }
}

/** 多开场景下「哪个窗口」比 PID 好认：命令行里带 Freebuff-slot-N 的就是号位实例。 */
function instanceLabel(p) {
  const cl = String(p.commandLine || '')
  if (!cl) return `PID ${p.pid}（命令行读不到）`
  const m = /Freebuff-slot-(\d+)/.exec(cl)
  if (m) return `PID ${p.pid}（实例 slot-${m[1]}）`
  return `PID ${p.pid}（主实例）`
}

// ------------------------------------------------------------------ 证据收集
function findInstall(explicit) {
  const candidates = []
  if (explicit) candidates.push(explicit)
  else if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, DEFAULT_INSTALL_SUFFIX))
  for (const dir of candidates) {
    const asarPath = path.join(dir, ASAR_REL)
    const uiIndexPath = path.join(dir, UI_INDEX_REL)
    if (!fs.existsSync(asarPath) && !fs.existsSync(uiIndexPath)) continue
    let bundlePath = null
    try {
      const html = fs.readFileSync(uiIndexPath, 'utf8')
      const m = /src="\.\/(assets\/[^"]*\.js)"/.exec(html)
      if (m) bundlePath = path.join(dir, 'resources', 'orchestrator', 'ui', m[1])
    } catch {
      /* 没有 index.html 就没有 bundle，判据各自会报 unknown */
    }
    return { path: dir, asarPath, uiIndexPath, bundlePath }
  }
  return null
}

function mtimeOf(p) {
  try {
    const st = fs.statSync(p)
    return { path: p, mtimeMs: st.mtimeMs }
  } catch {
    return null
  }
}

/**
 * 运行中的 Freebuff 进程。只认顶层进程：Electron 的渲染 / GPU / utility 子进程 exe 路径与主进程
 * 完全一样，靠命令行里的 --type= 区分（与控制器 QueryRunning 同一套判据）。
 * 拿不到就返回 ok:false —— 绝不能把「拿不到」当成「没有实例在跑」。
 */
function collectInstances(injected) {
  if (injected) {
    try {
      const raw = JSON.parse(fs.readFileSync(injected, 'utf8'))
      if (!Array.isArray(raw)) throw new Error('应当是 JSON 数组')
      return {
        ok: true,
        list: raw.map((r) => ({
          pid: r.pid,
          commandLine: r.commandLine || '',
          startedAtMs: r.startedAtMs !== undefined ? Number(r.startedAtMs) : Date.parse(r.startedAt),
        })),
        reason: null,
      }
    } catch (e) {
      return { ok: false, list: [], reason: `--processes ${injected} 读不了：${e.message}` }
    }
  }
  if (process.platform !== 'win32') {
    return { ok: false, list: [], reason: `非 Windows（platform=${process.platform}），拿不到进程列表` }
  }
  const ps = [
    "Get-CimInstance Win32_Process -Filter \"Name='Freebuff.exe'\" | ForEach-Object { " +
      "$s = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }; " +
      "\"$($_.ProcessId)`t$s`t$($_.CommandLine)\" }",
    "Get-WmiObject Win32_Process -Filter \"Name='Freebuff.exe'\" | ForEach-Object { " +
      "$s = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }; " +
      "\"$($_.ProcessId)`t$s`t$($_.CommandLine)\" }",
  ]
  let lastErr = ''
  for (const script of ps) {
    try {
      const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const list = []
      for (const line of out.split(/\r?\n/)) {
        if (!line.trim()) continue
        const [pid, started, ...rest] = line.split('\t')
        const cl = rest.join('\t')
        if (/--type=/.test(cl)) continue // Electron 子进程，不是实例
        list.push({ pid: Number(pid), commandLine: cl, startedAtMs: Date.parse(started) })
      }
      return { ok: true, list, reason: null }
    } catch (e) {
      lastErr = String((e && e.message) || e).split('\n')[0]
    }
  }
  return { ok: false, list: [], reason: `powershell 查询失败：${lastErr || '未知原因'}` }
}

/** 默认扫 %APPDATA% 下主实例与各 slot 的 orchestrator 日志。 */
function defaultLogFiles() {
  const out = []
  const appdata = process.env.APPDATA
  if (!appdata) return out
  let names = []
  try {
    names = fs.readdirSync(appdata).filter((n) => /^Freebuff(-slot-\d+)?$/.test(n))
  } catch {
    return out
  }
  for (const n of names.sort()) {
    const f = path.join(appdata, n, 'logs', 'orchestrator-stderr.log')
    if (fs.existsSync(f)) out.push(f)
  }
  return out
}

function resolveLogFiles(arg) {
  if (!arg) return defaultLogFiles()
  let st = null
  try {
    st = fs.statSync(arg)
  } catch {
    return []
  }
  if (st.isDirectory()) {
    const f = path.join(arg, 'logs', 'orchestrator-stderr.log')
    return fs.existsSync(f) ? [f] : []
  }
  return [arg]
}

async function collectHealth(logFiles) {
  const out = []
  for (const file of logFiles) {
    let port = null
    try {
      port = parseOrchestratorPort(fs.readFileSync(file, 'utf8'))
    } catch {
      port = null
    }
    if (!port) {
      out.push({ file, port: null, state: 'unknown', detail: '日志里没有 "listening on http://127.0.0.1:PORT"' })
      continue
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2000) })
      const body = await res.text()
      out.push({ file, port, state: classifyHealthResponse(res.status, body), detail: `HTTP ${res.status}` })
    } catch (e) {
      out.push({ file, port, state: 'unknown', detail: `连不上（${String((e && e.message) || e).split('\n')[0]}）` })
    }
  }
  return out
}

// ------------------------------------------------------------------ 输出
const MARK = { risk: '✗', unknown: '?', note: '·', ok: '✓' }

function renderReport(input, verdict, meta) {
  const lines = []
  lines.push(`Freebuff「forbidden」体检 —— ${iso(Date.now())}`)
  lines.push(`  装机：${input.install ? input.install.path : '（未找到）'}`)
  if (input.install) {
    for (const key of ['asar', 'ui']) {
      const f = input.files[key]
      lines.push(`  ${key === 'asar' ? 'app.asar' : 'ui/index.html'}：${f ? `${iso(f.mtimeMs)}` : '（缺失）'}`)
    }
    lines.push(`  main.cjs：${input.main.evidence}`)
  }
  if (meta.logFiles.length) lines.push(`  日志：${meta.logFiles.length} 份 orchestrator-stderr.log`)
  lines.push('')
  for (const f of verdict.findings) {
    lines.push(`${MARK[f.level]} ${f.title}`)
    if (f.detail) lines.push(`    ${f.detail}`)
  }
  lines.push('')
  if (verdict.risk) lines.push('结论：✗ 存在会触发 403 forbidden 的条件（见上）。')
  else if (verdict.unknown) lines.push('结论：? 判不了（证据不足，不等于正常）。')
  else lines.push('结论：✓ 没发现会触发 403 forbidden 的条件。')
  for (const a of verdict.advice) lines.push(`  ${a}`)
  return lines.join('\n')
}

function usage() {
  return [
    '用法：node tools/forbidden_probe.js [选项]',
    '  --install <目录>       装机目录（默认 %LOCALAPPDATA%/Programs/@codebufffreebuff-desktop）',
    '  --processes <json>     注入进程列表：[{pid, startedAt, commandLine}, …]',
    '  --logs <文件|目录>     orchestrator 日志（默认扫 %APPDATA%/Freebuff*/logs/）',
    '  --no-http              不发 /healthz 请求',
    '  --json                 结构化输出',
    '  --help                 显示本说明',
    '',
    '退出码：0 = 没发现风险；1 = 有确凿风险；2 = 判不了（证据不足或用法错误）。',
  ].join('\n')
}

function parseArgs(argv) {
  const opts = { install: null, processes: null, logs: null, http: true, json: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') opts.help = true
    else if (a === '--json') opts.json = true
    else if (a === '--no-http') opts.http = false
    else if (a === '--install' || a === '--processes' || a === '--logs') {
      const v = argv[++i]
      if (v === undefined) {
        opts.error = `${a} 缺少参数值`
        return opts
      }
      if (a === '--install') opts.install = v
      if (a === '--processes') opts.processes = v
      if (a === '--logs') opts.logs = v
    } else {
      opts.error = `未知参数：${a}`
      return opts
    }
  }
  return opts
}

async function collect(opts) {
  const install = findInstall(opts.install)
  const instances = collectInstances(opts.processes)
  const files = {
    asar: install ? mtimeOf(install.asarPath) : null,
    ui: install ? mtimeOf(install.uiIndexPath) : null,
  }
  const main = classifyMain(install ? readAsarEntry(install.asarPath, MAIN_ENTRY) : null)
  const renderer = install
    ? rendererUsesLaunchHeader(install.bundlePath ? safeRead(install.bundlePath) : null)
    : null
  const logFiles = resolveLogFiles(opts.logs)
  const health = opts.http ? await collectHealth(logFiles) : []
  return { install, main, renderer, files, instances, health, logFiles }
}

function safeRead(p) {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(usage())
    process.exit(0)
  }
  if (opts.error) {
    console.error(`ERROR: ${opts.error}\n\n${usage()}`)
    process.exit(2)
  }
  const input = await collect(opts)
  const verdict = evaluate(input)
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          install: input.install ? input.install.path : null,
          main: input.main,
          rendererUsesLaunchHeader: input.renderer,
          instances: input.instances,
          files: input.files,
          health: input.health,
          risk: verdict.risk,
          unknown: verdict.unknown,
          findings: verdict.findings,
          advice: verdict.advice,
        },
        null,
        2,
      ),
    )
  } else {
    console.log(renderReport(input, verdict, { logFiles: input.logFiles }))
  }
  process.exit(verdict.risk ? 1 : verdict.unknown ? 2 : 0)
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`ERROR: ${(e && e.stack) || e}`)
    process.exit(2)
  })
}

module.exports = {
  readAsarEntry,
  classifyMain,
  rendererUsesLaunchHeader,
  parseOrchestratorPort,
  classifyHealthResponse,
  compareStale,
  evaluate,
  findInstall,
  collectInstances,
  resolveLogFiles,
  parseArgs,
  MIX_TOLERANCE_MS,
}
