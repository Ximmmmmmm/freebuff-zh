#!/usr/bin/env node
// Auto-translate newly appeared UI strings for a new Freebuff bundle.
//
// Pipeline used by tools/autoupdate.sh when a fresh release introduces copy the
// dictionary does not cover yet:
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
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const DICT = path.join(ROOT, 'dict.json')
const CONFIG = path.join(ROOT, '.translator.json')

const bundlePath = process.argv[2]
const dry = process.argv.includes('--dry')
const extractOnly = process.argv.includes('--extract-only')
const maxIdx = process.argv.indexOf('--max')
const MAX_CANDIDATES = maxIdx >= 0 ? Number(process.argv[maxIdx + 1] || 200) : 200
if (!bundlePath) {
  console.error('usage: node tools/autotranslate.js <bundle.js> [--dry] [--extract-only] [--max N]')
  process.exit(1)
}

// ---- config ---------------------------------------------------------------
let cfg = {}
try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } catch { /* optional */ }
const baseUrl = (process.env.HANHUA_LLM_BASE || cfg.baseUrl || '').replace(/\/+$/, '')
const apiKey = process.env.HANHUA_LLM_KEY || cfg.apiKey || ''
const model = process.env.HANHUA_LLM_MODEL || cfg.model || ''
const maxBatch = Number(process.env.HANHUA_MAX_BATCH || cfg.maxBatch || 40)
const timeoutMs = Number(process.env.HANHUA_TIMEOUT_MS || cfg.timeoutMs || 120000)

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

const candidates = new Map() // en -> {kind, count}
function consider(en, kind) {
  if (!en) return
  let raw = en
  try { raw = JSON.parse('"' + en.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"') } catch { raw = en }
  if (!isUIFacing(raw)) return
  if (knownKeys.has(raw)) return
  if (dict.exact && dict.exact[raw]) return
  if (dict.template && dict.template[raw]) return
  const prev = candidates.get(raw)
  if (prev) prev.count++
  else candidates.set(raw, { kind, count: 1 })
}

const dqRe = /"((?:[^"\\]|\\.)*)"/g
let m
while ((m = dqRe.exec(src)) !== null) consider(m[1], 'exact')

const tplRe = /`((?:[^`\\]|\\.)*?)`/g
while ((m = tplRe.exec(src)) !== null) {
  const t = m[1]
  if (!/\$\{/.test(t)) { consider(t, 'exact'); continue }
  // template: the FULL literal (with real ${count} placeholders) becomes the
  // dict key — apply.js matches the whole backtick literal verbatim.
  consider(t, 'template')
}

let list = [...candidates.entries()]
  .filter(([en, v]) => !/[“”‘’]/.test(en) && !/already|translated/i.test(en))
  .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
  .slice(0, MAX_CANDIDATES)

if (list.length === 0) {
  console.log('没有发现新的未翻译 UI 文案，无需自动翻译')
  process.exit(0)
}
console.log(`候选 ${list.length} 条（前 ${Math.min(list.length, 10)} 条预览）：`)
for (const [en, v] of list.slice(0, 10)) console.log(`  [${v.kind}] x${v.count}  ${JSON.stringify(en.slice(0, 100))}`)

if (extractOnly) {
  console.log('\n[extract-only] 未调用 LLM，以上为待翻译候选')
  process.exit(0)
}

if (!baseUrl || !apiKey || !model) {
  console.error('ERROR: 未配置翻译 LLM。请在 .translator.json 填 baseUrl/apiKey/model，')
  console.error('       或用环境变量 HANHUA_LLM_BASE / HANHUA_LLM_KEY / HANHUA_LLM_MODEL。')
  console.error('       模板见 .translator.json.example')
  process.exit(3)
}

// ---- LLM translation -------------------------------------------------------
async function callLLM(batch) {
  const body = {
    model,
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
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
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

function placeholderSet(s) {
  return (s.match(/\$\{[^}]*\}/g) || []).sort()
}

const merged = []    // entries to add: {kind, en, zh}
const rejected = []  // reasons
const sleeps = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const groups = []
  for (let i = 0; i < list.length; i += maxBatch) {
    groups.push(list.slice(i, i + maxBatch))
  }
  for (let gi = 0; gi < groups.length; gi++) {
    const batch = groups[gi]
    let parsed = []
    try {
      parsed = await callLLM(batch)
    } catch (e) {
      rejected.push(`批次 ${gi + 1} LLM 调用失败: ${e.message}`)
      continue
    }
    for (const item of parsed) {
      const en = item && typeof item.key === 'string' ? item.key : null
      const zh = item && typeof item.value === 'string' ? item.value : null
      if (!en) continue
      if (!zh) { rejected.push(`跳过（模型判定不可译）: ${en.slice(0, 80)}`); continue }
      const cand = candidates.get(en)
      if (!cand) continue // model invented a key
      if (placeholderSet(en).join('|') !== placeholderSet(zh).join('|')) {
        rejected.push(`占位符不一致: ${en.slice(0, 60)}`)
        continue
      }
      if (/[\u4e00-\u9fff]/.test(en)) { rejected.push(`源已是中文: ${en.slice(0, 60)}`); continue }
      merged.push({ kind: cand.kind, en, zh })
    }
    if (gi < groups.length - 1) await sleeps(500)
  }

  // dedupe (dict may already have gained this key from an earlier partial run)
  const final = []
  for (const e of merged) {
    const sec = e.kind === 'template' ? dict.template : dict.exact
    if (sec[e.en]) continue
    sec[e.en] = e.zh
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
  console.log(final.length > 0 ? 'AUTOTRANSLATE_OK' : 'AUTOTRANSLATE_NONE')
}

main().catch((e) => {
  console.error('autotranslate 失败:', e.message)
  process.exit(1)
})
