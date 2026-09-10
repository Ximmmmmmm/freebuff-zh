#!/usr/bin/env node
// codex-fix.js — 流水线自修工具：构建/翻译链路失败时，把失败报告交给 Codex
// agent，让它直接在本仓库里修复 tools/ patches/ build.sh 等流水线自身的问题。
//
// 与 codex-translate.js（read-only sandbox + /tmp 隔离目录）不同，本工具给
// agent workspace-write 权限、cwd 就是仓库——修流水线 bug 必须能写代码。
// 调用方（autoupdate.sh）负责安全闭环：
//   1) 运行前确认流水线代码区无未提交改动（保护人工 WIP，本工具不检查）
//   2) 运行后对改动做 bash -n / node --check 语法自检
//   3) 重建验证；最终失败时 git checkout 回滚全部改动
//
// 用法: node tools/codex-fix.js <report.txt> <失败背景提示> [pristine_asar] [pristine_ui]
// 退出码: 0 = agent 正常结束（是否有改动由调用方看 git diff）
//         2 = codex/净化代理不可用
// 最后消息标记: FIXED: ... / CANNOT_FIX: ...（打印为 CODEX_FIX_DONE / CODEX_FIX_CANNOT）
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const log = (m) => console.log(`[codex-fix] ${m}`)

const reportPath = process.argv[2]
const hint = process.argv[3] || ''
const asar = process.argv[4] || ''
const uiDir = process.argv[5] || ''
if (!reportPath || !fs.existsSync(reportPath)) {
  console.error('usage: node tools/codex-fix.js <report.txt> <hint> [pristine_asar] [pristine_ui]')
  process.exit(2)
}

// 净化代理存活检查（与 codex-translate.js 同一通道，见 tools/codex-proxy.js）
function proxyAlive() {
  try {
    execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '5', 'http://127.0.0.1:3128/v1/models'], { stdio: ['ignore', 'pipe', 'ignore'] })
    return true
  } catch { return false }
}
if (!proxyAlive()) { log('净化代理 127.0.0.1:3128 未运行'); console.log('CODEX_FIX_FAIL'); process.exit(2) }

let cfg = {}
try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, '.translator.json'), 'utf8')) } catch {}
const apiKey = process.env.HANHUA_LLM_KEY || cfg.apiKey || (Array.isArray(cfg.models) && cfg.models[0] && cfg.models[0].apiKey) || ''
if (!apiKey) { log('无 API key（.translator.json）'); console.log('CODEX_FIX_FAIL'); process.exit(2) }

const WORKDIR = path.join(ROOT, 'work')
fs.mkdirSync(WORKDIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 17)
const taskFile = path.join(WORKDIR, `codex-fix-task-${stamp}.txt`)
const lastMsg = path.join(WORKDIR, `codex-fix-last-${stamp}.txt`)
const codexLog = path.join(WORKDIR, `codex-fix-${stamp}.log`)

const PROMPT = `你是 Freebuff 汉化流水线（本仓库）的维护工程师。自动更新流水线失败了，请定位根因并做最小修复。

失败背景：${hint}

失败报告（先完整阅读）：${path.resolve(reportPath)}
${asar ? `英文原版 app.asar：${path.resolve(asar)}
英文原版 ui 目录：${path.resolve(uiDir || '.')}
（排查扫描器/提取器/补丁问题时可直接检查原版文件）
` : ''}
允许修改：tools/、patches/、build.sh、package.json、docs/
禁止修改：dict.json、manifest.json（词典与版本由翻译/发布流程管理）、.translator.json、.notify.json、.git/、work/、downloads/、output/、dist/

修复原则：
1. 优先怀疑流水线自身的 bug（扫描器、提取器、校验器、补丁），而不是官方安装包
2. 最小改动：不重构、不加无关功能、不动无关文件
3. 改完对每个改过的 .js/.cjs 跑 node --check、改过的 .sh 跑 bash -n 自验，不过就继续修
4. 确认无法修复时不要硬改，保持文件原样

完成后，最后一条消息只输出一行（不要其他内容）：
FIXED: <一句话说明改了什么>
或
CANNOT_FIX: <一句话说明原因>`

fs.writeFileSync(taskFile, PROMPT)

log('调用 codex 自修（最长 15 分钟）...')
try {
  execFileSync('codex', [
    'exec', '--sandbox', 'workspace-write', '-C', ROOT,
    '--skip-git-repo-check',
    '--output-last-message', lastMsg,
    `读取 ${taskFile} 里的任务说明并完成它。按说明要求的格式输出最后一条消息。`,
  ], {
    env: { ...process.env, ROUTER_API_KEY: apiKey },
    timeout: 15 * 60 * 1000,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  })
} catch (e) {
  const rc = typeof e.status === 'number' ? e.status : 2
  if (e.stdout) fs.writeFileSync(codexLog, e.stdout.toString() + '\n' + (e.stderr || '').toString())
  log(`codex 失败（退出码 ${rc}），日志: ${codexLog}`)
  console.log('CODEX_FIX_FAIL')
  process.exit(2)
}
let raw = ''
try { raw = fs.readFileSync(lastMsg, 'utf8').trim() } catch {}
fs.writeFileSync(codexLog, raw || '(无输出)')
if (raw.includes('CANNOT_FIX')) {
  log(`agent 自述无法修复：${raw.slice(0, 200)}`)
  console.log('CODEX_FIX_CANNOT')
  process.exit(0)
}
log(`agent 完成：${raw.slice(0, 200)}`)
console.log('CODEX_FIX_DONE')
