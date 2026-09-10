#!/usr/bin/env node
// autoupdate 失败/恢复告警通知（独立小工具，自身失败不影响调用方主流程）
//
// 渠道（按优先级）：
//   1) .notify.json 的 webhooks 数组，format 支持：
//      feishu（飞书自定义机器人）/ wecom（企业微信群机器人）/ bark（iOS）/
//      serverchan（Server酱）/ generic（POST {title, body, text} 的自建接口）
//   2) 未配置或全部发送失败时，用 gh CLI 在 GitHub 仓库开 issue 兜底
//      （复用发布流程的 gh 登录，issue 标题即告警标题）
//
// 防刷屏：普通告警按「标题精确匹配」写 work/.notify-state，同一标题只发一次，
//   避免 30 分钟一次的 cron 对同一故障重复轰炸；--ok / --reset 清状态并自动
//   关闭兜底 issue（autoupdate 在版本探测恢复、成功发布时调用）。
//
// 用法：
//   node tools/notify.js <标题> [正文]           # 告警（同标题去重，正文自动附日志尾部）
//   node tools/notify.js --force <标题> [正文]    # 告警（忽略去重，测试用）
//   node tools/notify.js --ok <标题> [正文]       # 恢复/成功通知（总是发送 + 清状态 + 关 issue）
//   node tools/notify.js --reset                # 静默清状态 + 关 issue（不发通知）

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const ROOT = path.join(__dirname, '..')
const CONF_PATH = path.join(ROOT, '.notify.json')
const STATE_PATH = path.join(ROOT, 'work', '.notify-state')
const LOG_PATH = path.join(ROOT, 'work', 'autoupdate.log')
const GH_REPO_DEFAULT = 'Ximmmmmmm/freebuff-zh'
const BODY_MAX = 3600

const argv = process.argv.slice(2)
let mode = 'alert'
if (argv[0] === '--force') { mode = 'force'; argv.shift() }
else if (argv[0] === '--ok') { mode = 'ok'; argv.shift() }
else if (argv[0] === '--reset') { mode = 'reset'; argv.shift() }
const title = argv[0] || ''
let body = argv[1] || ''

function readConf() {
  try { return JSON.parse(fs.readFileSync(CONF_PATH, 'utf8')) } catch { return {} }
}
function readState() {
  try {
    const [t, i] = fs.readFileSync(STATE_PATH, 'utf8').split('\n')
    return { title: (t || '').trim(), issue: (i || '').trim() }
  } catch { return { title: '', issue: '' } }
}
function writeState(t, i) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, `${t}\n${i}\n`)
}
function clearState() { try { fs.unlinkSync(STATE_PATH) } catch {} }

function appendLogTail() {
  try {
    const tail = fs.readFileSync(LOG_PATH, 'utf8').trimEnd().split('\n').slice(-20).join('\n')
    if (tail) body += `\n\n--- work/autoupdate.log 尾部 ---\n${tail}`
  } catch {}
  if (body.length > BODY_MAX) body = body.slice(0, BODY_MAX) + '\n…（已截断）'
}

// cron 环境的 PATH 不一定包含 /usr/local/bin（gh 装在那里），显式补上
function gh(args) {
  return new Promise((resolve) => {
    execFile('gh', args, {
      cwd: ROOT,
      timeout: 90000,
      env: { ...process.env, PATH: `/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` },
    }, (err, stdout) => resolve(err ? null : String(stdout).trim()))
  })
}

async function postJson(url, obj) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(obj),
    signal: AbortSignal.timeout(20000),
  })
  return res.ok
}

async function sendWebhook(hook) {
  const url = String(hook.url || '')
  if (!/^https?:\/\//.test(url)) return false
  const fmt = String(hook.format || 'generic').toLowerCase()
  const text = `${title}\n${body}`
  if (fmt === 'feishu') return postJson(url, { msg_type: 'text', content: { text } })
  if (fmt === 'wecom') return postJson(url, { msgtype: 'text', text: { content: text } })
  if (fmt === 'bark') return postJson(url, { title, body })
  if (fmt === 'serverchan') return postJson(url, { title, desp: body })
  return postJson(url, { title, body, text })
}

async function ghRepo() {
  return readConf().githubRepo || GH_REPO_DEFAULT
}

async function ghAlert() {
  const repo = await ghRepo()
  const listRaw = await gh(['issue', 'list', '-R', repo, '--state', 'open', '--json', 'number,title', '--limit', '200'])
  let open = []
  try { open = JSON.parse(listRaw || '[]') } catch {}
  const hit = open.find((i) => i.title === title)
  if (hit) {
    console.log(`[notify] 已有同名开启 issue #${hit.number}，不重复创建`)
    return String(hit.number)
  }
  const out = await gh(['issue', 'create', '-R', repo, '--title', title, '--body', body])
  const m = out && out.match(/issues\/(\d+)/)
  if (m) { console.log(`[notify] 已创建兜底 issue #${m[1]}：${title}`); return m[1] }
  console.log(`[notify] gh 开 issue 失败：${out || '无输出'}`)
  return ''
}

async function ghResolve(comment) {
  const repo = await ghRepo()
  const st = readState()
  const targets = new Set()
  if (st.issue) targets.add(st.issue)
  if (st.title) {
    const listRaw = await gh(['issue', 'list', '-R', repo, '--state', 'open', '--json', 'number,title', '--limit', '200'])
    let open = []
    try { open = JSON.parse(listRaw || '[]') } catch {}
    for (const i of open) if (i.title === st.title) targets.add(String(i.number))
  }
  for (const n of targets) {
    await gh(['issue', 'close', String(n), '-R', repo, '-c', comment])
    console.log(`[notify] 已关闭兜底 issue #${n}`)
  }
}

async function main() {
  if (mode === 'reset') {
    await ghResolve('探测/构建链路已恢复正常，自动关闭。')
    clearState()
    return
  }
  if (!title) {
    console.error('[notify] 用法: node tools/notify.js [--force|--ok|--reset] <标题> [正文]')
    process.exit(1)
  }

  const st = readState()
  if (mode === 'alert' && st.title === title) {
    console.log(`[notify] 同标题告警已抑制（上次: ${st.title}）`)
    return
  }

  if (mode !== 'ok') appendLogTail()

  let sent = false
  let issue = ''
  for (const hook of readConf().webhooks || []) {
    try {
      if (await sendWebhook(hook)) { sent = true; console.log(`[notify] webhook 已送达（${hook.format || 'generic'}）`) }
    } catch (e) { console.log(`[notify] webhook 发送失败（${hook.format || 'generic'}）: ${e.message}`) }
  }
  if (!sent && mode !== 'ok') {
    // 仅告警走 issue 兜底；--ok 是成功/恢复通知，开 issue 没有意义
    issue = await ghAlert()
    sent = !!issue
  }

  if (mode === 'ok') {
    await ghResolve('新版本已成功发布，告警自动关闭。')
    clearState()
  } else {
    writeState(title, issue)
  }
  process.exit(sent ? 0 : 1)
}

main().catch((e) => { console.error(`[notify] 异常: ${e.message}`); process.exit(1) })
