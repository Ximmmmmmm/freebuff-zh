#!/usr/bin/env node
// compaction_tweak.js 自测（纯合成夹具，CI 可跑；**从不碰真装机**——每个用例都带 --file）。
//
// 为什么需要它：这个工具改的是**装机里的** orchestrator.js，而这份 bundle 每次上游更新都会被整体
// 替换。于是最要紧的三件事都不容易用眼睛看出来——
//   a) 锚点还在不在（上游改名 / 重排 / 换成多份实现时，必须报错而不是改错地方）；
//   b) 改了以后这份文件还是不是合法 ESM、那个函数还跑不跑得出新阈值（改坏了装机就起不来）；
//   c) 能不能**逐字节还原**（备份是不是真原件、记录失效时（上游更新过）会不会拿旧备份把
//      orchestrator 降级）。
// 这里把这三条连同退出码契约一起钉住。真装机上的实际改动只由人手跑，自测不碰。
//
// 用法：node tools/test_compaction_tweak.js        # 退出码非 0 表示回归
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const TOOL = path.join(__dirname, 'compaction_tweak.js')
const WORK = path.join(__dirname, '..', 'work', 'test-compaction-tweak')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

let fail = 0
const chk = (cond, label, detail) => {
  if (cond) console.log(`  ok  ${label}`)
  else {
    console.log(`  FAIL ${label}`)
    if (detail) console.log(`      ${String(detail).trim().split('\n').slice(0, 6).join('\n      ')}`)
    fail++
  }
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const sha = (p) => sha256(fs.readFileSync(p))

// 假装机目录：布局与真装机同源（<root>/Programs/@codebufffreebuff-desktop/resources/orchestrator/）
const FAKE_ROOT = path.join(WORK, 'fake-localappdata')
const FAKE_ORCH_DIR = path.join(FAKE_ROOT, 'Programs', '@codebufffreebuff-desktop', 'resources', 'orchestrator')
fs.mkdirSync(FAKE_ORCH_DIR, { recursive: true })
const FAKE_ORCH = path.join(FAKE_ORCH_DIR, 'orchestrator.js')

// 夹具：一段「像上游那样」的 bundle（含那个函数 + 前后无关代码）
const ANCHOR_BODY = [
  'function modelCompactionThreshold(maxContextLength) {',
  '  return Math.floor(maxContextLength * 0.8);',
  '}',
].join('\n')
const fixture = (head = 'var OTHER = 1;') =>
  ['// fake orchestrator bundle', head, ANCHOR_BODY, 'function anything() { return modelCompactionThreshold(400000) }', 'export { anything }', ''].join('\n')

const TARGET = path.join(WORK, 'orch.js')
const ORIGINAL = fixture()
fs.writeFileSync(TARGET, ORIGINAL)
const ORIG_SHA = sha(TARGET)
const REC = TARGET + '.hanhua-tweak.json'
const backups = () => fs.readdirSync(WORK).filter((n) => n.startsWith('orch.js.bak-hanhua-')).sort()
const readRec = () => JSON.parse(fs.readFileSync(REC, 'utf8'))

const run = (args, extraEnv = {}) => {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', env: { ...process.env, ...extraEnv } })
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') }
}
const withFile = (args) => run(['--file', TARGET, ...args])
const diag = (r) => `rc=${r.code} | ${(r.out + r.err).trim().split('\n').slice(0, 4).join(' / ')}`
// 从文件里把那个函数取出来实跑（证明「装到磁盘上的那份真的算得出新阈值」）
const thresholdOf = (p) => {
  const m = /function modelCompactionThreshold\(maxContextLength\) \{\n[\s\S]{0,600}?return Math\.floor\(maxContextLength \* ([0-9.]+)\);\n\}/.exec(
    fs.readFileSync(p, 'utf8')
  )
  if (!m) throw new Error('夹具里取不到函数：' + p)
  return (w) => Math.floor(w * Number(m[1]))
}

// --- 1) 原样状态 -----------------------------------------------------------------
console.log('1) 原样状态：说得清「现在是上游原值」')
{
  const r = withFile(['status'])
  chk(r.code === 0, `status rc=0（实际 ${r.code}）`, diag(r))
  chk(/压缩阈值系数 0\.8/.test(r.out), 'status 报出系数 0.8')
  chk(/（上游原样）/.test(r.out), 'status 标明这是上游原样（不是自己改过的）')
  chk(/压缩时机 320K/.test(r.out), 'status 顺手算出界面上的「压缩时机 320K」', r.out)
  chk(!fs.existsSync(REC) && !backups().length, 'status 不写记录、不做备份')
  chk(sha(TARGET) === ORIG_SHA, 'status 不改动文件')
}

// --- 2) apply：备份 + 记录 + 双校验 -------------------------------------------------
console.log('\n2) apply：备份原件、写下记录、两道校验')
{
  const r = withFile(['apply'])
  chk(r.code === 0, `apply rc=0（实际 ${r.code}）`, diag(r))
  chk(/压缩阈值系数 0\.8 → 0\.9/.test(r.out), '报告里写清 0.8 → 0.9', r.out)
  chk(/320000 → 360000/.test(r.out) && /225000/.test(r.out), '报告里给出两档前后阈值（320000→360000 / 200000→225000）', r.out)
  chk(/ESM 语法 ✓ \/ 算术 ✓/.test(r.out), '两道校验都报通过', r.out)
  chk(/重启 Freebuff 才生效/.test(r.out), '提醒重启才生效', r.out)
  chk(fs.readFileSync(TARGET, 'utf8').includes('Math.floor(maxContextLength * 0.9)'), '文件里系数已改成 0.9')
  chk(fs.readFileSync(TARGET, 'utf8').includes('HANHUA 本机实验'), '文件里留了可还原的标记注释')
  chk(backups().length === 1, `做了 1 份备份（实际 ${backups().length}）`, backups().join(','))
  const bk = path.join(WORK, backups()[0])
  chk(sha(bk) === ORIG_SHA, '备份就是原件（逐字节相同）')
  chk(fs.existsSync(REC), '写了状态文件')
  const rec = readRec()
  chk(rec.originalFactor === '0.8' && rec.factor === '0.9', '记录里 0.8 → 0.9', JSON.stringify(rec))
  chk(rec.beforeSha256 === ORIG_SHA, '记录里的 beforeSha256 等于原件哈希')
  chk(rec.afterSha256 === sha(TARGET), '记录里的 afterSha256 等于改后文件哈希')
  chk(rec.backup === backups()[0], '记录指向那份备份')
  chk(thresholdOf(TARGET)(400000) === 360000 && thresholdOf(TARGET)(250000) === 225000, '从磁盘上那份文件取函数实跑：400000→360000、250000→225000')
}

// --- 3) 幂等与换系数 ---------------------------------------------------------------
console.log('\n3) 幂等与换系数：不重复备份，备份永远是原件')
{
  const before = sha(TARGET)
  const r = withFile(['apply'])
  chk(r.code === 0 && /已经是 0\.9/.test(r.out), '再 apply 一次：认得出「已经是 0.9」并 rc 0', diag(r))
  chk(sha(TARGET) === before && backups().length === 1, '幂等：文件没变、也没多出备份')
  const r2 = withFile(['apply', '--factor', '0.7'])
  chk(r2.code === 0, `换系数 apply rc=0（实际 ${r2.code}）`, diag(r2))
  const rec = readRec()
  chk(rec.factor === '0.7' && rec.originalFactor === '0.8', '记录跟上了新系数，但原件系数仍是 0.8', JSON.stringify(rec))
  chk(backups().length === 1 && sha(path.join(WORK, backups()[0])) === ORIG_SHA, '没多出备份，且那份备份仍是原件', backups().join(','))
  chk(thresholdOf(TARGET)(400000) === 280000, '磁盘上算出的是 0.7 档（400000→280000）')
  const r3 = withFile(['apply', '--factor', '0.7'])
  chk(r3.code === 0 && /已经是 0\.7/.test(r3.out), '同一系数再来一次：幂等 rc 0', diag(r3))
  const beforeAsk = sha(TARGET)
  const r4 = withFile(['apply', '--factor', '0.8'])
  chk(r4.code === 0 && /就是上游原值/.test(r4.out) && /restore/.test(r4.out), '要求改回上游原值时：指回 restore（不把文件改成带标记的那种形态）', diag(r4))
  chk(sha(TARGET) === beforeAsk && readRec().factor === '0.7', '这条「无需改动」没偷偷改文件（记录仍是 0.7）')
}

// --- 4) restore：逐字节还原 ---------------------------------------------------------
console.log('\n4) restore：逐字节还原 + 清掉记录与备份')
{
  const r = withFile(['restore'])
  chk(r.code === 0, `restore rc=0（实际 ${r.code}）`, diag(r))
  chk(sha(TARGET) === ORIG_SHA, '还原后与最初逐字节一致')
  chk(/逐字节一致/.test(r.out), '报告里点明逐字节一致', r.out)
  chk(!fs.existsSync(REC) && !backups().length, '记录与备份都被清掉')
  const r2 = withFile(['restore'])
  chk(r2.code === 1 && /没有状态文件/.test(r2.err), '再 restore 一次：没有记录 → rc 1 并说清楚', diag(r2))
  chk(sha(TARGET) === ORIG_SHA, '这条失败没动文件')
}

// --- 5) 上游改写：锚点不对就报错，绝不改错地方 -----------------------------------------
console.log('\n5) 上游改写：锚点不匹配必须报错且不动文件')
{
  const renamed = path.join(WORK, 'orch-renamed.js')
  fs.writeFileSync(renamed, fixture('var OTHER = 1;').replace(/modelCompactionThreshold/g, 'compactionThresholdForModel'))
  const r = run(['--file', renamed, 'apply'])
  chk(r.code === 1 && /出现 0 处/.test(r.err), '函数被改名 → rc 1 且点名「出现 0 处」', diag(r))
  chk(fs.readFileSync(renamed, 'utf8').includes('compactionThresholdForModel'), '这份文件没被改动')
  chk(!fs.existsSync(renamed + '.hanhua-tweak.json') && !fs.readdirSync(WORK).some((n) => n.startsWith('orch-renamed.js.bak-hanhua-')), '失败时不留下备份/记录')

  const twice = path.join(WORK, 'orch-twice.js')
  fs.writeFileSync(twice, fixture('var OTHER = 1;\n' + ANCHOR_BODY))
  const r2 = run(['--file', twice, 'apply'])
  chk(r2.code === 1 && /出现 2 处/.test(r2.err), '函数出现两份 → rc 1 且点名「出现 2 处」', diag(r2))

  const odd = path.join(WORK, 'orch-odd.js')
  fs.writeFileSync(odd, fixture().replace('Math.floor(maxContextLength * 0.8)', 'computeBudget(maxContextLength)'))
  const r3 = run(['--file', odd, 'apply'])
  chk(r3.code === 1 && /函数体与锚点不符/.test(r3.err), '函数头在但写法变了 → rc 1 且说清取不到系数', diag(r3))

  const r4 = run(['--file', path.join(WORK, 'orch-renamed.js'), 'status'])
  chk(r4.code === 1 && /取不到 modelCompactionThreshold/.test(r4.out), 'status 在上游改写时也给出 rc 1 与说明', diag(r4))
}

// --- 6) 记录失效（上游更新过之后）-----------------------------------------------------
console.log('\n6) 上游更新过之后：不许拿旧备份把 orchestrator 降级')
{
  chk(withFile(['apply']).code === 0, '先重新 apply 一次（此时是干净原件）')
  const patched = sha(TARGET)
  fs.appendFileSync(TARGET, '\n// 模拟上游更新：整个文件被替换成新版\n')
  const updated = sha(TARGET)
  const r = withFile(['restore'])
  chk(r.code === 1 && /不是本工具改过的那一份/.test(r.err), 'restore 拒绝：当前文件已不是它改过的那份', diag(r))
  chk(sha(TARGET) === updated, '这条失败没动文件')
  const r2 = withFile(['apply', '--factor', '0.85'])
  chk(r2.code === 0, `更新后重新 apply rc=0（实际 ${r2.code}）`, diag(r2))
  const rec = readRec()
  chk(rec.factor === '0.85' && rec.originalFactor === '0.9', '新一轮的原件是更新后的那份（0.9 → 0.85）', JSON.stringify(rec))
  chk(backups().length === 2, `新建了一份备份（实际 ${backups().length} 份）`, backups().join(','))
  chk(sha(path.join(WORK, rec.backup)) === updated, '新备份就是更新后的那份文件')
  const r3 = withFile(['restore'])
  chk(r3.code === 0 && sha(TARGET) === updated, 'restore 把更新后的那份还原回来（不是更老的 patched 版）')
  chk(sha(TARGET) !== patched, '确实没有退回更早的那份（避免降级）')
}

// --- 7) 参数与退出码 ----------------------------------------------------------------
console.log('\n7) 参数与退出码')
{
  chk(withFile(['--factor', '1.5', 'apply']).code === 2, '--factor 1.5 → rc 2')
  chk(withFile(['apply', '--factor', '0']).code === 2, '--factor 0 → rc 2')
  chk(withFile(['apply', '--factor', 'abc']).code === 2, '--factor abc → rc 2')
  chk(withFile(['wat']).code === 2, '未知子命令 → rc 2')
  chk(withFile(['apply', '--bad']).code === 2, '未知参数 → rc 2')
  chk(run(['--file']).code === 2, '--file 缺值 → rc 2')
  chk(run(['--file', path.join(WORK, 'nope.js'), 'status']).code === 2, '目标不存在 → rc 2')
  const h = run(['--help'])
  chk(h.code === 0 && /apply/.test(h.out) && /restore/.test(h.out), '--help rc=0 且列出 apply / restore', diag(h))
  chk(/不在汉化包范围内/.test(h.out), '用法里说清「不在汉化包范围内」（免得被当成汉化的一部分）', h.out)
}

// --- 8) 默认路径解析：真装机布局 ------------------------------------------------------
console.log('\n8) 默认路径解析（用假 LOCALAPPDATA，仍不碰真装机）')
{
  fs.writeFileSync(FAKE_ORCH, ORIGINAL)
  const targetBefore = sha(TARGET) // 上一组结束时的状态：还原成了「更新后」那份，不是 ORIG_SHA
  const r = run(['status'], { LOCALAPPDATA: FAKE_ROOT })
  chk(r.code === 0, `不传 --file 时能按装机布局找到（rc=${r.code}）`, diag(r))
  chk(/压缩阈值系数 0\.8/.test(r.out), '找到的就是那份夹具', r.out)
  chk(/APP|AppData|fake-localappdata/i.test(r.out), '报告里给出了找到的位置', r.out)
  const r2 = run(['apply'], { LOCALAPPDATA: FAKE_ROOT })
  chk(
    r2.code === 0 && sha(TARGET) === targetBefore && fs.readFileSync(FAKE_ORCH, 'utf8').includes('* 0.9'),
    '按默认路径 apply 改的是那份夹具，别的文件都没动',
    diag(r2)
  )
  const r3 = run(['restore'], { LOCALAPPDATA: FAKE_ROOT })
  chk(r3.code === 0 && sha(FAKE_ORCH) === ORIG_SHA, '夹具也能还原回原件')
}

// --- 9) 真仓库里那份装机是否还在（只读，不改）-------------------------------------------
console.log('\n9) 只读回放：本机真装机（CI 上没有就跳过）')
{
  const real = path.join(process.env.LOCALAPPDATA || '', 'Programs', '@codebufffreebuff-desktop', 'resources', 'orchestrator', 'orchestrator.js')
  if (!fs.existsSync(real)) {
    console.log('  --  本机没有装机目录，跳过（CI 上属正常）')
  } else {
    const r = run(['status'], { LOCALAPPDATA: process.env.LOCALAPPDATA }) // 只读：绝不 apply 真装机
    chk(r.code === 0, `真装机上 status rc=0（实际 ${r.code}）`, diag(r))
    chk(/压缩阈值系数 [0-9.]+/.test(r.out), '报出了那份装机当前的系数', r.out)
  }
}

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过')
process.exit(fail ? 1 : 0)
