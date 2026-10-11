#!/usr/bin/env node
// to_lf.js —— 行尾归一（CRLF → LF）批量工具，替代 build 链里的 `find … -exec sed -i 's/\r$//' {} +`
//
// 为什么换掉 sed：build.sh / build_locked.sh 这一步实测 2.5s，几乎全是「几十次进程冷启动」
// 的开销（Windows 上每次 spawn sed ~50-80ms）——而实际工作量是几 MB 文本的字符串替换。
// 换成一个 node 进程一次处理全部文件后 ~0.4s（2026-10-11 实测）。
//
// 与 `sed -i 's/\r$//'` 的等价口径：
//   · 逐行（\n 分隔、末行可无 \n）删掉行尾的单个 \r —— split('\n') 逐段处理，完全一致；
//   · 不含 \r 的文件原样跳过（sed -i 会无谓重写，本工具不动它——内容一致，mtime 更少扰动）；
//   · 行中孤立的 \r（非行尾）不动（与 s/\r$// 同）。
//
// 用法：
//   node tools/to_lf.js <file...>        # 直接给文件列表
//   find … -print0 | xargs -0 -r node tools/to_lf.js --stdin   # 管道模式（--stdin 读 NUL 或换行分隔）
'use strict'
const fs = require('fs')

let files = process.argv.slice(2)
if (files[0] === '--stdin') {
  files = fs
    .readFileSync(0, 'utf8')
    .split(/[\n\0]+/)
    .filter(Boolean)
}

let changed = 0
let skipped = 0
for (const f of files) {
  let text
  try {
    text = fs.readFileSync(f, 'utf8')
  } catch {
    continue
  }
  if (!text.includes('\r')) {
    skipped++
    continue
  }
  const out = text
    .split('\n')
    .map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
    .join('\n')
  if (out !== text) {
    fs.writeFileSync(f, out)
    changed++
  }
}
console.log(`to_lf: ${changed} changed, ${skipped} already LF, ${files.length} files`)
