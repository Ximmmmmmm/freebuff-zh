#!/usr/bin/env node
// Merge a batch of new translations into hanhua/dict.json.
// For template entries, the EN key is extracted from the bundle itself (matched
// by a distinctive substring) so em-dashes/quotes always match byte-for-byte.
// Usage: node tools/addl10n.js <bundle> [--dry]
const fs = require('fs')
const path = require('path')

const bundle = process.argv[2]
const dry = process.argv.includes('--dry')
const dictPath = path.join(__dirname, '..', 'dict.json')
const src = fs.readFileSync(bundle, 'utf8')

function extractTemplate(needle) {
  const idx = src.indexOf(needle)
  if (idx < 0) throw new Error('needle not found: ' + needle)
  // walk back to opening backtick
  let q = -1
  for (let i = idx; i >= 0; i--) {
    const c = src[i]
    if (c === '`') { q = i; break }
    if (c === '"' || c === "'" || c === ';' || c === '/' || c === '{' || c === '}') break
  }
  if (q < 0 || src[q] !== '`') throw new Error('no backtick before: ' + needle)
  let end = -1
  let i = q + 1
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue }
    if (src[i] === '`') { end = i; break }
    if (src[i] === '$' && src[i + 1] === '{') {
      let depth = 1
      let k = i + 2
      while (k < src.length && depth > 0) {
        if (src[k] === '{') depth++
        else if (src[k] === '}') depth--
        k++
      }
      i = k
      continue
    }
    i++
  }
  if (end < 0) throw new Error('unterminated template: ' + needle)
  return src.slice(q + 1, end)
}

// [needle, translation] — template entries
const templates = [
  ['Actions for ${e}', '对“${e}”的操作'],
  ['all ${f.count} archived threads', '全部 ${f.count} 个已归档会话'],
  ['Branch this thread started from: ${t}', '此会话起始分支：${t}'],
  ['Could not ${ge?"archive":"restore"} that thread: ${ja(Ne)}', '无法${ge?"归档":"恢复"}该会话：${ja(Ne)}'],
  ['Could not ${ge?"pin":"unpin"} that thread: ${ja(Ne)}', '无法${ge?"置顶":"取消置顶"}该会话：${ja(Ne)}'],
  ['Could not delete archived threads: ${ja(ge)}', '无法删除已归档会话：${ja(ge)}'],
  ['Could not delete that thread: ${ja(ge)}', '无法删除该会话：${ja(ge)}'],
  ['Could not load threads: ${ja(G)}', '无法加载会话：${ja(G)}'],
  ['Could not mark that thread handled: ${ja(ge)}', '无法将该会话标记为已处理：${ja(ge)}'],
  ['Could not remove that project: ${ja(ge)}', '无法移除该项目：${ja(ge)}'],
  ['Could not reorder pinned threads: ${ja(Kt)}', '无法对置顶会话重新排序：${ja(Kt)}'],
  ['Deleted ${ge} archived thread${ge===1?"":"s"}', '已删除 ${ge} 个已归档会话'],
  ['Discard ${l.length} unsaved file edits?', '放弃 ${l.length} 个未保存的文件编辑？'],
  ['Edit "${m.title}" before sending', '发送前编辑“${m.title}”'],
  ['${E.label} — won’t be auto-archived', '${E.label} — 不会被自动归档'],
  ['${Ke.overflow} more — keep typing', '还有 ${Ke.overflow} 个 — 继续输入'],
  ['${n.length} attachments', '${n.length} 个附件'],
  ['${n} · ${i}/${e.limit} tab${e.limit===1?"":"s"} in use', '${n} · 已使用 ${i}/${e.limit} 个标签页'],
  ['${u} comment${u===1?"":"s"}', '${u} 条评论'],
  ['Open the stash (${s.length} message${s.length===1?"":"s"})', '打开暂存区（${s.length} 条消息）'],
  ['Project: ${Xi(t)}', '项目：${Xi(t)}'],
  ['Remove comment on ${jQ(ne)}', '删除 ${jQ(ne)} 上的评论'],
  ['Remove terminal context from ${ne.cwd}', '移除 ${ne.cwd} 的终端上下文'],
  ['Removed “${Xi(G)}” — nothing on disk was deleted', '已移除“${Xi(G)}”——未删除磁盘上的任何内容'],
  ['Reorder ${d}', '重新排序 ${d}'],
  ['Selected terminal output (working directory: ${JSON.stringify(r.cwd)}${o}):', '所选终端输出（工作目录：${JSON.stringify(r.cwd)}${o}）：'],
  ['You can add up to ${X2} terminal selections', '最多可添加 ${X2} 个终端选区'],
  ['You can attach up to ${P_} files', '最多可附加 ${P_} 个文件'],
  ['This folder sits inside the repository at ${P} rather than at its root, so isolated workspaces aren’t available. Threads run directly in the folder — open ${P} to get isolated ones.',
    '此文件夹位于仓库 ${P} 内部而非其根目录，因此无法使用隔离工作区。会话直接在文件夹中运行 — 打开 ${P} 即可获得隔离工作区。'],
  ['${cE(t)} sessions', '${cE(t)} 会话'],
  ['${cE(t)} ${Yv(t,e)} today. Each lasts up to 1 hour. Resets ${RX(t)}.', '${cE(t)} ${Yv(t,e)} 今天。每次最长 1 小时。重置时间：${RX(t)}。'],
  ['${Op(t)} ${e==="full"?"高级版":""}session${t===1?"":"s"}', '${Op(t)} ${e==="full"?"高级版":""}次会话'],
  ['${QX(t.cost,e)} · ${$X(t.remainingMs)} left', '${QX(t.cost,e)} · 剩余 ${$X(t.remainingMs)}'],
  ['Used ${QX(n.cost,e)} so far. ${AX(t,e)}', '已使用 ${QX(n.cost,e)}。${AX(t,e)}'],
  ['Out of ${Yv(t,e)} ${PX(t)} · resets in ${Uk(t.resetAt,n)}', '今日 ${Yv(t,e)} 已用完 · ${Uk(t.resetAt,n)} 后重置'],
  ['+${r} session${r===1?"":"s"}/day from referrals', '来自推荐的 +${r} 次会话/天'],
  ['${u} session${u===1?"":"s"} left today', '今日剩余 ${u} 次会话'],
]

// [exact, translation] — double-quoted literals
const exacts = [
  [' Mark handled', ' 标记为已处理'],
  [' Move up', ' 上移'],
  [' Move down', ' 下移'],
  [' Remove from projects', ' 从项目中移除'],
  [' Show Freebuff data', ' 显示 Freebuff 数据'],
  [' Delete all', ' 全部删除'],
  ['sessions for this model', '此模型的会话次数'],
  ['Session ready — sending request…', '会话已就绪 — 正在发送请求…'],
  ['Freebuff is at capacity — retrying…', 'Freebuff 已满载 — 正在重试…'],
  ['Thinking…', '正在思考…'],
  ['Responding…', '正在回复…'],
  ['Working…', '正在工作…'],
  ['Footnotes', '脚注'],
  ['↵ mention · ⇥ open folder', '↵ 提及 · ⇥ 打开文件夹'],
  ['…and ', '…还有 '],
  [' more — keep typing to narrow it down', ' 个文件 — 继续输入以缩小范围'],
  [' — sent with your message', ' — 随消息发送'],
  ['; selection truncated', '；所选内容已截断'],
]

// [verbatim, translation] — code fragments
const codes = [
  ['," file",t.files.length===1?"":"s"', '," 个文件"'],
  ['," code comment",a.length===1?"":"s"', '," 条代码评论"'],
  ['run_file_change_hooks:"Hooks"', 'run_file_change_hooks:"文件变更钩子"'],
]

const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'))
let added = 0

for (const [needle, zh] of templates) {
  let en
  try {
    en = extractTemplate(needle)
  } catch (e) {
    console.error('SKIP template (not found):', needle)
    continue
  }
  if (dict.template[en]) {
    console.log('exists:', en)
    continue
  }
  dict.template[en] = zh
  added++
  console.log('+ template:', en.slice(0, 90))
}

for (const [en, zh] of exacts) {
  if (!src.includes('"' + en + '"')) {
    console.error('SKIP exact (not found):', JSON.stringify(en))
    continue
  }
  if (dict.exact[en]) { console.log('exists:', en); continue }
  dict.exact[en] = zh
  added++
  console.log('+ exact:', en)
}

for (const [en, zh] of codes) {
  if (!src.includes(en)) {
    console.error('SKIP code (not found):', JSON.stringify(en))
    continue
  }
  if (dict.code[en]) { console.log('exists:', en); continue }
  dict.code[en] = zh
  added++
  console.log('+ code:', en.slice(0, 80))
}

if (!dry) {
  fs.writeFileSync(dictPath, JSON.stringify(dict, null, 2) + '\n')
}
console.log(`added ${added} entries`)
