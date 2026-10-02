#!/usr/bin/env node
// uipos_gap 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 这道体检补的是「单词级文案」这个系统性盲区：upstreamdiff 的片段级（≥3 词）与字面量级
// （≥2 词）都进不来，regress 的片段提取同样只认句子。所以它自己的口径必须钉死：
//   1. 解析 uipos 输出时只认 `## 小节` 之后的「数字+制表符」行——`\t@ 上下文` 续行
//      （--ctx）和小节之前的统计行都不能进集合，否则两侧差集会假报；
//   2. 差集 = 本版 − 上一版 − 登记表；上一版就有的（品牌名/模型名/代码）不算新增；
//   3. 有未登记新增 → rc 1（构建流程要拦）；全登记 → rc 0；参数/输入不对 → rc 2；
//   3b. 报告把新增项按形态分三桶（能翻 / 该登记 / 存疑）——分类只是**建议**，
//      不参与退出码；`--flat` 回到老的分桶前平铺清单（跨版 diff 两版报告时用）；
//   4. 登记表里**整串已不在产物里**的条目要提醒清理，但不失败；只为 upstreamdiff 的
//      字面量通道登记的（模型名 `displayName:"Solar Mini 4"` 这种 uipos 不扫的位置）不算
//      死条目——旧口径拿 uipos 的集合判定，把这 5 条从 0.0.140 一直报到 0.0.147。
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { parseUipos, classifyItem } = require(path.join(__dirname, 'uipos_gap.js'))

const REPO = path.join(__dirname, '..')
const WORK = path.join(REPO, 'work', 'test-uipos-gap')
fs.rmSync(WORK, { recursive: true, force: true })

const write = (rel, body) => {
  const p = path.join(WORK, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}
const pack = (name, bundle) => {
  write(`${name}/ui/index.html`, '<script type="module" crossorigin src="./assets/index-AAA.js"></script>\n')
  write(`${name}/ui/assets/index-AAA.js`, bundle)
  return path.join(WORK, name)
}

// 上一版产物：Settings / Old knob / Shared label
const prevDir = pack('prev', 'var a={label:"Settings"},b={label:"Old knob"},c={children:"Shared label"}\n')
// 本版产物：多了 Theme（这就是「单词级新文案」），Shared label 仍在；另外两串在**uipos 不扫的
// 位置**上（车配上一版字面量通道登记过的模型名与模板形态的第三方库 aria-label）
const curDir = pack(
  'cur',
  'var a={label:"Settings"},b={label:"Theme"},c={children:"Shared label"},' +
    'd={displayName:"Solar Mini 4"},e=`Action: ${x}${y}.`\n',
)
const emptyDir = path.join(WORK, 'no-bundle')
fs.mkdirSync(emptyDir, { recursive: true })

// 分类夹具：同一版本对（上一版只有 Settings），本版多出三条——各归一类，
// 用来钉「哪条进哪个桶」与 `--flat` 的老形态
const prevClassify = pack('prev-classify', 'var a={label:"Settings"}\n')
const curClassify = pack(
  'cur-classify',
  'var a={label:"Settings"},' +
    'b={"aria-label":"fpc fpc-- fpc--asset"},' +
    'c={children:"A different pace."},' +
    'd={"aria-label":`Dismiss ${x} ad`}\n',
)

// 只登记上一版就有的那条（Settings）；Theme 是「本版新增、词典还没覆盖」的样子
const allowSettings = write('allow-settings.json', JSON.stringify({ uiStrings: [{ text: 'Settings', why: '测试：上一版就有' }] }, null, 2))
const allowAll = write('allow-all.json', JSON.stringify({ uiStrings: [{ text: 'Settings', why: '测试' }, { text: 'Theme', why: '测试' }] }, null, 2))
const allowStale = write(
  'allow-stale.json',
  JSON.stringify({ uiStrings: [{ text: 'Settings', why: '测试' }, { text: 'Vanished', why: '上游已删' }] }, null, 2),
)
// 只在字面量通道 / 模板形态上活着的登记项：uipos 看不见它们，但它们确实还在产物里
const allowLiteral = write(
  'allow-literal.json',
  JSON.stringify(
    {
      uiStrings: [
        { text: 'Settings', why: '测试：上一版就有' },
        { text: 'Theme', why: '测试' },
        { text: 'Solar Mini 4', why: '测试：模型名，uipos 不扫 displayName:，为字面量通道而登记' },
        { text: 'Action: ${…}${…}.', why: '测试：第三方库 aria-label，登记表按 ${…} 形态写' },
      ],
    },
    null,
    2,
  ),
)
// 同样两串，但产物里整串已没了 → 仍要提醒清理
const allowLiteralGone = write(
  'allow-literal-gone.json',
  JSON.stringify(
    {
      uiStrings: [
        { text: 'Settings', why: '测试' },
        { text: 'Theme', why: '测试' },
        { text: 'Solar Mini X', why: '测试：模型已下线' },
        { text: 'Action: ${…}${…} cancelled.', why: '测试：模板整串已改写' },
      ],
    },
    null,
    2,
  ),
)

const run = (args) => {
  try {
    return { code: 0, out: execFileSync('node', [path.join(REPO, 'tools', 'uipos_gap.js'), ...args], { encoding: 'utf8' }) }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}
let fail = 0
const chk = (ok, msg) => {
  console.log((ok ? '  ok  ' : '  FAIL ') + msg)
  if (!ok) fail++
}

// --- 单元：uipos 输出解析 -----------------------------------------------------------
const sample = [
  'remaining UI-position English: 3',
  'some preamble 99\tNOT A SECTION',
  '',
  '## label (2)',
  '4\tSettings',
  '\t@ ...label:"Settings"',
  '1\tTheme',
  '',
  '## children (1)',
  '2\tShared label',
  '',
].join('\n')
const parsed = parseUipos(sample)
chk(parsed.size === 3, `解析：只取小节内的「数字+制表符」行（得 ${parsed.size}，期望 3）`)
chk(parsed.has('Settings') && parsed.has('Theme') && parsed.has('Shared label'), '解析：条目文本去掉首尾空白后入集合')
chk(!parsed.has('NOT A SECTION'), '解析：小节之前的行不算')
chk(![...parsed].some((x) => x.startsWith('@')), '解析：\\t@ 上下文续行不算')

// --- 端到端：差集 -----------------------------------------------------------------
const rGap = run(['--bundle', curDir, '--prev', prevDir, '--allow', allowSettings])
chk(rGap.code === 1, `有未登记新增 → rc 1（实际 ${rGap.code}）`)
chk(/本版界面位置英文 3 处，上一版 3 处/.test(rGap.out), '报告里给出两侧计数')
chk(/本版独有 1 处/.test(rGap.out), '扣除登记表后只剩 1 处')
chk(/· Theme/.test(rGap.out), '列出未覆盖的新增项 Theme')
chk(!/· Settings/.test(rGap.out), '登记表已覆盖的不再列出')
chk(!/· Old knob/.test(rGap.out) && !/· Shared label/.test(rGap.out), '上一版就有的不进「本版独有」')

const rClean = run(['--bundle', curDir, '--prev', prevDir, '--allow', allowAll])
chk(rClean.code === 0 && /没有未登记的新增项/.test(rClean.out), '新增项全部登记 → rc 0')

const rNoPrev = run(['--bundle', curDir, '--allow', allowSettings])
chk(rNoPrev.code === 1 && /本版界面位置英文 3 处/.test(rNoPrev.out), '没有上一版基线时看全量（仍按登记表扣除）')

const rStale = run(['--bundle', curDir, '--prev', prevDir, '--allow', allowStale])
chk(/可以清理/.test(rStale.out) && /Vanished/.test(rStale.out), '登记表里本版已看不见的条目提醒清理')
chk(rStale.code === 1, '清理提醒本身不变成 rc 0（真正的新增项照样拦）')

const rLiteral = run(['--bundle', curDir, '--prev', prevDir, '--allow', allowLiteral])
chk(rLiteral.code === 0, `字面量通道 / 模板形态的登记项齐备 → rc 0（实际 ${rLiteral.code}）`)
chk(!/可以清理/.test(rLiteral.out), '只为字面量通道登记的条目（uipos 看不见但产物里还在）不算死条目')
chk(!/Solar Mini 4|Action:/.test(rLiteral.out), '这类条目也不进清理清单的点名')

const rLiteralGone = run(['--bundle', curDir, '--prev', prevDir, '--allow', allowLiteralGone])
chk(
  /· Solar Mini X/.test(rLiteralGone.out) && /· Action: /.test(rLiteralGone.out),
  '整串已不在产物里的条目照旧提醒清理（含 ${…} 形态）',
)
chk(!/· Solar Mini 4/.test(rLiteralGone.out) && !/· Settings/.test(rLiteralGone.out), '还在产物里的条目仍不进清理清单')

// --- 单元：形态分类（判据全部来自本仓库登记表与 0.0.156 实测） ---------------------
const cls = (s) => classifyItem(s).verdict
chk(cls('/api/byok/connections/ /models') === 'register', '分类：API 路径 → 该登记')
chk(cls('/placement-previews/runable- .webp') === 'register', '分类：素材路径 → 该登记')
chk(cls('fpc fpc-- fpc--asset') === 'register', '分类：BEM 类名组合 → 该登记')
chk(cls('.explorer, .explorer-header') === 'register', '分类：DOM 选择器 → 该登记')
chk(cls('app desktop-shell') === 'register', '分类：kebab 两词类名 → 该登记')
chk(cls('git init') === 'register' && cls('bun install') === 'register', '分类：命令行 → 该登记')
chk(cls('getUser()') === 'register', '分类：代码片段（整串无空格）→ 该登记')
chk(cls('{') === 'register', '分类：单个括号（JSON 示例片段）→ 该登记')
chk(
  cls('Arguments (JSON array)') === 'translate' && cls('Cancel (Esc)') === 'translate',
  '分类：带括号注的文案（有空格的括号）不能当代码',
)
chk(cls('user =') === 'register', '分类：赋值片段（尾部无值也算）→ 该登记')
chk(cls("'Guest'") === 'register', '分类：引号字面量 → 该登记')
chk(cls('mcpServers') === 'register', '分类：camelCase 标识符 → 该登记')
chk(cls('Accepted') === 'translate' && cls('Mon') === 'translate', '分类：单词标签 → 能翻')
chk(cls('A different pace.') === 'translate', '分类：多词短语 → 能翻')
chk(
  cls('Images stay in this browser session. PNG, JPEG, WebP or AVIF, up to 10 MB.') === 'translate',
  '分类：带缩写的整句 → 能翻（含空格就不当路径）',
)
chk(cls('Dismiss ${…} ad') === 'unsure', '分类：模板串 → 存疑（补 template 或登记）')
chk(cls('Solar Mini 4') === 'unsure', '分类：标题式含数字 → 存疑（疑似模型名）')
chk(cls('API') === 'unsure', '分类：全大写缩写 → 存疑（术语还是标签分不出来）')

// --- 端到端：分桶报告 -------------------------------------------------------------
const rClassify = run(['--bundle', curClassify, '--prev', prevClassify, '--allow', allowSettings])
chk(rClassify.code === 1, `分桶报告仍按未登记新增拦下（rc ${rClassify.code}）`)
chk(
  /形态分类：能翻（补 dict.json） 1 · 该登记（形态上多半不是文案） 1 · 存疑（人工定夺） 1/.test(rClassify.out),
  '小结行给出三桶计数',
)
chk(/### 能翻（补 dict.json）（1）/.test(rClassify.out), '能翻单独成节')
chk(/· A different pace\.\s+← 多词短语/.test(rClassify.out), '能翻桶带上判断依据')
chk(/· fpc fpc-- fpc--asset\s+← CSS 类名 \/ 选择器/.test(rClassify.out), '该登记桶：CSS 类名')
chk(/· Dismiss \$\{…\} ad\s+← 模板串/.test(rClassify.out), '存疑桶：模板串')

const rFlat = run(['--bundle', curClassify, '--prev', prevClassify, '--allow', allowSettings, '--flat'])
chk(rFlat.code === 1, '--flat 不改变退出码')
chk(!/形态分类：/.test(rFlat.out) && !/^### /m.test(rFlat.out), '--flat 回到不分桶的平铺清单')
chk(/· A different pace\./.test(rFlat.out) && /· fpc fpc-- fpc--asset/.test(rFlat.out), '--flat 仍列出全部新增项')

const rRegistered = run(['--bundle', curDir, '--prev', prevDir, '--allow', allowSettings, '--quiet'])
chk(!/本版界面位置英文/.test(rRegistered.out) && rRegistered.code === 1, '--quiet 只留清单，去掉统计行')

// --- 参数 / 输入契约 ---------------------------------------------------------------
chk(run(['--prev', prevDir]).code === 2, '缺 --bundle → rc 2')
chk(run(['--bundle', path.join(WORK, 'nope')]).code === 2, 'bundle 路径不存在 → rc 2')
chk(run(['--bundle', emptyDir]).code === 2, '目录里找不到主 bundle → rc 2')
chk(run(['--bundle', curDir, '--prev', path.join(WORK, 'nope')]).code === 2, '--prev 路径不存在 → rc 2')
chk(run(['--bundle', curDir, '--bad']).code === 2, '未知参数 → rc 2')

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
