#!/usr/bin/env node
// upstreamdiff 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 为什么需要它：这个工具的价值全在「新增的是不是**本版上游真新写的**」这一点上，而它出错的方式
// 都很安静——
//   a) 把插值里的变量改名当成新增（minifier 每次发版都改这些字母，一改就是几十条假清单，没人再看）；
//   b) 反过来漏掉真新增（提取口径收得太紧，新增文案就此错过，直到 MISSED / 发布闸门才炸）；
//   c) 把注释、CSS 值、代码片段倒进清单；
//   d) 一段改写被报成「一增一下线」两件事，让人手工去凑；
//   e) --auto 挑错了版本（例如把 0.0.9 当成比 0.0.10 新），拿过期原版当基线。
// 这里用合成的两版原版 + 合成词典把这些都钉住；顺带覆盖 tools/regress.js 导出的提取器
// （两支工具共用它，判据只该有一处实现）。
//
// 覆盖：
//   1. 两边都一样 → 不进任何桶（只换插值变量的模板也在其中）；
//   2. 新增文案按「词典未覆盖 / 已覆盖」分桶，只有未覆盖的才让退出码为 1；
//   3. 一段改写被配对成一组「疑似改写」，不再重复出现在新增/下线桶里；
//   4. 上一版下线 → 进下线桶；
//   5. 注释、无空格的值（CSS）、含代码符号 / 语句关键字的片段 → 一条都不进；
//   6. 片段级两桶口径：含常见小词的算「文案」，2 词短标签算「短片段」（与 regress 共用）；
//   7. 上下文能指到命中处；--no-ctx 时不打；
//   8. 目录解析：给 ui/ 目录能自己找到主 bundle；坏路径 / 参数不足 → rc 2；
//   9. --auto：从缓存目录挑**版本号最大**的两版（0.0.10 > 0.0.9），只有一版时 rc 2；
//  10. 退出码：有待补翻 → 1；全部已覆盖 → 0。
//  12. **字面量级**（片段级口径的补充，0.0.120 适配后补上）：两词 Title case 标签（`Resume queue`）
//      进待补翻清单并拦住退出码——片段级要求「小写词占比 ≥0.6」，这类标签正好 0.5，以前就是
//      这么漏掉的；路径 / 类名 / 键名 / MIME 仍一条都不进；单词 + 标点的标签（`Rechecking…`）
//      单列进「短标签」节且**不拦退出码**；字面量的「已覆盖」判整串相等（子串相同不算）；
//  13. 字面量级反过来帮片段级去残段：`"Don't close …"` 片段级只抽出撇号后的半截句
//      （`t close this window …`），字面量级拿到全句，半截句不再单列。
//
// 用法：node tools/test_upstreamdiff.js        # 退出码非 0 表示回归
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const TOOL = path.join(__dirname, 'upstreamdiff.js')
const WORK = path.join(__dirname, '..', 'work', 'test-upstreamdiff')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

let fail = 0
const chk = (cond, label) => {
  if (cond) console.log(`  ok  ${label}`)
  else {
    console.log(`  FAIL ${label}`)
    fail++
  }
}

// --- 合成的两版英文原版 ---------------------------------------------------------
// 上一版：三句「不变」、一句「整段改写」、一句「本版下线」。
const PREV = `'use strict'
// This comment sentence is not a string, so it must never show up in the diff.
const states = "The connection states are unavailable."
const remove = "Remove this provider"
const rename = \`Wallet left: \${e.amount} of your daily allowance.\`
const rewrite = \`Spent before your wallet, and they do not carry over. Refills in \${r} hours.\`
const gone = "This upstream sentence is gone in the new version"
`

// 本版：不变句照旧、改名句只换了插值变量、改写句整段重写，另加 2 条新增 + 4 条噪音。
const CUR = `'use strict'
// This comment sentence is not a string, so it must never show up in the diff.
const states = "The connection states are unavailable."
const remove = "Remove this provider"
const rename = \`Wallet left: \${Ez.amount} of your daily allowance.\`
const rewrite = \`Spent before your wallet. Today's unused allowance does not carry over, and the next refill updates your balance.\`
const discount = \`First-tab discount · up to \${ve.amount} Freebucks off\`
const label = "First-tab discount in use"
const short = "bun install"
const titleLabel = "Resume queue"
const css = "align-items:center"
const codeish = "return t.map(e=>e.name).join(',')"
const trunc = "Don't close this window while the upload finishes."
const pathish = "cm-citedLine"
const keyish = "supabase_setup_invitation"
const oneWord = "Rechecking…"
`

const prevFile = path.join(WORK, 'prev.js')
const curFile = path.join(WORK, 'cur.js')
fs.writeFileSync(prevFile, PREV)
fs.writeFileSync(curFile, CUR)

// 合成词典：只覆盖 "First-tab discount in use" 与那条带撇号的整句，其余新增都算「待补翻」。
// （第二条专门用来试字面量级的「整串相等」判据：片段级抽出的半截句 `t close this window …`
// 不该因此被判成已覆盖，全句才该。）
const dictFile = path.join(WORK, 'dict.json')
fs.writeFileSync(
  dictFile,
  JSON.stringify(
    {
      exact: {
        'First-tab discount in use': '首个标签页折扣使用中',
        "Don't close this window while the upload finishes.": '上传完成前请不要关闭这个窗口。',
      },
      template: { 'Close tab (${t()}W)': '关闭标签页 (${t()}W)' },
      code: {},
      pattern: {},
    },
    null,
    2
  ) + '\n'
)

const run = (args) => {
  try {
    const out = execFileSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: String(e.stdout || ''), err: String(e.stderr || '') }
  }
}

// 从报告里取一个小节（到下一个 `## ` 或结尾为止）
const section = (out, title) => {
  const at = out.indexOf(title)
  if (at === -1) return ''
  const rest = out.slice(at)
  const next = rest.indexOf('\n## ', 1)
  return next === -1 ? rest : rest.slice(0, next)
}

const main = run([prevFile, curFile, '--dict', dictFile])
const out = main.out
// 只要条目行，去掉 `@ 上下文`（上下文会把邻近的源码一起打出来，那不算「报进了清单」）
const entries = (sec) =>
  sec
    .split('\n')
    .filter((l) => !/^\s+@ /.test(l))
    .join('\n')
// 条目文本（去掉 ⚠ / ✓ / · 前缀与 [桶] 标记）——用来断「某条**自己**没被单列」：
// 直接对整份报告做子串匹配会误判，因为长句条目里天然包含半截句（`Don't close …` 含 `t close …`）。
const entryTexts = (sec) =>
  sec
    .split('\n')
    .map((l) => l.replace(/^\s*[⚠✓·]\s*(\[[^\]]*\]\s*)?/, '').trim())
    .filter((l) => l && !/^@ /.test(l) && !l.startsWith('##'))

const need = section(out, '## 新增文案 · 词典未覆盖')
const cov = section(out, '## 新增文案 · 词典已覆盖')
const pair = section(out, '## 疑似改写')
const gone = section(out, '## 上一版下线')
const mainEntries = entries(need + cov + pair + gone)

// --- 1) 两边都一样 → 不进任何桶 ------------------------------------------------
chk(!out.includes('The connection states are unavailable.'), '1) 未变的句子不进任何桶')
chk(!out.includes('Remove this provider'), '1) 未变的短句也不进')
chk(!out.includes('Wallet left'), '1) 只换插值变量的模板不算新增（抹掉 ${...} 再比）')
chk(/新增 3、下线 1、疑似改写 1 组/.test(out), '1) 计数正确（新增 3 / 下线 1 / 改写 1）')

// --- 2) 分桶与词典覆盖 --------------------------------------------------------
chk(need.includes('[文案] First-tab discount · up to Freebucks off'), '2) 未覆盖的新模板进「待补翻」清单')
chk(cov.includes('[文案] First-tab discount in use'), '2) 词典已覆盖的新增标 ✓（键去掉插值后子串匹配）')
chk(!entries(need).includes('First-tab discount in use'), '2) 已覆盖的不再出现在「待补翻」里')
chk(main.code === 1, `2) 有待补翻 → exit 1（实际 ${main.code}）`)

// --- 3) 改写配对 --------------------------------------------------------------
chk(out.includes('疑似改写 1 组'), '3) 整段重写被报成 1 组改写')
chk(pair.includes('Spent before your wallet, and they do not carry over'), '3) 改写组里列了旧句')
chk(pair.includes('Today\'s unused allowance does not carry over'), '3) 改写组里列了新句')
chk(!entries(need).includes('Today\'s unused allowance'), '3) 改写的新句不重复出现在新增桶')
chk(!gone.includes('Spent before your wallet'), '3) 改写的旧句也不出现在下线桶')

// --- 4) 下线 ------------------------------------------------------------------
chk(gone.includes('This upstream sentence is gone in the new version'), '4) 只在下线桶里报了一遍')

// --- 5) 噪音一条都不进 --------------------------------------------------------
chk(!out.includes('so it must never show up in the diff'), '5) 注释里的句子不进')
chk(!mainEntries.includes('align-items'), '5) 无空格的值（CSS）不进')
chk(!mainEntries.includes('t.map(e=>e.name)'), '5) 含代码符号的片段不进')
chk(!entries(need).includes('s unused allowance'), '5) 被整句包含的残段不单列（撇号错位抽出的半截句）')
chk(!mainEntries.includes('cm-citedLine'), '5) 类名形态的单串不进（字面量级也要拦）')
chk(!mainEntries.includes('supabase_setup_invitation'), '5) 键名形态的单串不进')

// --- 6) 片段级两桶口径 --------------------------------------------------------
chk(need.includes('[短片段] bun install'), '6) 2 词小写短标签进「短片段」桶')
chk(/待补翻 3 条（文案 1 \+ 短片段 1 \+ 字面量 1）/.test(out), '6) 小结里的分桶计数正确')
chk(need.includes('[字面量] Resume queue'), '6) 口径修正：Title case 的两词标签进字面量桶（以前会漏）')

// --- 7) 上下文 ----------------------------------------------------------------
chk(/@ .*First-tab discount/.test(need), '7) 默认带命中处上下文')
const noCtx = run([prevFile, curFile, '--dict', dictFile, '--no-ctx'])
chk(!/@ /.test(section(noCtx.out, '## 新增文案 · 词典未覆盖')), '7) --no-ctx 时不打上下文')

// --- 8) 目录解析与坏输入 -------------------------------------------------------
const uiDir = path.join(WORK, 'ui')
fs.mkdirSync(path.join(uiDir, 'assets'), { recursive: true })
fs.writeFileSync(path.join(uiDir, 'index.html'), '<script type="module" src="./assets/index-abc.js"></script>')
fs.writeFileSync(path.join(uiDir, 'assets', 'index-abc.js'), CUR)
const viaDir = run([prevFile, uiDir, '--dict', dictFile, '--no-ctx'])
chk(viaDir.code === 1 && viaDir.out.includes('index-abc.js'), '8) 给 ui/ 目录能自己解析到主 bundle')
chk(run([prevFile, path.join(WORK, 'nope.js'), '--dict', dictFile]).code === 2, '8) 路径不存在 → exit 2')
chk(run([prevFile]).code === 2, '8) 参数不足 → exit 2')

// --- 9) --auto：挑版本号最大的两版 ---------------------------------------------
const arc = path.join(WORK, 'upstream')
fs.mkdirSync(arc, { recursive: true })
// 0.0.9 的 bundle 里连 states 都还没有 → 若被当成基线，states 会误报成新增
fs.writeFileSync(path.join(arc, '0.0.9-index-old.js'), 'const z = "Only in the oldest bundle"\n')
fs.writeFileSync(path.join(arc, '0.0.10-index-mid.js'), PREV)
fs.writeFileSync(path.join(arc, '0.0.114-index-new.js'), CUR)
// 快照仓库隔离到空目录：否则会把仓库真实的 work/pristine/ 扯进来（测试不许依赖本机状态）
const NO_SNAPS = path.join(WORK, 'no-snapshots')
const auto = run(['--auto', '--archive', arc, '--snapshots', NO_SNAPS, '--dict', dictFile])
chk(auto.out.includes('旧：0.0.10 · 0.0.10-index-mid.js'), '9) --auto 选中的「旧」是 0.0.10（不是 0.0.9）')
chk(auto.out.includes('新：0.0.114 · 0.0.114-index-new.js'), '9) --auto 选中的「新」是 0.0.114')
chk(!auto.out.includes('Only in the oldest bundle'), '9) 更早的 0.0.9 不参与对差')
chk(auto.code === 1, `9) --auto 与显式路径结论一致（实际 ${auto.code}）`)

const arcOne = path.join(WORK, 'upstream-one')
fs.mkdirSync(arcOne, { recursive: true })
fs.writeFileSync(path.join(arcOne, '0.0.114-index-new.js'), CUR)
const autoOne = run(['--auto', '--archive', arcOne, '--snapshots', NO_SNAPS, '--dict', dictFile])
chk(autoOne.code === 2, `9) 只有一版缓存 → exit 2（实际 ${autoOne.code}）`)
chk(/只有 1 版原版基线/.test(autoOne.err), '9) 并说明只有一版基线')
chk(/pristine\.js import --from-release/.test(autoOne.err), '9) 且给出可执行的补基线路径（不是只说「下次再说」）')

// --- 10) 全部已覆盖 → exit 0 ---------------------------------------------------
const cur2 = path.join(WORK, 'cur2.js')
fs.writeFileSync(cur2, PREV.replace('const gone', 'const added = "First-tab discount in use"\nconst gone'))
const clean = run([prevFile, cur2, '--dict', dictFile])
chk(clean.code === 0, `10) 新增都被词典覆盖 → exit 0（实际 ${clean.code}）`)
chk(/待补翻 0 条/.test(clean.out), '10) 小结显示 0 条待补翻')

// --- 11) 快照仓库（work/pristine/<版本>/）也是 --auto 的基线来源 --------------------
// 快照是 tools/pristine.js 写的可搬运形态；同一版本若快照与旧式单文件归档都在，必须按版本去重，
// 否则 --auto 会拿同一版自己跟自己比，结论永远是「新增 0 条」。
const snaps = path.join(WORK, 'pristine')
fs.mkdirSync(path.join(snaps, '0.0.113', 'ui', 'assets'), { recursive: true })
fs.writeFileSync(path.join(snaps, '0.0.113', 'ui', 'index.html'), '<script type="module" src="./assets/index-113.js"></script>')
fs.writeFileSync(path.join(snaps, '0.0.113', 'ui', 'assets', 'index-113.js'), PREV)
fs.writeFileSync(
  path.join(snaps, '0.0.113', 'snapshot.json'),
  JSON.stringify({ kind: 'freebuff-pristine-snapshot', version: '0.0.113', bundle: 'index-113.js', components: ['ui'], files: [] })
)
fs.writeFileSync(path.join(arc, '0.0.113-index-legacy.js'), 'const z = "Only in the legacy duplicate"\n')
const viaSnap = run(['--auto', '--archive', arc, '--snapshots', snaps, '--dict', dictFile])
chk(viaSnap.out.includes('旧：0.0.113 · 快照 index-113.js'), '11) --auto 认得快照仓库里的基线')
chk(!viaSnap.out.includes('Only in the legacy duplicate'), '11) 同版本的旧式归档被按版本去重掉（否则会自己跟自己比）')
chk(viaSnap.code === 1 && /待补翻 3 条/.test(viaSnap.out), `11) 拿快照当基线结论与显式路径一致（实际 ${viaSnap.code}）`)

// --- 12) 字面量级：短标签单列且不拦退出码；字面量的「已覆盖」判整串相等 -----------------
const labels = section(out, '## 短标签')
chk(labels.includes('Rechecking…'), '12) 单词 + 标点的标签进「短标签」节')
chk(!entries(need).includes('Rechecking…'), '12) 短标签不混进待补翻清单')
chk(/短标签 1 条/.test(out), '12) 小结里单独计数短标签')
chk(cov.includes('✓ [字面量] Don\'t close this window while the upload finishes.'), '12) 字面量级整串相等 → 判已覆盖')
chk(
  !need.split('\n').flatMap((l) => entryTexts(l)).includes('t close this window while the upload finishes.'),
  '13) 字面量级拿到全句后，撇号截出的半截句不再单列'
)
chk(need.includes('[字面量] Resume queue'), '13) 字面量级把片段级没报到的整串补进清单')

// 只有一条新短标签时不该拦住退出码（短标签是「人工过目」桶）
const curLabel = path.join(WORK, 'cur-label.js')
fs.writeFileSync(curLabel, PREV + 'const onlyLabel = "Rechecking…"\n')
const labelOnly = run([prevFile, curLabel, '--dict', dictFile])
chk(labelOnly.code === 0, `12) 只多一条短标签 → exit 0（实际 ${labelOnly.code}）`)
chk(/短标签 1 条/.test(labelOnly.out) && /待补翻 0 条/.test(labelOnly.out), '12) 且报告里明说待补翻 0 条、短标签 1 条')

// 单串形态的标签（无标点）仍然进不来：压缩代码里它与标识符无法区分
const curWord = path.join(WORK, 'cur-word.js')
fs.writeFileSync(curWord, PREV + 'const onlyWord = "Continue"\n')
const wordOnly = run([prevFile, curWord, '--dict', dictFile])
chk(!wordOnly.out.includes('Continue'), '12) 无标点的单词标签不进清单（交给 uipos / blindscan）')

console.log(fail ? `\n${fail} 项失败` : '\n全部通过（13 组用例）')
process.exit(fail ? 1 : 0)
