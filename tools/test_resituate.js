#!/usr/bin/env node
// resituate 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 为什么需要它：resituate 补的是「remap 之后那段人工活」——把够不着本版 bundle 的旧词条
// 在新版原版里找回现形态。它一旦退化，表现是「版本适配时一堆词条被当成死条目删掉」，
// 而 remap 依旧全绿（它只处理 template 分区、只认固定段逐字节还在的情形）。所以这里用
// 合成 bundle 把四种 verdict 与写回行为逐个钉住：
//   1. template RELOCATE：固定段没变、只换了变量名 → 新 key + 同步好的译文，且与 bundle 逐字节一致；
//   2. template CONFIRM：多候选 / 译文无法自动同步 → 绝不猜着写回；
//   3. template GONE：固定段在本版原版里找不到；
//   4. code RELOCATE：片段骨架命中（minifier 只改了标识符名），译文里的名字按位置同步；
//   5. code CONFIRM / GONE：多形态 / 片段整段消失；
//   6. 字面量类（exact / pattern 与无插值的 template）：只给相似度候选，从不自动改写散文；
//   7. MAIN：词典够不着主进程时点名「写进 patches/electron-*.patch」，不当死条目删；
//   8. 半截模板（partial）也能迁移，尾巴与 key 逐字节一致；
//   9. 命中（旧 key 还在 bundle 里）的词条根本不进报告；
//  10. --write / --prune-gone / --json / --prev-ui 的落盘与报告；退出码 0 / 1 / 2。
//
// 用法：node tools/test_resituate.js        # 退出码非 0 表示回归
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const WORK = path.join(REPO, 'work', 'test-resituate')
fs.rmSync(WORK, { recursive: true, force: true })

const write = (rel, body) => {
  const p = path.join(WORK, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}
const pack = (name, bundle) => {
  write(`${name}/ui/index.html`, '<script type="module" crossorigin src="./assets/index-AAA.js"></script>\n')
  write(`${name}/ui/assets/index-AAA.js`, bundle)
  return path.join(WORK, name)
}
const writeDict = (rel, dict) => write(rel, JSON.stringify(dict, null, 2) + '\n')
const readDict = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

// --- 本版原版（cur）：旧形态已不在，只有新形态 ------------------------------------
// template：Hello 只换了变量名；Open 有两份各自改名的拷贝；Vanished 整条消失
// code："Showing" 只换了标识符名；"Step" 有两份形态；"Gone" 整段消失
// 字面量："Already present label" 原样还在（命中，不进报告）；"| Sponsored by" 是
// 「 · Sponsored by 」改写后的新句子（近邻候选）
const CUR = pack(
  'cur',
  'var a=`Hello ${bb.name}, welcome`,b=`Open ${bb.name}`,c=`Open ${cc.title}`,d="Already present label",e="| Sponsored by";' +
    'q("Showing ",j.files.length," of ",j.matches,0);' +
    'q("Step ",b.n," of ",b.total,1);q("Step ",c.n," of ",c.total,1);\n',
)
// 上一版原版（prev）：这些旧 key 逐字节还在（用来验 wasInPrev）；两条不在（更早遗留）
const PREV = pack(
  'prev',
  'var p0=`Hello ${aa.name}, welcome`,p1=`Open ${aa.name}`,p2=`Vanished ${aa.x}`,p3="Already present label",p4=" · Sponsored by ";\n' +
    'q("Showing ",A.files.length," of ",A.matches,0);q("Step ",A.n," of ",A.total,1);q("Gone ",A.x," code ",A.y,1);\n',
)
const curSrc = fs.readFileSync(path.join(CUR, 'ui', 'assets', 'index-AAA.js'), 'utf8')
const EMPTY = path.join(WORK, 'no-bundle')
fs.mkdirSync(EMPTY, { recursive: true })

const matrix = {
  exact: {
    ' · Sponsored by ': ' · 赞助：',
    'Completely gone phrase here': '彻底消失的短语',
    'Already present label': '已存在标签',
    'Legacy dead entry': '更早版本遗留',
  },
  template: {
    'Hello ${aa.name}, welcome': '你好 ${aa.name}，欢迎',
    'Open ${aa.name}': '打开 ${aa.name}',
    'Vanished ${aa.x}': '已消失 ${aa.x}',
  },
  code: {
    '"Showing ",A.files.length," of ",A.matches,': '"显示 ",A.files.length," / ",A.matches,',
    '"Step ",A.n," of ",A.total,': '"第 ",A.n," 步，共 ",A.total,',
    '"Gone ",A.x," code ",A.y,': '"没了 ",A.x," 代码 ",A.y,',
  },
  pattern: {},
}
const matrixDict = writeDict('dict-matrix.json', matrix)

const run = (args) => {
  try {
    return { code: 0, out: execFileSync('node', [path.join(REPO, 'tools', 'resituate.js'), ...args], { encoding: 'utf8' }) }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}
let fail = 0
const chk = (ok, msg) => {
  console.log((ok ? '  ok  ' : '  FAIL ') + msg)
  if (!ok) fail++
}
const count = (re, s) => Number((s.match(re) || [])[1])

// --- 端到端：四种 verdict 的分诊 ---------------------------------------------------
const rowsJson = write('rows.json', '')
const r = run(['--ui', CUR, '--prev-ui', PREV, '--dict', matrixDict, '--json', rowsJson, '--limit', '50'])
const rows = JSON.parse(fs.readFileSync(rowsJson, 'utf8'))
const verdictOf = (key) => (rows.find((x) => x.key === key) || {}).verdict

chk(r.code === 1, `有 CONFIRM / GONE → rc 1（实际 ${r.code}）`)
chk(count(/旧词条 (\d+) 条/, r.out) === 10, '统计：词典共 10 条')
chk(count(/命中 (\d+) · 待定位 (\d+)/, r.out) === 1 && /命中 1 · 待定位 9/.test(r.out), '统计：命中 1（旧 key 还在）· 待定位 9')
chk(/其中 2 条连上一版原版里也没有/.test(r.out), '--prev-ui：点名「连上一版也没有」的 2 条（更早遗留 + 整句消失）')
chk(count(/可自动迁移 (\d+)/, r.out) === 2 && /可自动迁移 2 · 需人工确认 3 · 疑似下线 4/.test(r.out), '小结：迁移 2 / 确认 3 / 下线 4')

chk(!rows.some((x) => x.key === 'Already present label'), '命中（旧 key 还在 bundle 里）的词条不进报告')
chk(verdictOf('Hello ${aa.name}, welcome') === 'RELOCATE', 'template 唯一改名 → RELOCATE')
chk(verdictOf('Open ${aa.name}') === 'CONFIRM', 'template 多候选 → CONFIRM')
chk(verdictOf('Vanished ${aa.x}') === 'GONE', 'template 固定段消失 → GONE')
chk(verdictOf('"Showing ",A.files.length," of ",A.matches,') === 'RELOCATE', 'code 骨架唯一命中 → RELOCATE')
chk(verdictOf('"Step ",A.n," of ",A.total,') === 'CONFIRM', 'code 多形态 → CONFIRM')
chk(verdictOf('"Gone ",A.x," code ",A.y,') === 'GONE', 'code 片段消失 → GONE')
chk(verdictOf(' · Sponsored by ') === 'CONFIRM', '字面量近邻改写 → CONFIRM（不自动写回散文）')
chk(verdictOf('Completely gone phrase here') === 'GONE', '字面量无近邻 → GONE')
chk(verdictOf('Legacy dead entry') === 'GONE', '两边都没有的遗留词条 → GONE')

// 可自动迁移的条目：新 key 必须与 bundle 逐字节一致（落盘自证的前置）
const hello = rows.find((x) => x.key === 'Hello ${aa.name}, welcome')
chk(hello.newKey === 'Hello ${bb.name}, welcome' && curSrc.includes('`' + hello.newKey + '`'), 'template RELOCATE：新 key 与 bundle 逐字节一致')
const showing = rows.find((x) => x.key === '"Showing ",A.files.length," of ",A.matches,')
chk(showing.newKey === '"Showing ",j.files.length," of ",j.matches,' && curSrc.includes(showing.newKey), 'code RELOCATE：新片段就是命中处的源码原文')

// 报告小节与明细
chk(/## 可自动迁移 RELOCATE（2）/.test(r.out), '报告列出 RELOCATE 小节')
chk(/## 需人工确认 CONFIRM（3）/.test(r.out), '报告列出 CONFIRM 小节')
chk(/## 疑似已下线 GONE（4）/.test(r.out), '报告列出 GONE 小节')
chk(/唯一近邻候选/.test(r.out), 'CONFIRM 明细写明「唯一近邻候选，不自动写回」')

// --- --write 落盘：新译文（template 插值改名 / code 标识符改名） ---------------------
const matrixWrite = writeDict('dict-matrix-write.json', matrix)
const rw = run(['--ui', CUR, '--dict', matrixWrite, '--write', '--quiet'])
chk(rw.code === 1, `--write（不带 --prune-gone）：CONFIRM / GONE 仍在 → rc 1（实际 ${rw.code}）`)
const mw = readDict(matrixWrite)
chk(mw.template['Hello ${bb.name}, welcome'] === '你好 ${bb.name}，欢迎', 'template RELOCATE：译文插值随变量名同步')
chk(!Object.prototype.hasOwnProperty.call(mw.template, 'Hello ${aa.name}, welcome'), 'template RELOCATE：旧键已删除')
chk(mw.code['"Showing ",j.files.length," of ",j.matches,'] === '"显示 ",j.files.length," / ",j.matches,', 'code RELOCATE：译文里的标识符按位置改名')
chk(!Object.prototype.hasOwnProperty.call(mw.code, '"Showing ",A.files.length," of ",A.matches,'), 'code RELOCATE：旧片段已删除')
chk(Object.prototype.hasOwnProperty.call(mw.template, 'Open ${aa.name}'), 'CONFIRM 条目原样保留（不猜着写回）')

// --- 半截模板（partial）也能迁移 ---------------------------------------------------
const partialDict = writeDict('dict-partial.json', {
  exact: {},
  template: { 'A ${aa?': '甲 ${aa?' },
  code: {},
  pattern: {},
})
const PARTIAL = pack('partial', 'var t=`A ${bb?`;\n')
const rp = run(['--ui', PARTIAL, '--dict', partialDict, '--write', '--quiet'])
chk(rp.code === 0, `半截模板唯一候选 → --write 后 rc 0（实际 ${rp.code}）`)
const pd = readDict(partialDict).template
chk(Object.prototype.hasOwnProperty.call(pd, 'A ${bb?'), '半截模板迁移到新键（尾巴与 bundle 一致）')
chk(pd['A ${bb?'] === '甲 ${bb?', '半截模板译文尾巴同步（apply.js 不会拼断模板）')
chk(!Object.prototype.hasOwnProperty.call(pd, 'A ${aa?'), '旧半截键已移除')

// --- --write / --prune-gone / 落盘自证 --------------------------------------------
const cleanDict = writeDict('dict-clean.json', {
  exact: {},
  template: { 'Hello ${aa.name}, welcome': '你好 ${aa.name}，欢迎', 'Vanished ${aa.x}': '已消失 ${aa.x}' },
  code: {},
  pattern: {},
})
const before = readDict(cleanDict)
const rcDry = run(['--ui', CUR, '--dict', cleanDict])
chk(rcDry.code === 1 && /ERROR: 1 条旧词条需要人工/.test(rcDry.out), 'dry-run 不改词典：GONE 未删前 rc 1')
chk(JSON.stringify(readDict(cleanDict)) === JSON.stringify(before), 'dry-run 词典文件一个字节都没动')

const rcWrite = run(['--ui', CUR, '--dict', cleanDict, '--write', '--prune-gone'])
chk(rcWrite.code === 0 && /没有需要人工的条目了/.test(rcWrite.out), '--write --prune-gone 后没有需要人工的条目 → rc 0')
chk(/迁移 1 条，删除 1 条/.test(rcWrite.out), '落盘小结给出迁移 / 删除条数')
const after = readDict(cleanDict).template
chk(after['Hello ${bb.name}, welcome'] === '你好 ${bb.name}，欢迎', '写回：新 key + 同步译文')
chk(!Object.prototype.hasOwnProperty.call(after, 'Hello ${aa.name}, welcome'), '写回：旧 key 已删除')
chk(!Object.prototype.hasOwnProperty.call(after, 'Vanished ${aa.x}'), '--prune-gone：GONE 已删除')

// 落盘自证：新 key 必须能在 bundle 里逐字节命中；命不中的会落 GONE，绝不猜着写回
const bogusDict = writeDict('dict-bogus.json', {
  exact: {},
  template: { 'Bogus ${aa.zz}': '伪造 ${aa.zz}' },
  code: {},
  pattern: {},
})
const bogusBefore = fs.readFileSync(bogusDict, 'utf8')
const rb = run(['--ui', CUR, '--dict', bogusDict, '--write'])
chk(rb.code === 1 && /还有 1 条需要人工处理（GONE）/.test(rb.out), '造不出的 key 落 GONE：--write 也拦下（rc 1）')
chk(fs.readFileSync(bogusDict, 'utf8') === bogusBefore, 'GONE 不会被 --write 顺手写坏词典')

// --- MAIN：词典够不着主进程 --------------------------------------------------------
const mainDict = writeDict('dict-main.json', { exact: { 'Native menu item': '原生菜单项' }, template: {}, code: {}, pattern: {} })
const electronDir = path.join(WORK, 'electron')
fs.mkdirSync(electronDir, { recursive: true })
fs.writeFileSync(path.join(electronDir, 'main.cjs'), 'const t="Native menu item";\n')
const rm = run(['--ui', CUR, '--dict', mainDict, '--electron', electronDir])
chk(rm.code === 1, `只在主进程 → rc 1（实际 ${rm.code}）`)
chk(/## 词典够不着主进程 MAIN（1）/.test(rm.out), '报告单列 MAIN 小节')
chk(/patches\/electron-\*\.patch/.test(rm.out), 'MAIN 明细点名写进主进程补丁，而不是当死词条删')
chk(!/## 疑似已下线 GONE/.test(rm.out), '主进程专属条目不会被误判成 GONE')

// --- 参数 / 输入契约 ---------------------------------------------------------------
chk(run(['--dict', matrixDict]).code === 2, '缺 --ui → rc 2')
chk(run(['--ui', path.join(WORK, 'nope'), '--dict', matrixDict]).code === 2, '--ui 路径不存在 → rc 2')
chk(run(['--ui', EMPTY, '--dict', matrixDict]).code === 2, '目录里找不到主 bundle → rc 2')
chk(run(['--ui', CUR, '--dict', path.join(WORK, 'nope.json')]).code === 2, '找不到词典 → rc 2')
chk(run(['--ui', CUR, '--dict', matrixDict, '--bad']).code === 2, '未知参数 → rc 2')

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)