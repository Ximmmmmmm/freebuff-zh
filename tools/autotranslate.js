#!/usr/bin/env node
// Auto-translate newly appeared UI strings for a new Freebuff bundle.
//
// Use when a fresh Freebuff release introduces copy the dictionary does not
// cover yet (manual run; also the fallback when Codex is unavailable):
//   1. scan the pristine (English) UI bundle for user-facing strings that are
//      NOT already a dict key (exact / template)
//   2. batch them to an OpenAI-compatible chat-completions endpoint
//      (config in .translator.json or env HANHUA_LLM_*) with strict rules:
//      keep ${...} placeholders verbatim, translate only visible UI copy,
//      return null for code/identifiers/filenames
//   3. validate every reply (placeholder set identical, key present in dict,
//      translations must contain no ${} that the source lacks)
//   4. merge into dict.json under "exact" / "template", preserving CRLF-ish
//      JSON style (dict.json is written LF; the repo keeps it consistent)
//
// Only UI-bundle copy is translated. Main-process (.cjs) leftovers still stop
// the pipeline for a human, since those are few and risky to machine-fix.
//
// Usage:
//   node tools/autotranslate.js <bundle.js> [--dry] [--max N]
//   HANHUA_LLM_BASE / HANHUA_LLM_KEY / HANHUA_LLM_MODEL override config file.
//   多模型故障切换:在 .translator.json 里配置 models 数组(每项含 baseUrl/apiKey/model,
//   可选 timeoutMs),数组顺序即主备顺序;某个模型传输层失败(超时/网络/5xx/401/403/429)
//   自动切换到下一个,全部失败才报错并走拆半重试。env 单模型优先于 models 数组。
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { contextReason } = require('./semantic_guard')

const ROOT = path.join(__dirname, '..')
const DICT = path.join(ROOT, 'dict.json')
const CONFIG = path.join(ROOT, '.translator.json')
const PENDING_FILE = path.join(ROOT, 'work', 'autotranslate-pending.json')

const bundlePath = process.argv[2]
const dry = process.argv.includes('--dry')
const extractOnly = process.argv.includes('--extract-only')
const resetCache = process.argv.includes('--reset-cache')
const maxIdx = process.argv.indexOf('--max')
const MAX_CANDIDATES = maxIdx >= 0 ? Number(process.argv[maxIdx + 1] || 200) : 200
if (!bundlePath) {
  console.error('usage: node tools/autotranslate.js <bundle.js> [--dry] [--extract-only] [--max N] [--reset-cache]')
  process.exit(1)
}

// ---- 续翻缓存 ---------------------------------------------------------------
// 单条仍失败的条目落盘到 work/autotranslate-pending.json;下次运行自动跳过,
// 避免同一批超时条目反复重试烧 token。已翻译入 dict 的条目靠 knownKeys 天然
// 跳过,因此“中断后续翻”由增量写 dict + 失败缓存共同实现。
// 缓存按 bundle 内容哈希区分版本,换 bundle 后旧缓存自动作废。
const bundleHash = () =>
  crypto.createHash('sha256').update(fs.readFileSync(bundlePath)).digest('hex').slice(0, 16)

function loadFailedCache() {
  try {
    const p = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'))
    if (p.bundle !== bundleHash() || !Array.isArray(p.failed)) return new Map()
    const updated = Date.parse(p.updatedAt || '')
    if (!Number.isFinite(updated) || Date.now() - updated >= FAILED_CACHE_TTL_MS) {
      // 不能让一次短暂的 API 故障永久阻塞同一版本；过期后自动允许重试。
      clearFailedCache()
      return new Map()
    }
    return new Map(p.failed)
  } catch { /* 无缓存或格式不对 */ }
  return new Map()
}

function saveFailedCache(failedMap) {
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true })
  fs.writeFileSync(
    PENDING_FILE,
    JSON.stringify(
      { bundle: bundleHash(), updatedAt: new Date().toISOString(), failed: [...failedMap.entries()] },
      null,
      2,
    ) + '\n',
  )
}

function clearFailedCache() {
  try { fs.unlinkSync(PENDING_FILE) } catch { /* 已不存在 */ }
}

// ---- config ---------------------------------------------------------------
let cfg = {}
try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } catch { /* optional */ }

// 模型 provider 链(故障切换):优先级 env 单模型 > cfg.models 数组 > cfg 单模型。
// 数组顺序即主备顺序:传输层失败(超时/网络/5xx/401/403/429)自动切下一个,全部失败才报错。
function buildProviders() {
  const list = []
  const envBase = (process.env.HANHUA_LLM_BASE || '').replace(/\/+$/, '')
  const envKey = process.env.HANHUA_LLM_KEY || ''
  const envModel = process.env.HANHUA_LLM_MODEL || ''
  const defTimeout = Number(process.env.HANHUA_TIMEOUT_MS || cfg.timeoutMs || 300000)
  if (envBase && envKey && envModel) {
    list.push({ baseUrl: envBase, apiKey: envKey, model: envModel, timeoutMs: defTimeout })
  } else if (Array.isArray(cfg.models) && cfg.models.length > 0) {
    for (const m of cfg.models) {
      if (!m || !m.baseUrl || !m.apiKey || !m.model) continue
      list.push({
        baseUrl: String(m.baseUrl).replace(/\/+$/, ''),
        apiKey: m.apiKey,
        model: m.model,
        timeoutMs: Number(m.timeoutMs || defTimeout),
      })
    }
  } else if (cfg.baseUrl && cfg.apiKey && cfg.model) {
    list.push({
      baseUrl: String(cfg.baseUrl).replace(/\/+$/, ''),
      apiKey: cfg.apiKey,
      model: cfg.model,
      timeoutMs: defTimeout,
    })
  }
  return list
}
const providers = buildProviders()
const maxBatch = Number(process.env.HANHUA_MAX_BATCH || cfg.maxBatch || 20)
const FAILED_CACHE_TTL_MS = 60 * 60 * 1000 // 失败缓存最多阻塞一小时，之后自动重试

const dict = JSON.parse(fs.readFileSync(DICT, 'utf8'))
const src = fs.readFileSync(bundlePath, 'utf8')

// ---- candidate extraction --------------------------------------------------
// Double-quoted literals -> exact; backtick templates -> template. A candidate
// must look like human-readable UI copy (multi-word, or a Title word), must not
// already be a dict key, and must not contain a Chinese char yet.
const knownKeys = new Set([
  ...Object.keys(dict.exact || {}),
  ...Object.keys(dict.template || {}),
  ...Object.keys(dict.pattern || {}),
  ...Object.keys(dict.code || {}),
])

const looksLikeCode = (s) => {
  const t = s.trim()
  if (!t) return true
  if (/[\u4e00-\u9fff]/.test(t)) return true        // already Chinese
  if (!/[A-Za-z]/.test(t)) return true               // no latin letters
  // identifiers / code-ish fragments
  if (/^[a-z][a-zA-Z0-9]*$/.test(t)) return true     // camelCase single token
  if (/^[a-z]+_[a-z0-9_]+$/i.test(t)) return true    // snake_case
  if (/^[a-z]+-[a-z0-9-]+$/i.test(t)) return true    // kebab-case
  if (/^[A-Z_][A-Z0-9_]*$/.test(t)) return true      // ALL_CAPS const
  if (/^(data-|aria-|on[A-Z]|xmlns|http|https|www\.|\.\/|\.\.\/|[a-z]+:\/\/|class=|style=|id=|for=|name=|type=|key=|ref=|role=)/i.test(t)) return true
  if (/^[<{\[(]/.test(t)) return true
  // HTML/JSX fragments that slipped through quotes: "</symbol>", "/> <path d=" etc
  if (/<\/?[a-zA-Z][a-zA-Z0-9]*[\s>/]/.test(t)) return true
  // JS operators / code punctuation clusters
  if (/&&|\|\||===|!==|=>|==|!=|;|void 0|typeof|instanceof|new |return |function|\(.*\)[,:;]?$/.test(t)) return true
  // braces are fine inside template literals (Retry ${count} times) — only reject
  // pure-brace/JSX noise that carries no prose
  if (!/\$\{/.test(t) && /[{}()[\]\\]/.test(t)) return true
  // key-cap / CSS-ish: "12px", "#fff", "flex-start", "0 0 8px"
  if (/^[#0-9]/.test(t)) return true
  if (/(px|em|rem|vh|vw|%|deg|rad)$/.test(t) && /\s/.test(t)) return true
  return false
}

const isUIFacing = (s) => {
  const t = s.trim()
  if (t.length < 3) return false
  if (looksLikeCode(s)) return false
  const words = t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w))
  if (words.length === 0) return false
  // internal camelCase (e.g. DetermineComponentFrameRoot) is code
  for (const w of words) {
    if (/[a-z][A-Z]/.test(w)) return false
  }
  // two+ words: keep only if it reads like prose, not a css-class combo
  if (words.length >= 2) {
    const allLowerShort = words.every((w) => /^[a-z]{1,4}$/.test(w))
    if (allLowerShort) return false // "act tool-row"-style class noise
    const anyTitle = words.some((w) => /^[A-Z]/.test(w))
    const anyLong = words.some((w) => w.length >= 6)
    if (anyTitle || anyLong) return true
    return false
  }
  // single word: must be a Title-ish button label that is NOT a key name
  const w = words[0]
  const keyNames = /^(Esc|Escape|Enter|Return|Tab|Space|Backspace|Delete|Insert|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Shift|Control|Ctrl|Alt|Meta|CapsLock|F1?[0-9]?)$/i
  if (keyNames.test(w)) return false
  if (/^[A-Z][a-z]{2,}$/.test(w)) return true
  return false
}

// 正则字面量跳过:正则字符类里的引号(如 /[!'()*]/g 的 ')会被误当成字符串
// 开头,一路配对到远处导致中间的真实 UI 文案被吞掉(0.0.98 的
// "Thread mentions" 卡片就是这样漏掉的)。遇 `/` 且前面不是可除对象时
// 按正则扫描到未转义的结束 `/`,字符类内 `/` 不结束正则。
function trySkipRegex(s, i) {
  const prev = s[i - 1]
  if (prev && /[A-Za-z0-9_$)\]}\.'"`]/.test(prev)) return -1 // 除法/模板尾
  let j = i + 1
  let inClass = false
  while (j < s.length) {
    const c = s[j]
    if (c === '\\') { j += 2; continue }
    if (c === '[') { inClass = true; j++; continue }
    if (c === ']') { inClass = false; j++; continue }
    if (c === '/' && !inClass) return j + 1
    if (c === '\n') return -1 // 正则不能跨行
    j++
  }
  return -1
}

// 健壮的字面量扫描:压缩代码里的 `\"`/`\\` 转义序列会让全局正则的引号配对
// 错位,把后续真实字面量吞进超长匹配(0.0.98 的 "Thread mentions" 因此漏提取、
// 以英文发布)。逐字符配对,遇 `\` 跳过下一字符,保证每个字面量独立切出。
// 单引号字符串必须一并配对:Lezer 语法数据等超长字符串里常嵌单引号,而
// 单引号字符串内部的 `"` 若不配对会被误当成双引号字面量的开头,一路吞并
// 到后面的真实 UI 文案。正则字面量与 `//` 注释也要整体跳过,避免字符类
// 里的引号破坏配对。
function scanLiterals(s) {
  const out = []
  let i = 0
  while (i < s.length) {
    const c0 = s[i]
    if (c0 === '/') {
      if (s[i + 1] === '/') { let j = i + 2; while (j < s.length && s[j] !== '\n') j++; i = j; continue }
      if (s[i + 1] === '*') { const j = s.indexOf('*/', i + 2); i = j === -1 ? s.length : j + 2; continue }
      const reEnd = trySkipRegex(s, i)
      if (reEnd > i) { i = reEnd; continue }
      i++; continue
    }
    const q = c0
    if (q !== '"' && q !== "'" && q !== '`') { i++; continue }
    let j = i + 1
    let raw = ''
    let closed = false
    while (j < s.length) {
      const c = s[j]
      if (c === '\\') { raw += c + (s[j + 1] || ''); j += 2; continue }
      if (c === q) { closed = true; break }
      raw += c; j++
    }
    if (closed) out.push({ raw, quote: q, start: i, end: j + 1 })
    i = (closed ? j : i) + 1
  }
  return out
}

// ---- code-semantic blacklist --------------------------------------------
// Strings whose ANY occurrence sits in an identifier position (property value
// like name:"…", a comparison like =="…", or a switch case) are grammar/engine
// data, not UI copy. Translating them corrupts program behavior — the 0.0.97
// build shipped "Styles"→"样式" and the renderer died with
// "RangeError: Invalid top rule name" (CodeMirror Lezer parser.configure).
const codeProp = /\b(name|top|role|kind|type|tag|parser|token|node|term|grammar|lang|mode|match|rule|alias|ext|id|key|icon|scope|selector|extension|value|format|style|prop|state|event|source|context)\s*:\s*$/
const blockedStr = new Set()
for (const lit of scanLiterals(src)) {
  const before = src.slice(Math.max(0, lit.start - 40), lit.start)
  if (codeProp.test(before) || /[=!]==?\s*$/.test(before) || /case\s*$/.test(before)) blockedStr.add(lit.raw)
}

// 噪音词条不提取：`new XxxError("…")` 异常消息与纯类名组合(全小写含连字符
// 的多词，如 "modal modal-panel")不是 UI 文案，且会挤占批量配额把真实
// 界面文案(如 0.0.98 的 "Thread mentions" 卡片)挤出候选列表。
const isNoiseLiteral = (start, en) => {
  const before = src.slice(Math.max(0, start - 80), start)
  if (/\bnew\s+\w*Error\s*\(\s*["']?$/.test(before)) return true // 异常消息
  const words = en.split(/\s+/).filter(Boolean)
  if (words.length >= 2 && words.every((w) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(w))) return true // 纯类名组合
  return false
}

// UI 属性上下文标记:出现在 children:/label:/title:/placeholder:/aria-label:
// 等 JSX/属性值位置的字面量是确定无疑的界面文案,排序时优先保证进批次
// (候选总量常超配额,0.0.98 的 "Thread mentions" 卡片就被噪音挤出前 200)。
const uiPropRe = /(?:children|label|title|placeholder|aria-label|data-tooltip|confirmLabel|description|heading|subtitle|tooltip|alt)\s*:\s*["']?$/
const isUIAttr = (start) => uiPropRe.test(src.slice(Math.max(0, start - 60), start))

const candidates = new Map() // en -> {kind, count, ui}
function consider(en, kind, start) {
  if (!en) return
  let raw = en
  try { raw = JSON.parse('"' + en.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"') } catch { raw = en }
  if (!isUIFacing(raw)) return
  if (blockedStr.has(en)) return // 出现在代码语义位置的字符串(见上方 blacklist),拒翻
  if (knownKeys.has(raw)) return
  if (dict.exact && dict.exact[raw]) return
  if (dict.template && dict.template[raw]) return
  if (isNoiseLiteral(start, raw)) return
  const prev = candidates.get(raw)
  if (prev) { prev.count++; if (isUIAttr(start)) prev.ui = true; return }
  candidates.set(raw, { kind, count: 1, ui: isUIAttr(start) })
}

for (const lit of scanLiterals(src)) {
  if (lit.quote !== '"') continue
  consider(lit.raw, 'exact', lit.start)
}

for (const lit of scanLiterals(src)) {
  if (lit.quote !== '`') continue
  const t = lit.raw
  // 嵌套模板（${cond?`…`:""}）会截出一段以未闭合 "${" 结尾的半截词条——
  // 按整条字面量做 key 的词典会因此错配。跳过。
  if (/\$\{[^}]*$/.test(t)) continue
  // 一律按 template（反引号整串）入典：apply.js 的 exact 匹配只认 "…" 双引号，
  // 反引号内容当 exact 会永远 MISSED（0.0.97 构建中断的根因）。apply 的模板
  // 匹配器按 `key` 替换，扫出的片段天然带这对反引号，必然命中。
  consider(t, 'template', lit.start)
}

// 语义守卫后置扫描(黑屏教训的完整版)：对每个候选词条在 bundle 中扫全部出现
// 位置，任一处位于代码语义上下文(createEvent/phrase/endsWith/types.includes/
// configure 调用参数、平台 API 参数、比较/switch/语义属性值)即整条剔除——
// apply 是全局替换，词典里绝不能收这类词条。用 indexOf 逐位置检查而非正则
// 遍历字面量，避免压缩代码的转义序列干扰字面量切分。
{
  const semanticHit = (needle) => {
    let from = 0, idx
    while ((idx = src.indexOf(needle, from)) !== -1) {
      if (contextReason(src, idx, idx + needle.length)) return true
      from = idx + needle.length
    }
    return false
  }
  const drop = []
  for (const [key] of candidates) {
    if (semanticHit('"' + key + '"') || semanticHit('`' + key + '`')) drop.push(key)
  }
  for (const k of drop) candidates.delete(k)
  if (drop.length) console.log(`语义守卫剔除 ${drop.length} 条候选：${drop.slice(0, 10).map(JSON.stringify).join(', ')}`)
}

// UI 优先排序：多词完整句子 > 大写开头双词标题 > 单令牌噪音。候选常远超
// MAX_CANDIDATES 配额(count==1 的海量噪音)，纯按字母序会把 T 开头的真文案
// (0.0.98 的 "Thread mentions" 卡片)挤出配额，先按句子特征排序保证
// 界面文案不丢。
const uiPriority = (en) => {
  const words = en.split(/\s+/).filter(Boolean)
  if (words.length >= 3) return 3                        // 完整句子
  if (words.length === 2 && /^[A-Z]/.test(words[0])) return 2 // 双词标题
  return 1
}
let list = [...candidates.entries()]
  .filter(([en, v]) => !/[“”‘’]/.test(en) && !/already|translated/i.test(en) && !/\b\d[\d.]{2,}\b/.test(en)) // 数字坐标/SVG path 数据噪音
  .sort((a, b) => b[1].count - a[1].count || (b[1].ui ? 1 : 0) - (a[1].ui ? 1 : 0) || uiPriority(b[0]) - uiPriority(a[0]) || a[0].localeCompare(b[0]))
  .slice(0, MAX_CANDIDATES)

// 续翻:跳过上次已记录为失败的条目(避免重复烧 token 重试同一批超时条目)
if (resetCache) {
  clearFailedCache()
  console.log('--reset-cache:已清除续翻缓存，全部候选重新翻译')
}
const failedCache = loadFailedCache()
let cachedSkipped = 0
if (failedCache.size > 0) {
  const before = list.length
  list = list.filter(([en]) => !failedCache.has(en))
  cachedSkipped = before - list.length
  if (cachedSkipped > 0) console.log(`续翻:跳过上次失败的 ${cachedSkipped} 条候选（缓存 work/autotranslate-pending.json，缓存一小时后自动重试，也可加 --reset-cache 立即重试）`)
}

if (list.length === 0) {
  if (cachedSkipped > 0) {
    console.error(`当前候选全部处于失败冷却期（${cachedSkipped} 条），没有调用 LLM；缓存过期后会自动重试。`)
    console.log('AUTOTRANSLATE_BLOCKED_CACHE')
    process.exit(2)
  }
  console.log('没有发现新的未翻译 UI 文案，无需自动翻译')
  process.exit(0)
}
console.log(`候选 ${list.length} 条（前 ${Math.min(list.length, 10)} 条预览）：`)
for (const [en, v] of list.slice(0, 10)) console.log(`  [${v.kind}] x${v.count}  ${JSON.stringify(en.slice(0, 100))}`)

if (extractOnly) {
  console.log('\n[extract-only] 未调用 LLM，以上为待翻译候选')
  process.exit(0)
}

if (providers.length === 0) {
  console.error('ERROR: 未配置翻译 LLM。请在 .translator.json 填 baseUrl/apiKey/model(单模型)')
  console.error('       或 models 数组(多模型故障切换)，或用环境变量 HANHUA_LLM_BASE / HANHUA_LLM_KEY / HANHUA_LLM_MODEL。')
  console.error('       模板见 .translator.json.example')
  process.exit(3)
}
console.log(`模型链(${providers.length}):${providers.map((p) => p.model).join(' → ')}`)

// ---- LLM translation -------------------------------------------------------
// 传输层/服务端错误才换模型(超时/网络/5xx/401/403/429);
// 内容层错误(HTTP 200 但解析失败)不换模型,交上层拆半重试。
function isTransportError(e) {
  if (!e || !e.message) return false
  if (e.name === 'AbortError') return true
  if (/failed to fetch|fetch failed|network|socket|ECONNRESET|ETIMEDOUT/i.test(e.message)) return true
  if (/^HTTP (5\d\d|401|403|429)[:\s]/.test(e.message)) return true
  return false
}

const deadProviders = new Set() // 本次运行内已判定失效的 provider 索引,不再撞墙

async function callProvider(p, batch) {
  const body = {
    model: p.model,
    stream: false,
    temperature: Number(process.env.HANHUA_TEMP || cfg.temperature || 0.2),
    messages: [
      {
        role: 'system',
        content:
          '你是 Freebuff（AI 编程助手桌面应用）的简体中文本地化译者。' +
          '只翻译用户界面可见的文案，保持简洁自然、语气与原文一致。' +
          '规则：\n' +
          '1. 模板字符串中的 ${...} 占位符必须原样保留，一个不多一个不少。\n' +
          '2. 若某条是代码标识符、文件名、URL、CSS 类、属性名或不应翻译的技术文本，value 返回 null。\n' +
          '3. 保留英文引号风格提示：UI 中双引号文案不加引号；原文带的破折号、省略号、空格需保留。\n' +
          '4. 返回严格 JSON 数组，每项形如 {"key":"英文原文","value":"中文翻译或null"}。\n' +
          '5. 不要翻译代码块、不要发明内容。',
      },
      {
        role: 'user',
        content:
          '请翻译以下 UI 文案（key 是英文原文）。模板条目中的 ${} 代表变量，翻译时保持占位符原样：\n' +
          JSON.stringify(batch.map(([en, v]) => (v.kind === 'template' ? en : en)), null, 0),
      },
    ],
  }
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), p.timeoutMs)
  try {
    const res = await fetch(p.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.apiKey },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`)
    }
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content || ''
    const jsonStr = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) throw new Error('返回不是 JSON 数组')
    return parsed
  } finally {
    clearTimeout(timer)
  }
}

async function callLLM(batch) {
  let lastErr = null
  for (let i = 0; i < providers.length; i++) {
    if (deadProviders.has(i)) continue
    const p = providers[i]
    try {
      return await callProvider(p, batch)
    } catch (e) {
      lastErr = e
      if (isTransportError(e)) {
        deadProviders.add(i)
        console.log(`  ⚠ 模型 ${p.model} 传输层失败(${e.message.slice(0, 80)}),切换下一个可用模型…`)
      } else {
        throw e // 内容层错误不换模型,交上层拆半重试
      }
    }
  }
  throw lastErr || new Error('无可用模型')
}

function placeholderSet(s) {
  return (s.match(/\$\{[^}]*\}/g) || []).sort()
}

const merged = []    // entries to add: {kind, en, zh}
const rejected = []  // reasons
const sleeps = (ms) => new Promise((r) => setTimeout(r, ms))

// 翻译一个批次;失败时若超过 1 条则拆半递归重试(超时通常是批量太大),
// 直到单条仍失败才记录放弃——尽量不漏翻。ok 表示该批次是否完整成功，
// 不能把“部分批次成功”伪装成成功，否则调用方会误以为可以发布。
async function translateBatch(batch, depth) {
  try {
    return { ok: true, parsed: await callLLM(batch), failedEn: [] }
  } catch (e) {
    if (batch.length > 1) {
      const mid = Math.ceil(batch.length / 2)
      const left = batch.slice(0, mid)
      const right = batch.slice(mid)
      console.log(`  ⤵ 批次超时/失败(${e.message.slice(0, 80)}),拆半重试 ${left.length}+${right.length}...`)
      const a = await translateBatch(left, depth + 1)
      await sleeps(300)
      const b = await translateBatch(right, depth + 1)
      return {
        ok: a.ok && b.ok,
        parsed: [...a.parsed, ...b.parsed],
        failedEn: [...a.failedEn, ...b.failedEn],
      }
    }
    const en = batch[0][0]
    rejected.push(`LLM 调用失败(单条仍失败): ${en.slice(0, 60)} — ${e.message}`)
    return { ok: false, parsed: [], failedEn: [en] }
  }
}

async function main() {
  const groups = []
  for (let i = 0; i < list.length; i += maxBatch) {
    groups.push(list.slice(i, i + maxBatch))
  }
  const newFailed = new Map() // en -> reason,仅本次新增的失败
  let doneCount = 0
  for (let gi = 0; gi < groups.length; gi++) {
    const batch = groups[gi]
    const { parsed, failedEn } = await translateBatch(batch, 0)
    const failedSet = new Set(failedEn)
    for (const en of failedEn) newFailed.set(en, 'LLM 单条调用失败(超时/网络)')

    // 严格按本批候选核对返回值：模型漏回一条也必须进入失败缓存，不能
    // 静默丢失后以 AUTOTRANSLATE_OK 结束。
    const byKey = new Map()
    for (const item of parsed) {
      const en = item && typeof item.key === 'string' ? item.key : null
      if (!en || !candidates.has(en)) {
        if (en) rejected.push(`跳过（模型返回了不在候选中的 key）: ${en.slice(0, 80)}`)
        continue
      }
      if (byKey.has(en)) {
        rejected.push(`重复返回 key: ${en.slice(0, 80)}`)
        newFailed.set(en, '模型重复返回')
        continue
      }
      byKey.set(en, item)
    }

    for (const [en] of batch) {
      const item = byKey.get(en)
      if (!item) {
        if (!failedSet.has(en)) {
          rejected.push(`模型漏回: ${en.slice(0, 80)}`)
          newFailed.set(en, '模型漏回')
        }
        continue
      }
      const zh = typeof item.value === 'string' ? item.value : null
      if (!zh) {
        rejected.push(`跳过（模型判定不可译）: ${en.slice(0, 80)}`)
        newFailed.set(en, '模型判定不可译')
        continue
      }
      const cand = candidates.get(en)
      if (!cand) continue
      if (!/[\u3400-\u9fff]/.test(zh)) {
        rejected.push(`译文无中文: ${en.slice(0, 80)}`)
        newFailed.set(en, '译文无中文')
        continue
      }
      if (zh.trim() === en.trim()) {
        rejected.push(`译文原样回显英文: ${en.slice(0, 80)}`)
        newFailed.set(en, '译文原样回显英文')
        continue
      }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(zh) || /<\/?[a-z][^>]*>/i.test(zh)) {
        rejected.push(`译文含控制字符或 HTML: ${en.slice(0, 80)}`)
        newFailed.set(en, '译文含控制字符或 HTML')
        continue
      }
      if (zh.length > Math.max(2000, en.length * 20)) {
        rejected.push(`译文异常过长: ${en.slice(0, 80)}`)
        newFailed.set(en, '译文异常过长')
        continue
      }
      if (placeholderSet(en).join('|') !== placeholderSet(zh).join('|')) {
        rejected.push(`占位符不一致: ${en.slice(0, 60)}`)
        newFailed.set(en, '占位符不一致')
        continue
      }
      merged.push({ kind: cand.kind, en, zh })
    }
    // 增量写 dict:每批完成后立即落盘,进程被杀也不丢已翻条目
    if (!dry && merged.length > doneCount) {
      const sec = (e) => (e.kind === 'template' ? dict.template : dict.exact)
      for (const e of merged.slice(doneCount)) {
        if (!sec(e)[e.en]) sec(e)[e.en] = e.zh
      }
      fs.writeFileSync(DICT, JSON.stringify(dict, null, 2) + '\n')
      doneCount = merged.length
    }
    // 失败条目落盘缓存(下次自动跳过)
    if (!dry && newFailed.size > 0) {
      saveFailedCache(new Map([...failedCache, ...newFailed]))
    }
    if (gi < groups.length - 1) await sleeps(500)
  }

  // 剩余新失败也入缓存;全部成功则清理缓存
  if (!dry) {
    if (newFailed.size > 0) {
      saveFailedCache(new Map([...failedCache, ...newFailed]))
      console.log(`\n失败条目已缓存 ${newFailed.size} 条 → work/autotranslate-pending.json，下次运行自动跳过（--reset-cache 可重试）`)
    } else {
      clearFailedCache()
    }
  }

  // dedupe: candidates were filtered against dict at startup (knownKeys), so
  // any merged key already present with the same value was applied by THIS
  // run's incremental per-batch writes — count it, or the final OK/NONE
  // verdict always reports NONE and the caller discards the work.
  const final = []
  for (const e of merged) {
    const sec = e.kind === 'template' ? dict.template : dict.exact
    if (sec[e.en] === undefined) sec[e.en] = e.zh
    else if (sec[e.en] !== e.zh) continue
    final.push(e)
  }

  if (dry) {
    console.log(`\n[dry-run] 将新增 ${final.length} 条（未写入）`)
    for (const e of final.slice(0, 20)) console.log(`  [${e.kind}] ${JSON.stringify(e.en)} -> ${JSON.stringify(e.zh)}`)
  } else {
    fs.writeFileSync(DICT, JSON.stringify(dict, null, 2) + '\n')
    console.log(`\n已写入 dict.json：新增 ${final.length} 条`)
  }
  for (const e of final.slice(0, 30)) console.log(`  + [${e.kind}] ${JSON.stringify(e.en.slice(0, 90))} -> ${JSON.stringify(e.zh.slice(0, 90))}`)
  if (final.length > 30) console.log(`  … 其余 ${final.length - 30} 条省略`)
  if (rejected.length) {
    console.log(`\n被拒/失败 ${rejected.length} 条：`)
    for (const r of rejected.slice(0, 20)) console.log(`  - ${r}`)
  }
  if (newFailed.size > 0) {
    console.error(`\n自动翻译未完整成功：${newFailed.size} 条候选未通过校验或调用失败。`)
    console.log('AUTOTRANSLATE_PARTIAL')
    process.exitCode = 2
  } else {
    console.log(final.length > 0 ? 'AUTOTRANSLATE_OK' : 'AUTOTRANSLATE_NONE')
  }
}

main().catch((e) => {
  console.error('autotranslate 失败:', e.message)
  process.exit(1)
})