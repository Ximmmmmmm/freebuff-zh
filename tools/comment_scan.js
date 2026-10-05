#!/usr/bin/env node
// JS 注释区间扫描（apply.js 的词法前置件，纯函数、无副作用，可单独测）。
//
// 为什么单独一个模块：这份实现的第一版是「从行首逐字符走到当前位置，见 `//` 就判注释」，
// 它不认正则字面量、也不认模板字面量里的 `${}` 嵌套，于是
//     g.replace(/^refs\/(?:heads|remotes)\//,"")   ← 转义斜杠 \/ 紧接正则收尾的 /  → 假的 //
//     new URL(`http://…`)                          ← 模板里的协议头             → 假的 //
// 这类假注释一出现，该行从这个位置到行尾都判成注释，译文被静默跳过——而且调用方早就数过
// 命中数，连 MISSED 都不报，构建全绿。0.0.159 实测：主包 3 行误判、合计 11.4 万字符死区、
// 178 条词条一字未翻。这种错只有自测能提前发现，所以把词法部分独立出来钉住。
//
// 对外只暴露两个东西：
//   commentIntervals(src)   → [[start, end], …]（按 start 升序，互不重叠）
//   commentChecker()        → (src, at) => boolean，内部按 src 缓存区间表并二分查询
//
// 覆盖的真实语法：行注释、块注释、单双引号字符串（含转义）、模板字面量（含嵌套模板）、
// `${ }` 插值（含插值里的注释与正则）、正则字面量（含字符类里的 `/`、转义 `\/`、flags）。
'use strict'

// 单双引号字符串：返回收尾引号之后的位置；没闭合就吃到末尾
const skipQuoted = (s, i) => {
  const q = s[i]
  let j = i + 1
  while (j < s.length) {
    if (s[j] === '\\') j += 2
    else if (s[j] === q) return j + 1
    else j++
  }
  return j
}

// `${ … }`：从 `{` 之后开始，返回到匹配的 `}` 之后
const skipBraced = (s, i) => {
  let depth = 1
  let j = i
  while (j < s.length && depth > 0) {
    const c = s[j]
    if (c === '\\') { j += 2; continue }
    if (c === '"' || c === "'") { j = skipQuoted(s, j); continue }
    if (c === '`') { j = skipTemplated(s, j); continue }
    if (c === '/' && s[j + 1] === '/') {
      const e = s.indexOf('\n', j)
      j = e < 0 ? s.length : e
      continue
    }
    if (c === '/' && s[j + 1] === '*') {
      const e = s.indexOf('*/', j + 2)
      j = e < 0 ? s.length : e + 2
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    j++
  }
  return j
}

const skipTemplated = (s, i) => {
  let j = i + 1
  while (j < s.length) {
    const c = s[j]
    if (c === '\\') { j += 2; continue }
    if (c === '`') return j + 1
    if (c === '$' && s[j + 1] === '{') { j = skipBraced(s, j + 2); continue }
    j++
  }
  return j
}

// 正则字面量：字符类里的斜杠不算收尾；没闭合（撞到换行）就退回「除号」处理
const skipRegexLiteral = (s, i) => {
  let j = i + 1
  let inClass = false
  while (j < s.length) {
    const c = s[j]
    if (c === '\\') { j += 2; continue }
    if (c === '\n') return i
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (c === '/' && !inClass) { j++; break }
    j++
  }
  while (j < s.length && /[a-z]/i.test(s[j])) j++
  return j
}

// 斜杠是正则还是除号：能结束一个表达式的字符之后是除号
const REGEX_AFTER = /[)\]}'"`\w$]/
const REGEX_KEYWORD = /^(?:return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await|throw)$/

function commentIntervals(s) {
  const out = []
  let i = 0
  let prevChar = ''
  let prevWord = ''
  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') { i++; continue }
    if (c === '"' || c === "'") { i = skipQuoted(s, i); prevChar = c; prevWord = ''; continue }
    if (c === '`') { i = skipTemplated(s, i); prevChar = '`'; prevWord = ''; continue }
    if (c === '/') {
      const next = s[i + 1]
      if (next === '/') {
        let e = s.indexOf('\n', i)
        if (e < 0) e = s.length
        out.push([i, e])
        i = e
        prevChar = '/'
        prevWord = ''
        continue
      }
      if (next === '*') {
        const e = s.indexOf('*/', i + 2)
        const end = e < 0 ? s.length : e + 2
        out.push([i, end])
        i = end
        prevChar = '*'
        prevWord = ''
        continue
      }
      const asRegex = prevChar === '' || !REGEX_AFTER.test(prevChar) || REGEX_KEYWORD.test(prevWord)
      if (asRegex) {
        const j = skipRegexLiteral(s, i)
        if (j > i + 1) { i = j; prevChar = '/'; prevWord = ''; continue }
      }
      i++
      prevChar = '/'
      prevWord = ''
      continue
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < s.length && /[A-Za-z0-9_$]/.test(s[j])) j++
      prevWord = s.slice(i, j)
      prevChar = 'a'
      i = j
      continue
    }
    if (/[0-9]/.test(c)) {
      let j = i
      while (j < s.length && /[0-9A-Za-z_.]/.test(s[j])) j++
      prevChar = '0'
      prevWord = ''
      i = j
      continue
    }
    prevChar = c
    prevWord = ''
    i++
  }
  return out
}

// 区间表按「字符串」缓存：调用方（applyExact）对着一份快照跑完整节，只需分词一次
function commentChecker() {
  const cache = { src: null, starts: [], spans: [] }
  return (src, at) => {
    if (cache.src !== src) {
      const spans = commentIntervals(src)
      cache.src = src
      cache.spans = spans
      cache.starts = spans.map((x) => x[0])
    }
    const starts = cache.starts
    let lo = 0
    let hi = starts.length - 1
    let k = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (starts[mid] <= at) { k = mid; lo = mid + 1 } else hi = mid - 1
    }
    return k >= 0 && at < cache.spans[k][1]
  }
}

module.exports = { commentIntervals, commentChecker, skipQuoted, skipTemplated, skipRegexLiteral }
