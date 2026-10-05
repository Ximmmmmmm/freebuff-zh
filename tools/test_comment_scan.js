#!/usr/bin/env node
// comment_scan / apply.js 注释与取值自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 为什么需要它：apply.js 的注释判定错一次，后果是**静默漏翻**——构建全绿、MISSED 也不报，
// 只有装到机器上肉眼才发现界面上还是英文。0.0.159 就是这么中招的：
//     g.replace(/^refs\/(?:heads|remotes)\//,"")   ← 转义斜杠 \/ 紧接正则收尾的 /  → 假的 //
//     new URL(`http://…`)                          ← 模板字面量里的协议头          → 假的 //
// 一旦误判，该行从那个位置到行尾全被当成注释（主包最长的一行 12.7 万字符），
// 实测 178 条词条一字未翻。所以这里把词法细节和两条取值通道一起钉住。
//
// 覆盖：
//   1. 正则字面量收尾前是 `\/`（`/…\//`）→ 不产生假注释（本次事故的回归用例）；
//   2. 模板字面量里的 `http://` → 不产生假注释；
//   3. 普通字符串里的 `//`（`"a//b"`、`"https://x"`）→ 不是注释；
//   4. 除号（`a / b`）不会被当成正则起点，其后的内容照常扫描；
//   5. 正则字符类里的 `/`（`/[/]/`）不提前收尾；
//   6. 嵌套模板（`${… \`…\` …}`）不吃掉后面的代码；
//   7. 行注释 / 块注释里的英文 → 真的跳过（不能被修成「哪儿都翻」）；
//   8. `children:[…]` 数组里的 JSX 文本节点能被 pattern 采到（数组曾整体停在层级 1）；
//   9. 端到端：这些形态混在一份 fixture 里，跑一遍 apply.js 看结果对不对。
//
// 用法：node tools/test_comment_scan.js        # 退出码非 0 表示回归
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { commentIntervals, commentChecker } = require('./comment_scan.js')

const REPO = path.join(__dirname, '..')
const WORK = path.join(REPO, 'work', 'test-comment-scan')
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

// --- 1~7 词法 -------------------------------------------------------------------
// at 取 `"Settings"` 在 src 里的位置：不在注释里 = false，在注释里 = true
const inComment = (src) => {
  const check = commentChecker()
  const at = src.indexOf('"Settings"')
  if (at < 0) throw new Error('fixture 里没有 "Settings"')
  return check(src, at)
}

console.log('== 词法 ==')
chk(
  inComment('const a = h ? (g = r.sourceRef) == null ? void 0 : g.replace(/^refs\\/(?:heads|remotes)\\//,"") : r.sourceBranch, b = "Settings";') === false,
  '1) 正则收尾前是 \\/（/…\\//）不产生假注释'
)
chk(
  inComment('const u = new URL(`http://127.0.0.1:1/`), b = "Settings";') === false,
  '2) 模板字面量里的 http:// 不是注释'
)
chk(inComment('const p = "a//b", u = "https://x", b = "Settings";') === false, '3) 字符串里的 // 不是注释')
chk(inComment('const x = a / b / c, y = "Settings";') === false, '4) 除号不会引发注释误判')
chk(inComment('const r = /[/]/g, y = "Settings";') === false, '5) 正则字符类里的 / 不提前收尾')
chk(
  inComment('const t = `a${b ? `c${d}d` : e}e`, y = "Settings";') === false,
  '6) 嵌套模板不吃掉其后的代码'
)
chk(inComment('const a = "Settings";') === false, '7a) 普通代码里的字面量不算注释')
chk(inComment('// "Settings"') === true, '7b) 行注释里的字面量算注释')
chk(inComment('/* "Settings" */') === true, '7c) 块注释里的字面量算注释')
chk(inComment('const a = 1; // "Settings"') === true, '7d) 行尾注释里的字面量算注释')
chk(inComment('const u = "https://a//b"; // "Settings"') === true, '7e) 前面有 // 串的字符串不影响行尾注释判定')

// 区间表本身：升序、不重叠
{
  const src = '/* A */ const a = 1; // B\nconst b = 2 // C\n'
  const spans = commentIntervals(src)
  chk(spans.length === 3, `区间数 = 3（实际 ${spans.length}）`)
  chk(
    spans.every(([s, e], i) => s < e && (i === 0 || spans[i - 1][1] <= s)),
    '区间升序且互不重叠'
  )
}

// --- 8~9 端到端：过一遍真的 apply.js ----------------------------------------------
// fixture 里同时放：本次事故的原型行、`children:[…]` 数组、真注释。
// 依赖 dict.json 里的两条词条（exact 的 Settings→设置、pattern 的 "Your "→"你的 "）。
const dict = JSON.parse(fs.readFileSync(path.join(REPO, 'dict.json'), 'utf8'))
const zhSettings = (dict.exact || {}).Settings
const zhYour = (dict.pattern || {})['Your ']
console.log('== 端到端 ==')
if (!zhSettings || !zhYour) {
  console.log('  ! dict.json 里缺 Settings / "Your " 词条，跳过端到端（词法部分已跑）')
} else {
  const fixture = [
    'const a = g.replace(/^refs\\/(?:heads|remotes)\\//,""), b = "Settings";',
    '// "Settings"',
    '/* "Settings" */',
    'd.jsxs("div",{className:"x",children:["Your ",e," ",d.jsx("span",{children:"Settings"})]});',
    '',
  ].join('\n')
  const file = path.join(WORK, 'fixture.js')
  fs.writeFileSync(file, fixture)
  execFileSync(process.execPath, [path.join(__dirname, 'apply.js'), file, '--write'], {
    cwd: REPO,
    stdio: 'pipe',
  })
  const out = fs.readFileSync(file, 'utf8')
  chk(out.includes('b = "' + zhSettings + '"'), '8) 假注释区里的字面量被翻（本次事故的回归）')
  chk(out.includes('children:["' + zhYour + '"'), '9) children:[…] 数组里的文本节点被翻')
  chk(out.includes('// "Settings"'), '10) 行注释保持英文')
  chk(out.includes('/* "Settings" */'), '11) 块注释保持英文')
}

console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过')
process.exit(fail ? 1 : 0)
