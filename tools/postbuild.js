#!/usr/bin/env node
// 构建产物自检：捕获历史上出现过的两类静默失败——
//   a) ui/index.html 补丁被静默跳过，界面实际仍是英文（v0.0.70 前科）
//   b) 主进程补丁悬空模板字符串导致启动崩溃（v0.0.72 前科）
// 用法：node tools/postbuild.js [outputDir] [--main-src <已解包的 app.asar 目录>]
//   outputDir 默认 <repo>/output；
//   给出 --main-src 时额外校验主进程文件的语法与译文哨兵（build.sh 会传 WORK/main，
//   免去重新解包）；不带时跳过主进程检查并提示。
// 全部通过 exit 0；有硬性失败 exit 1（供 build.sh 中止）。
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.join(__dirname, '..')

const args = process.argv.slice(2)
let outDir = path.join(REPO, 'output')
let mainSrc = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--main-src') mainSrc = args[++i]
  else outDir = args[i]
}

const problems = []
const warns = []
const bad = (m) => problems.push(m)
const warn = (m) => warns.push(m)
const ok = (m) => console.log('  ✓ ' + m)

console.log(`== 构建产物自检：${outDir}`)

// --- 1. 布局 -----------------------------------------------------------------
const asarPath = path.join(outDir, 'app.asar')
if (!fs.existsSync(asarPath)) {
  bad(`缺少 ${asarPath}`)
} else {
  const mb = fs.statSync(asarPath).size / 1048576
  if (mb < 1) bad(`app.asar 只有 ${mb.toFixed(2)} MB，明显异常`)
  else ok(`app.asar (${mb.toFixed(1)} MB)`)
}

const idxPath = path.join(outDir, 'ui', 'index.html')
let bundleText = null
if (!fs.existsSync(idxPath)) {
  bad(`缺少 ${idxPath}（构建参数没给 ui 目录？）`)
} else {
  const html = fs.readFileSync(idxPath, 'utf8')
  // a 类静默失败的核心断言：index.html 必须带汉化标记
  if (!html.includes('<html lang="zh-CN">')) {
    bad('ui/index.html 缺少 lang="zh-CN" —— UI 补丁未生效（v0.0.70 式静默失败）')
  } else {
    ok('ui/index.html 已汉化（lang="zh-CN"）')
  }
  if (!html.includes('<title>Freebuff 桌面版</title>')) {
    warn('ui/index.html 标题不是「Freebuff 桌面版」')
  }

  const m = html.match(/src="\.\/(assets\/[^"]+\.js)"/)
  if (!m) {
    bad('ui/index.html 里没找到主 bundle 的 <script src="./assets/...">')
  } else {
    const bp = path.join(outDir, 'ui', m[1])
    if (!fs.existsSync(bp)) {
      bad(`index.html 引用的主 bundle 不存在：${m[1]}`)
    } else {
      bundleText = fs.readFileSync(bp, 'utf8')
      ok(`主 bundle ${m[1]} (${(bundleText.length / 1048576).toFixed(1)} MB)`)
    }
  }
}

// --- 2. 主 bundle 覆盖率统计 ---------------------------------------------------
// 只统计“纯字面量”词条（原文/译文都不含 ${、引号、反引号、反斜杠、换行），
// 避免转义形态差异造成误判。单条缺失可能是词条过期（产品改文案），属正常；
// 但如果几乎全部命中不了，说明词典应用步骤压根没跑。
if (bundleText) {
  const dict = JSON.parse(fs.readFileSync(path.join(REPO, 'dict.json'), 'utf8'))
  const pure = (s) =>
    typeof s === 'string' &&
    !s.includes('${') &&
    !/["'`\\\n]/.test(s)
  const zhHasCJK = (s) => /[一-鿿]/.test(s)

  let cands = 0
  let hits = 0
  const misses = []
  for (const section of ['exact', 'template']) {
    for (const [en, zh] of Object.entries(dict[section] || {})) {
      if (!pure(en) || !pure(zh) || !zhHasCJK(zh)) continue
      cands++
      if (bundleText.includes(zh)) hits++
      else misses.push(`${section}: ${en.slice(0, 48)}`)
    }
  }
  if (cands > 0) {
    const pct = ((hits / cands) * 100).toFixed(1)
    console.log(`  · 纯字面量词条覆盖：${hits}/${cands} (${pct}%)`)
    if (hits === 0) {
      bad('主 bundle 完全不含词典译文 —— 词典应用步骤未生效')
    } else if (hits / cands < 0.5) {
      warn(`覆盖率仅 ${pct}% —— 若是刚适配新版本属正常（旧词条待清理），否则请检查构建日志里的 MISSED`)
      for (const x of misses.slice(0, 8)) console.log(`      - ${x}`)
    }
  }
}

// --- 3. 主进程检查（可选，--main-src 指向已解包/尚未打包的 asar 内容目录） -----
// 各补丁注入的稳定中文哨兵；gen_patches 重生成时这些词不变，若改了措辞需同步这里。
const MAIN_SENTINELS = {
  'electron/main.cjs': ['退出 Freebuff？', '仍要退出'],
  'electron/orchestrator-failure.cjs': ['编排器未能在规定时间内就绪。'],
  'electron/mcp-consent-bridge.cjs': ['此连接器没有可运行的命令——已拒绝'],
  'electron/linux-launch.cjs': ['无法启动所需的子进程。'],
  'electron/open-in.cjs': ['复制路径'],
}
if (mainSrc) {
  for (const rel of Object.keys(MAIN_SENTINELS)) {
    const f = path.join(mainSrc, rel)
    if (!fs.existsSync(f)) {
      bad(`主进程文件不存在：${path.join(mainSrc, rel)}`)
      continue
    }
    if (f.endsWith('.cjs')) {
      try {
        execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })
        ok(`${rel} 语法校验通过`)
      } catch (e) {
        bad(`${rel} node --check 失败 —— 补丁破坏了 JS 结构（v0.0.72 式启动崩溃）：\n${String(e.stderr || e)}`)
        continue
      }
    }
    const text = fs.readFileSync(f, 'utf8')
    for (const s of MAIN_SENTINELS[rel]) {
      if (!text.includes(s)) bad(`${rel} 缺少译文哨兵「${s}」—— 对应补丁可能未套用`)
    }
  }
  // consent-window.html 是补丁重写较多的 HTML，只查按钮哨兵
  const cw = path.join(mainSrc, 'electron', 'consent-window.html')
  if (fs.existsSync(cw)) {
    const t = fs.readFileSync(cw, 'utf8')
    if (!t.includes('批准') || !t.includes('取消')) {
      bad('consent-window.html 缺少「批准/取消」—— 同意窗口补丁可能未套用')
    }
    if (!t.includes('批准此连接器？')) {
      bad('consent-window.html 缺少标题哨兵「批准此连接器？」—— 同意窗口补丁可能未套用')
    }
  } else {
    warn('未找到 electron/consent-window.html，跳过同意窗口检查')
  }
} else {
  console.log('  · 跳过主进程检查（传 --main-src <解包目录> 可开启）')
}

// --- 汇总 ---------------------------------------------------------------------
for (const w of warns) console.log('  ! 警告: ' + w)
if (problems.length) {
  console.error('')
  for (const p of problems) console.error('  ✗ ' + p)
  console.error(`\n自检失败：${problems.length} 项硬性问题。产物不可靠，请勿安装。`)
  process.exit(1)
}
console.log('\n✓ 自检通过：布局 / index.html 汉化标记'
  + (mainSrc ? ' / 主进程语法与译文哨兵' : '')
  + ' 均正常。')
