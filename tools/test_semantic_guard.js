#!/usr/bin/env node
// semantic_guard 自测（纯合成夹具，CI 可跑）。
//
// 为什么需要它：0.0.155 上游新加了带裸引号 / 反引号的正则字面量
// （`var XG=/[\n"\\]/g`），而扫描器只走引号 / 模板——从正则体里那个引号起，
// 引号配对整体错位，此后 2600 字符的代码被判成「一个字面量」，审计把该段里的中文
// （Freebucks 定价）报成「API 参数里出现中文」，postbuild 直接中止构建（假阳性）。
// 修复给扫描器加了正则字面量的词法，这里把三个方向钉住：
//   1) 正则体内的引号 / 反引号 / 花括号不再带偏配对（含转义、字符类、flags、
//      模板 ${} 内部、关键字后的无空格写法）；
//   2) 除号不会被误当正则——判错这个方向就会吞掉后面的真命中（漏报）；
//   3) 真·语义位置的中文一条都不许漏（createEvent / includes / 比较 / 枚举赋值 /
//      semantic property / platform API）。
//
// 最后有一条可选回放：本机有 output/ui（刚构建过）时对真实产物跑一遍，断言 0 命中
// ——合成夹具只能证词法，真实产物能证「这次事故不再发生」。CI 上没有产物，跳过并出声。
//
// 用法：node tools/test_semantic_guard.js        # 退出码非 0 表示回归
'use strict'

const fs = require('fs')
const path = require('path')

const { findUnsafeMatches, isRegexStart, skipRegex } = require('./semantic_guard.js')

let fail = 0
const chk = (cond, label) => {
  if (cond) console.log(`  ok  ${label}`)
  else { fail++; console.log(`  FAIL ${label}`) }
}

console.log('semantic_guard 自测\n')

// --- 1) 正则字面量不再带偏引号配对 ------------------------------------------------
const clean = [
  ['正则体内的裸双引号（0.0.155 事故原形）', String.raw`var XG=/[\n"\\\\]/g;const s="中文文案";`],
  ['正则体内的引号 + 反引号 + 尖括号', 'var re=/["&\'<>`]/g;const s="中文";'],
  ['正则体内转义的斜杠与星号', String.raw`var re=/["\/\*]/g;const s="中文";`],
  ['除号不是正则', 'const r=a/b;const s="中文";'],
  ['return 后的无空格正则', String.raw`function f(){return /["]/g}const s="中文";`],
  ['模板 ${} 内部的正则（含花括号与引号）', '`${x.replace(/["{}]/g,"")} 中文`'],
  ['模板 ${} 内部的除号', '`${a/b} 中文`'],
  ['正则里没有引号但紧跟真文案', String.raw`var re=/[a-z]+/g;const s="中文";`],
]
console.log('1) 正则 / 除号不应造成假阳性')
for (const [label, src] of clean) {
  const hits = findUnsafeMatches(src)
  chk(hits.length === 0, `${label}（命中 ${hits.length}）`)
}

// --- 2) 真语义位置照旧拦下 --------------------------------------------------------
const caught = [
  ['document.createEvent("中文事件")', 'semantic API argument'],
  ['dataTransfer.types.includes("中文")', 'semantic API argument'],
  ['if(x==="中文")', 'comparison or switch case'],
  ['switch(n){case"中文":break}', 'comparison or switch case'],
  ['t[t.Emphasis=25]="中文"', 'enum member assignment'],
  ['{top:"中文"}', 'semantic property top'],
  ['new URL("中文")', 'platform API argument'],
  ['resolver.configure("中文")', 'semantic API argument'],
]
console.log('2) 真语义位置仍要拦下')
for (const [src, want] of caught) {
  const hits = findUnsafeMatches(src)
  chk(hits.length === 1 && hits[0].reason === want, `${src} → ${hits.map((h) => h.reason).join(',') || '（没报）'}（期望 ${want}）`)
}

// --- 3) 正则与真命中同段：配对要回到正轨 ------------------------------------------
console.log('3) 正则之后紧跟真命中')
{
  const src = String.raw`var XG=/["\\]/g;document.createEvent("中文事件");`
  const hits = findUnsafeMatches(src)
  const at = hitIndex(src)
  chk(hits.length === 1 && hits[0].reason === 'semantic API argument', `正则后真命中仍报出（命中 ${hits.length}）`)
  console.log(`     （命中位置 index=${hits[0] ? hits[0].index : '-'}，即 createEvent 参数处 ${at}）`)
  function hitIndex() { return src.indexOf('"中文事件"') + 1 }
}

// --- 4) 两个帮助函数的边界 --------------------------------------------------------
console.log('4) isRegexStart / skipRegex 边界')
{
  const samples = [
    ['t=/[a]/g', 2, true, '= 后'],
    ['(x,/["]/g', 3, true, '( 与 , 后'],
    ['a / b', 2, false, '标识符后是除号'],
    ['f()/2', 3, false, ') 后是除号'],
    ['arr[0]/2', 6, false, '] 后是除号'],
    ['return /x/', 7, true, 'return 后'],
    ['typeof /x/', 7, true, 'typeof 后'],
    ['foo.return /x/', 11, true, '关键字判据看词尾'],
  ]
  for (const [src, at, want, label] of samples) chk(isRegexStart(src, at) === want, `${label}：isRegexStart(${JSON.stringify(src)}) → ${want}`)
  const skips = [
    [String.raw`/["\\]/g`, true],
    [String.raw`/[/]/g`, true],
    [String.raw`/[a-z]/gim`, true],
    ['/abc', false],
    ['/a\nb/', false],
  ]
  for (const [body, want] of skips) {
    const r = skipRegex(body, 1, body.length)
    chk((r > 0) === want, `${JSON.stringify(body)} → ${want ? '跳到底' : '不当作正则'}（实际 ${r}）`)
  }
}

// --- 5) 可选回放：本机真实产物应为 0 ------------------------------------------------
console.log('5) 真实产物回放（本机有 output/ui 时才跑）')
{
  const dir = path.join(__dirname, '..', 'output', 'ui')
  const html = path.join(dir, 'index.html')
  if (!fs.existsSync(html)) {
    console.log('  （没有 output/ui，跳过——CI 上的正常路径）')
  } else {
    const m = fs.readFileSync(html, 'utf8').match(/src="\.\/(assets\/[^"]+\.js)"/)
    if (!m || !fs.existsSync(path.join(dir, m[1]))) {
      console.log('  （output/ui 里没找到主 bundle，跳过）')
    } else {
      const hits = findUnsafeMatches(fs.readFileSync(path.join(dir, m[1]), 'utf8'))
      chk(hits.length === 0, `产物主 bundle 无代码语义中文字面量（命中 ${hits.length}）`)
      for (const h of hits.slice(0, 3)) console.log(`      - ${h.reason} @${h.index} ${JSON.stringify(h.value).slice(0, 90)}`)
    }
  }
}

console.log(fail ? `\n${fail} 项失败` : '\n全部通过（5 组用例）')
process.exit(fail ? 1 : 0)
