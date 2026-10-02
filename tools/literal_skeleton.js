// 模板字面量的解析与骨架工具（remap.js 与 resituate.js 共用的底层，无副作用、可单测）。
//
// 为什么单独一份：词典键必须与 bundle 逐字节一致，而「插值里的变量名」「标识符」每次发版都会
// 被 minifier 重排。两个工具都需要同一套能力——把一个 key 切成「固定段 + 插值/代码段」、
// 取表达式的骨架（抹掉字符串常量后比较）、按位置做标识符改名——口径必须完全一致，否则
// 「remap 说没问题、resituate 说找不到」这类互相矛盾的报告会让人不敢信任何一个。
//
// 边界说明：这里不做完整 JS 词法分析，够得上 minified 产物的规整形态即可；
// 解析不了的形态一律**保守返回**（partial / 不平衡），由调用方降级为「人工确认」，
// 绝不猜着写进词典。
'use strict'

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 把 `固定${expr}固定…` 切成 { t: 'lit' | 'expr', v, partial? } 交错段。
// 尊重引号字符串与嵌套花括号；末尾未闭合的 `${…`（「半截模板」键，apply.js 会连着
// 后面那个反引号一起匹配）记成 partial 表达式。
function parseTemplate(s) {
  const parts = []
  let lit = ''
  let i = 0
  const pushLit = () => {
    if (lit !== '') parts.push({ t: 'lit', v: lit })
    lit = ''
  }
  while (i < s.length) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 1
      let j = i + 2
      let q = null // 当前处于哪种引号内
      while (j < s.length && depth > 0) {
        const c = s[j]
        if (q) {
          if (c === '\\') j++
          else if (c === q) q = null
        } else if (c === '"' || c === "'" || c === '`') {
          q = c
        } else if (c === '{') depth++
        else if (c === '}') depth--
        j++
      }
      if (depth !== 0) {
        pushLit()
        parts.push({ t: 'expr', v: s.slice(i + 2), partial: true })
        return parts
      }
      pushLit()
      parts.push({ t: 'expr', v: s.slice(i + 2, j - 1) })
      i = j
    } else {
      lit += s[i]
      i++
    }
  }
  pushLit()
  return parts
}

// 表达式骨架：抹掉字符串字面量后比较。译文允许改写插值内部的字符串常量
// （`${r.title||"new thread"}` → `${r.title||"新会话"}`，lint_dict 的 E3 同样按骨架放行），
// 这种「译文自己的写法变体」不在 key 的插值表里，得靠骨架找到对应位置再改名。
const skeletonOf = (e) => e.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '\u0001')

// 表达式里的标识符 token（跳过字符串字面量内部，名字不翻）
function idents(e) {
  const out = []
  let i = 0
  while (i < e.length) {
    const c = e[i]
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < e.length) {
        if (e[j] === '\\') j += 2
        else if (e[j] === c) {
          j++
          break
        } else j++
      }
      i = j
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < e.length && /[\w$]/.test(e[j])) j++
      out.push({ start: i, end: j, name: e.slice(i, j) })
      i = j
    } else i++
  }
  return out
}

// 把 s 的标识符按位置换成 names（数量必须一致，即骨架相同才成立）；对不上返回 null
function renameTo(s, names) {
  const a = idents(s)
  if (a.length !== names.length) return null
  let out = ''
  let last = 0
  a.forEach((t, i) => {
    out += s.slice(last, t.start) + names[i]
    last = t.end
  })
  return out + s.slice(last)
}

// 去掉插值的 `${` / `}` 外壳（半截模板没有收尾花括号）
const innerOf = (e) => (e.startsWith('${') ? e.slice(2).replace(/\}$/, '') : e)

// 捕获到的表达式必须括号平衡且不含反引号，否则认为边界切错了
function balancedExpr(e) {
  if (!e || e.length > 300 || e.includes('`')) return false
  let d = 0
  let q = null
  for (let k = 0; k < e.length; k++) {
    const c = e[k]
    if (q) {
      if (c === '\\') k++
      else if (c === q) q = null
    } else if (c === '"' || c === "'") q = c
    else if (c === '(' || c === '{' || c === '[') d++
    else if (c === ')' || c === '}' || c === ']') d--
    if (d < 0) return false
  }
  return d === 0
}

// 插值捕获的三种形态（从严到宽），与 remap.js 的匹配级联同源：
//   strict   点号链 + 可选调用——形态最确定，不会跨插值乱切；
//   balanced 一层花括号平衡（三元分支、对象字面量参数）——相邻插值靠它切开；
//   lazy     兜底（不跨反引号的惰性捕获），形态更花哨的表达式只能靠它。
const STRICT_CAP = '[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*(?:\\([^`]{0,200}?\\))?'
const BALANCED_CAP = '(?:[^{}`]|\\{[^{}`]*\\})*'
const LAZY_CAP = '[^`]{0,400}?'
// 半截模板的尾巴：`${` + 到反引号/右花括号为止
const TAIL_CAP = '[^`}]{1,200}'

// 把「固定段 + 插值」形态的 key 编成一条正则（匹配带反引号的整段模板字面量）。
// 返回 null 表示这条 key 里没有插值（调用方应走字面量/片段路径）。
function templateRegex(key, cap = STRICT_CAP) {
  const parts = parseTemplate(key)
  if (!parts.some((p) => p.t === 'expr')) return null
  return new RegExp(
    '`' +
      parts
        .map((p) => {
          if (p.t === 'lit') return escRe(p.v)
          if (p.partial) return '(\\$\\{' + TAIL_CAP + ')'
          return '(\\$\\{' + cap + '\\})'
        })
        .join('') +
      '`',
    'g',
  )
}

module.exports = {
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
  TAIL_CAP,
}
