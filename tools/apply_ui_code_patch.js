#!/usr/bin/env node
// UI bundle 的「行为补丁」：与词典（翻译）分开的少量代码改动。
//
// 为什么不能用词典做：词典按字面量逐字替换，而这些改动落在表达式上（守卫条件、三元
// 分支、对象展开），锚点里全是 minifier 起的短名字（`n`/`r`/`o`…），换个版本就变。
// 这里改用「属性名 + 字面量 + 结构」匹配，并用捕获组把短名字原样带回，所以 minifier
// 改名不会失配；匹配必须**唯一命中**，命中 0 处或 2 处以上都算失败。
//
// 用法：
//   node tools/apply_ui_code_patch.js <bundle.js> [--write] [--quiet]
// 不带 --write 时只报告（dry run）。幂等：已在文件里看到本次补丁的哨兵就跳过。
//
// 失败语义（与词典 MISSED 一致，供 build.sh 中止构建）：
//   某条补丁既匹配不到源码、也看不到哨兵 → 记为 MISSED，退出码 1。
//   这意味着上游改写了这段代码，必须人工核对后重新维护本文件的补丁定义。
const fs = require('fs')

// 补丁注入的标识符统一带这个前缀，既避免与 minifier 的短名相撞，也方便 grep 与自检。
const INJECT_PREFIX = '_hanhua'

// 哨兵：补丁注入的稳定片段，用来判断「已应用」与构建产物自检（tools/postbuild.js）。
//
// defect 字段把补丁归到「上游的那个缺陷」上：多条补丁可以协同修同一个缺陷。它让
// tools/ui_patch_status.js 能回答「上游自己修好了吗、这些补丁能不能退场」——判定是
// 按缺陷成组做的，找不到对应探针的补丁会被如实标成「无法自动判定」。
const PATCHES = [
  {
    defect: 'stream-epoch',
    id: 'mark-in-flight-after-reconnect',
    why:
      '断线重连（含 orchestrator 崩溃重启）时，给未完成的回复打上 streamSeq=-1 标记：' +
      '表示「这条回复的本地序号已经作废，服务端接下来发来的事件不要再按它过滤」。' +
      '同一次崩溃重启的另一半（launch id 换代导致 403）见 CHANGELOG 0.0.110.2；' +
      '这里处理流式序号：新进程的 live.seq 从 0 重新计数，而本地那条回复仍带着重启前的' +
      '序号（例如 42），EG 的守卫会把新事件连同 finish 一起丢掉，回复停在崩溃前的内容、' +
      '永远不 done。',
    find: /\{\.\.\.([A-Za-z_$][\w$]*),stale:!0,turnStatus:void 0,historyRequest:void 0,historyLoading:!1\}/,
    apply: (m) =>
      `{...${m[1]},stale:!0,turnStatus:void 0,historyRequest:void 0,historyLoading:!1,` +
      `messages:${m[1]}.messages.map(${INJECT_PREFIX}Msg=>${INJECT_PREFIX}Msg.done||${INJECT_PREFIX}Msg.streamSeq===void 0?${INJECT_PREFIX}Msg:{...${INJECT_PREFIX}Msg,streamSeq:-1})}`,
    sentinel: `.streamSeq===void 0?${INJECT_PREFIX}Msg`,
  },
  {
    defect: 'stream-epoch',
    id: 'skip-stale-seq-filter',
    why:
      'EG 的流事件守卫 `streamSeq !== void 0 && seq <= streamSeq` 对上面那个 -1 标记放行：' +
      '本地序号作废时不再丢弃服务端事件；第一条真正应用的事件会把序号写回正常值，之后守卫恢复原样。',
    find: /if\(([A-Za-z_$][\w$]*)\.streamSeq!==void 0&&([A-Za-z_$][\w$]*)<=\1\.streamSeq\)return/,
    apply: (m) => `if(${m[1]}.streamSeq!==void 0&&${m[1]}.streamSeq>=0&&${m[2]}<=${m[1]}.streamSeq)return`,
    sentinel: '.streamSeq>=0&&',
  },
  {
    defect: 'token-epoch',
    id: 'token-cache-resettable',
    why:
      '让「本机 orchestrator 的写入令牌」那张缓存能被丢掉。渲染进程把它读一次就永久缓存' +
      '（preload.cjs 的 apiToken() → 这里的 ID()），而它对应的 id 是可能变的：orchestrator' +
      '崩溃重启时主进程会换一个新的（主进程侧的 patches/electron-main.cjs.patch 已经让它在' +
      '同一次应用会话里不再换），此外「换文件时应用还开着」留下的混合态里，跑着的仍是没带' +
      '那条补丁的旧主进程。缓存一旦作废，此后每个写操作都被本机 orchestrator 判' +
      ' 403 {"error":"forbidden"}（无法打开标签页 / 消息未发送 / 无法编辑消息…），只要窗口' +
      '不重载就一直坏下去。这里只把缓存暴露成一个可丢的对象，丢弃时机见下一条补丁。',
    find: /function ([A-Za-z_$][\w$]*)\(\)\{var ([\w$]+),([\w$]+);if\(([\w$]+)===void 0\)try\{/,
    apply: (m) =>
      `function ${INJECT_PREFIX}ResetToken(){${m[4]}=void 0}` +
      `function ${m[1]}(){var ${m[2]},${m[3]};if(${m[4]}===void 0)try{`,
    sentinel: `function ${INJECT_PREFIX}ResetToken(){`,
  },
  {
    defect: 'token-epoch',
    id: 'reset-and-retry-on-403',
    why:
      '上面那条的唯一触发点，也是缺陷真正被补齐的地方：请求包装器拿到 403 时先丢掉令牌缓存，' +
      '再**立即用新令牌重发同一次请求**——于是用户连那一次 forbidden 提示都不会看到，也不必等' +
      '下一次操作、更不必重载窗口（并发中正等其他请求的调用同样受益）。只认 403：网络失败 / ' +
      '5xx 与令牌无关，不丢缓存也不重试，否则服务器每抖一下都要多打一次。重试只做一次（重试后' +
      '再 403 就直接抛错，不会无限重发），判据是函数签名上的一个标记参数——本条补丁把签名与' +
      'catch 一起改（锚点从签名跨到 catch），所以两处的小名字都由捕获组原样带回，minifier 改名不失配。',
    find:
      /async function ([A-Za-z_$][\w$]*)\(([\w$]+),([\w$]+),([\w$]+)=!1\)\{const ([\w$]+)=\4\?new AbortController:null;([\s\S]{0,1200}?)\}catch\(([\w$]+)\)\{throw \7 instanceof ([\w$]+)\?(\7):([\w$]+)\?new \8\(/,
    apply: (m) =>
      `async function ${m[1]}(${m[2]},${m[3]},${m[4]}=!1,${INJECT_PREFIX}Retried=!1){const ${m[5]}=${m[4]}?new AbortController:null;${m[6]}` +
      `}catch(${m[7]}){if(${m[7]} instanceof ${m[8]}&&${m[7]}.status===403&&!${INJECT_PREFIX}Retried)return ${INJECT_PREFIX}ResetToken(),${m[1]}(${m[2]},${m[3]},${m[4]},!0);` +
      `throw ${m[7]} instanceof ${m[8]}?${m[7]}:${m[9]}?new ${m[8]}(`,
    sentinel: `${INJECT_PREFIX}ResetToken(),`,
  },
  {
    defect: 'stream-epoch',
    id: 'keep-local-in-flight',
    why:
      '重连后的 loadThread 用 nY 决定「本地那条未完成回复」与「服务端快照」谁胜出。' +
      '硬崩溃时本地那条回复是唯一副本（服务端要到回合结束才把它落盘），所以带 -1 标记时' +
      '必须保留本地内容、让服务端随后的增量续写到它上面——否则可见的部分回复会被只含' +
      '续写内容的服务端快照替换掉。',
    find: /([A-Za-z_$][\w$]*)\.streamSeq>\(([A-Za-z_$][\w$]*)\.streamSeq\?\?0\)\?\[\.\.\.([A-Za-z_$][\w$]*)\.slice\(0,-1\),\1\]:/,
    apply: (m) => `(${m[1]}.streamSeq<0||${m[1]}.streamSeq>(${m[2]}.streamSeq??0))?[...${m[3]}.slice(0,-1),${m[1]}]:`,
    sentinel: '.streamSeq<0||',
  },
]

// 括号计数：只用来比对「被替换片段」与「替换后片段」的结构是否一致。
// 不能对整个 bundle 用：压缩产物里有正则字面量（`/[()=,{}\[\]\/\s]/`）和 URL 里的
// `//`，naive 扫描会把它们当注释/括号，整文件必然「不平衡」。整文件的语法校验由
// tools/postbuild.js 的 `node --check` 负责（build.sh 末尾调用）。
function bracketCounts(s) {
  const c = { round: 0, curly: 0, square: 0 }
  let q = null
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '\\') i++
      else if (ch === q) q = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') q = ch
    else if (ch === '(') c.round++
    else if (ch === ')') c.round--
    else if (ch === '{') c.curly++
    else if (ch === '}') c.curly--
    else if (ch === '[') c.square++
    else if (ch === ']') c.square--
  }
  return c
}

const sameCounts = (a, b) => a.round === b.round && a.curly === b.curly && a.square === b.square

/**
 * 对 bundle 文本套用全部行为补丁。
 * @returns {{text: string, applied: string[], already: string[], missed: Array<{id:string,find:RegExp,reason?:string}>, error?: string}}
 */
function applyPatches(src) {
  const applied = []
  const already = []
  const missed = []

  // 前缀被占用却看不到本次哨兵：不是我们的产物，宁可停下也不往未知代码里插桩。
  if (src.includes(`${INJECT_PREFIX}Msg`) && !src.includes(PATCHES[0].sentinel)) {
    return { text: src, applied, already, missed, error: `文件里已存在 ${INJECT_PREFIX} 前缀但不是本次补丁，拒绝继续（避免覆盖未知改动）。` }
  }

  let text = src
  for (const p of PATCHES) {
    if (text.includes(p.sentinel)) {
      already.push(p.id)
      continue
    }
    const re = new RegExp(p.find.source, p.find.flags.includes('g') ? p.find.flags : p.find.flags + 'g')
    const matches = [...text.matchAll(re)]
    if (matches.length === 0) {
      missed.push({ id: p.id, find: p.find })
      continue
    }
    if (matches.length > 1) {
      // 多处命中说明锚点不够独特，插错地方的风险大于收益
      missed.push({ id: p.id, find: p.find, reason: `锚点命中 ${matches.length} 处（要求唯一）` })
      continue
    }
    const m = matches[0]
    const replacement = p.apply(m)
    // 片段级结构自检：转写后括号计数必须与原片段一致（锚点吃偏了会在这里露出来）
    if (!sameCounts(bracketCounts(m[0]), bracketCounts(replacement))) {
      return {
        text: src,
        applied: [],
        already,
        missed,
        error: `补丁 ${p.id} 的替换结果括号计数与原文不一致，拒绝写入（锚点可能已随上游改写而错位）。`,
      }
    }
    text = text.slice(0, m.index) + replacement + text.slice(m.index + m[0].length)
    applied.push(p.id)
  }
  return { text, applied, already, missed }
}

function main() {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  const write = args.includes('--write')
  const quiet = args.includes('--quiet')
  if (!file) {
    console.error('usage: node apply_ui_code_patch.js <bundle.js> [--write] [--quiet]')
    process.exit(1)
  }

  const src = fs.readFileSync(file, 'utf8')
  const r = applyPatches(src)
  if (r.error) {
    console.error('ERROR: ' + r.error)
    process.exit(1)
  }

  console.log(
    `ui code patch: applied ${r.applied.length} / already ${r.already.length} / missed ${r.missed.length}` +
      (r.applied.length
        ? ` (bundle ${src.length} -> ${r.text.length}, ${r.text.length - src.length >= 0 ? '+' : ''}${r.text.length - src.length} bytes)`
        : ''),
  )
  if (!quiet) {
    for (const id of r.applied) console.log(`  + ${id}`)
    for (const id of r.already) console.log(`  = ${id}（已应用，跳过）`)
  }

  if (r.missed.length) {
    console.error(
      `MISSED (${r.missed.length} 条行为补丁既匹配不到源码、也看不到哨兵 —— 上游可能改写了这段代码，` +
        '需人工核对后维护 tools/apply_ui_code_patch.js):',
    )
    for (const m of r.missed) {
      console.error(`  - ${m.id}${m.reason ? `（${m.reason}）` : ''}`)
      console.error(`      锚点: ${m.find}`)
    }
    process.exit(1)
  }

  if (write && r.applied.length) {
    fs.writeFileSync(file, r.text)
    console.log(`wrote ${file}`)
  } else if (write) {
    console.log('no changes to write')
  }
}

if (require.main === module) main()

module.exports = { PATCHES, INJECT_PREFIX, applyPatches, bracketCounts, SENTINELS: PATCHES.map((p) => p.sentinel) }
