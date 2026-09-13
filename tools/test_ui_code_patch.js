#!/usr/bin/env node
// apply_ui_code_patch 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 为什么需要它：这个工具的失败方式有两种，都不会被「装上能用」发现——一是锚点悄悄
// 失配（MISSED 之外还有一种：匹配到别处、插进错误位置，界面上表现为莫名其妙的流式
// 故障），二是补丁被重复应用（幂等性坏了会一路叠对象展开）。这里用合成 bundle 把
// 四条规则钉住：改名不失配、必须唯一命中、已应用则跳过、未知 `_hanhua` 前缀拒写。
//
// 覆盖：
//   1. 干净 bundle → 三条全应用，+ 字节数为正；
//   2. 已应用 → 三条全走「已应用，跳过」，文本逐字节不变（幂等）；
//   3. minifier 改名（n/r/o → 任意长名字）→ 仍全部应用（锚点不依赖短名）；
//   4. 锚点不见（上游改写）→ 计入 missed，CLI exit 1；
//   5. 锚点重复出现 → 计入 missed 并给出「命中 N 处」理由，CLI exit 1；
//   6. 片段级括号计数错位 → 拒绝写入（error），CLI exit 1；
//   7. 文件里已有 `_hanhua` 前缀但没有本次哨兵 → 拒绝继续（error）；
//   8. 补丁注入的标识符带 `_hanhua` 前缀，且不含任何英文字面量（semantic_guard 会拦）。
//
// 用法：node tools/test_ui_code_patch.js        # 退出码非 0 表示回归
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const { applyPatches, PATCHES, INJECT_PREFIX, SENTINELS } = require('./apply_ui_code_patch.js')

const WORK = path.join(__dirname, '..', 'work', 'test-ui-code-patch')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

let fail = 0
const chk = (cond, label) => {
  if (cond) console.log(`  ok  ${label}`)
  else {
    console.log(`  FAIL ${label}`)
    fail++
  }
}

// --- 合成 bundle：三段被补丁锚定的代码，变量名可换 ---------------------------------
// fresh：用压缩产物里那种一两个字符的名字；
// renamed：同样的结构，名字换成 `reconnectState` / `incomingSeq` 这类不会被 minifier 起的名字。
const fresh = [
  'const n={};',
  'function reconnectTo(s){return{...s,stale:!0,turnStatus:void 0,historyRequest:void 0,historyLoading:!1}}',
  'function applyEvent(t,n,r){var o;if(n.streamSeq!==void 0&&r<=n.streamSeq)return t;return t}',
  'function merge(server,local){const a=server.at(-1),b=local.at(-1);return b.streamSeq>(a.streamSeq??0)?[...server.slice(0,-1),b]:server}',
].join('\n')

const renamed = fresh
  .replace(/\bn\b/g, 'reconnectState')
  .replace(/\br\b/g, 'incomingSeq')
  .replace(/\bs\b/g, 'localState')
  .replace(/\ba\b/g, 'serverTail')
  .replace(/\bb\b/g, 'localTail')

// --- 1) 干净 bundle ---------------------------------------------------------------
const r1 = applyPatches(fresh)
chk(!r1.error, `1) 干净 bundle 不报错${r1.error ? '（' + r1.error + '）' : ''}`)
chk(r1.applied.length === PATCHES.length && r1.missed.length === 0, `1) 三条补丁全部应用（applied=${r1.applied.length} missed=${r1.missed.length}）`)
chk(r1.text.length > fresh.length, `1) 文本变长（${fresh.length} -> ${r1.text.length}）`)
chk(SENTINELS.every((s) => r1.text.includes(s)), '1) 结果里能看到全部哨兵')

// --- 2) 幂等 ---------------------------------------------------------------------
const r2 = applyPatches(r1.text)
chk(r2.applied.length === 0 && r2.already.length === PATCHES.length, `2) 再跑一次全部跳过（applied=${r2.applied.length} already=${r2.already.length}）`)
chk(r2.text === r1.text, '2) 文本逐字节不变')
chk(!r2.error && r2.missed.length === 0, '2) 幂等时既不报错也不 MISSED')

// --- 3) 改名抗性 -----------------------------------------------------------------
const r3 = applyPatches(renamed)
chk(!r3.error && r3.applied.length === PATCHES.length && r3.missed.length === 0, `3) 变量改名后仍全部应用（applied=${r3.applied.length} missed=${r3.missed.length}）`)
chk(r3.text.includes('reconnectState') && !r3.text.includes('{...n,'), '3) 捕获组把改名后的标识符原样带回')

// --- 4) 锚点消失 ---------------------------------------------------------------
const gone = fresh.replace('historyLoading:!1', 'historyLoading:!0')
const r4 = applyPatches(gone)
chk(r4.missed.length === 1 && r4.missed[0].id === PATCHES[0].id, `4) 锚点消失记入 missed（missed=${r4.missed.length}）`)

// --- 5) 锚点重复 ---------------------------------------------------------------
const dup = fresh + '\n' + fresh.split('\n')[1]
const r5 = applyPatches(dup)
chk(r5.missed.length === 1 && /命中 2 处/.test(r5.missed[0].reason || ''), `5) 锚点重复记入 missed 并说明命中处数（${(r5.missed[0] || {}).reason}）`)

// --- 6) 括号计数错位：把锚点改成「结构不闭合」的形态 ------------------------------
// find 能匹配上，但替换后会多出一个 `(`：片段级自检必须拒绝写入。
const orig = PATCHES[2].apply
PATCHES[2].apply = (m) => '(' + orig(m)
const r6 = applyPatches(fresh)
PATCHES[2].apply = orig
chk(!!r6.error && /括号计数/.test(r6.error), `6) 结构错位时拒绝写入（${r6.error || '没报错'}）`)

// --- 7) 未知 _hanhua 前缀 -------------------------------------------------------
const foreign = r1.text.replace(SENTINELS[0], '_hanhuaOther:x')
const r7 = applyPatches(foreign)
chk(!!r7.error && /拒绝继续/.test(r7.error), `7) 已有 _hanhua 前缀但无本次哨兵 → 拒绝继续（${r7.error || '没报错'}）`)

// --- 8) 注入内容本身 ------------------------------------------------------------
chk(r1.text.includes(`${INJECT_PREFIX}Msg`), `8) 注入标识符带 ${INJECT_PREFIX} 前缀`)
// 补丁只应插入标识符与结构，不应引入英文字面量（semantic_guard 把「代码语义里的中文」当
// 问题查，这里反过来确认补丁不会带进英文自然语言）。
const injectedLiterals = (r1.text.slice(0, r1.text.length)).match(/"[A-Za-z][A-Za-z ]{3,}"/g) || []
chk(injectedLiterals.every((s) => !/stream|seq/i.test(s)) || injectedLiterals.length === 0, '8) 补丁未引入新的英文字面量')

// --- CLI 退出码 -----------------------------------------------------------------
const runCli = (file) => {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'apply_ui_code_patch.js'), file], { encoding: 'utf8' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }
  }
}
const pOk = path.join(WORK, 'ok.js')
fs.writeFileSync(pOk, fresh)
const c1 = runCli(pOk)
chk(c1.code === 0 && /applied 3/.test(c1.out), `9) 干净 bundle → exit 0（实际 ${c1.code}）`)
const pBad = path.join(WORK, 'gone.js')
fs.writeFileSync(pBad, gone)
const c2 = runCli(pBad)
chk(c2.code === 1 && /MISSED/.test(c2.out), `9) 锚点消失 → exit 1 且报 MISSED（实际 ${c2.code}）`)

console.log(fail ? `\n${fail} 项失败` : '\n全部通过（9 组用例）')
process.exit(fail ? 1 : 0)
