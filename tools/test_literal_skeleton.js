#!/usr/bin/env node
// literal_skeleton 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 为什么需要它：这份底层是 remap.js 与 resituate.js **共用**的——两边口径一旦漂移，
// 就会出现「remap 说迁移好了、resituate 说找不到」这类互相矛盾的报告，维护者不敢信任何一个。
// 所以这里既钉住每个函数的行为，也钉住「只有一份实现」这件事本身。
//
// 覆盖：
//   1. parseTemplate：纯文本 / 单插值 / 相邻插值 / 嵌套花括号 / 字符串里的花括号 /
//      嵌套模板 / 末尾半截模板（partial）/ 空串 / 裸 `$`；
//   2. skeletonOf：抹掉三种引号的字符串常量（译文改写内部字符串常量后仍按骨架对齐）；
//   3. idents：跳过字符串字面量内部的名字（与 resituate 的 codeIdents 的关键差别）；
//   4. renameTo：数量一致才改名，对不上返回 null（骨架相同才成立）；
//   5. innerOf / balancedExpr：外壳剥离与括号配平判据（含反引号、超长、负深度）；
//   6. templateRegex：无插值返回 null；三种捕获形态都能命中；半截模板走 TAIL_CAP；
//   7. 共用守卫：remap.js / resituate.js 都 require 这份底层，且各自不再拄一份同名实现。
//
// 用法：node tools/test_literal_skeleton.js        # 退出码非 0 表示回归
'use strict'
const fs = require('fs')
const path = require('path')
const {
  escRe,
  parseTemplate,
  skeletonOf,
  idents,
  renameTo,
  innerOf,
  balancedExpr,
  templateRegex,
  STRICT_CAP,
  BALANCED_CAP,
  LAZY_CAP,
} = require('./literal_skeleton.js')

const REPO = path.join(__dirname, '..')
let fail = 0
const chk = (ok, msg) => {
  console.log((ok ? '  ok  ' : '  FAIL ') + msg)
  if (!ok) fail++
}
const eq = (got, exp, msg) => chk(JSON.stringify(got) === JSON.stringify(exp), `${msg}（得 ${JSON.stringify(got)}）`)
const parts = (s) => parseTemplate(s).map((p) => (p.t === 'lit' ? `L:${p.v}` : p.partial ? `E!${p.v}` : `E:${p.v}`))

// --- 1) parseTemplate -------------------------------------------------------------
eq(parseTemplate('plain text'), [{ t: 'lit', v: 'plain text' }], '纯文本 → 单个 lit')
eq(parseTemplate(''), [], '空串 → 无段')
eq(parseTemplate('$x'), [{ t: 'lit', v: '$x' }], '裸 $（后面不是 {）→ 当普通文本')
eq(parts('a ${x} b'), ['L:a ', 'E:x', 'L: b'], '单插值切成 lit / expr / lit')
eq(parts('${x}${y}'), ['E:x', 'E:y'], '相邻插值各自成段（不吞并）')
eq(parts('a ${ {k:1} } b'), ['L:a ', 'E: {k:1} ', 'L: b'], '嵌套花括号按深度配对')
eq(parts('a ${f("}")} b'), ['L:a ', 'E:f("}")', 'L: b'], '字符串里的 } 不提前收尾')
eq(parts("a ${f('{')} b"), ['L:a ', "E:f('{')", 'L: b'], "单引号里的 { 不加深嵌套")
eq(parts('a ${ `${b}` } c'), ['L:a ', 'E: `${b}` ', 'L: c'], '插值里的嵌套模板整体留在 expr 内')
eq(parseTemplate('tail ${cond?'), [{ t: 'lit', v: 'tail ' }, { t: 'expr', v: 'cond?', partial: true }], '末尾半截模板 → partial 表达式')
eq(parts('a ${x} b ${y?'), ['L:a ', 'E:x', 'L: b ', 'E!y?'], '半截只在末段出现（前面的插值照常闭合）')

// --- 2) skeletonOf ----------------------------------------------------------------
eq(skeletonOf('r.title||"new thread"'), 'r.title||\u0001', '双引号字符串常量被抹成占位')
eq(skeletonOf("a||'x'"), 'a||\u0001', '单引号字符串常量被抹成占位')
eq(skeletonOf('a||`x`'), 'a||\u0001', '反引号字符串常量被抹成占位')
chk(skeletonOf('a||"x"') === skeletonOf('a||"y"'), '不同字符串常量 → 同一骨架（译文改写内部常量仍能对齐）')
chk(skeletonOf('a.b') !== skeletonOf('a.c'), '不同标识符 → 不同骨架')
eq(skeletonOf('esc "a\\"b"'), 'esc \u0001', '带转义引号的字符串整段被抹掉')

// --- 3) idents --------------------------------------------------------------------
eq(idents('A.files.length').map((t) => t.name), ['A', 'files', 'length'], '点号链的标识符按出现顺序收集')
eq(idents('f("A.b")').map((t) => t.name), ['f'], '字符串字面量内部的名字不算标识符')
eq(idents('a`${b}`').map((t) => t.name), ['a'], '反引号模板内部的名字不算（与 codeIdents 的关键差别）')
eq(idents('x').map((t) => [t.start, t.end]), [[0, 1]], 'token 带位置（改名按位置贴回）')
eq(idents('$a_1').map((t) => t.name), ['$a_1'], '$ 与下划线开头的名字也算标识符')

// --- 4) renameTo ------------------------------------------------------------------
eq(renameTo('A.files', ['j', 'files']), 'j.files', '数量一致 → 按位置改名')
chk(renameTo('A.files', ['j']) === null, '数量不一致 → 返回 null（骨架不同，拒绝改名）')
eq(renameTo('A.b.c', ['x', 'y', 'z']), 'x.y.z', '三段链整体改名')
eq(renameTo('"A" + b', ['x']), '"A" + x', '字符串常量里的名字不动，只改标识符')

// --- 5) innerOf / balancedExpr ----------------------------------------------------
eq(innerOf('${a.b}'), 'a.b', '剥掉 ${…} 外壳')
eq(innerOf('a.b'), 'a.b', '没有外壳时原样返回')
eq(innerOf('${a.b'), 'a.b', '半截模板（无收尾花括号）也能剥壳')
chk(balancedExpr('a.b') && balancedExpr('(a)') && balancedExpr('f(")")'), '配平且含引号包裹的括号 → true')
chk(!balancedExpr('(a') && !balancedExpr('a)') && !balancedExpr('{'), '不配平 / 负深度 → false')
chk(!balancedExpr(''), '空串 → false')
chk(!balancedExpr('a`b'), '含反引号 → false（边界可能切错了）')
chk(!balancedExpr('a'.repeat(301)), '超过 300 字符 → false（防止跨插值乱切）')

// --- 6) templateRegex -------------------------------------------------------------
chk(templateRegex('no interpolation') === null, '无插值 → null（调用方该走字面量 / 片段路径）')
chk(templateRegex('a ${x} b').test('var t=`a ${y.z} b`;'), 'strict 形态命中点号链插值')
chk(!templateRegex('a ${x} b').test('var t=`a ${y(`z`)} b`;'), 'strict 不跨反引号（交给更宽的形态）')
chk(templateRegex('a ${x} b', LAZY_CAP).test('var t=`a ${{a:{b:1}}} b`;'), 'lazy 兜底能命中 balanced 跨不过的两层花括号')
chk(!templateRegex('a ${x} b', BALANCED_CAP).test('var t=`a ${{a:{b:1}}} b`;'), 'balanced 只吃一层花括号（两层交给 lazy）')
chk(templateRegex('a ${ {k:1} } b', BALANCED_CAP).test('var t=`a ${ {k:2} } b`;'), 'balanced 命中对象字面量插值')
{
  const re = templateRegex('tail ${cond?')
  chk(re.test('var t=`tail ${a?`;'), '半截模板走 TAIL_CAP，能命中未闭合形态')
  chk(!re.test('var t=`tail ${a} ok`;'), '半截模板不匹配已闭合的形态')
}
eq(escRe('a.b*c'), 'a\\.b\\*c', 'escRe 转义正则元字符')

// --- 7) 共用守卫：口径只有一份 -----------------------------------------------------
const remapSrc = fs.readFileSync(path.join(REPO, 'tools', 'remap.js'), 'utf8')
const resituateSrc = fs.readFileSync(path.join(REPO, 'tools', 'resituate.js'), 'utf8')
chk(/require\(['"]\.\/literal_skeleton\.js['"]\)/.test(remapSrc), 'remap.js require 共用底层')
chk(/require\(['"]\.\/literal_skeleton\.js['"]\)/.test(resituateSrc), 'resituate.js require 共用底层')
chk(!/function parseTemplate/.test(remapSrc), 'remap.js 不再拄一份 parseTemplate（口径漂移的根源）')
chk(!/function parseTemplate/.test(resituateSrc), 'resituate.js 不再拄一份 parseTemplate')
chk(!/function balancedExpr/.test(remapSrc) && !/function balancedExpr/.test(resituateSrc), '两边都不再各自实现 balancedExpr')
chk(!/const skeletonOf =/.test(remapSrc), 'remap.js 不再自己定义 skeletonOf')

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)