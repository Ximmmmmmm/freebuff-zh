#!/usr/bin/env node
// 自动重译（resituate 的「微改写」搭档）：上游对一条文案只改了一两个词（如 reset→local），
// 键由 resituate 机械重定位（清单 work/retranslate-*.json），但旧译文的语义不再对——这里把
// 「旧英文 / 新英文 / 旧译文 / 改动点」一起交给 LLM 链更新译文，再生成一份 dictapply 清单
// （rename + value）落盘；dictapply 负责 lint 后置闸门与「带问题整体拒绝」的语义。
//
// 配置与本地校验与 auto_translate 同源：.translator.json（或 HANHUA_LLM_* 环境变量）+
// validateLlmTranslation（占位符一致 / 含中文 / 不等于原文 / 术语守卫 / 英文残留）。
// 额外守卫：译文与旧译文逐字节相同 → 视为「改动未体现」拒绝——语义已变时，原样保留反而是错的。
//
// 用法：
//   node tools/retranslate.js work/retranslate-<stamp>.json [--write] [--dict <dict.json>]
//   默认 dry-run（只报告）；--write 生成同目录 retranslate-apply-<stamp>.json 并跑 dictapply 落盘。
// 退出码：0 = 全部重译完成（--write 时已落盘）；1 = 有未解决条目 / 未配置 LLM / 落盘失败；2 = 用法或输入错误。
'use strict'
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { loadTranslatorConfig, validateLlmTranslation, chatComplete } = require('./auto_translate.js')

const REPO = path.join(__dirname, '..')
const DICTAPPLY = path.join(__dirname, 'dictapply.js')
const short = (s, n = 72) => {
  const t = String(s == null ? '' : s)
  return JSON.stringify(t.length > n ? t.slice(0, n) + '…' : t)
}

const SYS = [
  '你是 Freebuff Desktop（Electron 桌面应用）的简体中文本地化译者。上游对一条界面文案做了小改动，请把既有的中文译文「同步更新」到新文案。',
  '硬性要求：',
  '1. 只输出更新后的中文译文本身；不要输出引号、解释、markdown 或代码围栏。',
  '2. 只改动与英文改动对应的部分，其余文字保持与旧译文一致（不要顺手重写整句）。',
  '3. 保留所有 ${...} 占位符逐字节不变；占位符内部的代码不翻译。',
  '4. 术语表：thread=会话（绝不能译成"线程"）、agent=智能体、workspace=工作区、token=令牌、repository=代码仓库、commit=提交；品牌与产品名（Freebuff、Freebucks 等）保持原文。',
  '5. 译文中除品牌/产品名、占位符与单位外，不得残留英文单词或英文句式；问句保留问号，省略号用 …。',
].join('\n')

const buildMessages = (it) => [
  { role: 'system', content: SYS },
  {
    role: 'user',
    content:
      `旧英文：${it.oldKey}\n` +
      `新英文：${it.newKey}\n` +
      `英文改动：${(it.change && it.change.from) || '（未知）'} → ${(it.change && it.change.to) || '（未知）'}\n` +
      `旧译文：${it.oldZh}\n` +
      '只输出更新后的新版中文译文。',
  },
]

// 单条重译：多模型按顺序故障切换；任何本地校验不过都换下一档（仍不过交人工）。
async function retranslateOne(it, cfg) {
  const errors = []
  for (const model of cfg.models) {
    try {
      const raw = await chatComplete(model, buildMessages(it), cfg)
      let out = String(raw).trim()
      const fence = out.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/)
      if (fence) out = fence[1].trim()
      try {
        const j = JSON.parse(out)
        if (typeof j === 'string') out = j
      } catch {
        /* 不是 JSON 字符串就按原文用 */
      }
      if (out === it.oldZh) {
        errors.push(`${model.model}: 译文与旧译文相同（改动未体现）`)
        continue
      }
      const v = validateLlmTranslation(it.newKey, out, it.section)
      if (!v.ok) {
        errors.push(`${model.model}: ${v.reason}`)
        continue
      }
      return { ok: true, out, model: model.model }
    } catch (e) {
      errors.push(`${model.model}: ${String((e && e.message) || e)}`)
    }
  }
  return { ok: false, errors }
}

function usage(msg) {
  if (msg) console.error('ERROR: ' + msg)
  console.error('usage: node tools/retranslate.js <retranslate-*.json> [--write] [--dict <dict.json>]')
  process.exit(2)
}

async function main() {
  const argv = process.argv.slice(2)
  let write = false
  let dictPath = path.join(REPO, 'dict.json')
  const pos = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--write') write = true
    else if (a === '--dry-run') write = false
    else if (a === '--dict') {
      const v = argv[++i]
      if (!v) usage('--dict 缺值')
      dictPath = path.resolve(v)
    } else if (a.startsWith('--')) usage(`未知参数：${a}`)
    else pos.push(a)
  }
  if (!pos.length) usage('缺重译清单路径')
  const inPath = path.resolve(pos[0])
  if (!fs.existsSync(inPath)) usage(`清单不存在：${inPath}`)
  if (!fs.existsSync(dictPath)) usage(`词典不存在：${dictPath}`)
  let items
  try {
    items = JSON.parse(fs.readFileSync(inPath, 'utf8'))
  } catch (e) {
    usage(`清单不是合法 JSON：${e.message}`)
  }
  if (!Array.isArray(items) || !items.length) usage('清单为空或不是数组')

  const cfg = loadTranslatorConfig()
  if (!cfg) {
    console.error('未配置 .translator.json / HANHUA_LLM_*（LLM 未启用）——本清单需人工重译，未改动任何文件。')
    return 1
  }
  console.log(`微改写重译：${items.length} 条 → ${cfg.models.length} 个模型（${cfg.source}）`)

  const resolved = []
  const unresolved = []
  for (const it of items) {
    if (!it || typeof it.oldKey !== 'string' || typeof it.newKey !== 'string') {
      unresolved.push({ it, errors: ['条目缺 oldKey / newKey'] })
      continue
    }
    const r = await retranslateOne(it, cfg)
    if (r.ok) {
      resolved.push({ ...it, newZh: r.out })
      console.log(`  ✓ ${short(it.oldKey)}`)
      console.log(`      旧：${short(it.oldZh)}`)
      console.log(`      新：${short(r.out)}（${r.model}）`)
    } else {
      unresolved.push({ it, errors: r.errors })
      console.log(`  ✗ ${short(it.oldKey)}`)
      for (const e of r.errors.slice(0, 3)) console.log(`      ${e}`)
    }
    if (cfg.paceMs > 0) await new Promise((res) => setTimeout(res, cfg.paceMs))
  }

  if (write && resolved.length) {
    // 生成 dictapply 清单：rename（旧键→新键）+ 明确 value（重译结果）。
    const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'))
    const rename = []
    for (const r of resolved) {
      const sec = dict[r.section]
      if (!sec || !Object.prototype.hasOwnProperty.call(sec, r.oldKey)) {
        const why = `${r.section} 里找不到旧键（可能已被其他步骤处理）`
        unresolved.push({ it: r, errors: [why] })
        console.error(`  ! ${short(r.oldKey)}：${why}`)
        continue
      }
      if (Object.prototype.hasOwnProperty.call(sec, r.newKey)) {
        const why = '新键已存在（会撞键，跳过）'
        unresolved.push({ it: r, errors: [why] })
        console.error(`  ! ${short(r.oldKey)}：${why}`)
        continue
      }
      rename.push({ section: r.section, key: r.oldKey, to: r.newKey, value: r.newZh, note: 'retranslate.js 微改写重译' })
    }
    if (rename.length) {
      const stamp = (path.basename(inPath).match(/(\d{8}-\d{6})/) || [])[1] || String(Date.now())
      const clPath = path.join(path.dirname(inPath), `retranslate-apply-${stamp}.json`)
      fs.writeFileSync(clPath, JSON.stringify({ generatedBy: 'retranslate.js', rename }, null, 2) + '\n')
      const dump = (r) => console.log((r.stdout || '') + (r.stderr || ''))
      const check = spawnSync(process.execPath, [DICTAPPLY, clPath, '--dict', dictPath, '--check'], { encoding: 'utf8' })
      if (check.status !== 0) {
        console.error(`dictapply --check 未过，未落盘（清单保留：${clPath}）`)
        dump(check)
        return 1
      }
      const w = spawnSync(process.execPath, [DICTAPPLY, clPath, '--dict', dictPath, '--write'], { encoding: 'utf8' })
      if (w.status !== 0) {
        console.error('dictapply --write 失败（词典未改或已还原）')
        dump(w)
        return 1
      }
      dump(w)
    }
  } else if (!write && resolved.length) {
    console.log('\n(dry-run：未修改任何文件；确认后加 --write 生成 dictapply 清单并落盘)')
  }

  if (unresolved.length) {
    console.error(`\n仍有 ${unresolved.length} 条未解决（保持原样，需人工处理）`)
    return 1
  }
  console.log(write ? '\n✓ 全部重译完成并已落盘（dictapply，含 lint 后置闸门）' : '\n✓ 全部重译预演完成（加 --write 落盘）')
  return 0
}

main()
  .then((rc) => process.exit(rc))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
