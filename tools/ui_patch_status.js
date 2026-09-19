#!/usr/bin/env node
// UI 行为补丁的**退场判定**：一条命令回答「上游自己修好了吗？这些补丁能不能删？」
//
// 背景：`tools/apply_ui_code_patch.js` 里的补丁是在修上游渲染进程的缺陷，属于「人家修好了
// 就该退场」的临时桩。要退场就得先确认缺陷真的消失了——而这件事不能靠肉眼看代码（2.4 MB
// minified），也不能靠「锚点还在不在」（锚点还在恰恰说明代码没被大改，不代表缺陷没了）。
// 所以判据是行为：把 probes 登记的探针跑在**英文原版** bundle 上，看缺陷还能不能复现。
//
// 两个维度、四种结论（锚点维度来自 apply_ui_code_patch.js 的干跑，缺陷维度来自探针）：
//
//   | 锚点还能命中 | 原版仍能复现缺陷 | 结论    | 该做什么                        |
//   |--------------|------------------|---------|---------------------------------|
//   | 是           | 是               | KEEP    | 什么都不用做                    |
//   | 否           | 是               | REWRITE | 上游改写了代码，需重新定位锚点  |
//   | 是 / 否      | 否               | RETIRE  | 上游自己修了，补丁可安全删除    |
//   | 无法取证     | 无法取证         | UNKNOWN | 人工核对（探针抽不到函数）      |
//
// 用法：
//   node tools/ui_patch_status.js                 # 自动找本机英文原版（hanhua-backup-* 优先）
//   node tools/ui_patch_status.js <原版 bundle|ui 目录|resources 目录>
//   退出码：0 全部 KEEP / 1 有可退场的 / 2 有必要人工介入的（REWRITE，构建也会失败）
//           3 仅无法取证（不拦构建，但需人工核对）
//
// 安全护栏：只接受**英文原版**。已打补丁的产物里缺陷必然“复现不出”，拿它判定会得出
// 「可以退场」这个完全错误的结论——所以看到本次补丁的哨兵就直接拒绝，并告诉你该指哪个文件。
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const { PATCHES, SENTINELS, applyPatches } = require('./apply_ui_code_patch.js')
const { resolveBundle } = require('./blindscan.js')
const streamEpoch = require('./probe_stream_epoch.js')
const tokenEpoch = require('./probe_token_epoch.js')

// 缺陷登记表：defect id → 探针模块。新增一组行为补丁时，在这里补上它的探针；
// 没有探针的补丁组会被如实标成 UNKNOWN，而不是悄悄当成「无需行动」。
// 探针的 verdict() 可以是同步的（stream-epoch）也可以是异步的（token-epoch，因为请求包装器
// 是 async 的），下面统一 await。
const PROBES = {
  [streamEpoch.ID]: streamEpoch,
  [tokenEpoch.ID]: tokenEpoch,
}

// 每个缺陷组自己的探针与自测文件名（RETIRE 的删除清单要按组点名，而不是写死一组）。
const PROBE_FILES = {
  [streamEpoch.ID]: ['tools/probe_stream_epoch.js', 'tools/test_probe_stream_epoch.js'],
  [tokenEpoch.ID]: ['tools/probe_token_epoch.js', 'tools/test_probe_token_epoch.js'],
}

const INSTALL = path.join(process.env.LOCALAPPDATA || '', 'Programs', '@codebufffreebuff-desktop')

/**
 * 决策表：把两个维度收敛成一个结论。纯函数，自测（test_ui_patch_status.js）钉的就是它。
 * @param {{anchorsOk: boolean, defect: 'present'|'absent'|'unknown'|'unprobed'}} dims
 * @returns {'KEEP'|'REWRITE'|'RETIRE'|'UNKNOWN'}
 */
function decide({ anchorsOk, defect }) {
  if (defect === 'present') return anchorsOk ? 'KEEP' : 'REWRITE'
  if (defect === 'absent') return 'RETIRE'
  return 'UNKNOWN' // unknown / unprobed 都不许推断缺陷已消失
}

/** 自动定位英文原版 bundle：hanhua-backup-* 里的 ui 优先，其次装机目录（且必须未被汉化）。 */
function findPristine() {
  const res = path.join(INSTALL, 'resources')
  let backups = []
  try {
    backups = fs
      .readdirSync(res)
      .filter((n) => n.startsWith('hanhua-backup-'))
      .map((n) => path.join(res, n))
      .filter((p) => fs.existsSync(path.join(p, 'ui', 'index.html')))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  } catch {
    /* 未安装：下面按「找不到原版」报错 */
  }
  if (backups.length) return { bundle: resolveBundle(backups[0], () => null), from: backups[0] }
  const inst = path.join(res, 'orchestrator', 'ui', 'index.html')
  if (fs.existsSync(inst)) {
    const html = fs.readFileSync(inst, 'utf8')
    if (!html.includes('<html lang="zh-CN">')) {
      return { bundle: resolveBundle(path.join(res, 'orchestrator', 'ui'), () => null), from: path.join(res, 'orchestrator', 'ui') }
    }
  }
  return { bundle: null, from: null }
}

/** RETIRE 时给出的删除清单：按顺序、每条都点名文件，最后一条是「删完怎么验」。 */
function retireChecklist(group) {
  const ids = group.patches.map((p) => p.id)
  return [
    `    1. tools/apply_ui_code_patch.js —— 删掉 PATCHES 里的 ${ids.length} 条（${ids.join(' / ')}）。`,
    `       SENTINELS 与 postbuild 的哨兵断言都由 PATCHES 推导，会自动跟着少，不用手改。`,
    `    2. ${(PROBE_FILES[group.defect] || []).join(' / ') || '（本组没有探针文件）'} —— 本缺陷的探针与自测。`,
    `    3. tools/postbuild.js —— \`const { verdict: probeVerdict } = ...\` 那行 + 行为取证那一段（约 15 行）。`,
    `    4. tools/ui_patch_status.js —— 删掉缺陷登记表里的 '${group.defect}' 条目（若再无其它缺陷则整个工具可删）。`,
    `    5. tools/update.sh —— 2/7 体检步与小结两行（步骤数 7 → 6）。`,
    `    6. .github/workflows/ci.yml —— 「行为取证探针自测」那一步。`,
    `    7. docs/更新维护.md —— 「第五种静默失败」整节、工具表两行、常见问题里那一条。`,
    `    删完跑一次：bash tools/update.sh —— 应全绿，且报告里不再出现 UI 行为补丁小节。`,
  ]
}

async function main() {
  const args = process.argv.slice(2)
  const given = args.find((a) => !a.startsWith('--'))

  let bundleFile = null
  let source = ''
  if (given) {
    bundleFile = resolveBundle(given, (msg) => {
      console.error(msg)
      process.exit(2)
    })
    source = given
  } else {
    const found = findPristine()
    if (!found.bundle) {
      console.error('ERROR: 找不到英文原版 bundle。安装目录既没有 hanhua-backup-*/ui，装机目录也不是未汉化的原版。')
      console.error('  请显式传入：node tools/ui_patch_status.js <原版 bundle | ui 目录 | resources 目录>')
      process.exit(2)
    }
    bundleFile = found.bundle
    source = found.from
  }

  const src = fs.readFileSync(bundleFile, 'utf8')
  console.log('UI 行为补丁退场判定')
  console.log(`  原版 bundle：${bundleFile}`)
  if (source && source !== bundleFile) console.log(`  （来自：${source}）`)

  // 护栏：产物里缺陷必然“复现不出”，拿它判定会得出完全相反的结论。
  const seen = SENTINELS.filter((s) => src.includes(s))
  if (seen.length) {
    console.error(`\nERROR: 这是一个**已打补丁的产物**（看到 ${seen.length} 条本次补丁的哨兵），不能用来判定退场。`)
    console.error('  已打补丁的 bundle 里缺陷一定复现不出，据此删补丁是错的。')
    console.error('  请指向英文原版：安装目录的 resources/hanhua-backup-*/ui，或安装目录当前的英文原文。')
    console.error('  （想看某组缺陷是不是“真的修好了”，用 postbuild 的行为取证，或按缺陷组跑'+
      ' node tools/probe_stream_epoch.js / probe_token_epoch.js <产物 bundle> --expect absent）')
    process.exit(2)
  }

  // --- 按缺陷分组 -----------------------------------------------------------------
  const anchors = applyPatches(src)
  const anchorMissed = new Set(anchors.missed.map((m) => m.id))
  const groups = new Map()
  for (const p of PATCHES) {
    const key = p.defect || '(未登记缺陷)'
    if (!groups.has(key)) groups.set(key, { defect: key, patches: [] })
    groups.get(key).patches.push(p)
  }

  let retire = 0
  let rewrite = 0
  let unknown = 0
  let keep = 0

  for (const group of groups.values()) {
    const probeMod = PROBES[group.defect]
    console.log(`\n缺陷组 ${group.defect}${probeMod ? ` —— ${probeMod.TITLE}` : '（未登记探针）'}`)
    console.log(`  补丁（${group.patches.length} 条）：${group.patches.map((p) => p.id).join(', ')}`)

    const misses = group.patches.filter((p) => anchorMissed.has(p.id))
    const anchorsOk = misses.length === 0
    if (anchorsOk) {
      console.log(`  锚点：${group.patches.length} 条全部唯一命中`)
    } else {
      const why = anchors.missed.find((m) => m.id === misses[0].id)
      console.log(`  锚点：未命中 ${misses.length} 条（${misses.map((p) => p.id).join(', ')}）`)
      if (why) console.log(`        原因：${why.reason || '匹配不到源码'}`)
    }

    let defect = 'unknown'
    let detail = ''
    if (!probeMod) {
      defect = 'unprobed'
      detail = '该缺陷没有登记探针，无法自动判定退场'
      console.log(`  取证：${detail}`)
    } else {
      try {
        const v = await probeMod.verdict(src)
        for (const r of v.rows) {
          // rows 自带的 text 优先（新探针都有）；没有的就按 stream-epoch 的老字段渲染
          console.log(
            '    ' +
              (r.text ||
                `${r.label.padEnd(22)} 保留本地内容=${r.kept ? '是' : '否'}  增量生效=${r.delta ? '是' : '否'}  finish 生效=${r.finish ? '是' : '否'}`),
          )
        }
        defect = v.defectPresent ? 'present' : 'absent'
      } catch (e) {
        detail = e.message
        console.log(`  取证：无法取证（${detail}）—— 探针抽不到函数，上游结构已变`)
      }
    }

    const decision = decide({ anchorsOk, defect })
    if (decision === 'KEEP') keep++
    else if (decision === 'RETIRE') retire++
    else if (decision === 'REWRITE') rewrite++
    else unknown++

    console.log(`  判定：${decision}`)
    const label = decision
    if (label === 'KEEP') {
      console.log('    → 上游仍带着这个缺陷，补丁继续保留，无需任何操作。')
    } else if (label === 'RETIRE') {
      console.log('    → 上游已复现不出该缺陷（自己修了，或改用了别的机制）。')
      console.log('    → 删前请人工确认一次：上游是真修了，而不是把这段逻辑挪走/换名了。')
      console.log('    可安全删除（按顺序）：')
      for (const line of retireChecklist(group)) console.log(line)
    } else if (label === 'REWRITE') {
      console.log('    → 上游改写了这段代码但缺陷仍在：需要在原版里重新定位同一处语义，')
      console.log('      更新 tools/apply_ui_code_patch.js 的 find/apply（构建也会在这里中止）。')
    } else {
      console.log(`    → 不能据此判定缺陷已消失${detail ? `（${detail}）` : ''}：请人工核对上游是否改写了这段代码。`)
    }
  }

  console.log(`\n小结：KEEP ${keep} / RETIRE ${retire} / REWRITE ${rewrite} / UNKNOWN ${unknown}`)
  if (retire) console.log('有 ' + retire + ' 组补丁可以退场（删除清单见上）。')
  if (rewrite) console.log('有 ' + rewrite + ' 组需要重新维护锚点。')
  if (unknown && !retire && !rewrite) console.log('有 ' + unknown + ' 组无法自动判定，请看上面每组的原因。')

  process.exit(retire ? 1 : rewrite ? 2 : unknown ? 3 : 0)
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`ui_patch_status: 意外错误 ${(e && e.stack) || e}`)
    process.exit(2)
  })
}

module.exports = { decide, retireChecklist, PROBES, findPristine }
