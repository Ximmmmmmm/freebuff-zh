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
//
// 0.0.148 的 Updates 页是这个表的第七个成员：
//   R1e=[…,"Updates"] → h!=="Updates"||… 过滤导航 → t==="Updates"&&p.jsx(cOe,{}) 选页面
// 与 0.0.131 那批完全同构，所以照样整表替换（词典里 "Updates" → "更新"）。
// （0.0.157 上游曾把 Updates 与 Version 合并成 About、这里跟着换成「关于」；
//   0.0.158 又撤回成 Updates，所以跟着换回来——改这张表前先确认本版 bundle 里是哪个词。）
const CONSISTENT_LABELS = new Set([
  '已连接',
  '通用',
  '外观',
  '连接器',
  '项目',
  '技能',
  'API 提供商',
  '更新',
  '计划审查',
  // 0.0.162：Sites 详情页的 tab 集合。它的数组（children:[…]）、比较（o==="…"）与初值
  // （useState("…")）用的是同一个值——只翻显示位置会让 o 与数组项失配、整个 tabpanel 变空，
  // 所以这七个标签必须走 exact（全局一致替换）并在白名单里放行比较位置。
  // 已核对：这七个字面量在原版里只出现在界面标签、tab 数组与上述比较处，没有协议/代码取值。
  '概览',
  '分析',
  '用户',
  '数据库',
  '存储',
  '密钥',
  '上限',
  // 0.0.162：设置页 / 账号页 / 站点页的导航表（C4e / E4e / rst）。与 Sites 的 tab 同构——
  // 表里条目的 label 会被当作状态值比较（s==="Account"、k==="Project settings"、["Usage","Billing","Earn"].map(k=>s===k)…），
  // 所以显示与比较必须同一个值：走 exact 全局一致替换，并在白名单里放行比较位置。
  // 已逐条核对：这些字面量在本版 bundle 里只出现在导航表、比较与同页标签上，没有协议取值。
  '账户',
  '账单',
  '赚取',
  '开发者 API',
  'API 密钥',
  '用量',
  '连接',
  '已归档',
  '项目设置',
  '浏览器',
  '模型与价格',
  '额度',
  // 0.0.164：设置页导航新增的「键盘快捷键」页。与上一版导航表同构——同一个字面量既是 label，
  // 又被比较（s==="Keyboard shortcuts"），还是设置关键字表 Ddt 的对象键（Ddt[r.label]），
  // 显示与比较必须同一个值：走 exact 全局一致替换并在白名单里放行比较位置。
  // 已核对：本版 bundle 里只出现在导航表、上述比较、关键字表键与同页标签上，没有协议取值。
  '键盘快捷键',
  // 0.0.169：CodeMirror 折叠槽按钮的 hover title——
  //   n.title=t.state.phrase(this.open?"Fold line":"Unfold line")
  // 它的形态命中上面 `.phrase(` 那条规则（0.0.100 事故后加的，防的是把**查表用的键**翻掉
  // 导致失配）。这里逐条核对过本版**不存在任何 phrases 注册表**：bundle 里只有 vn.phrases 这个
  // facet 的定义与读取（phrase(t,…) 方法本身、facet 变更比较），没有一处 `phrases.of({…})`；
  // phrase() 查不到表项时会把传入的键原样返回，所以翻译后就是 tooltip 显示中文，不存在失配路径。
  // 两个值在本版 bundle 里各只出现 1 次（同一处三元），不参与比较、不进 IPC、不落盘。
  '折叠行',
  '展开行',
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

// 正则字面量的词法：扫描器只走引号 / 模板，而正则体里的裸引号 / 反引号会把后面的
// 引号配对整体带偏——0.0.155 实测 `var XG=/[\n"\\\\]/g`（正则体内一个裸引号）让此后
// 2600 字符的代码被判成「一个字面量」，审计把该段里的中文（Freebucks 定价）报成
// 「API 参数里出现中文」，postbuild 据此中止构建（假阳性）。
//
// 判断一个 `/` 是正则开头还是除号：看上一个有效字符——标点（`(` `=` `,` `:` `[` …）后
// 是正则，标识符 / `)` / `]` / 数字后是除号；`return` / `typeof` 这类关键字以标识符结尾，
// 单独按词尾判定。判错一个方向都要出事：当正则越过会吞掉真命中（漏报），当除号越过会把
// 后面的引号配对带偏（假阳性，正是本次事故）。所以只在标点后严格成立时才跳过。
const REGEX_ALLOWED_AFTER = '([{,;=:!&|?+-*%~^<>'
const REGEX_KEYWORD_BEFORE = /(?:^|[^\w$])(?:return|typeof|instanceof|new|delete|void|do|else|in|of|case|yield|await)$/

function isRegexStart(source, at) {
  for (let p = at - 1; p >= 0; p--) {
    const ch = source[p]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue
    if (REGEX_ALLOWED_AFTER.includes(ch)) return true
    return REGEX_KEYWORD_BEFORE.test(source.slice(Math.max(0, p - 12), p + 1))
  }
  return true
}

// 从 `/` 之后跳到正则结束：处理转义与字符类（`[/]` 里的 `/` 不结束正则），带上 flags。
// 不是正则（未闭合 / 跨行）返回 -1，交给正常扫描。
function skipRegex(source, from, to) {
  let i = from
  let inClass = false
  while (i < to) {
    const ch = source[i]
    if (ch === '\\') { i += 2; continue }
    if (ch === '[') { inClass = true; i++; continue }
    if (ch === ']') { inClass = false; i++; continue }
    if (ch === '/' && !inClass) {
      i++
      while (i < to && /[a-z]/i.test(source[i])) i++
      return i
    }
    if (ch === '\n') return -1
    i++
  }
  return -1
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
      // 正则字面量整体跳过（正则体里的引号 / 反引号不是字符串定界符）
      if (c === '/' && isRegexStart(source, i)) {
        const after = skipRegex(source, i + 1, to)
        if (after > 0) { i = after; continue }
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
              // 表达式里的注释与正则：`["}]` 这种正则里的引号 / 花括号同样会带偏配平
              if (cc === '/') {
                if (source[k + 1] === '/') {
                  const nl = source.indexOf('\n', k)
                  k = nl < 0 || nl > to ? to : nl + 1
                  continue
                }
                if (source[k + 1] === '*') {
                  const close = source.indexOf('*/', k + 2)
                  k = close < 0 || close > to ? to : close + 2
                  continue
                }
                if (isRegexStart(source, k)) {
                  const after = skipRegex(source, k + 1, to)
                  if (after > 0) { k = after; continue }
                }
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
  isRegexStart,
  skipRegex,
}
