#!/usr/bin/env node
// 本机实验：改 Freebuff 的「压缩时机」系数（`modelCompactionThreshold` 里的 0.8×上下文预算）。
//
// ⚠️ 它改的是装机目录里的 `resources/orchestrator/orchestrator.js`，而这个文件**不在汉化包范围内**：
//    汉化包只装 `app.asar` 与 `orchestrator/ui/`，多开控制器（FreebuffController.exe）也不认第三个
//    文件——所以这个工具**不是**汉化的一部分、不进构建、不进发布，只服务「这台机器」。
//    它改的是**行为**（什么时候自动压缩上下文），不是文案。
//
// 为什么要有它而不是手改一行：上游每次更新都会整体替换 `resources/orchestrator/`，这次的改动必然
// 失效、需要重打。手改每次都要靠眼力（还得先找对地方），而这里是「锚点断言 + 语法校验 + 算术校验 +
// 自动回滚 + 可还原」：改不动就报错，绝不静默改错。
//
// 用法：
//   node tools/compaction_tweak.js status                 # 现在是多少、有没有备份、上游是否改过
//   node tools/compaction_tweak.js apply [--factor 0.9]   # 备份 → 改系数 → 双校验（任一不过自动回滚）
//   node tools/compaction_tweak.js restore                # 用备份还原（会核对当前文件确实是它改过的）
//   node tools/compaction_tweak.js --file <路径> status   # 指向别的安装 / 夹具（自测用）
//
// 退出码：0 成功 / 1 需要人看一眼（锚点不匹配、记录对不上、校验不过）/ 2 用法或环境不对。
//
// 自测：node tools/test_compaction_tweak.js（合成夹具，CI 跑；从不碰真装机）
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

class UsageError extends Error {}
class DataError extends Error {}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const short = (p) => {
  const h = os.homedir()
  return p.startsWith(h) ? '~' + p.slice(h.length) : p
}

// --- 目标文件：装机目录里的 orchestrator.js -----------------------------------------------
// 顺序与 pristine.js 的 installDirs() 同源：Windows 是主战场，mac 常见位置也列上。
function candidates() {
  const home = os.homedir()
  const dirs = []
  if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Programs', '@codebufffreebuff-desktop', 'resources'))
  dirs.push(path.join(home, 'Applications', 'Freebuff.app', 'Contents', 'Resources'))
  dirs.push('/Applications/Freebuff.app/Contents/Resources')
  dirs.push('/opt/Freebuff/resources')
  dirs.push(path.join(home, '.local', 'share', 'freebuff', 'resources'))
  return dirs.map((d) => path.join(d, 'orchestrator', 'orchestrator.js'))
}

function resolveTarget(explicit) {
  if (explicit) return path.resolve(explicit)
  for (const p of candidates()) if (fs.existsSync(p)) return p
  throw new UsageError(
    `找不到装机里的 orchestrator.js。找过这些位置：\n${candidates().map((p) => '  · ' + short(p)).join('\n')}\n` +
      `  装了 Freebuff 但位置不同就显式指定：node tools/compaction_tweak.js --file <路径> status`
  )
}

// --- 锚点：那个函数 ----------------------------------------------------------------
// 上游的原文（0.0.161）：
//   function modelCompactionThreshold(maxContextLength) {
//     return Math.floor(maxContextLength * 0.8);
//   }
// 允许中间夹注释行（我们自己打进去的那条就是注释），系数可带小数。
const FN_RE = /function modelCompactionThreshold\(maxContextLength\) \{\n([\s\S]{0,600}?)return Math\.floor\(maxContextLength \* ([0-9.]+)\);\n\}/

const ANCHOR_HEAD = 'function modelCompactionThreshold(maxContextLength) {'
function anchorCount(text) {
  return text.split(ANCHOR_HEAD).length - 1
}

function readFactor(text) {
  const m = FN_RE.exec(text)
  if (!m) return null
  return { factor: m[2], body: m[0] }
}

function buildFunction(factor, note) {
  return (
    'function modelCompactionThreshold(maxContextLength) {\n' +
    `  // ${note}\n` +
    `  return Math.floor(maxContextLength * ${factor});\n` +
    '}'
  )
}

const MARK = 'HANHUA 本机实验（tools/compaction_tweak.js 可还原）'
const NOTE = `${MARK}：压缩阈值系数原为 %s，现为 %s`

// 状态文件与备份都放在同一个目录里，命名一眼能认出来（都不属于汉化包）
const recordPath = (target) => target + '.hanhua-tweak.json'
const backupsOf = (target) => {
  const dir = path.dirname(target)
  const base = path.basename(target) + '.bak-hanhua-'
  let names = []
  try {
    names = fs.readdirSync(dir).filter((n) => n.startsWith(base))
  } catch {
    /* 目录读不到时当作没有备份 */
  }
  return names.sort().map((n) => path.join(dir, n))
}

function readRecord(target) {
  const f = recordPath(target)
  if (!fs.existsSync(f)) return null
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch (e) {
    throw new DataError(`状态文件读不出来：${f}（${e.message}）——人工看一眼再决定，本工具不动它`)
  }
}

function writeRecord(target, rec) {
  fs.writeFileSync(recordPath(target), JSON.stringify(rec, null, 2) + '\n')
}

// --- 校验：改完既要是合法 ESM，也要真的算得出新阈值 ------------------------------------------
function syntaxCheck(text) {
  const tmp = path.join(os.tmpdir(), `hanhua-orch-${process.pid}.mjs`)
  fs.writeFileSync(tmp, text)
  try {
    // 这份 bundle 是 ESM（用 import.meta.require），按 .cjs 检会假红
    const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' })
    return { ok: r.status === 0, detail: String(r.stderr || '').trim().split('\n').slice(0, 4).join('\n') }
  } finally {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* 临时文件删不掉不影响结论 */
    }
  }
}

function arithmeticCheck(text) {
  const hit = readFactor(text)
  if (!hit) return { ok: false, detail: '改完的文件里取不到 modelCompactionThreshold' }
  let fn
  try {
    fn = new Function(`return (${buildFunction(hit.factor, 'probe')})`)()
  } catch (e) {
    return { ok: false, detail: `取出来的函数跑不起来：${e.message}` }
  }
  return { ok: true, factor: hit.factor, fn }
}

const perK = (n) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))

// --- 子命令 ---------------------------------------------------------------------

function cmdStatus(target, quiet) {
  if (!fs.existsSync(target)) throw new UsageError(`目标不存在：${target}`)
  const text = fs.readFileSync(target, 'utf8')
  const hit = readFactor(text)
  const rec = readRecord(target)
  const baks = backupsOf(target)
  const bytes = Buffer.byteLength(text)
  if (!quiet) {
    console.log(`orchestrator.js ${short(target)}`)
    console.log(`  ${bytes} 字节，sha256 ${sha256(Buffer.from(text)).slice(0, 16)}…`)
  }
  if (!hit) {
    console.log(`  · 取不到 modelCompactionThreshold——上游可能改名/重排了，先人工核对再谈改不改`)
    return 1
  }  const mark = /HANHUA 本机实验/.test(hit.body) ? '（本工具改过）' : '（上游原样）'
  console.log(`  压缩阈值系数 ${hit.factor} ${mark}`)
  for (const w of [400000, 250000]) {
    const n = Math.floor(w * Number(hit.factor))
    console.log(`    maxContextLength=${w} → 阈值 ${n}（界面上的「压缩时机 ${perK(n)}」）`)
  }
  if (rec) {
    const now = sha256(fs.readFileSync(target))
    const same = now === rec.afterSha256
    console.log(
      `  记录：系数 ${rec.originalFactor} → ${rec.factor}，备份 ${path.basename(rec.backup)}` +
        (same ? '（当前文件与记录一致）' : `（当前文件已不是它改过的那份：上游更新过了？还原请先确认）`)
    )
  }
  console.log(`  备份 ${baks.length ? baks.map((b) => path.basename(b)).join(', ') : '无'}`)
  return 0
}

function cmdApply(target, factorArg, quiet) {
  if (!fs.existsSync(target)) throw new UsageError(`目标不存在：${target}`)
  const factor = factorArg === undefined ? '0.9' : String(factorArg)
  if (!/^(0\.[1-9][0-9]?|1(\.0+)?)$/.test(factor)) {
    throw new UsageError(`--factor 只接受 (0,1] 的小数：${factor}（0.9 = 上下文预算的 90%）`)
  }
  const before = fs.readFileSync(target)
  const text = before.toString('utf8')
  const heads = anchorCount(text)
  if (heads !== 1) {
    throw new DataError(
      `在 ${short(target)} 里，${ANCHOR_HEAD} 出现 ${heads} 处（期望恰好 1 处）——` +
        (heads === 0 ? '上游可能改名 / 重排了。' : '形态与预期不同，可能上游改成多份实现。') +
        `\n  本工具不猜：请人工看一眼那个函数还在不在，再决定要不要改（锚点要更新）。`
    )
  }
  const hit = readFactor(text)
  if (!hit) {
    throw new DataError(
      `在 ${short(target)} 里找到了函数头，但函数体与锚点不符（取不到 maxContextLength * <系数>）——\n` +
        `  上游可能改了写法。本工具不猜：人工看一眼再决定（锚点要更新）。`
    )
  }
  const origFactor = hit.factor
  const marked = /HANHUA 本机实验/.test(hit.body)
  // 「要的就是上游原值」不该把文件改成带标记的那种形态：直接指回 restore，逐字节还原。
  const nowRec = readRecord(target)
  if (nowRec && nowRec.afterSha256 === sha256(before) && nowRec.originalFactor === factor && origFactor !== factor) {
    console.log(
      `要的 ${factor} 就是上游原值（备份里那份的系数）——本工具不把文件「改成」原值那种带标记的形态。\n` +
        `  要逐字节回到原值：node tools/compaction_tweak.js restore（备份与记录都在）`
    )
    return 0
  }
  if (origFactor === factor) {
    console.log(
      marked
        ? `已经是 ${factor}（本工具改过的就是这一份），无需改动：${short(target)}`
        : `${short(target)} 本来就是 ${factor}（上游原值），无需改动；要改就换一个系数，如 --factor ${factor === '0.8' ? '0.9' : '0.8'}`
    )
    return 0
  }
  // 备份：优先复用上一次那份「原件」备份（它是真正的原件，且避免反复 apply 堆一地的备份）
  const prev = nowRec
  const beforeSha = sha256(before)
  const prevBackup = prev ? path.join(path.dirname(target), prev.backup) : null
  const reuse = !!(
    prev &&
    prev.afterSha256 === beforeSha &&
    prevBackup &&
    fs.existsSync(prevBackup) &&
    sha256(fs.readFileSync(prevBackup)) === prev.beforeSha256
  )
  const originalFactor = reuse ? prev.originalFactor : origFactor
  const originalSha = reuse ? prev.beforeSha256 : beforeSha
  const originalBytes = reuse ? prev.beforeBytes : before.length
  let backupName
  let backupPath
  if (reuse) {
    backupName = prev.backup
    backupPath = prevBackup
  } else {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) // 20261006153528（UTC，秒级）
    // 同一秒里连打两次会撞名——撞了就往后排号，绝不覆盖上一份备份
    backupPath = `${target}.bak-hanhua-${stamp}`
    for (let n = 2; fs.existsSync(backupPath); n++) backupPath = `${target}.bak-hanhua-${stamp}-${n}`
    backupName = path.basename(backupPath)
    fs.writeFileSync(backupPath, before)
  }
  const after = text.replace(hit.body, buildFunction(factor, NOTE.replace('%s', originalFactor).replace('%s', factor)))
  fs.writeFileSync(target, after, 'utf8')

  // 双校验；任一不过就自动回滚——绝不把坏文件留在装机里
  const syn = syntaxCheck(after)
  const ari = arithmeticCheck(after)
  if (!syn.ok || !ari.ok) {
    fs.writeFileSync(target, before)
    if (!reuse) {
      try {
        fs.rmSync(backupPath, { force: true })
      } catch {
        /* 备份删不掉也不影响结论 */
      }
    }
    throw new DataError(
      `改完没通过校验，已自动回滚（文件已恢复原状）：\n` +
        `  · 语法${syn.ok ? '通过' : `不过：\n${syn.detail}`}\n` +
        `  · 算术${ari.ok ? '通过' : `不过：${ari.detail}`}\n` +
        `  这条说明上游这份 bundle 与锚点预期不同，人工看一眼再决定。`
    )
  }
  const rec = {
    tool: 'tools/compaction_tweak.js',
    note: '本机实验：改的是压缩阈值系数，不属于汉化包；上游更新会整体替换这个文件，重跑一次 apply 即可',
    target,
    originalFactor,
    factor: ari.factor,
    backup: backupName,
    beforeBytes: originalBytes,
    afterBytes: Buffer.byteLength(after),
    beforeSha256: originalSha,
    afterSha256: sha256(Buffer.from(after)),
    appliedAt: new Date().toISOString(),
  }
  writeRecord(target, rec)
  if (!quiet) {
    console.log(`已改：${short(target)}`)
    console.log(`  压缩阈值系数 ${origFactor} → ${ari.factor}${originalFactor !== origFactor ? `（原件系数 ${originalFactor}）` : ''}`)
    for (const w of [400000, 250000]) {
      console.log(`    maxContextLength=${w}：${Math.floor(w * Number(origFactor))} → ${ari.fn(w)}（「压缩时机 ${perK(ari.fn(w))}」）`)
    }
    console.log(`  备份：${backupName}（${rec.beforeBytes} 字节，sha256 ${rec.beforeSha256.slice(0, 16)}…${reuse ? '，沿用上次那份原件' : ''}）`)
    console.log(`  校验：ESM 语法 ✓ / 算术 ✓（任一不过会自动回滚，这次没有）`)
    console.log(`  ⚠️ 重启 Freebuff 才生效（orchestrator 只在启动时读这个文件）；上游更新后要重跑一次 apply`)
    console.log(`  还原：node tools/compaction_tweak.js restore`)
  }
  return 0
}

function cmdRestore(target, quiet) {
  if (!fs.existsSync(target)) throw new UsageError(`目标不存在：${target}`)
  const rec = readRecord(target)
  const baks = backupsOf(target)
  if (!rec) {
    throw new DataError(
      `没有状态文件（${path.basename(recordPath(target))}）：本工具从不改出「没有记录」的产物，所以不猜。\n` +
        (baks.length ? `  目录里有 ${baks.length} 份旧备份，但它属于哪一次改动无从判断——人工看一眼再动手。` : '  目录里也没有备份。')
    )
  }
  const backup = path.join(path.dirname(target), rec.backup)
  if (!fs.existsSync(backup)) throw new DataError(`记录里的备份不在了：${short(backup)}——人工从别处找原件，本工具不动当前文件`)
  const backupBuf = fs.readFileSync(backup)
  if (sha256(backupBuf) !== rec.beforeSha256) {
    throw new DataError(
      `备份内容与记录不符（备份被改动过？）：\n  备份 sha256 ${sha256(backupBuf).slice(0, 16)}…\n  记录 sha256 ${rec.beforeSha256.slice(0, 16)}…\n  拒绝用它覆盖当前文件。`
    )
  }
  const nowBuf = fs.readFileSync(target)
  if (sha256(nowBuf) !== rec.afterSha256) {
    throw new DataError(
      `当前文件不是本工具改过的那一份（上游更新过了？）——拿旧备份覆盖只会把 orchestrator 降级。\n` +
        `  当前 sha256 ${sha256(nowBuf).slice(0, 16)}…\n  记录 sha256 ${rec.afterSha256.slice(0, 16)}…\n` +
        `  上游更新后的正确做法是先跑 apply（它会重新备份新版本再改）；确实要强行还原请人工 cp。`
    )
  }
  fs.writeFileSync(target, backupBuf)
  fs.rmSync(recordPath(target), { force: true })
  try {
    fs.rmSync(backup, { force: true })
  } catch {
    /* 删不掉就留着，反正已经还原了 */
  }
  if (!quiet) {
    console.log(`已还原：${short(target)}`)
    console.log(`  压缩阈值系数回到 ${rec.originalFactor}，sha256 ${rec.beforeSha256.slice(0, 16)}…（与改动前逐字节一致）`)
    console.log(`  记录与备份已清掉；重启 Freebuff 生效`)
  }
  return 0
}

// --- 入口 -----------------------------------------------------------------------

const USAGE = `用法：
  node tools/compaction_tweak.js status                     # 现在是多少、有没有备份、上游是否改过
  node tools/compaction_tweak.js apply [--factor 0.9]       # 备份 → 改系数 → 双校验（不过自动回滚）
  node tools/compaction_tweak.js restore                    # 用备份还原

选项：
  --file <路径>   指定 orchestrator.js（默认找装机目录；自测用）
  --factor <值>   目标系数，默认 0.9（0.8 是上游原值；越大越晚压缩）
  --quiet         只报错，不打印过程

改的是装机目录里的 resources/orchestrator/orchestrator.js——**不在汉化包范围内**，
只服务这台机器；上游更新会整体替换它，更新后重跑一次 apply 即可。`

function main(argv) {
  const flags = { file: null, factor: undefined, quiet: false }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--file') {
      flags.file = argv[++i]
      if (!flags.file) throw new UsageError('--file 后面要跟路径')
    } else if (a === '--factor') {
      flags.factor = argv[++i]
      if (flags.factor === undefined) throw new UsageError('--factor 后面要跟数值')
    } else if (a === '--quiet') flags.quiet = true
    else if (a === '-h' || a === '--help') {
      console.log(USAGE)
      return 0
    } else if (a.startsWith('-')) throw new UsageError(`未知参数：${a}\n${USAGE}`)
    else positional.push(a)
  }
  const cmd = positional[0]
  if (!cmd) throw new UsageError(USAGE)
  const target = resolveTarget(flags.file)
  switch (cmd) {
    case 'status':
      return cmdStatus(target, flags.quiet)
    case 'apply':
      return cmdApply(target, flags.factor, flags.quiet)
    case 'restore':
      return cmdRestore(target, flags.quiet)
    default:
      throw new UsageError(`未知子命令：${cmd}\n${USAGE}`)
  }
}

/* istanbul ignore next */
if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`用法/环境不对：${e.message}`)
      process.exit(2)
    }
    if (e instanceof DataError) {
      console.error(`ERROR: ${e.message}`)
      process.exit(1)
    }
    console.error(`compaction_tweak: 意外错误 ${(e && e.stack) || e}`)
    process.exit(1)
  }
}

module.exports = { FN_RE, ANCHOR_HEAD, anchorCount, readFactor, buildFunction, candidates, resolveTarget, recordPath, backupsOf, perK, MARK }
