#!/usr/bin/env node
// 词典质量门禁：不依赖任何专有文件，可在 CI 里对 dict.json 单独运行。
//
// 检查项：
//   E1 结构       四个分区齐全、每条目都是 string→string、除 code 外译文非空
//   E2 键重复     同一分区内重复的原文键（JSON.parse 会静默保留最后一条，必须显式查出）
//   E3 占位符     译文中出现词典 key 里没有的 ${...} 表达式 = 手误，硬错误；
//                 数量少于 key 属正常（中文吸收复数等机制占位符），只统计提示
//   W1 空白不对称 key/译文一侧有首尾空白另一侧没有——常见复制粘贴手误
//   W2 疑似未翻   非 code 分区里完全不含 CJK 的译文（个别品牌词属有意保留）
//   E4 pattern    pattern 键必须是纯字面量（不含 ${ ` 换行）
//   E5 半截模板  以未闭合的 `${条件?` 结尾的 template 键（外层模板里内嵌模板三元的写法）：
//                 只允许在 template 分区、译文必须逐字节复现同一尾巴、形态要能被 remap 迁移，
//                 且骨架必须登记在 TRUNCATED_TEMPLATE_ANCHORS 里——这类键是特例，
//                 0.0.104 适配时正是靠人肉才发现的 4 条，登记后就不再靠人工盯。
//
// 用法：node tools/lint_dict.js [dict.json]      # 默认 <repo>/dict.json
const fs = require('fs')
const path = require('path')

const dictPath = process.argv[2] || path.join(__dirname, '..', 'dict.json')
const raw = fs.readFileSync(dictPath, 'utf8')

const errors = []
const warns = []
const info = []

const SECTIONS = ['exact', 'template', 'code', 'pattern']

// --- 半截模板键白名单 ---------------------------------------------------------------
// 「半截模板键」形如 `… wallet.${fe?`——外层模板里内嵌模板三元的写法，apply.js 会把它连着
// 后面那个反引号一起匹配（不这样写就只能把整段嵌套模板抄进词典）。这类键是**特例**：
//   · 译文必须逐字节复现同一个半截尾巴，否则替换后模板直接断裂（E5 硬错误）；
//   · 尾巴形态必须能被 remap.js 捕获迁移（`${` + 非空 + 不含反引号/右花括号）；
//   · 骨架必须在这里登记——新增的半截键一进来就报错，必须显式登记后才能提交。
// 登记用「英文骨架里的稳定片段」而不是整条键：minifier 改变量名不动英文文字，
// 所以 remap 重写键之后这里也不会失效（骨架 = 键去掉所有 `${…}` 与尾部半截后的纯文本）。
const TRUNCATED_TEMPLATE_ANCHORS = [
  'an hour, more than the',
  'for an hour of unlimited messages, charged once when the session starts. You have',
  'buys one hour of unlimited messages and tool calls.',
  "in your wallet. Used after today's pool.",
]

// --- 行级扫描：dict.json 是机器稳定格式（2 空格缩进），可逐行拿行号报错 ------------
// 形如：  "section": {            /     "key": "value",            /   },
const secRe = /^ {2}"([A-Za-z]+)": \{$/
const entryRe = /^ {4}"((?:[^"\\]|\\.)*)": "((?:[^"\\]|\\.)*)",?$/
const closeRe = /^ {2}\},?$/

let section = null
const lineNo = (i) => i + 1
const pairsBySection = new Map(SECTIONS.map((s) => [s, []]))

raw.split(/\r?\n/).forEach((line, i) => {
  const n = lineNo(i)
  if (line.trim() === '' || line === '{' || line === '}') {
    if (line === '}') section = null
    return
  }
  let m
  if ((m = line.match(secRe))) {
    if (section) errors.push(`E0 ${n}: 上一个分区未闭合就出现了新分区头`)
    section = m[1]
    if (!SECTIONS.includes(section)) errors.push(`E0 ${n}: 未知分区 "${section}"（预期 ${SECTIONS.join('/')}）`)
    return
  }
  if (closeRe.test(line)) {
    section = null
    return
  }
  if (section) {
    m = line.match(entryRe)
    if (!m) {
      errors.push(`E0 ${n}: 不是 "key": "value" 形态（文件应保持 JSON.stringify(…,2) 规整格式）`)
      return
    }
    let k, v
    try {
      k = JSON.parse('"' + m[1] + '"')
      v = JSON.parse('"' + m[2] + '"')
    } catch {
      errors.push(`E0 ${n}: 键/值转义非法`)
      return
    }
    pairsBySection.get(section).push({ k, v, n })
  } else {
    errors.push(`E0 ${n}: 条目出现在任何分区之外`)
  }
})
if (section) errors.push('E0: 文件结尾处仍有未闭合的分区')

// 兜底：整体仍必须是合法 JSON 且语义与逐行结果一致（防格式漂移）
try {
  JSON.parse(raw)
} catch (e) {
  errors.push(`E0: 整体 JSON 解析失败：${e.message}`)
}

const PH = /\$\{(?:[^{}]|\{[^{}]*\})*\}/g
const phOf = (s) => s.match(PH) || []
// 表达式骨架：抹掉字符串字面量后比较——表达式内部的双引号 / 反引号模板文案是可翻译的
// （如 ${r.title||"new thread"} → ${r.title||"新会话"}），结构一致即可
const skeletonOf = (e) => e.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""')
const hasCJK = /[㐀-鿿豈-﫿　-〿＀-￯]/

for (const sec of SECTIONS) {
  const items = pairsBySection.get(sec)
  info.push(`${sec}: ${items.length}`)

  // E2 重复键
  const seen = new Map()
  for (const { k, n } of items) {
    if (seen.has(k)) errors.push(`E2 ${n}: 与第 ${seen.get(k)} 行重复的键（JSON.parse 会静默保留后者，前一条译文已丢失）：${JSON.stringify(k.slice(0, 60))}`)
    else seen.set(k, n)
  }

  for (const { k, v, n } of items) {
    if (typeof v !== 'string') continue // E0 已拦
    // E1 除 code 外译文非空
    if (v === '' && sec !== 'code') errors.push(`E1 ${n}: ${sec} 分区译文为空：${JSON.stringify(k.slice(0, 40))}`)

    const kp = phOf(k)
    const vp = phOf(v)
    if (sec !== 'code') {
      // E3 不得发明 key 里没有的表达式；骨架（去字符串字面量）一致视为合法，
      // 因为表达式内部的字符串常量本身可翻译
      const kpSkel = kp.map(skeletonOf)
      for (const e of vp) {
        if (!kp.includes(e) && !kpSkel.includes(skeletonOf(e))) {
          errors.push(`E3 ${n}: 译文含 key 中不存在的插值 ${e} —— ${JSON.stringify(k.slice(0, 44))}`)
        }
      }
      if (vp.length !== kp.length) {
        info.push(`  · ${n}: 占位符数不同（key ${kp.length} → 译 ${vp.length}，多为复数吸收）：${JSON.stringify(k.slice(0, 40))}`)
      }
    }

    // W1 首尾空白不对称
    const leadK = /^\s/.test(k), trailK = /\s$/.test(k)
    const leadV = /^\s/.test(v), trailV = /\s$/.test(v)
    if ((leadK !== leadV || trailK !== trailV)) {
      warns.push(`W1 ${n}: 首尾空白不对称 key=${JSON.stringify(k.slice(0, 30))} → 译=${JSON.stringify(v.slice(0, 30))}`)
    }

    // W2 疑似未翻译
    if (sec !== 'code' && !hasCJK.test(v)) {
      warns.push(`W2 ${n}: 译文不含中文（若为品牌词等有意保留请忽略）：${JSON.stringify(v.slice(0, 40))}`)
    }

    // E4 pattern 必须是纯字面量
    if (sec === 'pattern' && (k.includes('${') || k.includes('`') || /\n/.test(k))) {
      errors.push(`E4 ${n}: pattern 键必须为纯字面量（apply.js 只在 children:/label: 等 UI 属性位置做精确替换）`)
    }

    // E5 半截模板键
    const trunc = k.match(/\$\{[^}]*$/)
    if (trunc) {
      const tail = trunc[0]
      const skeleton = k.replace(PH, '').replace(/\$\{[^}]*$/, '')
      const short = JSON.stringify(k.slice(-30))
      if (sec !== 'template') {
        errors.push(`E5 ${n}: 半截模板键只能出现在 template 分区（当前在 ${sec}）：${short}`)
      }
      const vTail = (v.match(/\$\{[^}]*$/) || [null])[0]
      if (vTail !== tail) {
        errors.push(
          `E5 ${n}: 译文的半截尾巴与 key 不一致（key 结尾 ${JSON.stringify(tail)}，译文结尾 ${JSON.stringify(vTail)}）` +
            `—— apply.js 是整段替换，尾巴对不上会把模板字符串弄断：${short}`,
        )
      }
      if (!/^\$\{[^`}]{1,200}$/.test(tail)) {
        errors.push(
          `E5 ${n}: 半截尾巴 ${JSON.stringify(tail)} 形态 remap.js 无法迁移（要求以美元符号加左花括号开头、` +
            `条件非空、不含反引号/右花括号、≤200 字符）：${short}`,
        )
      }
      if (!TRUNCATED_TEMPLATE_ANCHORS.some((a) => skeleton.includes(a))) {
        errors.push(
          `E5 ${n}: 未登记的半截模板键。这类键是特例，请在 lint_dict.js 的 TRUNCATED_TEMPLATE_ANCHORS 里` +
            `登记它的英文骨架片段后再提交（否则下个版本只能靠人工重新发现）：${short}`,
        )
      }
      info.push(`  · ${n}: 半截模板键（已登记，remap 可自动迁移）：${JSON.stringify(k.slice(-28))}`)
    }
  }
}

// --- 汇总 ------------------------------------------------------------------------
console.log(`lint_dict: ${dictPath}`)
for (const l of info) console.log('  · ' + l)
if (warns.length) {
  console.log(`\n警告 ${warns.length} 条:`)
  for (const w of warns.slice(0, 20)) console.log('  ! ' + w)
  if (warns.length > 20) console.log(`  … 其余 ${warns.length - 20} 条略`)
}
if (errors.length) {
  console.log(`\n错误 ${errors.length} 条:`)
  for (const e of errors.slice(0, 30)) console.log('  ✗ ' + e)
  if (errors.length > 30) console.log(`  … 其余 ${errors.length - 30} 条略`)
  process.exit(1)
}
console.log('\n✓ lint 通过（结构与占位符一致性检查无错误）。')
