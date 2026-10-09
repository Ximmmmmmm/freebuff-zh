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
const { findUnsafeMatches } = require('./semantic_guard')

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
      try {
        // Vite 产物是 ES module（包含 import.meta）。复制为带唯一名称的 .mjs
        // 后再 --check，让 Node 按模块语法解析，而不尝试执行或解析依赖。
        const os = require('os')
        const checkPath = path.join(os.tmpdir(), `freebuff-ui-check-${process.pid}-${Date.now()}.mjs`)
        fs.copyFileSync(bp, checkPath)
        try {
          execFileSync(process.execPath, ['--check', checkPath], { stdio: 'pipe' })
        } finally {
          try { fs.unlinkSync(checkPath) } catch { /* 文件可能已被系统清理 */ }
        }
        ok('主 bundle JavaScript 语法校验通过')
      } catch (e) {
        bad(`主 bundle node --check 失败 —— UI 产物不是合法 JavaScript：\\n${String(e.stderr || e)}`)
      }

      const unsafe = findUnsafeMatches(bundleText)
      if (unsafe.length) {
        const unique = [...new Map(unsafe.map((x) => [`${x.value}\\u0000${x.reason}`, x])).values()]
        for (const item of unique.slice(0, 30)) {
          bad(`主 bundle 在${item.reason}中出现中文字面量「${item.value}」`)
        }
        if (unique.length > 30) bad(`主 bundle 另有 ${unique.length - 30} 个代码语义中文字面量，详见 semantic_guard 扫描`)
      } else {
        ok('主 bundle 代码语义常量未发现中文')
      }
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
// 各补丁注入的稳定中文哨兵；补丁中的这些词不变；若改了措辞需同步这里。
const MAIN_SENTINELS = {
  // 最后一条不是译文，而是行为补丁：orchestrator 重启时沿用同一 launch id
  // （否则渲染进程缓存的令牌作废，此后每个写操作都被本机 orchestrator 403
  // forbidden，见 patches/electron-main.cjs.patch 的 startOrchestrator 那一段）。
  'electron/main.cjs': [
    '退出 Freebuff？',
    '仍要退出',
    '汉化包补丁：orchestrator 崩溃重启时沿用本次应用会话已发出的 launch id',
    'const launchId = apiLaunchToken ?? randomUUID()',
    // 崩溃对话框 / 原生对话框 / 菜单 / 文件管理器报错（0.0.113 适配时补翻），
    // 每条对应补丁里一组独立的改动，用于把「补丁只套了一半」这种半途而废挡住。
    '获取兼容版本',
    '无法停止已失败的编排器。',
    '请确认已安装 Bun，或设置 FREEBUFF_BUN_PATH。',
    '进程：${details.reason}）',
    '所有图片',
    '该应用不可用',
    '导出为 Markdown…',
    '移到新窗口',
    // 窗口按钮区（titleBarOverlay）：底色交给界面自己画，图标色与高度跟随 CSS（产物改动，不是翻译）：
    // 上游给 UI 换了新配色、又把 --tabbar-height 覆盖成 48px，主进程那张影子表却留着旧值，
    // 于是窗口按钮区在标签条右侧露出一块颜色、高度与图标深浅都对不上的矩形。
    // 底色现在直接给全透明：露出来的就是标签条自己的那一层（开壁纸时它是 transparent）。
    'const HANHUA_SHELL_COLORS = (() => {',
    'overlay: HANHUA_SHELL_COLORS.overlay,',
    'overlaySymbol: HANHUA_SHELL_COLORS.symbolLight,',
    'height: HANHUA_SHELL_COLORS.height,',
    // 0.0.154 修的那一半：CSS 里那两个变量可能是 `var(...)` 的转发，必须解到底再交出去。
    // 没有它就等于回到「把 var(...) 字符串当颜色」——哨兵只查上面那几行文本，查不出这个差别。
    'const shellColor = (re, name, fallbackValue) => {',
  ],
  // 0.0.162：上游把原生应用菜单从 main.cjs 拆成了 electron/app-menu.cjs（main.cjs 里那
  // 段 buildMenu 已不存在），菜单译文随 patches/electron-app-menu.cjs.patch 一起搬了过来。
  // 哨兵跟着搬，否则「补丁没套上」会退回成静默失败——菜单是英文而其余界面是中文。
  'electron/app-menu.cjs': [
    '将标签页移到新窗口',
    '重新打开已关闭的标签页',
    '打开项目…',
    '重新加载应用',
    '检查更新…',
  ],
  // 0.0.162：浏览器导入子系统的用户可见文案全在主进程（IPC 报错、原生对话框），词典够不着，
  // 只能靠 patches/electron-browser-*.cjs.patch。本版上游给这套 IPC 新加了一批报错
  // （导入 Cookie / 导入扩展的失败路径），下面四个文件的哨兵随之补齐。
  'electron/browser-data.cjs': [
    '浏览器导入仅在桌面版可用。',
    '打开「系统设置 → 隐私与安全性 → 完全磁盘访问权限」。',
  ],
  'electron/browser-extensions.cjs': [
    '扩展的工具栏按钮与弹出窗口暂不可用。',
    '不支持该扩展的清单文件。',
  ],
  'electron/browser-import.cjs': [
    // 0.0.131 适配时补翻的那批
    '不支持的应用绑定 Cookie 加密。',
    // 0.0.162 新增的导入失败路径
    '部分加密 Cookie 无法解锁。系统询问时请允许访问浏览器的密钥，或重新登录。',
  ],
  'electron/browser-native.cjs': [
    '检查元素',
    '请等待此配置文件的导入完成后再移除。',
  ],
  'electron/orchestrator-failure.cjs': [
    '编排器未能在规定时间内就绪。',
    // Bun 崩溃对话框整段（0.0.113 适配时补翻）
    '这是 Bun 内部的缺陷，而不是 Freebuff 的问题，完整报告见日志。',
    'Freebuff 的运行时崩溃了',
  ],
  'electron/mcp-consent-bridge.cjs': [
    '此连接器没有可运行的命令——已拒绝',
    // 同意窗口：第二行说明与赞助任务批准按钮（0.0.113 适配时补翻）
    '环境变量名会显示，其值不会。',
    "['否', '是']",
  ],
  'electron/linux-launch.cjs': ['无法启动所需的子进程。'],
  'electron/open-in.cjs': ['复制路径'],
  // 0.0.155 起缩放菜单从 Electron 内建 role（随系统语言自动本地化）换成硬编码 label，
  // 三项都会直接出现在 View 菜单里，靠 patches/electron-zoom-menu.cjs.patch 补翻。
  'electron/zoom-menu.cjs': ['实际大小', '放大', '缩小'],
  // electron/updater.cjs 的译文哨兵随「暂停更新」补丁一起退场：0.0.148 上游删掉了
  // 整个暂停机制（loadState / saveState / validPauseDate 与 set-pause IPC 全无），
  // 那两条报错已不存在，补丁与哨兵都不再需要。
}
// 可选哨兵：对应的主进程文件只存在于较新的 Freebuff 版本里（老版本 asar 里没有），
// 因此缺失只警告不报错，存在则必须带译文哨兵。
const OPTIONAL_SENTINELS = {
  // 0.0.107 新增：渲染进程健康状况采样 + 「窗口已停止」恢复弹窗
  'electron/renderer-health.cjs': ['重新加载窗口'],
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
  // 窗口按钮区不能只看哨兵：两种坏法都是「补丁文本一个字节没变、值却不对」——0.0.154 那块色差
  // （把 `var(--shell-base)` 当颜色交出去，Electron 回落成系统默认底色）、以及 overlay 被改回不透明色
  // （开壁纸时右上角重新露出一块实心矩形）。哨兵全绿、用户照样看得见。
  // 所以再拿产物 main.cjs 与产物 ui 跑一次行为取证：rc 1 = 值不对（挡住），rc 2 = 拿不到证据（只警告）。
  {
    const mainCjs = path.join(mainSrc, 'electron', 'main.cjs')
    if (fs.existsSync(mainCjs)) {
      try {
        execFileSync(
          process.execPath,
          [path.join(__dirname, 'probe_shell_colors.js'), mainCjs, '--ui', path.join(outDir, 'ui'), '--expect', 'ok'],
          { stdio: 'pipe' },
        )
        ok('窗口按钮区行为取证通过（底色交给界面 / 图标色 / 高度与界面 CSS 一致）')
      } catch (e) {
        const out = `${e.stdout || ''}${e.stderr || ''}`.trim()
        if (e.status === 1) bad(`窗口按钮区与界面 CSS 对不上（tools/probe_shell_colors.js）:\n${out}`)
        else warn(`窗口按钮区行为取证拿不到证据（rc ${e.status ?? '?'}）—— 补丁效果未经实测，仅凭哨兵放行:\n${out}`)
      }
    }
  }
  for (const rel of Object.keys(OPTIONAL_SENTINELS)) {
    const f = path.join(mainSrc, rel)
    if (!fs.existsSync(f)) {
      warn(`主进程文件不存在（旧版本正常）：${rel}，跳过哨兵检查`)
      continue
    }
    try {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })
      ok(`${rel} 语法校验通过`)
    } catch (e) {
      bad(`${rel} node --check 失败 —— 补丁破坏了 JS 结构：\n${String(e.stderr || e)}`)
      continue
    }
    const text = fs.readFileSync(f, 'utf8')
    for (const s of OPTIONAL_SENTINELS[rel]) {
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
