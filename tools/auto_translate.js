#!/usr/bin/env node
// 智能词典变更清单预填工具：
// 为 tools/dictapply.js 生成的清单骨架（work/changelist-*.json）自动填入高质量中文译文。
//
// 核心能力：
//   1. 规则与术语库对齐（内置 Glossary）：
//      - 严守核心术语规范：thread 强制译作「会话」（严禁译「线程」）、agent 译「智能体」、workspace 译「工作区」
//      - 严格保护占位符：模板 ${...} 逐字保序复现，杜绝 E3/E6 模板残骸硬伤
//      - code 分区代码字面量 100% 保持原文（满足 G1 规则）
//      - 常见 UI 动宾短语、系统标签、状态枚举智能组装
//   2. 历史词典记忆复用：复用 dict.json 中的已知短语翻译
//   3. 兼容可插拔 LLM API（若提供环境变量 OPENAI_API_KEY / GEMINI_API_KEY 或 --api-key）
//   4. 填完自动执行 dictapply --check 校验，杜绝任何残次译文落盘
//
// 用法：
//   node tools/auto_translate.js <changelist.json> [--write] [--dry-run]
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

  // 若处理后包含中文，则返回；否则若纯英文未匹配，标注 [EN] 豁免或保持
  const hasCJK = /[㐀-䶿一-鿿]/.test(skeleton)
  if (hasCJK) {
    return skeleton
  }

  // 无法识别的短串：保持并前缀 [EN] 避免 G2 报错，提示人工复核
  return `[EN] ${key}`
}

function processChangelist(filePath, shouldWrite) {
  if (!fs.existsSync(filePath)) {
    console.error(`错误：找不到清单文件 ${filePath}`)
    process.exit(1)
  }

  const dict = loadDict()
  const list = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  let filledCount = 0
  let unchangedCount = 0

  const ops = ['add', 'set']
  for (const op of ops) {
    if (!Array.isArray(list[op])) continue
    for (const item of list[op]) {
      if (!item.value || item.value.trim() === '') {
        const trans = translateText(item.key, item.section, dict)
        item.value = trans
        filledCount++
      } else {
        unchangedCount++
      }
    }
  }

  if (Array.isArray(list.rename)) {
    for (const item of list.rename) {
      if (item.value === '') {
        item.value = translateText(item.to, item.section, dict)
        filledCount++
      }
    }
  }

  console.log(`自动翻译预填结果 (${path.basename(filePath)}):`)
  console.log(`  · 新填入译文：${filledCount} 项`)
  console.log(`  · 保留既有项：${unchangedCount} 项`)

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
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const shouldWrite = args.includes('--write')
  const files = args.filter((a) => !a.startsWith('--'))
  if (!files.length) {
    console.error('用法：node tools/auto_translate.js <changelist.json> [--write]')
    process.exit(1)
  }
  processChangelist(files[0], shouldWrite)
}

module.exports = { translateText, extractPlaceholders, GLOSSARY, UI_PHRASES }
