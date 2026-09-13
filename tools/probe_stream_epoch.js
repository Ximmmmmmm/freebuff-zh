#!/usr/bin/env node
// 「崩溃重启后那条回复永远不结束」的**取证探针**：不依赖任何合成片段，直接从给定 bundle 里
// 把相关纯函数原样抽出来，按事故时序跑一遍，看它到底丢不丢事件。
//
// 为什么要有这个工具：`tools/apply_ui_code_patch.js` 修的是上游渲染进程里的一个缺陷，而
// 「补丁还有没有必要」「补丁真的生效了吗」这两件事，靠哨兵（文本存在性）是答不出来的 ——
// 哨兵只能证明我们插进去了，不能证明插进去的东西真的改变了行为。这里的判据是行为：
//   · 原版 bundle：未打标记的残局必须**丢事件**（缺陷在 ⇒ 补丁必要）；
//   · 产物 bundle：打上标记后必须**不丢**，且未打标记时仍丢（⇒ 补丁既有效又最小，
//     没有把守卫整个拆掉）。
//
// 事故时序（详见 docs/更新维护.md「第五种静默失败」）：崩溃前本地那条回复带着旧的高序号
// （42）还没 done，orchestrator 重启后接着跑但序号从 0 重新计数，服务端快照序号为 3；
// 未打标记时渲染进程的守卫会把它之后 seq=4 的增量连同 finish 一起丢掉。
//
// 用法：
//   node tools/probe_stream_epoch.js <bundle.js> [--expect present|absent]
//     --expect present  原版：缺陷必须复现（rc 0）；不见了 rc 1（上游可能自修，补丁可退场）
//     --expect absent   产物：缺陷必须已消除（rc 0）；还在 rc 1
//     不带 --expect 时只报告，rc 0。
//   抽不到函数（上游结构变了）→ rc 2「无法取证」，调用方（tools/update.sh）只警告不拦。
'use strict'

const fs = require('fs')

// 被抽出来的函数：锚点全部用「属性名 + 字面量 + 结构」，短名字经捕获组（\1 等）原样带回，
// 所以 minifier 改名不影响。结构真被改写时抽不到 → 无法取证，而不是猜。
const ANCHORS = {
  foldParts: [
    /function ([A-Za-z_$][\w$]*)\((\w+),(\w+),(\w+)\)\{switch\(\3\.type\)\{case"text":\{if\(!\3\.text\)return/,
    '增量折叠',
  ],
  foldEvent: [
    /function ([A-Za-z_$][\w$]*)\((\w+),(\w+),(\w+)\)\{var \w+;switch\(\3\.type\)\{case"response_reset":return \2\.length\?\[\]:\2;/,
    '流事件分发',
  ],
  applyEvent: [
    /function ([A-Za-z_$][\w$]*)\((\w+),(\w+),(\w+)\)\{const (\w+)=\2\.length-1,(\w+)=\2\[\5\];if\(!\6\|\|\6\.role!=="assistant"\|\|\6\.done\)/,
    '流事件守卫（缺陷所在）',
  ],
  reconcile: [
    /function ([A-Za-z_$][\w$]*)\((\w+),(\w+)\)\{const (\w+)=\3==null\?void 0:\3\.at\(-1\),(\w+)=\2\.at\(-1\);return/,
    '快照合并（缺陷所在）',
  ],
  closeReasoning: [
    /function ([A-Za-z_$][\w$]*)\((\w+)\)\{const (\w+)=(\w+)\(\2\),(\w+)=\3>=0\?\2\[\3\]:void 0;return/,
    '推理段收尾',
  ],
  lastNonAd: [
    /function ([A-Za-z_$][\w$]*)\((\w+)\)\{let (\w+)=\2\.length-1;for\(;\3>=0&&\2\[\3\]\.kind==="ad";\)\3--;return \3\}/,
    '末尾消息定位',
  ],
  markDone: [
    /function ([A-Za-z_$][\w$]*)\((\w+),(\w+)\)\{let (\w+)=!1;const (\w+)=\2\.map\((\w+)=>\6\.role!=="assistant"\|\|\6\.done\?/,
    '轮次结束标记',
  ],
  replaceAt: [
    /function ([A-Za-z_$][\w$]*)\((\w+),(\w+),(\w+)\)\{const (\w+)=\2\.slice\(\);return \5\[\3\]=\4,\5\}/,
    '按位替换',
  ],
  mapReasoning: [
    /function ([A-Za-z_$][\w$]*)\((\w+),(\w+)\)\{return (\w+)\(\2,\w+=>\w+\.kind==="reasoning"\?\3\(\w+\):\w+\)\}/,
    '推理段映射',
  ],
  mapParts: [
    /function ([A-Za-z_$][\w$]*)\((\w+),(\w+)\)\{let (\w+)=!1;const (\w+)=\2\.map\((\w+)=>\{let (\w+)=\6;if\(\6\.kind==="agent"\)/,
    '部件映射',
  ],
}

// 与 replaceAt 同一实现的箭头声明（bundle 里两种都有，foldParts 引用的是箭头那个）
const ARROW_ANCHOR = /([A-Za-z_$][\w$]*)=\((\w+),(\w+),(\w+)\)=>\{const (\w+)=\2\.slice\(\);return \5\[\3\]=\4,\5\}/

/** 从 bundle 文本里按锚点抽出一个函数的完整源码（按大括号配平截取）。 */
function findFn(src, anchor, label) {
  const m = src.match(anchor)
  if (!m || !m[1]) throw new Error(`抽不到「${label}」的锚点`)
  const name = m[1]
  const start = src.indexOf('function ' + name + '(')
  if (start < 0) throw new Error(`抽不到「${label}」的函数声明`)
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return { name, body: src.slice(start, i + 1) }
    }
  }
  throw new Error(`「${label}」的大括号不配对`)
}

/**
 * 跑一次事故时序。
 * @returns {{rows: Array<{label:string, kept:boolean, delta:boolean, finish:boolean}>}}
 * @throws 抽不到函数时抛错（调用方转成 rc 2）
 */
function probe(src) {
  const fns = {}
  for (const [key, [anchor, label]] of Object.entries(ANCHORS)) {
    fns[key] = findFn(src, anchor, label)
  }
  const arrow = src.match(ARROW_ANCHOR)
  if (!arrow) throw new Error('抽不到按位替换的箭头声明')

  const names = Object.fromEntries(Object.entries(fns).map(([k, v]) => [k, v.name]))
  const decl = [
    ...Object.values(fns).map((f) => f.body),
    'var ' + arrow[1] + '=' + arrow[0].slice(arrow[1].length + 1),
    'var Ec=function(){return "m"+(++__id)}', // bundle 里的 id 生成器，抽出来的函数会引用
  ].join('\n')

  const api = new Function(
    '__id',
    decl + `\nreturn {applyEvent:${names.applyEvent},reconcile:${names.reconcile},foldParts:${names.foldParts}}`,
  )(0)

  const user = { role: 'user', parts: [{ kind: 'text', text: '问题' }], done: true }
  const partial = () => ({
    role: 'assistant',
    parts: [{ kind: 'text', text: '崩溃前的部分回复' }],
    done: false,
    streamSeq: 42, // 崩溃前本地那条回复带着的高序号
  })
  // 服务端快照：新进程的 live.seq 从 0 起，已经发出 seq=1..3 三条增量
  const serverLive = () => {
    let parts = []
    for (let seq = 1; seq <= 3; seq++) parts = api.foldParts(parts, { type: 'text', text: `续${seq}`, id: 'p' }, () => 'p1')
    return [user, { role: 'assistant', parts, done: false, streamSeq: 3 }]
  }

  const row = (label, marked) => {
    const local = partial()
    if (marked) local.streamSeq = -1
    const merged = api.reconcile(serverLive(), [user, local])
    const last = merged[merged.length - 1]
    const kept = last.streamSeq === local.streamSeq && last.parts[0].text === '崩溃前的部分回复'
    const afterDelta = api.applyEvent(merged, { type: 'text', text: '后', id: 'p' }, 4)
    const afterFinish = api.applyEvent(afterDelta, { type: 'finish', metrics: {} }, 10)
    return {
      label,
      kept,
      delta: afterDelta !== merged,
      finish: afterFinish[afterFinish.length - 1].done === true,
    }
  }

  return { rows: [row('未打标记（原版行为）', false), row('打上 -1 标记（补丁行为）', true)] }
}

const yn = (b) => (b ? '是' : '否')

// --- 探针身份与判决：供 tools/ui_patch_status.js 登记、与 postbuild 共用同一份判据 ------ 
// 一个「缺陷」可能对应多条补丁（本缺陷就是三条协同），所以判定放在缺陷这一层，
// 补丁与缺陷的从属关系由 apply_ui_code_patch.js 里每条补丁的 defect 字段声明。
const ID = 'stream-epoch'
const TITLE = '崩溃重启后，被打断的那一轮回复永远不结束'

/**
 * 判决：给 bundle 一个结论，而不是让调用方各自解释两行数据。
 * @returns {{
 *   id: string, title: string,
 *   rows: Array<{label:string, kept:boolean, delta:boolean, finish:boolean}>,
 *   defectPresent: boolean,  // 未打标记时增量与 finish 双双被丢弃 = 缺陷在
 *   patchEffective: boolean,  // 打上标记后不再丢，且未打标记时仍丢 = 补丁有效且最小
 * }}
 * @throws 抽不到函数时抛错（调用方应视为「无法取证」）
 */
function verdict(src) {
  const [plain, marked] = probe(src).rows
  return {
    id: ID,
    title: TITLE,
    rows: [plain, marked],
    defectPresent: !plain.delta && !plain.finish,
    patchEffective: marked.kept && marked.delta && marked.finish && !plain.delta && !plain.finish,
  }
}

function main() {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  const expectIdx = args.indexOf('--expect')
  const expect = expectIdx >= 0 ? args[expectIdx + 1] : null
  if (!file || (expect && !['present', 'absent'].includes(expect))) {
    console.error('usage: node tools/probe_stream_epoch.js <bundle.js> [--expect present|absent]')
    process.exit(2)
  }

  let src
  try {
    src = fs.readFileSync(file, 'utf8')
  } catch (e) {
    console.error(`probe: 无法读取 ${file} —— ${e.message}`)
    process.exit(2)
  }

  let result
  try {
    result = verdict(src)
  } catch (e) {
    // 上游把这段结构改了：拿不到证据就直说，绝不根据「抽不到」去推断缺陷是否还在
    console.error(`probe: 无法取证（${e.message}）—— 上游渲染进程的代码结构已变，需人工核对后再更新本工具的锚点`)
    process.exit(2)
  }

  console.log(`stream-epoch 取证：${file}`)
  for (const r of result.rows) {
    console.log(`  ${r.label.padEnd(22)} 保留本地内容=${yn(r.kept)}  seq=4 增量生效=${yn(r.delta)}  finish 生效=${yn(r.finish)}`)
  }

  const defectPresent = result.defectPresent
  const patchedOk = result.patchEffective

  let verdict
  if (expect === 'present') verdict = defectPresent
  else if (expect === 'absent') verdict = patchedOk
  else verdict = null

  if (verdict === null) {
    console.log(`  结论：缺陷${defectPresent ? '在' : '不在'}；补丁行为${patchedOk ? '有效' : '未达标'}（未指定 --expect，仅报告）`)
    process.exit(0)
  }
  if (verdict) {
    console.log(
      expect === 'present'
        ? '  结论：✓ 缺陷可复现（补丁仍然必要）'
        : '  结论：✓ 缺陷已消除，且守卫仍在（补丁有效且最小）',
    )
    process.exit(0)
  }
  if (expect === 'present') {
    console.log('  结论：✗ 未能复现缺陷 —— 上游可能已自行修复（或改了时序），补丁应当人工确认后移除')
  } else {
    console.log('  结论：✗ 缺陷仍未消除（或守卫被整体拆掉）—— 补丁未按要求生效')
  }
  process.exit(1)
}

if (require.main === module) main()

module.exports = { probe, verdict, ANCHORS, ID, TITLE }
