#!/usr/bin/env node
// 智能词典变更清单预填工具：为 tools/dictapply.js 生成的清单骨架（work/changelist-*.json）
// 自动填入中文译文。两层结构：
//
//   ① 规则层（始终启用，零依赖、零成本）：
//      - 术语库对齐（thread=会话、agent=智能体、workspace=工作区……）与常见 UI 短语表
//      - 历史词典记忆复用
//      - 占位符 ${...} 逐字保序；code 分区逐字节原样（满足 G1）
//      - 拼装质量守卫：整串拼装结果残留英文虚词（整句没拼完）一律改标 [EN]，
//        交 LLM 补漏层 / 人工——半英半中不进词典（0.0.170 联调实锤的洞）
//   ② LLM 补漏层（可选，默认关闭）：
//      - 只补规则层翻不出的句子（结果带 [EN] 前缀标记的那些；code 分区永不提交给 LLM）
//      - OpenAI 兼容接口；多模型按顺序故障切换；任何失败自动回退纯规则，绝不中断流程
//      - 译文先过本地校验（占位符集合一致 / 含中文 / 不等于原文 / 无 E6 模板残骸 /
//        术语守卫 / 英文残留守卫）再采纳；被校验拒绝的条目换链条下一档模型重试一轮
//      - 配置：仓库根 .translator.json（模板见 .translator.json.example），或环境变量
//        HANHUA_LLM_BASE / HANHUA_LLM_KEY / HANHUA_LLM_MODEL（优先级最高）；
//        HANHUA_TRANSLATOR_CONFIG 可改配置文件路径（自测与换机器用）
//      - 免费选择（实测直连可用）：智谱 https://open.bigmodel.cn/api/paas/v4（免费文本模型：
//        glm-4-flash-250414 ~0.8s 最快；glm-4.5-flash ~12s；glm-4.7-flash 最新但 ~30s 且
//        429 频繁，建议放备选链末尾）、OpenRouter https://openrouter.ai/api/v1（:free 供应商
//        三方池，实测 nvidia/nemotron-3-super-120b-a12b:free ~3.6s 可用；免费层约 50 请求/天）、
//        硅基流动 https://api.siliconflow.cn/v1（需实名认证且非负余额；免费聊天模型仅
//        Hunyuan-MT-7B / Xing4.0-29B）
//      - 可选 paceMs：批次之间的间隔毫秒数（免费层限流时设 300–1000 更稳）
//
// 无论哪层填的译文，落盘前都要过 dictapply --check（G1–G5）——那才是最终闸门。
//
// 用法：
//   node tools/auto_translate.js <changelist.json> [--write] [--dry-run] [--no-llm]
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const dictPath = path.join(REPO, 'dict.json')

// --- 术语表 (Glossary) ---
const GLOSSARY = [
  ['thread', '会话'],
  ['Thread', '会话'],
  ['agent', '智能体'],
  ['Agent', '智能体'],
  ['workspace', '工作区'],
  ['Workspace', '工作区'],
  ['token', '令牌'],
  ['Token', '令牌'],
  ['repository', '代码仓库'],
  ['branch', '分支'],
  ['commit', '提交'],
  ['settings', '设置'],
  ['Settings', '设置'],
  ['General', '通用'],
  ['Appearance', '外观'],
  ['Connectors', '连接器'],
  ['Projects', '项目'],
  ['Skills', '技能'],
  ['API Providers', 'API 提供商'],
  ['Freebuff', 'Freebuff'],
  ['Freebucks', 'Freebucks'],
  ['Discord', 'Discord'],
]

// 常见基础词汇与操作短语
const UI_PHRASES = new Map([
  ['Export', '导出'],
  ['Import', '导入'],
  ['Save', '保存'],
  ['Save changes', '保存更改'],
  ['Cancel', '取消'],
  ['Confirm', '确认'],
  ['Delete', '删除'],
  ['Remove', '移除'],
  ['Edit', '编辑'],
  ['Update', '更新'],
  ['Retry', '重试'],
  ['Close', '关闭'],
  ['Open', '打开'],
  ['Copy', '复制'],
  ['Paste', '粘贴'],
  ['Cut', '剪切'],
  ['Select all', '全选'],
  ['Undo', '撤销'],
  ['Redo', '重做'],
  ['Back', '返回'],
  ['Next', '下一步'],
  ['Finish', '完成'],
  ['Done', '完成'],
  ['Search', '搜索'],
  ['Filter', '筛选'],
  ['Clear', '清空'],
  ['Reset', '重置'],
  ['Enable', '启用'],
  ['Disable', '禁用'],
  ['Enabled', '已启用'],
  ['Disabled', '已禁用'],
  ['Active', '已激活'],
  ['Inactive', '未激活'],
  ['Online', '在线'],
  ['Offline', '离线'],
  ['Loading', '正在加载'],
  ['Loading...', '正在加载…'],
  ['Connecting', '正在连接'],
  ['Connecting...', '正在连接…'],
  ['Connected', '已连接'],
  ['Disconnected', '已断开'],
  ['Success', '成功'],
  ['Failed', '失败'],
  ['Error', '错误'],
  ['Warning', '警告'],
  ['Info', '信息'],
  ['Help', '帮助'],
  ['Documentation', '文档'],
  ['Feedback', '反馈'],
  ['About', '关于'],
  ['Version', '版本'],
  ['Check for updates', '检查更新'],
  ['Fold line', '折叠行'],
  ['Unfold line', '展开行'],
  ['Unknown error', '未知错误'],
])

function loadDict() {
  try {
    return JSON.parse(fs.readFileSync(dictPath, 'utf8'))
  } catch {
    return { exact: {}, template: {}, code: {}, pattern: {} }
  }
}

// 抽取并保留所有 ${...}
function extractPlaceholders(text) {
  const list = []
  let depth = 0, start = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '$' && text[i + 1] === '{') {
      if (depth === 0) start = i
      depth++
      i++
    } else if (text[i] === '}' && depth > 0) {
      depth--
      if (depth === 0) {
        list.push(text.slice(start, i + 1))
      }
    }
  }
  return list
}

// 启发式翻译引擎
function translateText(key, section, dict) {
  if (section === 'code') {
    // G1 规则：代码字面量保持原样
    return key
  }

  // 1. 若词典既有条目精确命中，直接复用
  if (dict[section] && dict[section][key]) {
    return dict[section][key]
  }
  if (dict.exact && dict.exact[key]) {
    return dict.exact[key]
  }

  // 2. 基础短语命中
  if (UI_PHRASES.has(key)) {
    return UI_PHRASES.get(key)
  }

  // 3. 常见复合句型模式匹配
  let res = key

  // 占位符隔离
  const placeholders = extractPlaceholders(key)
  let skeleton = key
  placeholders.forEach((ph, idx) => {
    skeleton = skeleton.replace(ph, `__PH_${idx}__`)
  })

  // 常见句式规则
  if (/^Export\s+(.+)$/i.test(skeleton)) {
    skeleton = skeleton.replace(/^Export\s+/i, '导出 ')
  } else if (/^Import\s+(.+)$/i.test(skeleton)) {
    skeleton = skeleton.replace(/^Import\s+/i, '导入 ')
  } else if (/^Create\s+(.+)$/i.test(skeleton)) {
    skeleton = skeleton.replace(/^Create\s+/i, '创建 ')
  } else if (/^Delete\s+(.+)$/i.test(skeleton)) {
    skeleton = skeleton.replace(/^Delete\s+/i, '删除 ')
  } else if (/^Select\s+(.+)$/i.test(skeleton)) {
    skeleton = skeleton.replace(/^Select\s+/i, '选择 ')
  } else if (/^Failed to\s+(.+)$/i.test(skeleton)) {
    skeleton = skeleton.replace(/^Failed to\s+/i, '无法')
  } else if (/^Unable to\s+(.+)$/i.test(skeleton)) {
    skeleton = skeleton.replace(/^Unable to\s+/i, '无法')
  } else if (/^Connecting to\s+(.+)$/i.test(skeleton)) {
    skeleton = skeleton.replace(/^Connecting to\s+/i, '正在连接到 ')
  }

  // 术语逐项替换
  for (const [en, zh] of GLOSSARY) {
    const re = new RegExp(`\\b${en}\\b`, 'g')
    skeleton = skeleton.replace(re, zh)
  }

  // 基础短语替换
  for (const [en, zh] of UI_PHRASES.entries()) {
    if (en.length > 3) {
      const re = new RegExp(`\\b${en}\\b`, 'g')
      skeleton = skeleton.replace(re, zh)
    }
  }

  // 还原占位符
  placeholders.forEach((ph, idx) => {
    skeleton = skeleton.replace(`__PH_${idx}__`, ph)
  })

  // 若处理后包含中文，还需过质量守卫；否则整串未命中，标注 [EN] 交 LLM 补漏层 / 人工
  const hasCJK = /[㐀-䶿一-鿿]/.test(skeleton)
  if (hasCJK) {
    // 质量守卫：拼装结果只要残留英文虚词（your/will/in…），就是「整句没拼完」——
    // 宁可标 [EN] 交 LLM 补漏层，也不能把「Your 工作区 will restart in ${…} seconds.」
    // 这种半英半中直接写进词典。0.0.170 联调实锤：它含中文 → 绕过 LLM 通道 → 直通发布包。
    if (!englishResidue(skeleton, 1)) return skeleton
  }

  // 无法识别的短串：保持并前缀 [EN] 避免 G2 报错，提示人工复核
  return `[EN] ${key}`
}

// --- 可选 LLM 补漏层 -----------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 120000
// E6 模板残骸判据（与 lint_dict 一致）：剔掉 ${...} 后仍残留代码残骸即视为不合格
const DEBRIS_RE = /\?"|":|\?\?|===|!==|=>|\|\||\.length/
// 术语守卫：对应词典历史上的两次真实事故——thread 被译成「线程」、agent 被译成「代理」
const TERM_GUARDS = [
  { test: /\bthreads?\b/i, bad: /线程/, want: '会话' },
  { test: /\bagents?\b/i, bad: /代理/, want: '智能体' },
]
// 英文残留守卫：剔掉 ${...} 后若还留有英文虚词（your/will/in…），几乎可以断定整句没翻完。
// 起因：0.0.170 联调实锤——规则层拼装路径把整句译成「Your 工作区 will restart in ${…} seconds.」
// （只译出 glossary 命中的 workspace），且因含中文绕过 LLM 通道直通发布包；LLM 输出同样要防。
// 规则层阈值 1（任何虚词都说明没拼完）；LLM 输出阈值 2（对模型输出保守些）。
// 校准：阈值 2 对当时全量词典（约 4000 条）零误杀；品牌名/产品名（Claude Code、GitHub Copilot）不受影响。
const FUNC_WORDS = new Set(
  (
    'the a an and or but if when while of to in on at for with from by as is are was were be been being ' +
    'will would shall should can could may might must do does did have has had not no yes it its this that ' +
    'these those there their they them you your yours we our us my mine i he she his her him what which who ' +
    'how why where all any some more most other into over under again then than so up down out off itself'
  ).split(' '),
)

function hasCJK(s) {
  return /[㐀-䶿一-鿿]/.test(s)
}
function hasLatin(s) {
  return /[A-Za-z]/.test(s)
}
function normBaseUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '')
}

// 读取可选的 LLM 配置。环境变量优先于文件；返回 null = 保持纯规则。
function loadTranslatorConfig() {
  const env = process.env
  const cfgPath = env.HANHUA_TRANSLATOR_CONFIG
    ? path.resolve(env.HANHUA_TRANSLATOR_CONFIG)
    : path.join(REPO, '.translator.json')

  const collect = (m, out) => {
    const baseUrl = normBaseUrl(m && m.baseUrl)
    const apiKey = String((m && m.apiKey) || '').trim()
    const model = String((m && m.model) || '').trim()
    if (baseUrl && apiKey && model) {
      const t = Number(m.timeoutMs)
      out.push({ baseUrl, apiKey, model, timeoutMs: t > 0 ? t : DEFAULT_TIMEOUT_MS })
    }
  }

  if (env.HANHUA_LLM_BASE || env.HANHUA_LLM_KEY || env.HANHUA_LLM_MODEL) {
    const out = []
    collect({ baseUrl: env.HANHUA_LLM_BASE, apiKey: env.HANHUA_LLM_KEY, model: env.HANHUA_LLM_MODEL }, out)
    if (out.length) return { models: out, maxBatch: 20, temperature: 0.2, paceMs: 0, source: 'env' }
    console.error('! HANHUA_LLM_* 环境变量不完整（base/key/model 三者缺一不可）—— 继续看配置文件。')
  }

  if (!fs.existsSync(cfgPath)) return null
  let file
  try {
    file = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  } catch (e) {
    console.error(`! 配置文件解析失败（按纯规则继续）：${cfgPath}：${e.message}`)
    return null
  }

  const out = []
  if (Array.isArray(file.models)) {
    for (const m of file.models) collect(m, out)
  } else {
    collect(file, out)
  }
  if (!out.length) {
    console.error(`! 配置文件里没有完整模型（baseUrl/apiKey/model 三者缺一不可）—— 保持纯规则：${cfgPath}`)
    return null
  }
  const paceMs = Number(file.paceMs)
  return {
    models: out,
    maxBatch: Number(file.maxBatch) > 0 ? Math.floor(Number(file.maxBatch)) : 20,
    temperature: Number.isFinite(Number(file.temperature)) ? Number(file.temperature) : 0.2,
    paceMs: Number.isFinite(paceMs) && paceMs > 0 ? Math.min(paceMs, 60000) : 0,
    source: cfgPath,
  }
}

// 译文本地校验：任何不合格都不采纳（保持 [EN] 标记交人工）
function validateLlmTranslation(key, translated, section) {
  const t = typeof translated === 'string' ? translated.trim() : ''
  if (section === 'code') return { ok: false, reason: 'code 分区不交给 LLM' }
  if (!t) return { ok: false, reason: '空译文' }
  if (t === key) return { ok: false, reason: 'G3：与原文逐字节相同' }
  if (!hasCJK(t)) return { ok: false, reason: 'G2：译文里没有中文' }
  for (const g of TERM_GUARDS) {
    if (g.test.test(key) && g.bad.test(t)) return { ok: false, reason: `术语守卫：必须译「${g.want}」` }
  }
  const want = extractPlaceholders(key)
  const got = extractPlaceholders(t)
  const norm = (arr) => [...arr].sort().join('\u0000')
  if (norm(want) !== norm(got)) {
    return { ok: false, reason: `占位符不一致（key 有 ${want.length} 个，译文有 ${got.length} 个）` }
  }
  let stripped = t
  for (const ph of got) stripped = stripped.replace(ph, ' ')
  if (DEBRIS_RE.test(stripped)) return { ok: false, reason: 'E6：译文残留模板/代码残骸' }
  const residue = englishResidue(stripped)
  if (residue) return { ok: false, reason: `英文残留：疑似整句未译完（虚词 ${residue}）` }
  return { ok: true }
}

// 英文虚词检测：返回命中的虚词列表（≥ min 个不同虚词即视为「整句没翻完」）
function englishResidue(stripped, min = 2) {
  const words = String(stripped).match(/[A-Za-z][A-Za-z0-9.'-]*/g) || []
  const bad = new Set(
    words.map((w) => w.toLowerCase().replace(/[.'-]+$/, '')).filter((w) => FUNC_WORDS.has(w)),
  )
  return bad.size >= min ? [...bad].join('、') : null
}

const SYSTEM_PROMPT = [
  '你是 Freebuff Desktop（Electron 桌面应用）的简体中文本地化译者。把用户给出的英文界面文案逐条翻译成简体中文。',
  '硬性要求：',
  '1. 只输出 JSON 字符串数组，长度与输入条数相同、顺序一致，不要输出任何解释、markdown 或代码围栏。',
  '2. 保留所有 ${...} 模板占位符逐字节不变：不得新增、删除或改写；占位符内部的代码不翻译。',
  '3. 术语表：thread=会话（绝不能译成"线程"）、agent=智能体、workspace=工作区、token=令牌、repository=代码仓库、branch=分支、commit=提交。',
  '4. 品牌、产品名、协议名保持原文：Freebuff、Freebucks、Discord、GitHub、Supabase、MCP 等。',
  '5. 代码标识符、路径、命令、枚举名、键盘键名、文件扩展名保持原文。',
  '6. 译文简洁得体，符合按钮/标签/提示的语气；问句保留问号，省略号用 …。',
  '7. 译文不得与原文逐字节相同；原文若本就是中文或无需翻译，原样返回。',
  '8. 必须整句译完：除品牌/产品名、占位符与单位外，译文不得残留英文单词或英文句式。',
].join('\n')

function buildMessages(chunk) {
  const lines = chunk.map((it, i) => `${i + 1}. ${it.key}`).join('\n')
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `请翻译以下 ${chunk.length} 条界面文案，只返回 JSON 数组（${chunk.length} 个字符串，与输入顺序一一对应）：\n${lines}`,
    },
  ]
}

// 发一批给单个模型；传输/协议失败抛错（由调用方切换下一个模型）
async function sendChunk(model, chunk, cfg) {
  if (typeof fetch !== 'function') throw new Error('当前 Node 没有全局 fetch（需要 Node 18+）')
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), model.timeoutMs)
  let resp
  try {
    resp = await fetch(`${model.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` },
      body: JSON.stringify({ model: model.model, messages: buildMessages(chunk), temperature: cfg.temperature }),
      signal: ac.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = await resp.json().catch(() => null)
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
  if (typeof content !== 'string') throw new Error('响应缺少 choices[0].message.content')
  let text = content.trim()
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fence) text = fence[1].trim()
  let arr
  try {
    arr = JSON.parse(text)
  } catch {
    throw new Error(`模型未返回合法 JSON：${text.slice(0, 80)}`)
  }
  if (!Array.isArray(arr) || arr.length !== chunk.length) {
    throw new Error(`返回数组长度不符（期望 ${chunk.length}，实得 ${Array.isArray(arr) ? arr.length : '非数组'}）`)
  }
  return arr
}

// 发一轮：分块 → 逐模型故障切换 → 逐条本地校验（外层 llmFill 负责质量重试）
async function llmFillOnce(items, cfg, models) {
  const filled = new Map()
  const rejected = new Map()
  const errors = []
  for (let i = 0; i < items.length; i += cfg.maxBatch) {
    const chunk = items.slice(i, i + cfg.maxBatch)
    let arr = null
    let lastErr = null
    for (const model of models) {
      try {
        arr = await sendChunk(model, chunk, cfg)
        break
      } catch (e) {
        lastErr = e
      }
    }
    if (!arr) {
      errors.push(String((lastErr && lastErr.message) || lastErr))
      continue
    }
    chunk.forEach((it, idx) => {
      const v = validateLlmTranslation(it.key, arr[idx], it.section)
      if (v.ok) filled.set(it.key, String(arr[idx]).trim())
      else rejected.set(it.key, v.reason)
    })
    // 免费层限流时按配置在批次之间留间隔
    if (cfg.paceMs > 0 && i + cfg.maxBatch < items.length) {
      await new Promise((r) => setTimeout(r, cfg.paceMs))
    }
  }
  return { filled, rejected, errors }
}

// 补漏主入口：先按全链跑一轮；被本地校验拒绝的条目（半英半中、E6 残骸等）换链条
// 下一档模型重试一轮——小模型质量不够时由更强模型兜底；仍不过就保持 [EN] 交人工。
async function llmFill(items, cfg) {
  const out = await llmFillOnce(items, cfg, cfg.models)
  const retryItems = items.filter((it) => out.rejected.has(it.key))
  if (!retryItems.length || cfg.models.length < 2) return out
  const retry = await llmFillOnce(retryItems, cfg, cfg.models.slice(1))
  for (const [k, v] of retry.filled) {
    out.filled.set(k, v)
    out.rejected.delete(k)
  }
  out.errors.push(...retry.errors)
  return out
}

function isMarker(v) {
  return typeof v === 'string' && v.startsWith('[EN] ')
}

// 纯逻辑：在内存里把清单填满（可自测；不写文件）。opts.llmConfig 显式传入时不再读配置。
async function fillChangelist(list, opts = {}) {
  const dict = opts.dict || loadDict()
  const stats = { ruleFilled: 0, kept: 0, markers: 0, llmFilled: 0, llmRejected: 0 }
  const pending = []
  const fill = (key, section, set) => {
    const v = translateText(key, section, dict)
    if (isMarker(v)) pending.push({ key, section, set })
    set(v)
    stats.ruleFilled++
  }

  for (const op of ['add', 'set']) {
    if (!Array.isArray(list[op])) continue
    for (const item of list[op]) {
      if (!item.value || String(item.value).trim() === '') {
        fill(item.key, item.section, (v) => {
          item.value = v
        })
      } else {
        stats.kept++
      }
    }
  }
  if (Array.isArray(list.rename)) {
    for (const item of list.rename) {
      if (item.value === '') {
        fill(item.to, item.section, (v) => {
          item.value = v
        })
      }
    }
  }
  stats.markers = pending.length

  const wanted = pending.filter((p) => hasLatin(p.key))
  const cfg = 'llmConfig' in opts ? opts.llmConfig : opts.noLlm ? null : loadTranslatorConfig()
  const llm = { enabled: !!cfg, models: cfg ? cfg.models.length : 0, attempted: wanted.length, errors: [] }
  if (cfg && wanted.length) {
    let res
    try {
      res = await llmFill(
        wanted.map(({ key, section }) => ({ key, section })),
        cfg,
      )
    } catch (e) {
      res = { filled: new Map(), rejected: new Map(), errors: [String((e && e.message) || e)] }
    }
    for (const p of wanted) {
      if (res.filled.has(p.key)) {
        p.set(res.filled.get(p.key))
        stats.llmFilled++
      } else {
        stats.llmRejected++
      }
    }
    llm.errors = res.errors
  }
  return { stats, llm }
}

async function processChangelist(filePath, shouldWrite, flags = {}) {
  if (!fs.existsSync(filePath)) {
    console.error(`错误：找不到清单文件 ${filePath}`)
    return 1
  }

  const list = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const { stats, llm } = await fillChangelist(list, { noLlm: flags.noLlm })

  console.log(`自动翻译预填结果 (${path.basename(filePath)}):`)
  console.log(`  · 规则层填入：${stats.ruleFilled} 项`)
  console.log(`  · 保留既有项：${stats.kept} 项`)
  if (llm.enabled) {
    const errs = llm.errors.length ? `，失败批次 ${llm.errors.length}（首个错误：${llm.errors[0]}）` : ''
    console.log(`  · LLM 补漏：${llm.models} 个模型，提交 ${llm.attempted} 条，采纳 ${stats.llmFilled} 条，未采纳 ${stats.llmRejected} 条${errs}`)
  }
  const leftover = stats.markers - stats.llmFilled
  if (leftover > 0) {
    const hint = llm.enabled
      ? '保持 [EN] 前缀，待人工复核'
      : '保持 [EN] 前缀待人工；配置 .translator.json（免费模型示例见 .translator.json.example）可启用 LLM 自动补翻'
    console.log(`  · 仍需人工：${leftover} 条（${hint}）`)
  }

  if (shouldWrite) {
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2) + '\n', 'utf8')
    console.log(`已写回 ${filePath}。`)

    // 运行 dictapply --check 进行只读体检
    const checkRes = spawnSync(process.execPath, [path.join(__dirname, 'dictapply.js'), filePath, '--check'], {
      encoding: 'utf8',
    })
    console.log('\n--- dictapply --check 体检反馈 ---')
    console.log((checkRes.stdout || '') + (checkRes.stderr || ''))
    if (checkRes.status === 0) {
      console.log('✓ 清单校验完全合格，可执行 node tools/dictapply.js <file> --write 应用落盘！')
    } else {
      console.log('! 请根据体检提示微调清单后，再执行 --write。')
    }
  } else {
    console.log('\n(dry-run 模式，未修改文件；确认无误后添加 --write 写入并运行体检)')
  }
  return 0
}

async function main() {
  const args = process.argv.slice(2)
  const shouldWrite = args.includes('--write')
  const noLlm = args.includes('--no-llm')
  const files = args.filter((a) => !a.startsWith('--'))
  if (!files.length) {
    console.error('用法：node tools/auto_translate.js <changelist.json> [--write] [--dry-run] [--no-llm]')
    return 1
  }
  return processChangelist(files[0], shouldWrite, { noLlm })
}

if (require.main === module) {
  main()
    .then((rc) => process.exit(rc))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}

module.exports = {
  translateText,
  extractPlaceholders,
  GLOSSARY,
  UI_PHRASES,
  loadTranslatorConfig,
  validateLlmTranslation,
  fillChangelist,
  processChangelist,
}
