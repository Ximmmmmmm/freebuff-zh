#!/usr/bin/env node
// test_apply.js — apply.js 的回归自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 为什么需要它：apply.js 的匹配引擎在 2026-10-11 从「逐条 regex 扫全文」换成了
// Trie 一次扫描 + 重叠回退（主 bundle 单文件 7.5s → 1.4s）。那次是靠「新旧实现全量
// 差分」的一次性脚本验证的（55 个文件逐字节对比）——这里把这类校验固化成常驻用例：
// 多文件入口、--dict 注入、嵌套模板回退、幂等、MISSED 报告的口径全部钉住。
//
// 覆盖：
//   1. exact 基本替换；2. 注释里的命中不替换、也不算 MISSED；3. 转义形态 key；
//   4. template 基本替换；5. 嵌套模板（外层 key 完整包含内层 key 形态）→ 重叠回退
//      路径 + 先外后内级联；6. pattern 只作用在 UI 属性位置；7. 幂等（对已翻译文件
//      再跑 → replaced 0 且不报 MISSED）；8. MISSED 报告（非 quiet 逐条 / quiet 条数）；
//   9. 多文件入口（一次两个文件都写盘、输出逐文件成组）；10. 无参数 usage + rc 非 0。
//
// 用法：node tools/test_apply.js        # 退出码非 0 表示回归
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const APPLY = path.join(__dirname, 'apply.js')
const WORK = path.join(REPO, 'work', 'test-apply')
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

let dictN = 0
const runApply = (dictObj, args) => {
  const dictFile = path.join(WORK, `dict-${++dictN}.json`)
  fs.writeFileSync(dictFile, JSON.stringify(dictObj, null, 2) + '\n')
  const r = spawnSync(process.execPath, [APPLY, ...args, '--dict', dictFile], {
    encoding: 'utf8',
    timeout: 60000,
  })
  return { out: (r.stdout || '') + (r.stderr || ''), status: r.status }
}
const fx = (name, text) => {
  const p = path.join(WORK, name)
  fs.writeFileSync(p, text)
  return p
}
const read = (p) => fs.readFileSync(p, 'utf8')

console.log('== exact ==')
{
  const f = fx('exact.js', 'const a = "Hello world";\n')
  const r = runApply({ exact: { 'Hello world': '你好世界' } }, [f, '--write'])
  chk(read(f) === 'const a = "你好世界";\n', '1) exact 基本替换')
  chk(r.out.includes('replaced 1 occurrences'), '1b) 报告替换计数')
  chk(r.out.includes('all keys matched'), '1c) 全命中不报 MISSED')
}
{
  const src = '// "Hello world"\nconst b = 1;\n'
  const f = fx('comment.js', src)
  const r = runApply({ exact: { 'Hello world': '你好世界' } }, [f, '--write'])
  chk(read(f) === src, '2) 注释里的命中不替换')
  chk(r.out.includes('all keys matched'), '2b) 注释命中不算 MISSED')
}
{
  const f = fx('escape.js', 'x = "Say \\"hi\\" now";\n')
  const r = runApply({ exact: { 'Say \\"hi\\" now': '说 \\"hi\\" 吧' } }, [f, '--write'])
  chk(read(f) === 'x = "说 \\"hi\\" 吧";\n', '3) 转义形态 key（\\" 与 key 同为源码形态）')
  void r
}

console.log('== template ==')
{
  const f = fx('tpl.js', 'const t = `Open ${name}`;\n')
  const r = runApply({ template: { 'Open ${name}': '打开 ${name}' } }, [f, '--write'])
  chk(read(f) === 'const t = `打开 ${name}`;\n', '4) template 基本替换')
  void r
}
{
  const outer = 'Total ${c?`${n} files changed`} done'
  const outerZh = '共 ${c?`${n} files changed`} 完毕'
  const inner = '${n} files changed'
  const innerZh = '${n} 个文件变了'
  const f = fx('tpl-nested.js', 'const s = `Total ${c?`${n} files changed`} done`;\n')
  const r = runApply({ template: { [outer]: outerZh, [inner]: innerZh } }, [f, '--write'])
  chk(read(f) === 'const s = `共 ${c?`${n} 个文件变了`} 完毕`;\n', '5) 嵌套模板：重叠回退 + 先外后内级联')
  chk(r.out.includes('all keys matched'), '5b) 嵌套场景全命中不误报')
}

console.log('== pattern ==')
{
  const f = fx('pattern.js', 'const el = {children:"Delete"};\n')
  const r = runApply({ pattern: { Delete: '删除' } }, [f, '--write'])
  chk(read(f) === 'const el = {children:"删除"};\n', '6) pattern 只作用 UI 属性位置')
  void r
}

console.log('== 幂等 ==')
{
  const src = 'const a = "Hello world"; const el = {children:"Delete"};\n'
  const f = fx('idem.js', src)
  const dict = { exact: { 'Hello world': '你好世界' }, pattern: { Delete: '删除' } }
  const r1 = runApply(dict, [f, '--write'])
  const after1 = read(f)
  const r2 = runApply(dict, [f, '--write'])
  chk(r1.out.includes('replaced 2 occurrences'), '7a) 第一遍替换 2 处')
  chk(after1 === 'const a = "你好世界"; const el = {children:"删除"};\n', '7b) 第一遍内容正确')
  chk(r2.out.includes('replaced 0 occurrences'), '7c) 第二遍不再替换')
  chk(r2.out.includes('all keys matched'), '7d) 第二遍不报 MISSED（幂等）')
  chk(read(f) === after1, '7e) 第二遍不改动文件')
}

console.log('== MISSED ==')
{
  const f = fx('missed.js', 'const z = 1;\n')
  const dict = { exact: { 'Ghost text': '幽灵文本' } }
  const r = runApply(dict, [f, '--write'])
  chk(r.out.includes('MISSED') && r.out.includes('"Ghost text"'), '8) 非 quiet：逐条列出 MISSED')
  const rq = runApply(dict, [f, '--write', '--quiet'])
  chk(rq.out.includes('missed 1 keys'), '8b) quiet：只报条数')
  chk(read(f) === 'const z = 1;\n', '8c) MISSED 不影响写盘')
}

console.log('== 多文件 ==')
{
  const fa = fx('multi-a.js', 'const a = "Hello world";\n')
  const fb = fx('multi-b.js', 'const b = "Hello world";\n')
  const r = runApply({ exact: { 'Hello world': '你好世界' } }, [fa, fb, '--write'])
  chk(read(fa) === 'const a = "你好世界";\n' && read(fb) === 'const b = "你好世界";\n', '9) 多文件入口都处理')
  const n = (r.out.match(/replaced 1 occurrences/g) || []).length
  const w = (r.out.match(/^wrote /gm) || []).length
  chk(n === 2 && w === 2, '9b) 输出逐文件成组（2 份 replaced + 2 份 wrote）')
}

console.log('== 入口 ==')
{
  const r = spawnSync(process.execPath, [APPLY], { encoding: 'utf8', timeout: 30000 })
  chk(r.status !== 0 && ((r.stdout || '') + (r.stderr || '')).includes('usage'), '10) 无参数：usage 且 rc 非 0')
}

console.log()
if (fail) {
  console.log(`FAILED: ${fail} 项未通过`)
  process.exit(1)
}
console.log('全部通过 ✓')
