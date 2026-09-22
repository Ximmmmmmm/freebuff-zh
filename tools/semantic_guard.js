'use strict'

// These contexts accept protocol/grammar identifiers rather than user-visible
// copy. A translated value here can be syntactically valid but semantically
// wrong (for example document.createEvent("Event") or
// dataTransfer.types.includes("Files")). Keep this list deliberately narrow:
// normal UI attributes such as title/label remain translatable.
//
// 0.0.100 事故教训：LLM 批量翻译把 Lezer 节点名 "Emphasis" 翻成 "强调"，
// resolve:"Emphasis" / after:"Emphasis" / t[t.Emphasis=25]="Emphasis" 四处
// 代码位置被污染，应用启动即崩（RangeError: unknown parser）。以下新增：
//   - resolve/mark/after：Lezer 语法扩展配置属性
//   - displayName：主题/套餐等标识符式展示名（比较风险高，保持英文）
//   - backgroundColor/fill/stroke：CSS 系统色关键字（如 "Highlight"）
//   - 枚举赋值 ]="X"：TS 枚举自映射（t[t.Always=0]="Always"）
const SEMANTIC_PROPERTIES = new Set([
  'top',
  'parser',
  'grammar',
  'token',
  'node',
  'term',
  'rule',
  'alias',
  'kind',
  'mode',
  'scope',
  'selector',
  'extension',
  'resolve',
  'mark',
  'after',
  'displayName',
  'backgroundColor',
  'fill',
  'stroke',
])

// 界面标签常量白名单：这些中文是词典 code 分区「全局一致替换」的结果。典型例子是
// Connected——它既是状态标签的生成值（label:cond?"Connected":…），又被同一份代码
// 用来比较（l.label==="Connected" 过滤已连接列表、判断 sr-only）。只翻其中一处会让
// 过滤器失配，所以必须整体翻；它属本进程内派生的展示标签，不写盘、不发请求、不跨进程，
// 整体替换是安全的。这里放行对应的中文常量，避免 findUnsafeMatches 把「比较位置出现
// 中文」当成污染（其余中文出现在语义位置仍会拦下）。
//
// 0.0.131 新增的设置页名（General / Appearance / Connectors / Projects / Skills /
// API Providers）与工具标签 Plan review 属同一类：它们出自同一份常量表，既是导航按钮的
// 文案，又是 page 状态与分支判定的 id——
//   v2e=["General",…] → onClick:()=>or.setState({page:h}) → t==="Appearance"&&… / I2e[t]
// 全在渲染进程内派生：page 只存在 zustand 内存 store 里，不落盘、不走 IPC、不发请求
// （`settings.opened` 之类遥测用的是另一组常量），所以整表一致替换即可安全翻成中文。
// 前提与 Connected 相同，新增条目必须同样满足：同表同值、进程内派生、不写盘不跨进程。
const CONSISTENT_LABELS = new Set([
  '已连接',
  '通用',
  '外观',
  '连接器',
  '项目',
  '技能',
  'API 提供商',
  '计划审查',
])

const SEMANTIC_CALLS = [
  /(?:document\.)?createEvent\s*\([^()]*$/,
  /new\s+(?:Event|CustomEvent|MouseEvent|KeyboardEvent|PointerEvent)\s*\([^()]*$/,
  /\.types\.includes\s*\([^()]*$/,
  /\.(?:phrase|endsWith|startsWith)\s*\([^()]*$/,
  /\.configure\s*\([^()]*$/,
]

// Calls whose first string argument is a protocol value. Unlike the property
// rules above, these are matched from the call site so a minified bundle does
// not need stable variable names.
const SEMANTIC_CALL_NAMES = [
  /\b(?:document\.)?createEvent\s*\([^,)]*$/,
  /\.(?:phrase|endsWith|startsWith)\s*\([^,)]*$/,
  /\.types\.includes\s*\([^,)]*$/,
  /\.configure\s*\([^,)]*$/,
]

function hasCJK(s) {
  return /[\u3400-\u9fff]/.test(s)
}

function contextReason(source, start, end) {
  const before = source.slice(Math.max(0, start - 180), start)
  const property = before.match(/(?:^|[,{;])\s*([A-Za-z_$][\w$]*)\s*:\s*$/)
  if (property && SEMANTIC_PROPERTIES.has(property[1])) {
    return `semantic property ${property[1]}`
  }
  if (/\]\s*=\s*$/.test(before)) {
    // TS 枚举自映射：t[t.Emphasis=25]="Emphasis"。普通 UI 字符串不会以
    // 索引赋值形式出现在压缩产物里，误伤面极小。
    return 'enum member assignment'
  }
  if (/(?:===|!==|==|!=)\s*$/.test(before) || /\bcase\s*$/.test(before)) {
    return 'comparison or switch case'
  }
  if (SEMANTIC_CALLS.some((re) => re.test(before)) || SEMANTIC_CALL_NAMES.some((re) => re.test(before))) {
    return 'semantic API argument'
  }
  if (/\b(?:DOMException|URL|URLSearchParams)\s*\([^()]*$/.test(before)) {
    return 'platform API argument'
  }
  void end
  return null
}

function decodeDoubleQuoted(raw) {
  try {
    return JSON.parse('"' + raw + '"')
  } catch {
    return raw
  }
}

/**
 * 扫出「中文落在语义位置」的字面量。
 *
 * 这里必须自己按词汇边界（引号 / 模板字面量 / 注释）走一遍，**不能**用一条全局正则去
 * 抓引号对：模板字面量里的裸引号（词典翻出来的 `…${x?y:"未知错误"}` 就是）会被当成字符串
 * 定界符，从那一对引号起后面所有引号都错一位，于是两个引号之间的代码被当成「一个字面量」
 * 报出来（0.0.131 的事故：一条 toast 模板里的引号把同一条语句前面的 `new Event("focus")`
 * 卷进配对，报成「API 参数里出现中文」，构建被自己的守卫拦下）。
 *
 * 口径与旧实现保持一致：只认双/单引号字符串与模板字面量的**文本部分**，值含中文才进
 * contextReason 判断；模板的 `${…}` 内部按表达式递归（里面的字符串照样要查）。
 */
function findUnsafeMatches(source) {
  const out = []
  const n = source.length

  const consider = (start, end, value) => {
    if (!value || !hasCJK(value)) return
    // 白名单按去掉首尾空白后的值比对：模板里取出的固定段与带前后空格的词条
    //（如 `` `${x} 已连接` ``）都是同一类派生标签。
    if (CONSISTENT_LABELS.has(value.trim())) return
    const reason = contextReason(source, start, end)
    if (reason) out.push({ value, reason, index: start })
  }

  // 扫一段代码（顶层 / 模板的 ${} 内部）：抽字符串与模板字面量，跳过注释
  const scan = (from, to) => {
    let i = from
    while (i < to) {
      const c = source[i]
      if (c === '/' && source[i + 1] === '/') {
        const nl = source.indexOf('\n', i)
        i = nl < 0 || nl > to ? to : nl + 1
        continue
      }
      if (c === '/' && source[i + 1] === '*') {
        const close = source.indexOf('*/', i + 2)
        i = close < 0 || close > to ? to : close + 2
        continue
      }
      if (c === '"' || c === "'") {
        let raw = ''
        let j = i + 1
        while (j < to) {
          const ch = source[j]
          if (ch === '\\') { raw += source.slice(j, j + 2); j += 2; continue }
          if (ch === c) break
          raw += ch
          j++
        }
        const value = c === '"' ? decodeDoubleQuoted(raw) : raw
        consider(i, j + 1, value)
        i = j + 1
        continue
      }
      if (c === '`') {
        let text = ''
        let j = i + 1
        while (j < to) {
          const ch = source[j]
          if (ch === '\\') { text += source.slice(j, j + 2); j += 2; continue }
          if (ch === '`') break
          if (ch === '$' && source[j + 1] === '{') {
            // ${ … }：按大括号配平切出表达式，递归扫里面的字符串
            let depth = 1
            let k = j + 2
            while (k < to && depth > 0) {
              const cc = source[k]
              if (cc === '\\') { k += 2; continue }
              if (cc === '"' || cc === "'") {
                const q = cc
                k++
                while (k < to && source[k] !== q) k += source[k] === '\\' ? 2 : 1
                k++
                continue
              }
              if (cc === '`') {
                let d2 = 0
                k++
                while (k < to) {
                  if (source[k] === '\\') { k += 2; continue }
                  if (source[k] === '`' && d2 === 0) break
                  k++
                }
                k++
                continue
              }
              if (cc === '{') depth++
              else if (cc === '}') depth--
              k++
            }
            scan(j + 2, k - 1)
            j = k
            continue
          }
          text += ch
          j++
        }
        consider(i, j + 1, text)
        i = j + 1
        continue
      }
      i++
    }
  }

  scan(0, n)
  return out.sort((a, b) => a.index - b.index)
}

module.exports = {
  SEMANTIC_PROPERTIES,
  CONSISTENT_LABELS,
  contextReason,
  findUnsafeMatches,
  hasCJK,
}
