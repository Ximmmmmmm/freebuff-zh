#!/usr/bin/env node
// retranslate.js 自测（全部走本地 mock HTTP：不碰外网、不读真实配置文件）。
//
// 钉住的是「微改写重译」这条新链路的关键行为：
//   1. 正常重译 → dictapply 落盘（旧键→新键 + 新译文），rc 0；
//   2. 模型把旧译文原样抄回 → 「改动未体现」拒绝 → 链条下一档模型补上；
//   3. 全链失败（英文残留被本地校验拒绝）→ rc 1、词典一个字节不改；
//   4. 未配置 LLM → rc 1 明说、不误动文件；
//   5. dry-run → rc 0、不动文件、无 dictapply 清单；
//   6. 新键撞车 → 该条不写、点名提示、rc 1。
'use strict'
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const REPO = path.join(__dirname, '..')
const TOOL = path.join(REPO, 'tools', 'retranslate.js')
const WORK = path.join(REPO, 'work', 'test-retranslate')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

let failures = 0
let total = 0
function chk(cond, name, extra) {
  total++
  if (cond) console.log(`  ok  ${name}`)
  else {
    failures++
    console.error(`  FAIL ${name}${extra ? `：${extra}` : ''}`)
  }
}

const OLDC = 'The backup runs every night at midnight in your chosen timezone; logs show the last run time.'
const NEWC = 'The backup runs every night at midnight in your local timezone; logs show the last run time.'
const OLDZH = '备份每晚午夜在你所选时区运行；日志会显示上次运行时间。'
const NEWZH = '备份每晚午夜在你本地时区运行；日志会显示上次运行时间。'
const OTHER_OLD = 'Your saved card will be charged once for each successful renewal of the plan.'
const OTHER_NEW = 'Your stored card will be billed once for every successful renewal of the plan.'
const OTHER_ZH = '你保存的银行卡将在每次成功续订套餐时扣费一次。'
const OTHER_NEWZH = '你保存的卡片将在每次成功续订套餐时计费一次。'

const readDict = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
function mkCase(name) {
  const dir = path.join(WORK, name)
  fs.mkdirSync(dir, { recursive: true })
  const items = path.join(dir, 'retranslate-20261012-120000.json')
  fs.writeFileSync(
    items,
    JSON.stringify(
      [
        { section: 'exact', oldKey: OLDC, newKey: NEWC, oldZh: OLDZH, change: { from: 'chosen', to: 'local' } },
        { section: 'exact', oldKey: OTHER_OLD, newKey: OTHER_NEW, oldZh: OTHER_ZH, change: { from: 'charged / each', to: 'billed / every' } },
      ],
      null,
      2,
    ) + '\n',
  )
  // 注意：四个分区都要有内容——lint_dict 的行级解析对整段空的 `"xxx": {},` 会报 E0；
  // 真实词典四个分区从不为空，这里用最小占位条目保持同形（与 test_dictapply 的基座夹具同款）。
  const dict = path.join(dir, 'dict.json')
  fs.writeFileSync(
    dict,
    JSON.stringify(
      {
        exact: { [OLDC]: OLDZH, [OTHER_OLD]: OTHER_ZH },
        template: { 'Hello ${name}': '你好 ${name}' },
        code: { 'run_file_change_hooks:"Hooks"': 'run_file_change_hooks:"文件变更钩子"' },
        pattern: { Providers: '提供商' },
      },
      null,
      2,
    ) + '\n',
  )
  return { dir, items, dict }
}

function startMock(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => handler(req, res, body))
    })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }))
  })
}
const reply = (res, out) => {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ choices: [{ message: { content: out } }] }))
}
const okHandler = (req, res, body) => {
  const user = JSON.parse(body).messages.slice(-1)[0].content
  reply(res, user.includes('local timezone') ? NEWZH : OTHER_NEWZH)
}
const userOf = (body) => JSON.parse(body).messages.slice(-1)[0].content

function writeCfg(models) {
  const p = path.join(WORK, 'translator.json')
  fs.writeFileSync(p, JSON.stringify({ models, paceMs: 0 }, null, 2) + '\n')
  return p
}
const childEnv = (cfgPath) => ({
  ...process.env,
  HANHUA_LLM_BASE: '',
  HANHUA_LLM_KEY: '',
  HANHUA_LLM_MODEL: '',
  HANHUA_TRANSLATOR_CONFIG: cfgPath,
})
// 必须用异步 spawn：mock 服务端跑在本测试进程里，同步 execFileSync 会把事件循环冻住，
// 子进程的 fetch 永远等不到响应（两边互等死锁）。
function runTool(args, cfgPath) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [TOOL, ...args], { env: childEnv(cfgPath) })
    let out = ''
    p.stdout.on('data', (c) => (out += c))
    p.stderr.on('data', (c) => (out += c))
    p.on('close', (code) => resolve({ code, out }))
  })
}

;(async () => {
  console.log('retranslate 自测\n')

  // --- 1) 正常重译 → dictapply 落盘 ---------------------------------------------------
  {
    const c = mkCase('ok')
    const m = await startMock(okHandler)
    const cfg = writeCfg([{ baseUrl: m.url, apiKey: 'k', model: 'm1' }])
    const r = await runTool([c.items, '--write', '--dict', c.dict], cfg)
    chk(r.code === 0, `正常重译 → rc 0（实际 ${r.code}）\n${r.out}`)
    const d = readDict(c.dict).exact
    chk(d[NEWC] === NEWZH && d[OTHER_NEW] === OTHER_NEWZH, '两条都落盘（旧键→新键 + 新译文）')
    chk(!(OLDC in d) && !(OTHER_OLD in d), '旧键已移除')
    chk(fs.existsSync(path.join(c.dir, 'retranslate-apply-20261012-120000.json')), 'dictapply 清单已生成（时间戳沿用输入名）')
    chk(/已落盘/.test(r.out), '输出写明已落盘（含 lint 后置闸门）')
    m.srv.close()
  }

  // --- 2) 同译文拒绝 + 链条故障切换 ---------------------------------------------------
  {
    const c = mkCase('failover')
    let calls = 0
    const m = await startMock((req, res, body) => {
      calls++
      const b = JSON.parse(body)
      const user = userOf(body)
      const ok = user.includes('local timezone') ? NEWZH : OTHER_NEWZH
      const bad = user.includes('local timezone') ? OLDZH : OTHER_ZH
      reply(res, b.model === 'm1' ? bad : ok)
    })
    const cfg = writeCfg([
      { baseUrl: m.url, apiKey: 'k', model: 'm1' },
      { baseUrl: m.url, apiKey: 'k', model: 'm2' },
    ])
    const r = await runTool([c.items, '--write', '--dict', c.dict], cfg)
    chk(r.code === 0 && calls === 4, `模型 A 原样抄回被拒 → 模型 B 补上（rc ${r.code}，请求 ${calls} 次）\n${r.out}`)
    const d = readDict(c.dict).exact
    chk(d[NEWC] === NEWZH && d[OTHER_NEW] === OTHER_NEWZH, '故障切换后两条都正确落盘')
    m.srv.close()
  }

  // --- 3) 全链失败（校验拒绝）→ rc 1、词典不动 ----------------------------------------
  {
    const c = mkCase('badllm')
    const m = await startMock((req, res) => reply(res, 'English only answer'))
    const cfg = writeCfg([{ baseUrl: m.url, apiKey: 'k', model: 'm1' }])
    const before = fs.readFileSync(c.dict, 'utf8')
    const r = await runTool([c.items, '--write', '--dict', c.dict], cfg)
    chk(r.code === 1 && /仍有 2 条未解决/.test(r.out), `全链失败 → rc 1 + 未解决计数（实际 ${r.code}）\n${r.out}`)
    chk(fs.readFileSync(c.dict, 'utf8') === before, '失败时词典一个字节未改')
    m.srv.close()
  }

  // --- 4) 未配置 LLM → rc 1 明说、不误动文件 -------------------------------------------
  {
    const c = mkCase('nocfg')
    const before = fs.readFileSync(c.dict, 'utf8')
    const r = await runTool([c.items, '--write', '--dict', c.dict], path.join(WORK, 'not-exist.json'))
    chk(r.code === 1 && /未配置/.test(r.out), '未配置 LLM → rc 1 且明说（不误动文件）')
    chk(fs.readFileSync(c.dict, 'utf8') === before, '未配置时词典一个字节未改')
  }

  // --- 5) dry-run → 动嘴不动手 --------------------------------------------------------
  {
    const c = mkCase('dry')
    const m = await startMock(okHandler)
    const cfg = writeCfg([{ baseUrl: m.url, apiKey: 'k', model: 'm1' }])
    const before = fs.readFileSync(c.dict, 'utf8')
    const r = await runTool([c.items, '--dict', c.dict], cfg)
    chk(r.code === 0 && /dry-run/.test(r.out), `dry-run → rc 0 且提示未写文件（实际 ${r.code}）`)
    chk(fs.readFileSync(c.dict, 'utf8') === before, 'dry-run 词典未改')
    chk(!fs.existsSync(path.join(c.dir, 'retranslate-apply-20261012-120000.json')), 'dry-run 不生成 dictapply 清单')
    m.srv.close()
  }

  // --- 6) 新键撞车 → 该条不写、点名、rc 1 ---------------------------------------------
  {
    const c = mkCase('collide')
    const d0 = readDict(c.dict)
    d0.exact[NEWC] = '已存在的译文'
    fs.writeFileSync(c.dict, JSON.stringify(d0, null, 2) + '\n')
    const m = await startMock(okHandler)
    const cfg = writeCfg([{ baseUrl: m.url, apiKey: 'k', model: 'm1' }])
    const r = await runTool([c.items, '--write', '--dict', c.dict], cfg)
    chk(r.code === 1 && /新键已存在/.test(r.out), `新键撞车 → rc 1 且点名（实际 ${r.code}）\n${r.out}`)
    const d = readDict(c.dict).exact
    chk(d[NEWC] === '已存在的译文', '撞车条目未被覆盖')
    chk(d[OTHER_NEW] === OTHER_NEWZH, '另一条照常落盘（部分完成）')
    m.srv.close()
  }

  console.log(failures ? `\n${failures} 项失败（共 ${total}）` : '\n全部通过')
  process.exit(failures ? 1 : 0)
})()
