#!/usr/bin/env node
// 界面位置英文差集体检：uipos 报出来的「界面位置英文」里，哪些是本版新增、词典还没覆盖的？
//
// 为什么需要它：两条对差通道（tools/upstreamdiff.js 的片段级 / 字面量级）都有词数下限
// （≥3 词 / ≥2 词），**单词文案两边都进不来**；而 tools/regress.js 的片段提取同样只认句子。
// 结果就是 `Settings` / `Projects` / `General` / `Missions` / `Theme` / `Reset` / `Width` /
// `Height` / `Availability` / `Browser` / `System` 与设备预设这类单词标签，只能靠人去看
// uipos 的清单（0.0.131 适配时 14 条就是这么手工挑出来的——52 条里挑 14 条，全靠肉眼）。
//
// 本工具把这一步变成可执行判据：uipos 扫**本版产物**（English 还在 = 词典没覆盖）与
// **上一版已发布产物**（那时就有的多半是品牌名 / 模型名 / 代码），做差集，再减掉
// intentional-english.json 的 uiStrings 登记表。剩下的就是本版新增、需要人看一眼的鬼东西。
//
// 登记表是**两道闸门共用**的：本工具认界面位置，tools/upstreamdiff.js 还认它的**字面量
// 通道**（≥2 词的短串，典型是 `displayName:"Solar Mini 4"` 这种 uipos 根本不扫的位置）。
// 所以「哪些登记项已经死了」不能拿 uipos 的集合去问（它只能替自己那一半作证），
// 要问产物本身——判据是 regress.js 的 `presenceProbe`，本工具与 regress 共用同一份。
//
// 报告按「能翻 / 该登记 / 存疑」三桶分组（classifyItem，纯形态判据，见下）：0.0.156 适配时
// 40 条新增只能人工逐条挑拣（哪条是文案、哪条是 CSS 类名/路径），现在按桶复核即可——
// 路径 / CSS 类名 / 命令行 / 代码标识符自动归到「该登记」，多词短语与单词标签归到「能翻」，
// 两类都像的（含 ${…} 的模板串、带数字的标题式词、全大写缩写）留在「存疑」。
// **分类只影响报告的呈现与建议，不参与退出码判定**——判据仍然是「词典 + 登记表有没有覆盖」；
// 分错的代价是白看一眼，不会让闸门变绿或变红。--flat 可回到不分桶的老清单（便于跨版 diff）。
//
// 用法：
//   node tools/uipos_gap.js --bundle <本版产物：bundle / 目录 / pack zip>
//        [--prev <上一版产物>] [--allow <json>] [--limit N] [--quiet] [--flat]
// 退出码：0 = 没有未登记的界面位置英文；1 = 有（补进 dict.json，或登进 uiStrings 并写理由）；2 = 输入/调用出错
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
// presenceProbe 是「登记项还活着吗」的**唯一判据**，与 regress 共用（定义在 tools/regress.js）：
// 归一化（抹插值 + 折叠空白 + 去首尾）后看整串还在不在本版产物里；`${…}` 形态的登记项
// （如 `Action: ${…}${…}.`）也就能对上产物原文。详见 regress.js 里那段注释。
// normText（同一套归一化）也由那里导出，upstreamdiff 一并用它读登记表。
const { resolveBundle, presenceProbe } = require('./regress.js')

function usage(msg) {
  if (msg) console.error('ERROR: ' + msg)
  console.error('usage: node tools/uipos_gap.js --bundle <产物> [--prev <上一版产物>] [--allow <json>] [--limit N] [--quiet] [--flat]')
  process.exit(2)
}

// uipos.js 的输出（人类可读）：
//   remaining UI-position English: N
//   ## kind (n)
//   次数\t字符串
//   \t@ 上下文（--ctx 时才有）
// 只取 `## 小节` 之后的「数字+制表符」行；以制表符开头的续行（上下文 / 多行字符串的第二行）
// 一律跳过——两侧都按同一口径解析，差集才不会假报。
function parseUipos(out) {
  const set = new Set()
  let inSection = false
  for (const line of out.split('\n')) {
    if (/^## /.test(line)) {
      inSection = true
      continue
    }
    if (!inSection) continue
    const m = line.match(/^(\d+)\t(.+)$/)
    if (m) set.add(m[2].trim())
  }
  return set
}

function runUipos(bundle) {
  try {
    return execFileSync(process.execPath, [path.join(__dirname, 'uipos.js'), bundle], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    })
  } catch (e) {
    usage(`跑 tools/uipos.js ${bundle} 失败：${e.message}`)
  }
}

// --- 自动分类：把「人工逐条挑拣」换成「按桶复核」-------------------------------------
// 判据全部是形态特征（不看语义），依据来自本仓库登记表与 0.0.131→0.0.156 各版实测：
//   该登记   `/api/…`、`/placement-previews/….webp`、`fpc fpc-- fpc--asset`（BEM）、
//           `.explorer, .explorer-header`（选择器）、`bun install`（命令）、
//           `getUser()` / `user?.name ??` / `mcpServers`（代码与标识符）;
//   能翻     `A little` / `Images stay in this browser session…`（短语）、`Accepted` / `Mon`（单词标签）;
//   存疑     `${…} image`（模板串：要么补 template 要么登记）、`Solar Mini 4`（带数字，多半是模型名）、
//           `API`（全大写缩写无法从形态判断是术语还是标签）。
// 注意「该登记」里也包含**已经该翻但形态像代码**的少数（广告卡里模拟代码的文案就是这种），
// 所以它给的是**建议**，最终去留仍由复核的人决定。
const VERDICT_LABEL = {
  translate: '能翻（补 dict.json）',
  register: '该登记（形态上多半不是文案）',
  unsure: '存疑（人工定夺）',
}
const VERDICT_ORDER = ['translate', 'register', 'unsure']
// 命令行首词表：这些开头的短串是用户要照抄运行 / 报错里给出的命令，按惯例保留英文
const COMMAND_HEADS = /^(?:git|npm|npx|pnpm|yarn|bun|pip|pip3|python|python3|node|cargo|go|docker|kubectl|brew|apt|choco|winget|curl|make|sudo)\b/
const ASSET_EXT = /\.(?:webp|png|jpe?g|svg|gif|ico|js|mjs|cjs|json|css|html|md|ya?ml|exe|txt|gz|zip)\b/i

function classifyItem(raw) {
  const t = String(raw).trim()
  if (!t) return { verdict: 'unsure', reason: '空串' }

  // 1) 路径 / 资源 / URL：含协议、以 / 开头、localhost:端口、或整体就是「名字+素材后缀」
  if (
    /:\/\//.test(t) ||
    /^localhost:\d+/.test(t) ||
    /^\/\S/.test(t) ||
    (/^\S+$/.test(t) && ASSET_EXT.test(t))
  ) {
    return { verdict: 'register', reason: '路径 / 资源名' }
  }

  // 2) CSS 类名组合 / 选择器：整串由小写 kebab 词组成（BEM 的 `--`、选择器的前导点、单词里的 `-`）
  const cssTokens = t.split(/[,\s]+/).filter(Boolean).map((x) => x.replace(/^\.+/, ''))
  const allLowerKebab = cssTokens.length > 0 && cssTokens.every((x) => /^[a-z][a-z0-9-]*$/.test(x))
  if (allLowerKebab && (t.includes('--') || /(^|[,\s])\./.test(t) || cssTokens.some((x) => x.includes('-')))) {
    return { verdict: 'register', reason: 'CSS 类名 / 选择器' }
  }

  // 3) 命令行（`bun install` / `git init` 这类要照拄运行的）
  if (COMMAND_HEADS.test(t)) return { verdict: 'register', reason: '命令行' }

  // 4) 模板串：uipos 把插值渲染成 ${…}，这类要么补 template 分区，要么登记
  if (/\$\{/.test(t)) return { verdict: 'unsure', reason: '模板串（含 ${…}）：补 template 或登记' }

  // 5) 代码 / 标识符：括号只有在「整串无空格」或「旁有表达式证据」时才算代码——
  //    `Arguments (JSON array)` / `Cancel (Esc)` 这类是带括号注的**文案**，不能误判（实测踩过）。
  const hasExpr = /=>|===|!==|\?\?|\?\.|\$\{/.test(t)
  if (/[(){}[\]<>]/.test(t) && (!/\s/.test(t) || hasExpr)) return { verdict: 'register', reason: '代码片段' }
  if (hasExpr) return { verdict: 'register', reason: '表达式片段' }
  // 引号字面量：整串被引号包着（`'Guest'`）——多是演示代码或拼出来的值，不是给人读的标签
  if (/^['"].*['"]$/.test(t)) return { verdict: 'register', reason: '代码里的字符串字面量' }
  // 赋值片段：`user =` / `count = 0` 这种**整串**就是一段赋值（尾部的值可以缺省）
  if (/^[A-Za-z_$][\w$.]*\s*=[^=]*$/.test(t)) return { verdict: 'register', reason: '赋值语句片段' }
  if (/^[A-Za-z_$][\w$]*$/.test(t) && /[a-z][A-Z]/.test(t)) return { verdict: 'register', reason: '标识符（camelCase）' }
  if (/^[A-Za-z_$][\w$]*(?:\.[\w$]+)+$/.test(t)) return { verdict: 'register', reason: '点分路径（对象字段 / 配置键）' }

  // 6) 带数字的标题式词：多半是模型名 / 版本号（登记表里那批 displayName 长这样）
  if (/^[A-Z][\w.-]*(?:\s+[A-Z0-9][\w.-]*)*$/.test(t) && /\d/.test(t)) {
    return { verdict: 'unsure', reason: '标题式含数字（疑似模型名 / 版本号）' }
  }
  // 7) 全大写缩写：从形态分不出是术语（该登记）还是界面标签（该翻）
  if (/^[A-Z0-9][A-Z0-9{}_.-]{1,}$/.test(t)) return { verdict: 'unsure', reason: '全大写缩写（术语 / 协议名）' }

  // 8) 多词短语 → 界面文案
  if (/\s/.test(t)) return { verdict: 'translate', reason: '多词短语' }
  // 9) 单词：首字母大写的多半是标签（Accepted / Mon / Somewhere），全小写多半是枚举值或代码串
  if (/^[A-Z][a-z]+$/.test(t)) return { verdict: 'translate', reason: '单词标签' }
  if (/^[a-z][a-z0-9]*$/.test(t)) return { verdict: 'register', reason: '全小写单词（疑似枚举值 / 代码串）' }
  return { verdict: 'unsure', reason: '形态不典型' }
}

function loadAllow(file) {
  const p = file || path.join(__dirname, '..', 'intentional-english.json')
  if (!fs.existsSync(p)) return { path: p, entries: new Map() }
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'))
  const entries = new Map()
  for (const it of doc.uiStrings || []) {
    const text = typeof it === 'string' ? it : it && it.text
    if (!text) continue
    entries.set(text, (it && it.why) || '')
  }
  return { path: p, entries }
}

function main() {
  const argv = process.argv.slice(2)
  const opt = { limit: 30, quiet: false, flat: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--quiet') opt.quiet = true
    else if (a === '--flat') opt.flat = true
    else if (a === '--limit') opt.limit = Number(argv[++i])
    else if (a === '--bundle') opt.bundle = argv[++i]
    else if (a === '--prev') opt.prev = argv[++i]
    else if (a === '--allow') opt.allow = argv[++i]
    else usage(`未知参数：${a}`)
  }
  if (!opt.bundle) usage('--bundle 必填')

  const cur = resolveBundle(path.resolve(opt.bundle))
  if (!cur) usage(`在 ${opt.bundle} 下找不到主 bundle（ui/index.html 或 assets/index-*.js）`)
  const prev = opt.prev ? resolveBundle(path.resolve(opt.prev)) : null
  if (opt.prev && !prev) usage(`在 ${opt.prev} 下找不到主 bundle`)

  // 登记项死没死的判据与 regress 同一套（regress.js 的 presenceProbe）：整串还在不在产物里。
  // 读不到产物时 probe 为 null——由此跳过这道提醒，不拿「读不到」当成「全都没了」。
  const { probe, error } = presenceProbe(cur)
  if (!probe && !opt.quiet) console.log(`  ! 读不到产物内容（${error}），跳过登记表清理提醒`)

  const allow = loadAllow(opt.allow)
  const curSet = parseUipos(runUipos(cur))
  const prevSet = prev ? parseUipos(runUipos(prev)) : new Set()
  const added = [...curSet]
    .filter((x) => !prevSet.has(x))
    .filter((x) => !allow.entries.has(x))
    .sort()

  if (!opt.quiet) {
    console.log(`界面位置英文差集：${path.basename(cur)}${prev ? ` ← 上一版 ${path.basename(prev)}` : '（没有上一版基线，看全量）'}`)
    console.log(
      `  本版界面位置英文 ${curSet.size} 处${prev ? `，上一版 ${prevSet.size} 处` : ''}；` +
        `扣除登记表 ${allow.entries.size} 条后，本版独有 ${added.length} 处`,
    )
    console.log(`  （这些位置的词数都 <2，upstreamdiff / regress 两通道都看不见，只能靠这道体检）`)
  }

  if (added.length) {
    console.log('\n## 本版新增的界面位置英文（词典还没覆盖）')
    console.log('   能翻的补进 dict.json（补完重跑 bash build.sh）；品牌名 / 模型名 / 代码串登进')
    console.log(`   ${path.relative(process.cwd(), allow.path)} 的 uiStrings（逐条写理由）`)
    if (opt.flat) {
      // 老形态：不分桶的平铺清单（跨版 diff 两版报告时更顺手）
      for (const x of added.slice(0, opt.limit)) console.log(`   · ${x}`)
      if (added.length > opt.limit) console.log(`   … 其余 ${added.length - opt.limit} 条见 --limit`)
    } else {
      // 自动分桶：把「逐条挑拣」变成「按桶复核」。分类只是建议，退出码不受它影响。
      const buckets = { translate: [], register: [], unsure: [] }
      for (const x of added) {
        const c = classifyItem(x)
        buckets[c.verdict].push({ x, reason: c.reason })
      }
      console.log(`   形态分类：${VERDICT_ORDER.map((v) => `${VERDICT_LABEL[v]} ${buckets[v].length}`).join(' · ')}`)
      console.log('   （分类只看形态，不看语义；拿不准的一律进「存疑」——分错只是白看一眼，不影响闸门）')
      for (const v of VERDICT_ORDER) {
        const rows = buckets[v]
        if (!rows.length) continue
        console.log(`\n### ${VERDICT_LABEL[v]}（${rows.length}）`)
        for (const { x, reason } of rows.slice(0, opt.limit)) console.log(`   · ${x}   ← ${reason}`)
        if (rows.length > opt.limit) console.log(`   … 其余 ${rows.length - opt.limit} 条见 --limit`)
      }
    }
  }

  // 登记项在本版已经不存在了（上游删掉/改了/我们自己翻掉了）→ 提醒清理，不失败。
  //
  // 判据见 presenceProbe：**不是**「uipos 还看不看得见」——登记表是三道通道共用的，
  // 只为 upstreamdiff 的字面量通道登记的条目（模型名 `displayName:"Solar Mini 4"`、
  // 命令行 `git init` 这类）永远进不了 curSet，拿 uipos 的集合算就会年年把同 5 条报成
  // 「可以清理」（0.0.140 → 0.0.147 每版一次）。
  const stale = probe ? [...allow.entries.keys()].filter((x) => !probe(x)) : []
  if (stale.length && !opt.quiet) {
    console.log(`\n## 登记表里有 ${stale.length} 条在本版产物里已看不见（整串都没了），可以清理`)
    for (const x of stale.slice(0, 10)) console.log(`   · ${x}`)
  }

  if (added.length === 0) {
    console.log('\n✓ 界面位置英文里没有未登记的新增项')
    process.exit(0)
  }
  console.error(`\nERROR: 有 ${added.length} 处界面位置英文没被词典覆盖（清单见上）`)
  process.exit(1)
}

if (require.main === module) main()
module.exports = { parseUipos, classifyItem, VERDICT_LABEL, VERDICT_ORDER }
