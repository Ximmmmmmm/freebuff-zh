#!/usr/bin/env node
// smoke-test.js — 发布前冒烟测试：无头 Chromium 真实加载构建产物，抓未捕获异常。
//
// 背景（0.0.100 事故）：LLM 批量翻译把 Lezer 节点名 "Emphasis" 翻成 "强调"，
// apply 后静态检查（语法/守卫/自检）全过，用户应用汉化后启动即崩
// （RangeError: unknown parser）。静态规则只能挡"已知类别"，这里用真实浏览器
// 执行 bundle，把"未知类别"的翻译事故拦在发布前。
//
// 原理：output/ui 是 orchestrator 供渲染器加载的静态站点，用本地 HTTP 服务
// 静态伺服 + headless Chromium 打开。没有 orchestrator 后端，API/WebSocket
// 请求会失败——这类网络噪音按模式过滤；真正的失败信号是：
//   1. pageerror（未捕获 JS 异常）——Emphasis 类事故在这里现形
//   2. 非网络噪音的 console.error
//   3. #root 渲染挂载（校准后启用）
//
// 用法: node tools/smoke-test.js [ui-dir]     # 默认 output/ui
// 退出码: 0=通过  1=冒烟失败  3=环境缺 playwright/chromium
const fs = require('fs')
const http = require('http')
const path = require('path')

const UI_DIR = path.resolve(process.argv[2] || path.join(__dirname, '..', 'output', 'ui'))
const WAIT_MS = parseInt(process.env.HANHUA_SMOKE_WAIT_MS || '20000', 10)

let chromium
try {
  ({ chromium } = require('playwright'))
} catch {
  console.error('SMOKE_FAIL_ENV: 缺 playwright，请先 npm install 并 npx playwright install chromium')
  process.exit(3)
}

if (!fs.existsSync(path.join(UI_DIR, 'index.html'))) {
  console.error(`SMOKE_FAIL_ENV: ${UI_DIR} 缺 index.html（先构建）`)
  process.exit(3)
}

// 文本类必须带 charset=utf-8：否则浏览器按 Latin-1 解码外部 JS，中文报错串
// 变成 "å¼ºè°ƒ" 乱码，smoke-heal.js 就提取不到中文、自愈链路静默失效。
const MIME = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
}

function serve(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '')
      const f = path.join(dir, rel)
      if (!f.startsWith(dir) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' })
      fs.createReadStream(f).pipe(res)
    })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

// 没有 orchestrator 后端时的预期网络噪音（headless 静态加载必然出现）
const NET_NOISE = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /ERR_CONNECTION_REFUSED|ERR_EMPTY_RESPONSE|ERR_TIMED_OUT/i,
  /WebSocket connection .*failed/i,
  /GET http:\/\/127\.0\.0\.1:\d+\/api\/.* (404|500|502)/i,
  /Failed to fetch/i,
]

const isNetNoise = (s) => NET_NOISE.some((re) => re.test(s))

;(async () => {
  const { srv, port } = await serve(UI_DIR)
  const url = `http://127.0.0.1:${port}/index.html`
  const pageErrors = []
  const consoleErrors = []
  let browser
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const page = await browser.newPage()
    page.on('pageerror', (err) => pageErrors.push(String(err && err.stack ? err.stack : err)))
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const t = msg.text()
        if (!isNetNoise(t)) consoleErrors.push(t)
      }
    })
    page.on('requestfailed', () => {}) // 网络层失败由 console/噪音过滤覆盖
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(WAIT_MS)
    const rootChildren = await page.evaluate(() => {
      const r = document.getElementById('root')
      return r ? r.childElementCount : -1
    }).catch(() => -1)
    const title = await page.title().catch(() => '')
    console.log(`冒烟: ${UI_DIR}`)
    console.log(`  加载 ${url} 等待 ${WAIT_MS}ms → title=${JSON.stringify(title)} #root 子元素=${rootChildren}`)

    const fatal = [...pageErrors, ...consoleErrors]
    if (pageErrors.length) {
      console.log(`  ✗ 未捕获异常 ${pageErrors.length} 条:`)
      pageErrors.slice(0, 8).forEach((e) => console.log('    ' + e.split('\n').slice(0, 4).join('\n    ')))
    }
    if (consoleErrors.length) {
      console.log(`  ✗ 非噪音 console.error ${consoleErrors.length} 条:`)
      consoleErrors.slice(0, 8).forEach((e) => console.log('    ' + e.slice(0, 300)))
    }
    if (!fatal.length) console.log('  ✓ 无未捕获异常、无非噪音 console.error')
    process.exitCode = fatal.length ? 1 : 0
    if (fatal.length) console.log('SMOKE_FAIL: 渲染器加载即崩/报错，禁止发布')
    else console.log('SMOKE_OK')
  } catch (e) {
    console.error('SMOKE_FAIL_ENV: 启动浏览器失败（缺系统依赖？）: ' + e.message)
    process.exitCode = 3
  } finally {
    if (browser) await browser.close().catch(() => {})
    srv.close()
  }
})()
