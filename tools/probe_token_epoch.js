#!/usr/bin/env node
// 「orchestrator 换了 launch id 之后，写操作一直 403 forbidden」的**取证探针**：不依赖任何
// 合成片段，直接从给定 bundle 里把相关函数原样抽出来，按事故时序跑一遍，看渲染进程能不能自己
// 从那一次 403 里恢复。
//
// 为什么要有这个工具：`tools/apply_ui_code_patch.js` 的 token-epoch 组修的是上游渲染进程里的
// 一个缺陷，而「补丁还有没有必要」「补丁真的生效了吗」靠哨兵（文本存在性）答不出来——哨兵只能
// 证明我们插进去了。这里的判据是行为：
//   · 原版 bundle：403 之后**不自愈**（那一次调用直接失败，没有第二次请求）⇒ 缺陷在 ⇒ 补丁必要；
//   · 产物 bundle：403 之后**同一次调用内就完成重试**（请求序列 T1→T2，调用成功），且
//     **非 403 不误伤**（5xx / 网络失败不丢缓存也不重试）⇒ 补丁既有效又最小。
//
// 事故时序（详见 docs/更新维护.md「常见问题」里 forbidden 那一条）：渲染进程把写入令牌读一次就
// 永久缓存（preload.cjs 的 apiToken() → 这里的 ID()），而它对应的 id 会变——orchestrator 崩溃
// 重启会换一个新的（主进程侧 patches/electron-main.cjs.patch 让它在同一次会话里不再换；此外
// 「换文件时应用还开着」留下的混合态里跑着的仍是没带那条补丁的旧主进程）。令牌作废之后，每个
// 写操作（打开标签页 / 发消息 / 停止 / 编辑…）都被判 403 {"error":"forbidden"}，窗口不重载就
// 一直坏下去。token-epoch 组做的事：403 时把那张缓存丢掉，并**立即用新令牌重发同一次请求**
// （只重试一次），于是用户连那一次 forbidden 提示都看不到。
//
// 用法：
//   node tools/probe_token_epoch.js <bundle.js> [--expect present|absent]
//     --expect present  原版：缺陷必须复现（rc 0）；不见了 rc 1（上游可能自修，补丁可退场）
//     --expect absent   产物：缺陷必须已消除且不误伤（rc 0）；否则 rc 1
//     不带 --expect 时只报告，rc 0。
//   抽不到函数（上游结构变了）→ rc 2「无法取证」，调用方只警告不拦。
'use strict'

const fs = require('fs')

// 被抽出来的函数：锚点用「属性名 + 字面量 + 结构」，短名字经捕获组原样带回，minifier 改名不影响；
// 结构真被改写时抽不到 → 无法取证，而不是猜。
const ANCHORS = {
  // 令牌缓存读取：function ID(){var t,e;if(mg===void 0)try{mg=(
  tokenCache: [
    /function ([A-Za-z_$][\w$]*)\(\)\{var ([\w$]+),([\w$]+);if\(([\w$]+)===void 0\)try\{[\w$]+=\(/,
    '令牌缓存读取',
  ],
  // 桌面桥接取值：function rt(){return typeof window>"u"?void 0:window.freebuffDesktop}
  // 只取它的**名字**：harness 用同名替身替掉它（返回可注入的假桥接对象）。
  bridge: [/function ([A-Za-z_$][\w$]*)\(\)\{return typeof window>"u"\?void 0:window\.[\w$.]+\}/, '桌面桥接取值'],
  // 请求包装器：async function Zt(t,e,n=!1){const i=n?new AbortController:null;
  // 第四个参数是可选的：token-epoch 的补丁会加上一个「已重试」标记参数（`,_hanhuaRetried=!1`），
  // 探针必须在**补丁前与补丁后**都能抽出同一个函数（否则产物侧直接变成「无法取证」）。
  request: [
    /async function ([A-Za-z_$][\w$]*)\(([\w$]+),([\w$]+),([\w$]+)=!1(?:,([\w$]+)=!1)?\)\{const [\w$]+=\4\?new AbortController:null;/,
    '请求包装器',
  ],
  // 超时常量（请求包装器在超时分支里引用它）
  timeoutConst: [/const ([A-Za-z_$][\w$]*)=15e3;/, '超时常量'],
  // ApiError 类：请求包装器用它区分「HTTP 错误」与「传输错误」，补丁按 .status 判断 403。
  // harness 里必须用**同一个名字**重建它——早期实现把它写死成 `go`，0.0.126 里 minifier
  // 把它改成了 `Ds`，于是抽出来的请求包装器一引用就 ReferenceError，探针把「补丁未生效」
  // 误报成构建失败（构建闸门抓不到这种「探针自己错」的情形，只能靠这里动态取名）。
  apiError: [/class ([A-Za-z_$][\w$]*)\s*extends Error\{constructor\([^)]*\)\{[^}]*this\.name="ApiError"[^}]*\}\}/, 'ApiError 类'],
  // 请求错误消息构造与 JSON 解析：请求包装器直接按名字调用，改名也要跟着走（抽不到时退回旧名，
  // 合成源码里本来就没有它们）。
  messageHelper: [/function ([A-Za-z_$][\w$]*)\(t,e\)\{if\(t&&typeof t==="object"\)\{const\{error:n,message:i\}=t;/, '请求错误消息构造'],
  jsonHelper: [/function ([A-Za-z_$][\w$]*)\(t\)\{try\{return JSON.parse\(t\)\}catch\{return null\}\}/, 'JSON 解析'],
}

// token-epoch 补丁注入的缓存失效函数。**固定名字**（带 _hanhua 前缀，不与 minifier 的短名相撞），
// 有它就说明这组补丁已应用；两条补丁靠这个名字协同（前一条把它注入，后一条调用它）。
const RESET_ANCHOR = /function (_hanhuaResetToken)\(\)\{[\w$]+=void 0\}/

/** 从 bundle 文本里按锚点抽出一个函数的完整源码（按大括号配平截取）。 */
function findFn(src, anchor, label) {
  const m = src.match(anchor)
  if (!m || !m[1]) throw new Error(`抽不到「${label}」的锚点`)
  const name = m[1]
  const decl = src.indexOf('function ' + name + '(')
  if (decl < 0) throw new Error(`抽不到「${label}」的函数声明`)
  // `async ` 前缀也必须带上：请求包装器就是 async 的，少这两个字符会让抽出来的片段
  // 在 new Function 里编译不过（await is only valid in async functions）。
  const start = decl >= 6 && src.slice(decl - 6, decl) === 'async ' ? decl - 6 : decl
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
 * 从请求包装器本体里读出它实际调用的两个辅助函数名：
 *   · 消息构造：`new <ApiError>(<helper>(…), <status>, …)` 的第一个参数
 *   · JSON 解析：`const x = raw ? <helper>(raw) : null` 里的 <helper>
 * 读不到就返回 null（调用方回退到锚点，再由 runtime 自检把「名字对不上」转成无法取证）。
 */
const GLOBAL_NAMES = new Set(['setTimeout', 'setInterval', 'clearTimeout', 'fetch', 'JSON', 'Promise', 'Object', 'Array'])
function deriveCallNames(body, errName) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // new <ApiError>(<helper>(…), <status>, …)
  const msg = new RegExp(`new ${esc(errName)}\\(([A-Za-z_$][\\w$]*)\\(`).exec(body)
  // 解析响应体：`x = raw ? <helper>(raw) : null`。必须要求**同一个变量**既做判据又做入参
  // （回引 \1），否则 `const s=n?setTimeout(()=>…` 这类三元会把 setTimeout 误抓成辅助函数，
  // 合成运行时于是把真 setTimeout 覆盖成 JSON 解析器（0.0.131 踩过）。
  const json = /([A-Za-z_$][\w$]*)\?([A-Za-z_$][\w$]*)\(\1\)/.exec(body)
  const pick = (m, idx) => (m && !GLOBAL_NAMES.has(m[idx]) ? m[idx] : null)
  return { msgName: pick(msg, 1), jsonName: pick(json, 2) }
}

/**
 * 组装一个只含「令牌读取 + 请求包装器」的迷你运行时。每次调用都重新组装：缓存变量是模块级
 * 状态，场景之间必须互不影响。
 * @param {string} src bundle 文本
 * @param {'ok'|'403'|'500'} failure 假 orchestrator 的回应方式：好令牌放行，坏令牌 403 / 500
 */
function build(src, failure) {
  const tokenCache = findFn(src, ...ANCHORS.tokenCache)
  const bridge = src.match(ANCHORS.bridge[0])
  if (!bridge) throw new Error('抽不到「桌面桥接取值」的锚点')
  const request = findFn(src, ...ANCHORS.request)
  const timeout = src.match(ANCHORS.timeoutConst[0])
  if (!timeout) throw new Error('抽不到「超时常量」的锚点')
  const reset = src.match(RESET_ANCHOR) ? findFn(src, RESET_ANCHOR, '令牌缓存失效') : null
  const mg = src.match(ANCHORS.tokenCache[0])[4]
  // 短名字从源码里取（minifier 每版都可能改），类名取不到就没法取证——那说明上游改写了
  // ApiError 的写法，必须人工核对后更新锚点，而不是拿错名字硬跑出一个假结论。
  const errMatch = src.match(ANCHORS.apiError[0])
  if (!errMatch) throw new Error('抽不到「ApiError 类」的锚点')
  const errName = errMatch[1]
  // 辅助函数名：优先从**抽出来的请求包装器本体**里读它实际调用的名字，锚点只作兜底。
  // 锚点绑的是上游某一版的写法，minifier 换名或上游微调写法都会失配；而退回硬编码的旧名
  // （pG / OG）会让合成运行时里没有那个函数——包装器一调用就 ReferenceError，又被它自己的
  // catch 吞掉，表现成「调用直接失败」，于是补丁明明生效也被判成未生效（0.0.131 的 iY 就是
  // 这样：锚点未命中，退回的 pG 在 bundle 里根本不存在）。
  const derived = deriveCallNames(request.body, errName)
  const msgMatch = src.match(ANCHORS.messageHelper[0])
  const jsonMatch = src.match(ANCHORS.jsonHelper[0])
  // 锚点只当兜底；两边都拿不到就不定义（合成运行时里缺名字会由 scenario 的自检转成「无法取证」）。
  const msgName = derived.msgName || (msgMatch ? msgMatch[1] : null)
  const jsonName = derived.jsonName || (jsonMatch ? jsonMatch[1] : null)

  const decl = [
    `const ${timeout[1]}=15e3`,
    // ApiError：请求包装器用它区分「HTTP 错误」与「传输错误」，补丁按 .status 判断 403
    `class ${errName} extends Error{constructor(e,n,i=null){super(e);this.status=n;this.body=i;this.name="ApiError"}}`,
    msgName ? `function ${msgName}(t,e){if(t&&typeof t=="object"){const{error:n,message:i}=t;if(typeof n==="string"&&n)return n;if(typeof i==="string"&&i)return i}return "请求失败（"+e+"）"}` : '',
    jsonName ? `function ${jsonName}(t){try{return JSON.parse(t)}catch{return null}}` : '',
    `let ${mg};`,
    // 桥接替身：真身返回 window.freebuffDesktop，这里换成可注入的假对象
    `function ${bridge[1]}(){return __state.ui}`,
    reset ? reset.body : '',
    tokenCache.body,
    'function fetch(u,init){return __state.fetch(u,init)}',
    request.body,
  ]
    .filter(Boolean)
    .join('\n')

  // token = 主进程当前会交给渲染进程的那份令牌（崩潏重启后会跟着变）
  // orchestrator = 当前活着的 orchestrator 自己认的那个 id
  const state = { token: 'T1', orchestrator: 'T1', sent: [], failure }
  state.ui = { apiToken: () => state.token }
  state.fetch = async (_url, init) => {
    const sent = init && init.headers ? init.headers['x-freebuff-launch-id'] : undefined
    state.sent.push(sent)
    // 假 orchestrator：只认自己当前的 id；别的令牌按本次场景的失败方式回应。
    if (sent === state.orchestrator) return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) }
    if (failure === '403') return { ok: false, status: 403, text: async () => JSON.stringify({ error: 'forbidden' }) }
    return { ok: false, status: 500, text: async () => JSON.stringify({ error: 'boom' }) }
  }

  const api = new Function('__state', decl + `\nreturn {request:${request.name},token:${tokenCache.name}}`)(state)
  return { api, state }
}

/**
 * 跑一次事故时序：预热缓存（T1）→ orchestrator 与主进程都换成 T2（崩溃重启）→ 写两次。
 *
 * 关键看**第一次调用**：
 *   · 原版：第一次请求带 T1 → 403 → 直接抛错，用户看到那一次 forbidden；
 *   · 补丁后：第一次请求带 T1 → 403 → 丢缓存 + 重发 → 第二次请求带 T2 → 200，
 *     所以**这一次调用是成功的**（用户完全无感）。
 * 第二次调用用来观察「非 403 时缓存有没有被误丢」（它若仍带 T1，说明缓存没被动过）。
 * @returns {{sent: string[], firstCallOk: boolean, secondCallOk: boolean, requestsInFirstCall: number}}
 */
async function scenario(src, failure) {
  const { api, state } = build(src, failure)
  const call = () => api.request('/api/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, false)

  // 预热：崩潏重启**之前**，渲染进程已经读过一次令牌（T1）——这就是那张会被永久缓存的缓存。
  api.token()
  // 崩潏重启：orchestrator 换成 T2，主进程侧的 apiToken() 也跟着变；渲染进程缓存里仍是 T1。
  state.orchestrator = 'T2'
  state.token = 'T2'

  let firstCallOk = false
  let firstErr = null
  try {
    await call()
    firstCallOk = true
  } catch (e) {
    firstCallOk = false
    firstErr = e
  }
  // 合成运行时的自检：抽出来的代码引用了这里没定义的名字（辅助函数改名/锚点失配），
  // 结果不是「缺陷结论」而是「取证失败」——ReferenceError 会被包装器自己的 catch 吞掉，
  // 不拦就会把补丁生效的产物报成未生效。
  if (firstErr instanceof ReferenceError) {
    throw new Error(`合成运行时缺少被引用的名字（${firstErr.message}）—— 辅助函数名与上游写法已不一致`)
  }
  const requestsInFirstCall = state.sent.length
  // harness 自检（两种 bundle 上都必须成立）：第一次请求确实带着那张预热的旧令牌。
  // 不成立说明时序没搭起来，属于「无法取证」而不是「缺陷不在」（与 build() 抽不到函数同类）。
  if (requestsInFirstCall === 0 || state.sent[0] !== 'T1') {
    throw new Error('时序没搭起来：第一次请求没有带上预热的旧令牌')
  }

  let secondCallOk = false
  try {
    await call()
    secondCallOk = true
  } catch {
    secondCallOk = false
  }
  return { sent: state.sent, firstCallOk, secondCallOk, requestsInFirstCall }
}

/**
 * 判决（异步：请求包装器是 async 的）。
 * @returns {Promise<{id:string, title:string, rows:Array, defectPresent:boolean, patchEffective:boolean}>}
 * @throws 抽不到函数 / 时序跑不起来时抛错（调用方应视为「无法取证」）
 */
const ID = 'token-epoch'
const TITLE = 'orchestrator 换了 launch id 之后，写操作一直 403 forbidden'

// 放在 verdict 之前：它是 const，写在后面会让 verdict 在 TDZ 里引用它（本仓库吃过这个亏）。
const yn = (b) => (b ? '是' : '否')

async function verdict(src) {
  const on403 = await scenario(src, '403')
  const on500 = await scenario(src, '500')

  // 只数**首次调用内**发出去的请求：第二次调用是另一个观察窗（测缓存有没有被误丢）。
  const seqIn = (r) => r.sent.slice(0, r.requestsInFirstCall).join('→')
  // 补丁后的自愈：**同一次调用**里先带旧令牌、重试后带当前令牌，并且这次调用是成功的。
  const heals = on403.firstCallOk && seqIn(on403) === 'T1→T2'
  // 原版：第一次请求带着旧令牌被拒，调用直接失败（用户看到那一次 forbidden），不会有第二次请求。
  const failsAsBefore = !on403.firstCallOk && on403.requestsInFirstCall === 1 && on403.sent[0] === 'T1'
  // 非 403（5xx）不该重试、也不该动缓存：两次调用各只发一次请求，且都仍带旧令牌。
  const ignoresNon403 =
    on500.requestsInFirstCall === 1 && on500.sent.slice(0, 2).join(',') === 'T1,T1' && !on500.firstCallOk && !on500.secondCallOk

  const rows = [
    {
      label: '403 forbidden 之后',
      healed: heals,
      sent: on403.sent,
      note: heals ? '同一次调用内即完成重试（用户无感）' : '调用直接失败（用户看到一次 forbidden）',
      text:
        `403 forbidden 之后  同一次调用内完成重试=${yn(heals)}  首次调用的请求序列=${seqIn(on403)}  ` +
        (heals ? '调用成功、用户无感' : '调用直接失败（用户看到一次 forbidden）'),
    },
    {
      label: '5xx 之后',
      healed: false,
      sent: on500.sent,
      note: ignoresNon403 ? '未重试、缓存未被丢掉（与令牌无关，符合预期）' : '不该出现的重试或丢缓存',
      text:
        `5xx 之后            同一次调用内完成重试=否  首次调用的请求序列=${seqIn(on500)}  ` +
        (ignoresNon403 ? '未重试、缓存未被丢掉（与令牌无关，符合预期）' : '不该出现的重试或丢缓存'),
    },
  ]

  return {
    id: ID,
    title: TITLE,
    rows,
    // 未打补丁：403 之后不自愈（调用直接失败）
    defectPresent: failsAsBefore,
    // 打了补丁：403 后同一次调用内重试成功、且非 403 不重试不误丢缓存
    patchEffective: heals && ignoresNon403,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  const expectIdx = args.indexOf('--expect')
  const expect = expectIdx >= 0 ? args[expectIdx + 1] : null
  if (!file || (expect && !['present', 'absent'].includes(expect))) {
    console.error('usage: node tools/probe_token_epoch.js <bundle.js> [--expect present|absent]')
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
    result = await verdict(src)
  } catch (e) {
    console.error(`probe: 无法取证（${e.message}）—— 上游渲染进程的代码结构已变，需人工核对后再更新本工具的锚点`)
    process.exit(2)
  }

  console.log(`token-epoch 取证：${file}`)
  for (const r of result.rows) console.log(`  ${r.text}`)

  const defectPresent = result.defectPresent
  const patchedOk = result.patchEffective

  let pass
  if (expect === 'present') pass = defectPresent
  else if (expect === 'absent') pass = patchedOk
  else pass = null

  if (pass === null) {
    console.log(`  结论：缺陷${defectPresent ? '在' : '不在'}；补丁行为${patchedOk ? '有效' : '未达标'}（未指定 --expect，仅报告）`)
    process.exit(0)
  }
  if (pass) {
    console.log(
      expect === 'present'
        ? '  结论：✓ 缺陷可复现（补丁仍然必要）'
        : '  结论：✓ 缺陷已消除——403 之后同一次调用内即完成重试，且只对 403 生效（有效且最小）',
    )
    process.exit(0)
  }
  if (expect === 'present') {
    console.log('  结论：✗ 未能复现缺陷 —— 上游可能已自行修复（或改了时序），补丁应当人工确认后移除')
  } else {
    console.log('  结论：✗ 缺陷仍未消除（403 之后调用仍然失败，或非 403 也重试 / 误丢缓存）—— 补丁未按要求生效')
  }
  process.exit(1)
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`probe: 意外错误 ${(e && e.stack) || e}`)
    process.exit(2)
  })
}

module.exports = { build, scenario, verdict, ANCHORS, RESET_ANCHOR, ID, TITLE }
