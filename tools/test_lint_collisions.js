#!/usr/bin/env node
// lint_collisions 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 钉住三件事：
//   1. 判据本身：路径参数 / 比较位置 / IPC 通道名 三种「字面量在代码里当值用」的形态必须报；
//   2. 假阳性防线：标识符里的子串（`discordEnabled` 之于词条 `Enabled`）**不能**报——
//      第一版实现就是栽在这儿（用 includes() 全文件扫），实测 2 条假阳性；
//   3. Cookies 形态：`for (const suffix of ['Network/Cookies','Cookies'])` 这种「隔一个变量
//      才被喂进 path.join」的坑，局部规则抓不到，必须至少落进「位置形态=数组元素」的提示里。
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const WORK = path.join(REPO, 'work', 'test-lint-collisions')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

const write = (rel, body) => {
  const p = path.join(WORK, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}

// --- 夹具：一个 mini 主进程 ---------------------------------------------------------
const electronDir = path.join(WORK, 'electron')
fs.mkdirSync(electronDir, { recursive: true })
write(
  'electron/main.cjs',
  [
    // 硬：文件系统调用参数
    "const profile = path.join(root, 'Cookies')", // 目录名，翻掉导入就找不到文件
    "fs.existsSync('Cache')", // 另一处路径形态
    // 硬：比较位置（协议常量）
    'const hidden = kind === "Bare" ? 1 : 0',
    'if (state !== "Wired") return',
    // 硬：IPC 通道名
    "ipcMain.handle('Widget:open', () => 1)",
    // 提示：跨文件复用的标签（这里三种形态各来一个，钉住「位置形态」标注）
    'const label = "Close"',
    "const tabs = ['Filter', 'All']",
    "const mode = { label: 'Mode' }",
    // 假阳性陷阱：标识符**子串**，不是字面量
    'let discordEnabled = true',
    "const note = 'discordEnabled'", // 连字面量里也是子串而非等值
  ].join('\n') + '\n',
)
write(
  'electron/browser-import.cjs',
  [
    // Cookies 形态：数组元素 → 之后被喂给 path.join（隔一个变量，局部规则抓不到）
    "for (const suffix of ['Network/Cookies', 'Cookies']) { void suffix }",
    "for (const suffix of ['Network/Filter', 'Filter']) { void suffix }",
    "const mb = { name: 'Mode' }",
    'const t = "Close"',
  ].join('\n') + '\n',
)
write('electron/README.txt', '不是 .cjs / .html，不该被扫\n')

const dictOf = (body) => {
  const p = path.join(WORK, `dict-${Math.random().toString(36).slice(2, 8)}.json`)
  fs.writeFileSync(p, JSON.stringify(body, null, 2) + '\n')
  return p
}
const HARD = {
  exact: {
    Cookies: 'Cookie 数据',
    Cache: '缓存',
    Bare: '裸',
    Wired: '已接线',
  },
  code: { 'Widget:open': '窗口:打开' },
}
const SOFT = { exact: { Close: '关闭', Enabled: '已启用', Filter: '筛选', Mode: '模式' } }

const run = (args) => {
  try {
    return { code: 0, out: execFileSync('node', [path.join(REPO, 'tools', 'lint_collisions.js'), ...args], { encoding: 'utf8' }) }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}
let fail = 0
const chk = (ok, msg) => {
  console.log((ok ? '  ok  ' : '  FAIL ') + msg)
  if (!ok) fail++
}

// --- 单元：字面量扫描器 -------------------------------------------------------------
const { literals, enclosingCall, posKind } = require(path.join(REPO, 'tools', 'lint_collisions.js'))
const lits = (s) => literals(s).map((x) => x.value)
// 位置形态 / 所在调用都以「引号起点」为坐标（工具的调用方式），测试里用 quote() 取同一坐标
const quote = (s, needle) => s.indexOf(needle)
chk(JSON.stringify(lits('a = "x"; b = \'y\'; c = `z`')) === JSON.stringify(['x', 'y', 'z']), '字面量扫描：双引号 / 单引号 / 模板固定段')
chk(
  lits('t = `${x ? "Collapse" : "Expand"} details`').includes('Collapse') &&
    lits('t = `${x ? "Collapse" : "Expand"} details`').includes('Expand'),
  '字面量扫描：下钻到 ${…} 内部的三元分支',
)
chk(JSON.stringify(lits('s = "a\\"b"')) === JSON.stringify(['a\\"b']), '字面量扫描：转义引号不截断')
const fsCall = 'fs.readFileSync(f, "utf8")'
chk(enclosingCall(fsCall, quote(fsCall, '"utf8"')) === 'fs.readFileSync', '定位所在调用：文件系统调用')
const nested = 'see(path.join(a.getPath("userData"), "Cookies"))'
chk(enclosingCall(nested, quote(nested, '"Cookies"')) === 'path.join', '定位所在调用：跳过内层调用取外层 path.join')
const boundary = 'const a = 1; const b = "x"'
chk(enclosingCall(boundary, quote(boundary, '"x"')) === null, '定位所在调用：语句边界外返回 null')
const keyed = 'filters: [{ name: "Cookies" }]'
chk(posKind(keyed, quote(keyed, '"Cookies"')) === '键值（name: …）', '位置形态：对象键值')
const arr = "for (const s of ['a', 'Cookies'])"
chk(posKind(arr, quote(arr, "'Cookies'")) === '数组元素', '位置形态：数组元素')
const arg = 'f(x, "Cookies")'
chk(posKind(arg, quote(arg, '"Cookies"')) === '调用参数', '位置形态：调用参数')
// 递归扫描必须给出**原文坐标**（enclosingCall 用的是同一个坐标系）
const tmpl = 'const t = `${cond ? "Wired" : "Idle"}`'
const inner = literals(tmpl).find((x) => x.value === 'Wired')
chk(!!inner && enclosingCall(tmpl, inner.start) === null && tmpl[inner.start] === '"', '插值内部的字面量坐标指向原文的引号起点')

// --- 端到端：硬命中必须拦下 ---------------------------------------------------------
const rHard = run(['--electron', electronDir, '--dict', dictOf(HARD)])
chk(rHard.code === 1, `三种硬形态全命中 → rc 1（实际 ${rHard.code}）`)
chk(/文件系统调用参数/.test(rHard.out) && /"Cookies"/.test(rHard.out), '报告 Cookies ← 文件系统调用参数')
chk(/比较位置/.test(rHard.out) && /"Wired"/.test(rHard.out), '报告 Wired ← 比较位置')
chk(/IPC \/ 事件通道名/.test(rHard.out) && /"Widget:open"/.test(rHard.out), '报告 Widget:open ← IPC 通道名')
chk(/\.html/.test(rHard.out) === false, '只扫 .cjs / .html，README.txt 不参与')

// --- 端到端：提示项 + 假阳性 ---------------------------------------------------------
const rSoft = run(['--electron', electronDir, '--dict', dictOf(SOFT)])
chk(rSoft.code === 0, `只有提示项时不拦（实际 rc ${rSoft.code}）`)
chk(/"Close"/.test(rSoft.out), '提示项：跨文件复用的标签列出来')
chk(/"Filter"[^\n]*数组元素/.test(rSoft.out), '提示项带位置形态：数组元素（Cookies 形态的坑靠它提示）')
chk(/"Mode"[^\n]*键值（label: …）/.test(rSoft.out), '提示项带位置形态：对象键值')
chk(!/"Enabled"/.test(rSoft.out), '假阳性防线：标识符子串 discordEnabled 不触发词条 Enabled')

// --- 端到端：干净词典 ---------------------------------------------------------------
const rClean = run(['--electron', electronDir, '--dict', dictOf({ exact: { 'No such text': '无' } })])
chk(rClean.code === 0 && /没有词条被代码占用/.test(rClean.out), '干净词典 → rc 0')

// --- 参数 / 输入契约 ----------------------------------------------------------------
chk(run(['--electron', electronDir, '--dict', path.join(WORK, 'nope.json')]).code === 2, '词典不存在 → rc 2')
chk(run(['--dict', dictOf(SOFT), '--electron', path.join(WORK, 'no-such-dir')]).code === 2, 'electron 目录不存在 → rc 2')
chk(run(['--electron', electronDir, '--dict', dictOf(SOFT), '--bad']).code === 2, '未知参数 → rc 2')
fs.mkdirSync(path.join(WORK, 'empty-dir'), { recursive: true })
chk(run(['--dict', dictOf(SOFT), '--electron', path.join(WORK, 'empty-dir')]).code === 0, 'electron 目录里没有可扫文件 → 跳过并 rc 0')

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
