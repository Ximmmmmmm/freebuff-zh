#!/usr/bin/env node
// 上游文案对差（upstreamdiff）：拿**两版英文原版**的主 bundle 对差，列出本版上游新写 / 改写 /
// 下线的英文文案——**不依赖上一版汉化包**。
//
// 与 regress 的分工（为什么需要它）：
//   · `regress.js` 比的是「上一版汉化包 vs 本版产物」，前提是**存在上一版汉化包**：首次发布、
//     没发过包、离线取不到包时它直接跳过，那道闸门就白跑了；
//   · 而「本版上游新增了哪些文案」根本不需要汉化包——两版英文原版一比就知道。适配时先拿到
//     这张清单，就能在补翻之前把要翻的句子挑出来，而不是等 MISSED / 回归闸门一条条报。
//
// 真正的难点不是比对，而是**上一版的英文原版从哪来**：装机目录被自动更新覆盖后旧的英文原版
// 就没了（0.0.114 的自动更新把 hanhua-backup-* 一起清了）。所以本版原版由 `build.sh` 每次构建
// 登记成**快照**（`work/pristine/<版本>/`，见 tools/pristine.js），`--auto` 取最新两版；旧式单文件
// 归档 `work/upstream/<版本>-<bundle>` 仍照读（同一版本两处都有时按版本去重）。也可以直接给两个
// 路径（bundle 文件 / ui 目录 / resources 目录 / 快照目录都行）。
//
// 只有一版基线时不要就此放过：`node tools/pristine.js list` 看本机还能挖到什么，
// `... import --from-release latest` 从我们自己的 Release 取上一版原版，
// `... capture --exe <安装包>` 从安装包解（需要 7-Zip）。
//
// 判据与 `regress.js` 共用同一份提取器（由它导出）：先整体抹掉 `${...}` 插值（minifier 改变量名
// 不误报），再取引号相邻 / 模板逐段的英文片段并滤掉代码片段。两边都有 = 不是新增；只在一边 =
// 新增 / 下线；一段改写会同时表现为「一增一下线」，所以再按词重合度把两边配对成一组「改写」，
// 免得把同一件事当成两条手工核对。
//
// **两层扫描**（片段级 + 字面量级），因为片段级口径为了在 2.4 MB 压缩代码里少报噪音，要求
// 「≥3 词 + 小写词占比 ≥0.6 + 含常见小词」，它拿不到两类东西：
//   a) 三词以内的短标签——`Recheck setup`、` Country & allowance`（小写词占比正好 0.5）、`Rechecking…`
//      （不足 2 词），0.0.120 适配时 6 条新文案就是这么漏掉的；
//   b) 被同批更长片段包含的独立短句——报告里「被更长片段包含」的残段不会单列（撇号 / 引号错位
//      抽出的半截句），可这条规则同时也藏掉了代码里**另一条真实存在**的短字符串；
// 这两类都靠第二层补：只认有引号边界的完整字符串（`collectLiteralsFromSource`，判据是
//      「像不像标识符」而不是「像不像句子」），它比片段级多收短标签，也能给出**准确的字符串
//      边界**。两层的文本归一化口径相同，所以能直接去重：片段级已经报过的（含已覆盖、已写成
//      改写组）不再重复列，**被 prune 藏起来的会在这一层补回来**，而字面量级的「已覆盖」用
//      整串相等判（片段级的子串匹配是为了迁就抽取产物；字面量要的是「dict 里有没有正好这一条
//      键」，否则 `…checkpoint.` 会被含它的长句键判成已覆盖，而代码里它是另一条独立字符串，
//      实际没人翻）。
//
// 反过来，字面量级也帮片段级清理：片段级在撇号处就截断（`"Freebuff couldn't complete…"` 只抽出
// `t complete…`），现在 `pruneSubsumed` 把字面量级的整串也当作「更长的东西」，这类半截句不再
// 单列；但**本身也是完整字符串**的片段例外（`This Git repository needs a committed checkpoint.`
// 是独立字符串，同时也是长句的前缀），否则就真丢了。
//
// 四个桶（口径不同，别混着看）：
//   · 文案（片段级：含常见小词）／短片段（≥2 词但不含常见小词，人工过目）——片段级的两个桶；
//   · 字面量（片段级没报到的完整短串）——进「待补翻」清单，拦住退出码；
//   · 短标签（单词 + 自然语言标点，如 `Rechecking…`）——单列一节，**不拦退出码**，交给
//     uipos / blindscan 兜底。
//   只有「词典未覆盖」的新增才让退出码非 0，短片段 / 短标签两桶允许有噪音。
//
// 用法：
//   node tools/upstreamdiff.js <上一版英文原版> <本版英文原版>
//   node tools/upstreamdiff.js --auto                    # 用快照仓库 / 旧式归档里最新的两版
//   可选：--archive <dir>    旧式单文件归档目录（默认 work/upstream）
//         --snapshots <dir>  快照仓库目录（默认 work/pristine）
//         --dict <path>      词典（默认仓库根 dict.json），用来标注「已覆盖 / 待补翻」
//         --no-ctx         不打印命中处上下文
//         --verbose        展开全部下线条目
// 退出码：0 = 新增文案在词典里都已覆盖；1 = 有「词典未覆盖」的新增（正是本版要翻的清单）；
//         2 = 输入不足 / 无法解析（例如只有一版原版缓存）。
// 自测：node tools/test_upstreamdiff.js（CI 会跑）。
'use strict'

const fs = require('fs')
const path = require('path')
const { collectFragmentsFromSource, collectLiteralsFromSource, resolveBundle, stripInterp, COMMON } = require('./regress.js')

const ROOT = path.join(__dirname, '..')
const DEFAULT_ARCHIVE = path.join(ROOT, 'work', 'upstream')
const DEFAULT_SNAPSHOTS = path.join(ROOT, 'work', 'pristine')
const DEFAULT_DICT = path.join(ROOT, 'dict.json')

// --- 比对 ---------------------------------------------------------------------

// 词集合（用于改写配对）：只留 ≥3 字母的词，免得 the / of 这类把不相关的两句配到一起
function tokens(s) {
  return new Set(s.toLowerCase().match(/[a-z]{3,}/g) || [])
}

// 重合度用「较小一侧被覆盖的比例」而不是 Jaccard：整段重写通常是「原句保留 + 补一句」，
// 词数差距大时 Jaccard 会掉到阈值以下，就不成对了（0.0.113 那次余额提示重写正是这种情况）。
function similarity(a, b) {
  const A = tokens(a)
  const B = tokens(b)
  let common = 0
  for (const t of A) if (B.has(t)) common++
  const denom = Math.min(A.size, B.size)
  return { common, score: denom ? common / denom : 0 }
}

function pairRewrites(removed, added) {
  const cand = []
  for (const r of removed) {
    for (const a of added) {
      const { common, score } = similarity(r, a)
      if (common >= 3 && score >= 0.5) cand.push({ r, a, common, score })
    }
  }
  cand.sort((x, y) => y.score - x.score || y.common - x.common)
  const pairs = []
  const usedR = new Set()
  const usedA = new Set()
  for (const c of cand) {
    if (usedR.has(c.r) || usedA.has(c.a)) continue
    usedR.add(c.r)
    usedA.add(c.a)
    pairs.push(c)
  }
  return { pairs, usedR, usedA }
}

// 拔掉被同批里更长片段完整包含的残段。提取器对「每个引号都当开引号」配对，于是文案里的
// 撇号（`Today's`）也会开一段，抽出 `s unused allowance … balance.` 这种半截东西；它一定
// 被同一句完整文案包含，单列出来只会让人多核对一遍。（只是显示层去重，不影响两边都有的判断。）
//
// 第二组「更长的东西」是字面量级的整串：片段级在撇号处就会截断（`"Freebuff couldn't complete…"`
// 只抽出 `t complete…`），而字面量级按同类型引号闭合，拿到的是全句。两者一起看，才认得出哪个
// 是残段。但**本身就是一条完整字符串**的例外——它在同一批里也算字面量，被当残段拔掉就真丢了
// （`This Git repository needs a committed checkpoint.` 是独立字符串，同时也是长句的前缀）。
const normEdge = (s) => s.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9.!?]+$/, '')

function pruneSubsumed(list, literals = new Set()) {
  const norm = list.map(normEdge)
  const lits = [...literals]
  return list.filter((x, i) => {
    if (literals.has(x)) return true
    if (list.some((__, j) => j !== i && norm[j].length > norm[i].length && norm[j].includes(norm[i]))) return false
    return !lits.some((lit) => lit.length > norm[i].length && lit.includes(norm[i]))
  })
}

// --- 词典覆盖 ------------------------------------------------------------------

// 词典键里带着 `${...}` 与原始空白，与「抹掉插值、折叠空白」后的片段不同名，所以键也按同一套
// 归一化后再做判断（例如键 `First-tab discount · up to ${x.amount} Freebucks off` 归一化后
// 正好包含片段 `First-tab discount · up to Freebucks off`）。
function dictKeys(dictPath) {
  const d = JSON.parse(fs.readFileSync(dictPath, 'utf8'))
  const keys = []
  for (const sec of ['exact', 'template', 'code', 'pattern']) {
    for (const k of Object.keys(d[sec] || {})) keys.push(stripInterp(k).replace(/\s+/g, ' ').trim())
  }
  return keys
}

// 片段级用子串匹配：片段本身是抽取产物（抹掉插值、可能只是句子的一截），要求整串相等会大面积误报。
const coveredBy = (frag, keys) => keys.some((k) => k.includes(frag))

// 字面量级用整串相等：到这里已经是「一条完整字符串」，dict 里只有键**正好**是它，替换才会命中。
// 用子串匹配的话，`This Git repository needs a committed checkpoint.` 会被含它的长句键判成
// 已覆盖——可它在代码里是另一条独立字符串，实际没人翻（0.0.120 适配时踩过）。
const coveredExactly = (lit, keySet) => keySet.has(lit)

// --- 定位上下文 ----------------------------------------------------------------

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 片段是折过空白的，直接在源码里 indexOf 会找不到（换行 / 缩进），所以把空白换成 \s+
function contextOf(src, frag) {
  let at = -1
  try {
    const m = new RegExp(frag.split(/\s+/).map(esc).join('\\s+')).exec(src)
    if (m) at = m.index
  } catch {
    at = src.indexOf(frag)
  }
  if (at < 0) return ''
  return src.slice(Math.max(0, at - 70), at + frag.length + 70).replace(/\s+/g, ' ').trim()
}

// --- 原版基线（快照仓库 work/pristine/ + 旧式归档 work/upstream/）------------------------

function cmpVersion(a, b) {
  const A = a.split('.').map(Number)
  const B = b.split('.').map(Number)
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const d = (A[i] || 0) - (B[i] || 0)
    if (d) return d
  }
  return 0
}

// 快照仓库（tools/pristine.js 写的，可跨机器搬）：每个 <版本>/ 目录就是一份原版
function snapshotEntries(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((n) => fs.existsSync(path.join(dir, n, 'snapshot.json')))
    .map((n) => {
      let bundle = null
      try {
        bundle = JSON.parse(fs.readFileSync(path.join(dir, n, 'snapshot.json'), 'utf8')).bundle
      } catch {
        /* 坏元数据交给 pristine.js 报，这里只要版本号 */
      }
      return { version: n, name: bundle ? `快照 ${bundle}` : '快照', file: path.join(dir, n), kind: 'snapshot' }
    })
}

function legacyEntries(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ version: f.split('-')[0], name: f, file: path.join(dir, f), kind: 'file' }))
}

// 两个存放地合并，**按版本去重**：同一版本若快照与旧式归档都在，留着快照那份。不去重的话
// `--auto` 会把同一版当成「上一版」和「本版」比，结论永远是「新增 0 条」——正是那种最安静的错。
function archiveEntries(fileDir, snapDir = DEFAULT_SNAPSHOTS) {
  const seen = new Set()
  const out = []
  for (const e of [...snapshotEntries(snapDir), ...legacyEntries(fileDir)]) {
    if (seen.has(e.version)) continue
    seen.add(e.version)
    out.push(e)
  }
  return out.sort((a, b) => cmpVersion(b.version, a.version))
}

// --- 报告 ---------------------------------------------------------------------

const BUCKET = (frag) => (/ /.test(frag) && COMMON.test(frag) ? '文案' : '短片段')

// 字面量级的桶：完整字符串有引号边界，判据比片段级松，但仍要把「命令 / 术语」与「UI 文案」
// 分开——全小写又不含常见小词的短语（`bun install`、`sudo apt`）多半是命令，人工过目即可；
// 首字母大写或含常见小词的才是真文案（`Resume queue`、`Recheck setup`、` First-tab discount …`）。
// 单词标签（`Rechecking…`）单列：它们在压缩产物里与标识符长得太像，一律收进来会淹掉清单。
const LITERAL_BUCKET = (lit) => {
  if (!/ /.test(lit)) return '短标签'
  return COMMON.test(lit) || /^[A-Z]/.test(lit) ? '文案' : '短标签'
}

function main(argv) {
  const flags = argv.filter((a) => a.startsWith('--'))
  const valueOf = (name, dflt) => {
    const i = argv.indexOf(name)
    if (i === -1) return dflt
    const v = argv[i + 1]
    if (!v || v.startsWith('--')) {
      console.error(`ERROR: ${name} 需要一个路径`)
      return null
    }
    return v
  }
  const noCtx = flags.includes('--no-ctx')
  const verbose = flags.includes('--verbose')
  const auto = flags.includes('--auto')

  const archive = valueOf('--archive', DEFAULT_ARCHIVE)
  const snapshots = valueOf('--snapshots', DEFAULT_SNAPSHOTS)
  const dictPath = valueOf('--dict', DEFAULT_DICT)
  if (archive === null || snapshots === null || dictPath === null) return 2

  // 位置参数（--auto 时不需要）
  const positional = argv.filter((a, i) => !a.startsWith('--') && !['--archive', '--snapshots', '--dict'].includes(argv[i - 1]))

  let prevInput = positional[0]
  let curInput = positional[1]
  let prevLabel = prevInput
  let curLabel = curInput

  if (auto) {
    const entries = archiveEntries(archive, snapshots)
    if (entries.length < 2) {
      // 只有一版基线时不能就这么算了：这是「本版新增文案」这一步失效的常见原因，
      // 而它完全可以补——所以这里把三条可执行的补救路径直接打出来。
      console.error(`ERROR: 只有 ${entries.length} 版原版基线，没法对差（需要「上一版 + 本版」两份）。`)
      console.error(`  已登记：${entries.map((e) => e.version).join(', ') || '（无）'}；本版原版由 build.sh 每次构建登记到 work/pristine/<版本>/。`)
      console.error('  补齐上一版基线（三选一）：')
      console.error('    · node tools/pristine.js list                      # 看本机还能挖到什么（备份 / 装机原版 / 安装包）')
      console.error('    · node tools/pristine.js import --from-release latest   # 从我们自己的 Release 取（发布会附上）')
      console.error('    · node tools/pristine.js capture --exe <安装包>      # 从 NSIS 安装包解（需要 7-Zip）')
      console.error('  也可以跳过基线：node tools/upstreamdiff.js <上一版英文原版> <本版英文原版>')
      return 2
    }
    curInput = entries[0].file
    prevInput = entries[1].file
    prevLabel = `${entries[1].version} · ${entries[1].name}`
    curLabel = `${entries[0].version} · ${entries[0].name}`  } else if (!prevInput || !curInput) {
    console.error('用法：node tools/upstreamdiff.js <上一版英文原版> <本版英文原版>')
    console.error('      node tools/upstreamdiff.js --auto          # 用快照仓库 / 旧式归档里最新的两版')
    console.error('（两侧都可以给 bundle 文件 / ui 目录 / resources 目录）')
    return 2
  }

  const prevFile = resolveBundle(prevInput)
  const curFile = resolveBundle(curInput)
  if (!prevFile || !curFile) {
    console.error(`ERROR: 无法定位主 bundle：${prevFile ? '' : prevInput + ' '}${curFile ? '' : curInput}`)
    console.error('（期望目录里有 ui/index.html，或 assets/index-*.js，或直接给 bundle 文件）')
    return 2
  }
  if (!auto) {
    prevLabel = path.basename(prevFile)
    curLabel = path.basename(curFile)
  }

  // 宽口径取一遍（≥2 词、不要求常见小词），两个桶都从这一份结果里分。
  const opts = { minWords: 2, requireCommon: false }
  const prevSrc = fs.readFileSync(prevFile, 'utf8')
  const curSrc = fs.readFileSync(curFile, 'utf8')
  const prevSet = collectFragmentsFromSource(prevSrc, opts)
  const curSet = collectFragmentsFromSource(curSrc, opts)

  // 字面量级：同一份源码再扫一遍，拿「完整字符串」补片段级口径看不到的东西（主要是三词以内的
  // 短标签），顺便给上面那步去残段提供准确的字符串边界。去重规则见文件头。
  const prevLits = collectLiteralsFromSource(prevSrc)
  const curLits = collectLiteralsFromSource(curSrc)
  const litAdded = [...curLits.keys()].filter((t) => !prevLits.has(t))

  const addedAll = pruneSubsumed([...curSet].filter((x) => !prevSet.has(x)).sort(), new Set(curLits.keys()))
  const removedAll = pruneSubsumed([...prevSet].filter((x) => !curSet.has(x)).sort(), new Set(prevLits.keys()))

  const { pairs, usedR, usedA } = pairRewrites(removedAll, addedAll)
  const added = addedAll.filter((x) => !usedA.has(x))
  const removed = removedAll.filter((x) => !usedR.has(x))

  // 只按「片段级已经报过的文本」去重（被 prune 藏起来的不算报过，正需要这一层补回来）。
  const reportedFrag = new Set(addedAll)
  const litOnly = litAdded.filter((t) => !reportedFrag.has(t))

  let keys = []
  try {
    keys = dictKeys(dictPath)
  } catch {
    console.error(`WARN: 读不到词典 ${dictPath}，跳过「已覆盖 / 待补翻」标注。`)
  }
  const keySet = new Set(keys)
  const uncovered = keys.length ? added.filter((f) => !coveredBy(f, keys)) : []
  const covered = keys.length ? added.filter((f) => coveredBy(f, keys)) : added
  const litUncovered = keys.length ? litOnly.filter((t) => !coveredExactly(t, keySet)) : []
  const litCovered = keys.length ? litOnly.filter((t) => coveredExactly(t, keySet)) : litOnly
  const sortedUncovered = uncovered.slice().sort((a, b) => BUCKET(a).localeCompare(BUCKET(b)))
  // 字面量级按桶分：文案进「待补翻」（拦退出码），单词标签单列（不拦）
  const litProse = litUncovered.filter((t) => LITERAL_BUCKET(t) === '文案').sort()
  const litLabels = litUncovered.filter((t) => LITERAL_BUCKET(t) === '短标签').sort()
  const pending = sortedUncovered.length + litProse.length

  console.log('上游文案对差（英文原版 vs 英文原版，不依赖上一版汉化包）')
  console.log(`  旧：${prevLabel}`)
  console.log(`  新：${curLabel}`)
  console.log(
    `  上一版英文片段 ${prevSet.size} 处；本版 ${curSet.size} 处 → 新增 ${added.length}、` +
      `下线 ${removed.length}、疑似改写 ${pairs.length} 组`
  )
  console.log(
    `  字面量级：本版 ${curLits.size} 条 / 上一版 ${prevLits.size} 条 → 新增 ${litAdded.length}` +
      `（其中 ${litOnly.length} 条是片段级没报到的）`
  )
  console.log(`  词典覆盖：新增里 ${covered.length + litCovered.length} 条已覆盖 / ${uncovered.length + litUncovered.length} 条待补翻`)

  if (pending) {
    console.log('\n## 新增文案 · 词典未覆盖（本版要翻的清单）')
    for (const f of sortedUncovered) {
      console.log(`  ⚠ [${BUCKET(f)}] ${f}`)
      if (!noCtx) {
        const ctx = contextOf(curSrc, f)
        if (ctx) console.log(`      @ ${ctx}`)
      }
    }
    for (const t of litProse) {
      console.log(`  ⚠ [字面量] ${t}`)
      if (!noCtx) {
        const ctx = contextOf(curSrc, t)
        if (ctx) console.log(`      @ ${ctx}`)
      }
    }
  }

  if (litLabels.length) {
    console.log('\n## 短标签 · 词典未覆盖（人工过目，不影响退出码）')
    console.log('   单词标签在压缩产物里与标识符长得太像，一律收进来会淹掉清单；确认是文案就补进 dict.json。')
    for (const t of litLabels) console.log(`  · ${t}`)
  }

  if (pairs.length) {
    console.log('\n## 疑似改写（上一版那句被改写成新版那句——通常伴生 MISSED 与旧词条下线）')
    for (const p of pairs) {
      console.log(`  · 旧：${p.r}`)
      console.log(`    新：${p.a}（重合 ${p.common} 词）`)
    }
  }

  if (covered.length || litCovered.length) {
    console.log('\n## 新增文案 · 词典已覆盖（核对译文是否仍然贴切）')
    for (const f of covered.slice().sort()) console.log(`  ✓ [${BUCKET(f)}] ${f}`)
    for (const t of litCovered.slice().sort()) console.log(`  ✓ [字面量] ${t}`)
  }

  if (removed.length) {
    const show = verbose ? removed : removed.slice(0, 30)
    console.log('\n## 上一版下线（dict 里对应词条可能已成死条目）')
    for (const f of show) console.log(`  · ${f}`)
    if (show.length < removed.length) console.log(`  … 其余 ${removed.length - show.length} 条（--verbose 展开）`)
  }

  const proseUncovered = sortedUncovered.filter((f) => BUCKET(f) === '文案').length
  const fragUncovered = sortedUncovered.length - proseUncovered
  console.log(
    `\n小结：待补翻 ${pending} 条（文案 ${proseUncovered} + 短片段 ${fragUncovered} + 字面量 ${litProse.length}）、` +
      `短标签 ${litLabels.length} 条（人工过目，不拦退出码）、疑似改写 ${pairs.length} 组、下线 ${removed.length} 条`
  )
  if (pending) {
    console.log('  处理：把待补翻的句子补进 dict.json（按字面量形态选 exact / template 分区）后重跑 bash build.sh；')
    console.log('        标 [字面量] 的要保证 dict 里有一条键**整串**等于它（子串相同不算），否则替换不会命中；')
    console.log('        短片段里的术语 / 命令 / 库内部文案按 uipos / blindscan 的既有惯例保留英文即可。')
  }
  return pending ? 1 : 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))

module.exports = { main, pairRewrites, similarity, dictKeys, archiveEntries, cmpVersion, BUCKET, LITERAL_BUCKET }
