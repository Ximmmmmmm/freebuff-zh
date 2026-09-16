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
// 报告里「被同批更长的片段包含」的残段不会单列（撇号 / 引号错位抽出的半截句），计数也随之。
//
// 两个桶（口径不同，别混着看）：
//   · 句子感强（含常见小词）——多半真是给人看的文案；
//   · 短片段（≥2 词但不含常见小词）——可能是标签，也可能是术语 / MIME / 样式值，人工过目。
//   只有「词典未覆盖」的新增才让退出码非 0，短片段桶允许有噪音。
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
const { collectFragmentsFromSource, resolveBundle, stripInterp, COMMON } = require('./regress.js')

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
const normEdge = (s) => s.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9.!?]+$/, '')

function pruneSubsumed(list) {
  const norm = list.map(normEdge)
  return list.filter((_, i) => !list.some((__, j) => j !== i && norm[j].length > norm[i].length && norm[j].includes(norm[i])))
}

// --- 词典覆盖 ------------------------------------------------------------------

// 词典键里带着 `${...}` 与原始空白，与「抹掉插值、折叠空白」后的片段不同名，所以键也按同一套
// 归一化后再做子串判断（例如键 `First-tab discount · up to ${x.amount} Freebucks off` 归一化后
// 正好包含片段 `First-tab discount · up to Freebucks off`）。
function dictKeys(dictPath) {
  const d = JSON.parse(fs.readFileSync(dictPath, 'utf8'))
  const keys = []
  for (const sec of ['exact', 'template', 'code', 'pattern']) {
    for (const k of Object.keys(d[sec] || {})) keys.push(stripInterp(k).replace(/\s+/g, ' ').trim())
  }
  return keys
}

const coveredBy = (frag, keys) => keys.some((k) => k.includes(frag))

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

  const addedAll = pruneSubsumed([...curSet].filter((x) => !prevSet.has(x)).sort())
  const removedAll = pruneSubsumed([...prevSet].filter((x) => !curSet.has(x)).sort())

  const { pairs, usedR, usedA } = pairRewrites(removedAll, addedAll)
  const added = addedAll.filter((x) => !usedA.has(x))
  const removed = removedAll.filter((x) => !usedR.has(x))

  let keys = []
  try {
    keys = dictKeys(dictPath)
  } catch {
    console.error(`WARN: 读不到词典 ${dictPath}，跳过「已覆盖 / 待补翻」标注。`)
  }
  const uncovered = keys.length ? added.filter((f) => !coveredBy(f, keys)) : []
  const covered = keys.length ? added.filter((f) => coveredBy(f, keys)) : added
  const sortedUncovered = uncovered.slice().sort((a, b) => BUCKET(a).localeCompare(BUCKET(b)))

  console.log('上游文案对差（英文原版 vs 英文原版，不依赖上一版汉化包）')
  console.log(`  旧：${prevLabel}`)
  console.log(`  新：${curLabel}`)
  console.log(
    `  上一版英文片段 ${prevSet.size} 处；本版 ${curSet.size} 处 → 新增 ${added.length}、` +
      `下线 ${removed.length}、疑似改写 ${pairs.length} 组`
  )
  console.log(`  词典覆盖：新增里 ${covered.length} 条已覆盖 / ${uncovered.length} 条待补翻`)

  if (sortedUncovered.length) {
    console.log('\n## 新增文案 · 词典未覆盖（本版要翻的清单）')
    for (const f of sortedUncovered) {
      console.log(`  ⚠ [${BUCKET(f)}] ${f}`)
      if (!noCtx) {
        const ctx = contextOf(curSrc, f)
        if (ctx) console.log(`      @ ${ctx}`)
      }
    }
  }

  if (pairs.length) {
    console.log('\n## 疑似改写（上一版那句被改写成新版那句——通常伴生 MISSED 与旧词条下线）')
    for (const p of pairs) {
      console.log(`  · 旧：${p.r}`)
      console.log(`    新：${p.a}（重合 ${p.common} 词）`)
    }
  }

  if (covered.length) {
    console.log('\n## 新增文案 · 词典已覆盖（核对译文是否仍然贴切）')
    for (const f of covered.slice().sort()) console.log(`  ✓ [${BUCKET(f)}] ${f}`)
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
    `\n小结：待补翻 ${sortedUncovered.length} 条（文案 ${proseUncovered} + 短片段 ${fragUncovered}）、` +
      `疑似改写 ${pairs.length} 组、下线 ${removed.length} 条`
  )
  if (sortedUncovered.length) {
    console.log('  处理：把待补翻的句子补进 dict.json（按字面量形态选 exact / template 分区）后重跑 bash build.sh；')
    console.log('        短片段里的术语 / 命令 / 库内部文案按 uipos / blindscan 的既有惯例保留英文即可。')
  }
  return sortedUncovered.length ? 1 : 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))

module.exports = { main, pairRewrites, similarity, dictKeys, archiveEntries, cmpVersion, BUCKET }
