#!/usr/bin/env node
// Find English text still sitting in UI positions of a built bundle.
//
// 覆盖三类位置（早期版本只认第一类里的字面量写法，connectors 面板整片漏报）：
//   1. UI 属性值：children: / label: / title: / placeholder: / "data-tooltip": /
//      "aria-label": / confirmLabel: / actionLabel: —— 值位置兼容压缩后的两种写法
//      （字面量 label:"X" 与默认参数 label:n="X"），并深入值里的三元分支
//      （label:t.status==="idle"?"Ready when needed":"Disconnected"）。
//   2. JSX 文本节点：children:[ …, " 裸文本", … ] 中深度 1 的纯字符串元素。
//   3. 模板分支：属性值里以反引号给出的模板（`Connected · Manage ${o}`）。
//
// 只列英文（不含 CJK）条目，按出现次数排序。用法：node tools/uipos.js <bundle>
const fs = require('fs')
const src = fs.readFileSync(process.argv[2], 'utf8')
// --ctx：每条附上原文里左侧 70 字符上下文，便于判断它出现在哪种属性位置
const WITH_CTX = process.argv.includes('--ctx')

const ANCHORS = [
  'children',
  'label',
  'title',
  'placeholder',
  '"data-tooltip"',
  '"aria-label"',
  'confirmLabel',
  'actionLabel',
]
const OPT_ASSIGN = '(?:[A-Za-z_$][\\w$]*\\s*=\\s*)?'
const hasCJK = /[\u3400-\u9fff]/

// 纯标识符 / 类名 / 路径 / URL 这类不是给人看的文案
function looksLikeCopy(s) {
  const t = s.trim()
  if (t.length < 2) return false
  if (!/[A-Za-z]/.test(t)) return false
  if (hasCJK.test(t)) return false
  if (/^(?:https?:|\/\/|~\/|[a-z0-9_$.-]+\/)/i.test(t)) return false
  if (/^[a-z0-9_$.-]+$/.test(t)) return false // 全小写标识符/类名
  if (/^[A-Z0-9_$.-]+$/.test(t) && !/ /.test(t)) return false // 全大写常量
  return true
}

const counts = new Map()
const ctxOf = new Map()
const add = (s, kind, at) => {
  if (!looksLikeCopy(s)) return
  const key = s + '\u0000' + kind
  counts.set(key, (counts.get(key) || 0) + 1)
  if (at != null && !ctxOf.has(key)) {
    ctxOf.set(key, src.slice(Math.max(0, at - 70), at).replace(/\s+/g, ' '))
  }
}

// --- 1/2/3. 属性值（含三元分支与模板）----------------------------------------
// 取锚点后到「深度 0 的逗号 / 分号 / 右括号」为止的值文本，再从中摘出可见字符串。
function valueTextAt(pos) {
  let depth = 0
  let i = pos
  let q = null
  const limit = Math.min(src.length, pos + 400)
  while (i < limit) {
    const c = src[i]
    if (q) {
      if (c === '\\') i++
      else if (c === q) q = null
    } else if (c === '"' || c === "'" || c === '`') q = c
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === '}' || c === ']' || c === ')') {
      if (depth === 0) break
      depth--
    } else if (c === ',' && depth === 0) break
    i++
  }
  return { text: src.slice(pos, i), end: i }
}

// 从值文本里摘字符串：只取「值表达式第 0 层」的字面量与模板（裸值、三元分支、
// 模板固定段），并排除比较运算符右侧的字面量（那是协议值/状态码，不是文案）。
// 嵌套在 {} [] () 里的是别的属性值（class 名、色值、SVG 路径、id…），一律不取。
const CMP_BEFORE = /(?:===|!==|==|!=|\.includes\s*\(|\.startsWith\s*\(|\.endsWith\s*\(|\.types\.includes\s*\(|\bcase\s*)\s*$/
function collectStrings(text) {
  const out = []
  let i = 0
  let depth = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '(' || c === '[' || c === '{') {
      depth++
      i++
      continue
    }
    if (c === ')' || c === ']' || c === '}') {
      depth--
      i++
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let v = ''
      while (j < text.length) {
        const ch = text[j]
        if (ch === '\\') {
          v += text.slice(j, j + 2)
          j += 2
          continue
        }
        if (ch === c) break
        v += ch
        j++
      }
      if (depth === 0 && !CMP_BEFORE.test(text.slice(0, i))) out.push({ raw: v, quote: '"', offset: i })
      i = j + 1
      continue
    }
    if (c === '`') {
      let j = i + 1
      let v = ''
      while (j < text.length) {
        const ch = text[j]
        if (ch === '\\') {
          v += text.slice(j, j + 2)
          j += 2
          continue
        }
        if (ch === '`') break
        if (ch === '$' && text[j + 1] === '{') {
          let d = 1
          let k = j + 2
          while (k < text.length && d > 0) {
            if (text[k] === '{') d++
            else if (text[k] === '}') d--
            k++
          }
          v += '${…}'
          j = k
          continue
        }
        v += ch
        j++
      }
      if (depth === 0 && !CMP_BEFORE.test(text.slice(0, i))) out.push({ raw: v, quote: '`', offset: i })
      i = j + 1
      continue
    }
    i++
  }
  return out
}

for (const anchor of ANCHORS) {
  const re = new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':' + OPT_ASSIGN, 'g')
  let m
  while ((m = re.exec(src)) !== null) {
    const valueStart = m.index + m[0].length
    const { text } = valueTextAt(valueStart)
    for (const { raw, quote, offset } of collectStrings(text)) {
      let v
      try {
        v = quote === '"' ? JSON.parse('"' + raw.replace(/\\/g, '\\\\') + '"') : raw
      } catch {
        v = raw
      }
      add(v, anchor.replace(/"/g, ''), valueStart + offset)
    }
  }
}

// --- 2. JSX 文本节点：children:[ …, " text", … ] --------------------------------
const childArr = /children:\[/g
let cm
while ((cm = childArr.exec(src)) !== null) {
  let i = cm.index + cm[0].length
  let depth = 1
  let q = null
  const start = i
  while (i < src.length && depth > 0) {
    const c = src[i]
    if (q) {
      if (c === '\\') i++
      else if (c === q) q = null
    } else if (c === '"' || c === "'" || c === '`') q = c
    else if (c === '[' || c === '(' || c === '{') depth++
    else if (c === ']' || c === ')' || c === '}') depth--
    i++
  }
  const body = src.slice(start, i - 1)
  let j = 0
  let d = 0
  let q2 = null
  let segStart = 0
  const pushSeg = () => {
    const seg = body.slice(segStart, j).trim()
    const mm = seg.match(/^"((?:[^"\\]|\\.)*)"$/)
    if (mm) {
      try {
        add(JSON.parse('"' + mm[1] + '"'), 'text-node', start + segStart)
      } catch {
        /* ignore */
      }
    }
  }
  while (j < body.length) {
    const c = body[j]
    if (q2) {
      if (c === '\\') j++
      else if (c === q2) q2 = null
    } else if (c === '"' || c === "'" || c === '`') q2 = c
    else if (c === '[' || c === '(' || c === '{') d++
    else if (c === ']' || c === ')' || c === '}') d--
    else if (c === ',' && d === 0) {
      pushSeg()
      segStart = j + 1
    }
    j++
  }
  pushSeg()
}

const entries = [...counts.entries()]
  .map(([k, n]) => {
    const [s, kind] = k.split('\u0000')
    return { s, kind, n }
  })
  .sort((a, b) => b.n - a.n || a.s.localeCompare(b.s))

const kinds = ['children', 'label', 'title', 'placeholder', 'data-tooltip', 'aria-label', 'confirmLabel', 'actionLabel', 'text-node']
console.log(`remaining UI-position English: ${entries.length}`)
for (const kind of kinds) {
  const list = entries.filter((e) => e.kind === kind)
  if (!list.length) continue
  console.log(`\n## ${kind} (${list.length})`)
  for (const e of list) {
    const ctx = ctxOf.get(e.s + '\u0000' + e.kind)
    console.log(`${e.n}\t${e.s}${WITH_CTX && ctx ? `\n\t@ ${ctx}` : ''}`)
  }
}
