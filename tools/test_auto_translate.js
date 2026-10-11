#!/usr/bin/env node
// auto_translate.js 自测：
//   1) 规则层（术语对齐 / G1 / 占位符 / 词典复用 / 句式 / 拼装质量守卫）
//   2) LLM 补漏层（全部走本地 mock HTTP：不碰外网、不读真实配置文件）
//      - 配置加载：无配置→null、环境变量优先、文件多模型与 maxBatch/timeoutMs
//      - 译文本地校验：G2/G3/占位符集合/E6 残骸/术语守卫（thread≠线程、agent≠代理）/
//        英文残留守卫（半英半中拒绝）/code 分区
//      - 补漏行为：成功采纳、坏占位符单条拒绝、HTTP 500 回退、多模型故障切换、超时回退、
//        code 分区与无字母条目永不提交、paceMs 批次间隔、质量重试（校验拒绝→下一档模型）
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  translateText,
  extractPlaceholders,
  loadTranslatorConfig,
  validateLlmTranslation,
  fillChangelist,
} = require('./auto_translate.js')

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

console.log('auto_translate 自测\n')

// --- 1) 规则层 ---------------------------------------------------------------------
const mockDict = {
  exact: { 'Save': '保存', 'Cancel': '取消' },
  template: {},
  code: {},
  pattern: {},
}

chk(translateText('Save', 'exact', mockDict) === '保存', '精确匹配已有词典')
chk(translateText('Export', 'exact', mockDict) === '导出', '基础 UI 动词')
chk(translateText('Check for updates', 'exact', mockDict) === '检查更新', '长短语命中')

const threadRes = translateText('Close thread', 'exact', mockDict)
chk(threadRes.includes('会话') && !threadRes.includes('线程'), 'thread 必须译「会话」，绝不出现「线程」')

const agentRes = translateText('Agent settings', 'exact', mockDict)
chk(agentRes.includes('智能体') && agentRes.includes('设置'), 'agent=智能体 / settings=设置')

chk(translateText('some_internal_code', 'code', mockDict) === 'some_internal_code', 'G1：code 分区逐字节原样')

const tplRes = translateText('Connecting to ${e.server}...', 'template', mockDict)
chk(tplRes.includes('${e.server}') && tplRes.includes('正在连接'), '模板占位符完整保留')

// 规则层拼装质量守卫：结果残留英文虚词（整句没拼完）→ 一律 [EN]，半英半中绝不直通发布包
const guardRes = translateText('Your workspace will restart in ${e.seconds} seconds.', 'template', mockDict)
chk(
  guardRes === '[EN] Your workspace will restart in ${e.seconds} seconds.',
  '拼装质量守卫：半英半中（Your…will…in…）→ [EN] 交补漏层/人工',
)
const cleanRes = translateText('Workspace settings', 'exact', mockDict)
chk(
  !cleanRes.startsWith('[EN]') && cleanRes.includes('工作区') && cleanRes.includes('设置'),
  '拼装质量守卫：完整拼装照常放行（workspace settings）',
)

chk(
  JSON.stringify(extractPlaceholders('Hello ${name}, you have ${count} items')) === JSON.stringify(['${name}', '${count}']),
  '占位符提取',
)

// --- 2) LLM 补漏层 -------------------------------------------------------------------
const envKeys = ['HANHUA_LLM_BASE', 'HANHUA_LLM_KEY', 'HANHUA_LLM_MODEL', 'HANHUA_TRANSLATOR_CONFIG']
const envBackup = {}
for (const k of envKeys) envBackup[k] = process.env[k]
function restoreEnv() {
  for (const k of envKeys) {
    if (envBackup[k] === undefined) delete process.env[k]
    else process.env[k] = envBackup[k]
  }
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

// 从 OpenAI 兼容请求体里取回按行编号的原文（mock 的“理解”）
function keysFromBody(body) {
  const msgs = JSON.parse(body).messages
  const content = msgs[msgs.length - 1].content
  return content
    .split('\n')
    .slice(1)
    .map((l) => l.replace(/^\d+\.\s?/, ''))
}

function okHandler(mutate) {
  return (req, res, body) => {
    const keys = keysFromBody(body)
    const arr = keys.map((k) => (mutate ? mutate(k) : `译：${k}`))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(arr) } }] }))
  }
}

async function main() {
  // 2.1 配置加载
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-translate-test-'))
  for (const k of envKeys) delete process.env[k]
  process.env.HANHUA_TRANSLATOR_CONFIG = path.join(tmpDir, 'nope.json')
  chk(loadTranslatorConfig() === null, '无配置/无环境变量 → null（保持纯规则）')

  process.env.HANHUA_LLM_BASE = 'http://127.0.0.1:9/v1/'
  process.env.HANHUA_LLM_KEY = 'k'
  process.env.HANHUA_LLM_MODEL = 'm'
  const cfgEnv = loadTranslatorConfig()
  chk(
    cfgEnv && cfgEnv.models.length === 1 && cfgEnv.models[0].baseUrl === 'http://127.0.0.1:9/v1' && cfgEnv.source === 'env',
    '环境变量优先且规范化（去尾斜杠）',
  )

  const cfgFile = path.join(tmpDir, 'translator.json')
  fs.writeFileSync(
    cfgFile,
    JSON.stringify({
      models: [
        { baseUrl: 'https://a.example/v1', apiKey: 'k1', model: 'm1' },
        { baseUrl: 'https://b.example/v1', apiKey: 'k2', model: 'm2', timeoutMs: 5 },
      ],
      maxBatch: 3,
    }),
  )
  for (const k of ['HANHUA_LLM_BASE', 'HANHUA_LLM_KEY', 'HANHUA_LLM_MODEL']) delete process.env[k]
  process.env.HANHUA_TRANSLATOR_CONFIG = cfgFile
  const cfgMulti = loadTranslatorConfig()
  chk(
    cfgMulti && cfgMulti.models.length === 2 && cfgMulti.models[1].timeoutMs === 5 && cfgMulti.maxBatch === 3,
    '文件多模型 + maxBatch/timeoutMs 解析',
  )
  restoreEnv()

  // 2.2 译文本地校验
  chk(validateLlmTranslation('Open thread', '打开会话', 'exact').ok, '校验：正常译文采纳')
  chk(!validateLlmTranslation('Open thread', 'Open thread', 'exact').ok, '校验：等于原文拒绝（G3）')
  chk(!validateLlmTranslation('Open thread', 'Thread [EN]', 'exact').ok, '校验：无中文拒绝（G2）')
  chk(!validateLlmTranslation('Hi ${e.name}', '你好 {e.name}', 'template').ok, '校验：占位符被截断拒绝')
  chk(!validateLlmTranslation('Hi ${e.name}', '你好 ${e.name}，还有 ${x.y}', 'template').ok, '校验：凭空多出占位符拒绝')
  chk(!validateLlmTranslation('Spend it', '已用完 r?" 并结束":"".', 'exact').ok, '校验：E6 模板残骸拒绝')
  chk(!validateLlmTranslation('Open thread', '打开线程', 'exact').ok, '术语守卫：thread 译成「线程」拒绝')
  chk(!validateLlmTranslation('Review all agents', '审查所有代理', 'exact').ok, '术语守卫：agent 译成「代理」拒绝')
  chk(validateLlmTranslation('Open thread', '打开会话', 'exact').ok, '术语守卫：正确译「会话」放行')
  chk(!validateLlmTranslation('any', '译文', 'code').ok, '校验：code 分区永远不采纳 LLM')
  chk(
    !validateLlmTranslation(
      'Your workspace will restart in ${e.seconds} seconds.',
      'Your 工作区 will restart in ${e.seconds} seconds.',
      'template',
    ).ok,
    '英文残留守卫：半英半中拒绝（虚词 your/will/in）',
  )
  chk(
    validateLlmTranslation('Pick a framework', 'React Native 或 Flutter', 'exact').ok,
    '英文残留守卫：品牌/产品名不受影响',
  )

  // 2.3 无 LLM：行为与纯规则一致
  const list0 = {
    add: [
      { section: 'exact', key: 'Zorb the quantum widget', value: '' },
      { section: 'exact', key: 'Save', value: '' },
    ],
    set: [{ section: 'exact', key: 'Cancel', value: '取消X' }],
  }
  const r0 = await fillChangelist(list0, { llmConfig: null })
  chk(list0.add[0].value === '[EN] Zorb the quantum widget', '无 LLM：规则翻不出的保留 [EN] 标记')
  chk(list0.add[1].value === '保存' && list0.set[0].value === '取消X', '无 LLM：已知项照常填、已有值不动')
  chk(r0.stats.markers === 1, '统计：markers=1')

  // 2.4 mock 正常：补翻 + 占位符保留 + code 分区不提交
  let received = []
  const mock1 = await startMock((req, res, body) => {
    received = keysFromBody(body)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(received.map((k) => `译：${k}`)) } }] }))
  })
  const list1 = {
    add: [
      { section: 'exact', key: 'Zorb the quantum widget', value: '' },
      { section: 'template', key: 'Ignite ${e.count} flux pods', value: '' },
      { section: 'code', key: 'hooks:"go"', value: '' },
    ],
  }
  const cfg1 = {
    models: [{ baseUrl: mock1.url, apiKey: 'k', model: 'm', timeoutMs: 3000 }],
    maxBatch: 20,
    temperature: 0.2,
    source: 'test',
  }
  const r1 = await fillChangelist(list1, { llmConfig: cfg1 })
  chk(list1.add[0].value === '译：Zorb the quantum widget', 'LLM 补翻普通句子')
  chk(list1.add[1].value === '译：Ignite ${e.count} flux pods', 'LLM 补翻模板句且占位符原样')
  chk(list1.add[2].value === 'hooks:"go"', 'code 分区逐字节原样（G1，且不提交给 LLM）')
  chk(received.length === 2 && !received.includes('hooks:"go"'), '提交给 LLM 的只有 2 条（code 排除）')
  chk(r1.stats.llmFilled === 2 && r1.stats.llmRejected === 0, '统计：补翻 2 条 / 拒绝 0 条')
  mock1.srv.close()

  // 2.5 mock 弄坏占位符：单条拒绝，同批合格条目照常采纳
  const mock2 = await startMock(okHandler((k) => (k.includes('${') ? `译：${k.replace('${', '{')}` : `译：${k}`)))
  const list2 = {
    add: [
      { section: 'template', key: 'Ignite ${e.count} flux pods', value: '' },
      { section: 'exact', key: 'Zorb the quantum widget', value: '' },
    ],
  }
  const r2 = await fillChangelist(list2, {
    llmConfig: { models: [{ baseUrl: mock2.url, apiKey: 'k', model: 'm', timeoutMs: 3000 }], maxBatch: 20, temperature: 0.2 },
  })
  chk(list2.add[0].value === '[EN] Ignite ${e.count} flux pods', '占位符被模型弄坏 → 拒绝，保持 [EN]')
  chk(list2.add[1].value === '译：Zorb the quantum widget', '同批合格的那条照常采纳')
  chk(r2.stats.llmFilled === 1 && r2.stats.llmRejected === 1, '统计：1 采纳 / 1 拒绝')
  mock2.srv.close()

  // 2.6 HTTP 500：自动回退纯规则，不中断
  const mock3 = await startMock((req, res) => {
    res.writeHead(500)
    res.end('boom')
  })
  const list3 = { add: [{ section: 'exact', key: 'Zorb the quantum widget', value: '' }] }
  const r3 = await fillChangelist(list3, {
    llmConfig: { models: [{ baseUrl: mock3.url, apiKey: 'k', model: 'm', timeoutMs: 2000 }], maxBatch: 20, temperature: 0.2 },
  })
  chk(list3.add[0].value === '[EN] Zorb the quantum widget' && r3.stats.llmFilled === 0, 'HTTP 500 → 自动回退纯规则，不中断')
  chk(r3.llm.errors.length === 1, '统计：失败批次 1 个（错误已记录）')
  mock3.srv.close()

  // 2.7 多模型故障切换：第一个 500 → 第二个成功
  const mock4 = await startMock((req, res, body) => {
    if (req.url.startsWith('/bad')) {
      res.writeHead(500)
      res.end('boom')
      return
    }
    const keys = keysFromBody(body)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(keys.map((k) => `译：${k}`)) } }] }))
  })
  const list4 = { add: [{ section: 'exact', key: 'Zorb the quantum widget', value: '' }] }
  const r4 = await fillChangelist(list4, {
    llmConfig: {
      models: [
        { baseUrl: `${mock4.url}/bad`, apiKey: 'k', model: 'bad', timeoutMs: 2000 },
        { baseUrl: `${mock4.url}/good`, apiKey: 'k', model: 'good', timeoutMs: 2000 },
      ],
      maxBatch: 20,
      temperature: 0.2,
    },
  })
  chk(list4.add[0].value === '译：Zorb the quantum widget' && r4.stats.llmFilled === 1, '第一个模型 500 → 自动切换第二个模型成功')
  mock4.srv.close()

  // 2.8 超时：快速回退（不等满模型超时以外的时长）
  const mock5 = await startMock((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"choices":[{"message":{"content":"[]"}}]}')
    }, 1500)
  })
  const t0 = Date.now()
  const list5 = { add: [{ section: 'exact', key: 'Zorb the quantum widget', value: '' }] }
  const r5 = await fillChangelist(list5, {
    llmConfig: { models: [{ baseUrl: mock5.url, apiKey: 'k', model: 'm', timeoutMs: 250 }], maxBatch: 20, temperature: 0.2 },
  })
  chk(
    list5.add[0].value === '[EN] Zorb the quantum widget' && r5.llm.errors.length === 1 && Date.now() - t0 < 1200,
    '超时 → 回退纯规则（快速返回）',
  )
  mock5.srv.close()

  // 2.9 无字母条目（纯符号）永不提交
  let hits = 0
  const mock6 = await startMock((req, res, body) => {
    hits++
    const keys = keysFromBody(body)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(keys.map((k) => `译：${k}`)) } }] }))
  })
  const list6 = { add: [{ section: 'exact', key: '···', value: '' }] }
  await fillChangelist(list6, {
    llmConfig: { models: [{ baseUrl: mock6.url, apiKey: 'k', model: 'm', timeoutMs: 2000 }], maxBatch: 20, temperature: 0.2 },
  })
  chk(hits === 0 && list6.add[0].value === '[EN] ···', '无字母的条目不提交给 LLM')
  mock6.srv.close()

  // 2.10 paceMs：批次之间按配置留间隔（免费层限流防护）
  let reqCount = 0
  const mock7 = await startMock((req, res, body) => {
    reqCount++
    const keys = keysFromBody(body)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(keys.map((k) => `译：${k}`)) } }] }))
  })
  const list7 = {
    add: [
      { section: 'exact', key: 'Zorb the alpha widget', value: '' },
      { section: 'exact', key: 'Zorb the beta widget', value: '' },
    ],
  }
  const tp = Date.now()
  await fillChangelist(list7, {
    llmConfig: { models: [{ baseUrl: mock7.url, apiKey: 'k', model: 'm', timeoutMs: 2000 }], maxBatch: 1, temperature: 0.2, paceMs: 300 },
  })
  chk(reqCount === 2 && Date.now() - tp >= 280, 'paceMs：两批之间按配置间隔（>=280ms）')
  mock7.srv.close()

  // 2.11 质量重试：第一个模型译文过不了本地校验（半英半中）→ 换第二个模型重试成功
  let sloppyCalls = 0
  let goodCalls = 0
  const mock8 = await startMock((req, res, body) => {
    const model = JSON.parse(body).model
    let arr
    if (model === 'sloppy') {
      sloppyCalls++
      arr = ['Your 归档 ${e.count} will restart soon.']
    } else {
      goodCalls++
      arr = ['归档 ${e.count} 个任务']
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(arr) } }] }))
  })
  const list8 = { add: [{ section: 'template', key: 'Archive ${e.count} missions', value: '' }] }
  const r8 = await fillChangelist(list8, {
    llmConfig: {
      models: [
        { baseUrl: mock8.url, apiKey: 'k', model: 'sloppy', timeoutMs: 3000 },
        { baseUrl: mock8.url, apiKey: 'k', model: 'good', timeoutMs: 3000 },
      ],
      maxBatch: 20,
      temperature: 0.2,
    },
  })
  chk(
    list8.add[0].value === '归档 ${e.count} 个任务' && r8.stats.llmFilled === 1 && r8.stats.llmRejected === 0,
    '质量重试：小模型半英半中被拒 → 下一档模型补上',
  )
  chk(sloppyCalls >= 1 && goodCalls >= 1, '质量重试：确实换过模型（两个模型都被调用）')
  mock8.srv.close()

  console.log(failures === 0 ? `\n✓ auto_translate 全部 ${total} 项自测通过！` : `\n✗ ${failures}/${total} 项失败`)
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
