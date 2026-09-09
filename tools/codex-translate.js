#!/usr/bin/env node
// codex-translate.js — Codex agent 全权翻译器(汉化"Codex 全程驱动"的核心)
//
// 职责:Freebuff 出新版本时,新文案的翻译/改写/删除/跳过判定全部交给 Codex agent。
// 它替代 autotranslate.js(批量 LLM)成为自动翻译的主力;LLM 批量翻译降级为
// Codex 不可用时的备胎(autoupdate.sh 里处理)。
//
// 输入:
//   <bundle.js>            英文原版主 bundle(必须)
//   --report <report.txt>  构建报告(可选):解析 MISSED 列表,合并为"失配词条"候选
//   --dry                  只输出方案,不落库
//   --max N                单批候选上限(默认 150,超出分多批,每批一次 codex 调用)
//
// 输出协议(供 autoupdate.sh 解析):
//   退出码 0 = 有落库(或 dry 有方案)  2 = codex/代理不可用  3 = 输出非 JSON
//   4 = 校验失败  5 = 无候选  1 = 其他错误
//   最后一行的标记:CODEX_TRANSLATE_OK / CODEX_TRANSLATE_NONE / CODEX_TRANSLATE_FAIL
//
// 设计红线(继承 agent-migrate.js):
//   - agent 只产出结构化 JSON 方案,落库前必须全部通过确定性校验,一条不过全不落库
//   - agent 运行在隔离目录 + read-only sandbox,无法触碰 dict.json / .translator.json
//   - 代码语义位置黑名单(黑屏教训:top:"Styles" 被翻成"样式"导致 Lezer 引擎崩溃)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { contextReason } = require('./semantic_guard');

const ROOT = path.join(__dirname, '..');
const DICT = path.join(ROOT, 'dict.json');
const BUNDLE = process.argv[2];
const DRY = process.argv.includes('--dry');
const extractOnly = process.argv.includes('--extract-only');
const reportIdx = process.argv.indexOf('--report');
const REPORT = reportIdx >= 0 ? process.argv[reportIdx + 1] : '';
const maxIdx = process.argv.indexOf('--max');
const MAX_BATCH = maxIdx >= 0 ? Number(process.argv[maxIdx + 1] || 150) : 150;
if (!BUNDLE) {
  console.error('usage: node tools/codex-translate.js <bundle.js> [--report report.txt] [--dry] [--extract-only] [--max N]');
  process.exit(1);
}

const log = (m) => console.log(`[codex-translate] ${m}`);

const bundleSrc = fs.readFileSync(BUNDLE, 'utf8');
const dict = JSON.parse(fs.readFileSync(DICT, 'utf8'));
const knownKeys = new Set([
  ...Object.keys(dict.exact || {}),
  ...Object.keys(dict.template || {}),
  ...Object.keys(dict.pattern || {}),
  ...Object.keys(dict.code || {}),
]);

// ---- 1. 候选提取 --------------------------------------------------------------
// 1a. 从 bundle 提取未入词典的新文案(复用 autotranslate.js 的判定逻辑)
const looksLikeCode = (s) => {
  const t = s.trim();
  if (!t) return true;
  if (/[\u4e00-\u9fff]/.test(t)) return true;
  if (!/[A-Za-z]/.test(t)) return true;
  if (/^[a-z][a-zA-Z0-9]*$/.test(t)) return true;
  if (/^[a-z]+_[a-z0-9_]+$/i.test(t)) return true;
  if (/^[a-z]+-[a-z0-9-]+$/i.test(t)) return true;
  if (/^[A-Z_][A-Z0-9_]*$/.test(t)) return true;
  if (/^(data-|aria-|on[A-Z]|xmlns|http|https|www\.|\.\/|\.\.\/|[a-z]+:\/\/|class=|style=|id=|for=|name=|type=|key=|ref=|role=)/i.test(t)) return true;
  if (/^[<{\[(]/.test(t)) return true;
  if (/<\/?[a-zA-Z][a-zA-Z0-9]*[\s>/]/.test(t)) return true;
  if (/&&|\|\||===|!==|=>|==|!=|;|void 0|typeof|instanceof|new |return |function|\(.*\)[,:;]?$/.test(t)) return true;
  if (!/\$\{/.test(t) && /[{}()[\]\\]/.test(t)) return true;
  if (/^[#0-9]/.test(t)) return true;
  if (/(px|em|rem|vh|vw|%|deg|rad)$/.test(t) && /\s/.test(t)) return true;
  return false;
};

const isUIFacing = (s) => {
  const t = s.trim();
  if (t.length < 3) return false;
  if (looksLikeCode(s)) return false;
  const words = t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length === 0) return false;
  for (const w of words) if (/[a-z][A-Z]/.test(w)) return false;
  if (words.length >= 2) {
    const allLowerShort = words.every((w) => /^[a-z]{1,4}$/.test(w));
    if (allLowerShort) return false;
    const anyTitle = words.some((w) => /^[A-Z]/.test(w));
    const anyLong = words.some((w) => w.length >= 6);
    if (anyTitle || anyLong) return true;
    return false;
  }
  const w = words[0];
  const keyNames = /^(Esc|Escape|Enter|Return|Tab|Space|Backspace|Delete|Insert|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Shift|Control|Ctrl|Alt|Meta|CapsLock|F1?[0-9]?)$/i;
  if (keyNames.test(w)) return false;
  if (/^[A-Z][a-z]{2,}$/.test(w)) return true;
  return false;
};

// 健壮的字面量扫描：压缩代码里的 `\"`/`\\` 转义序列会让全局正则的引号配对
// 错位，把后续真实字面量吞进超长匹配（0.0.98 的 "Thread mentions" 因此漏提取、
// 以英文发布）。逐字符配对，遇 `\` 跳过下一字符，保证每个字面量独立切出。
function scanLiterals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const q = src[i];
    if (q !== '"' && q !== '`') { i++; continue; }
    let j = i + 1;
    let raw = '';
    let closed = false;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') { raw += c + (src[j + 1] || ''); j += 2; continue; }
      if (c === q) { closed = true; break; }
      raw += c; j++;
    }
    if (closed) out.push({ raw, quote: q, start: i, end: j + 1 });
    i = (closed ? j : i) + 1;
  }
  return out;
}

// 代码语义位置黑名单(与 autotranslate.js 一致)
const codeProp = /\b(name|top|role|kind|type|tag|parser|token|node|term|grammar|lang|mode|match|rule|alias|ext|id|key|icon|scope|selector|extension|value|format|style|prop|state|event|source|context)\s*:\s*$/;
const blockedStr = new Set();
for (const lit of scanLiterals(bundleSrc)) {
  const before = bundleSrc.slice(Math.max(0, lit.start - 40), lit.start);
  if (codeProp.test(before) || /[=!]==?\s*$/.test(before) || /case\s*$/.test(before)) blockedStr.add(lit.raw);
}

// 候选集:Map<key, {kind: 'exact'|'template', src: 'new'|'missed', count}>
const candidates = new Map();
function addCandidate(key, kind, src) {
  if (!key) return;
  const exist = candidates.get(key);
  if (exist) { exist.count++; if (src === 'missed') exist.src = 'missed'; return; }
  candidates.set(key, { kind, src, count: 1 });
}
for (const lit of scanLiterals(bundleSrc)) {
  if (lit.quote !== '"') continue;
  const raw = lit.raw;
  let en = raw;
  try { en = JSON.parse('"' + raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'); } catch { en = raw; }
  if (!isUIFacing(en)) continue;
  if (blockedStr.has(raw)) continue;
  if (knownKeys.has(en)) continue;
  if (dict.exact && dict.exact[en]) continue;
  if (dict.template && dict.template[en]) continue;
  addCandidate(en, 'exact', 'new');
}
for (const lit of scanLiterals(bundleSrc)) {
  if (lit.quote !== '`') continue;
  const t = lit.raw;
  if (/\$\{[^}]*$/.test(t)) continue;
  if (!isUIFacing(t)) continue;
  if (blockedStr.has(t)) continue;
  if (knownKeys.has(t)) continue;
  if (dict.template && dict.template[t]) continue;
  addCandidate(t, 'template', 'new');
}

// 1b. 从构建报告解析 MISSED(词典 key 在新 bundle 未命中 → rewrite/delete/skip 候选)
if (REPORT && fs.existsSync(REPORT)) {
  const reportText = fs.readFileSync(REPORT, 'utf8');
  let inMissed = false;
  for (const line of reportText.split('\n')) {
    if (/^MISSED \(\d+ keys/.test(line)) { inMissed = true; continue; }
    if (inMissed) {
      const m = line.match(/^  - "(.+)"$/);
      if (m) {
        let k = m[1];
        try { k = JSON.parse('"' + k + '"'); } catch { /* 保持原样 */ }
        addCandidate(k, /\$\{[^}]+\}/.test(k) ? 'template' : 'exact', 'missed');
        continue;
      }
      if (line.trim() === '' || /^missed /.test(line)) inMissed = false;
    }
  }
}

// 语义守卫后置扫描(黑屏教训的完整版)：对每个候选词条在 bundle 中扫全部出现
// 位置，任一处位于代码语义上下文(createEvent/phrase/endsWith/types.includes/
// configure 调用参数、平台 API 参数、比较/switch/语义属性值)即整条剔除——
// apply 是全局替换，词典里绝不能收这类词条(0.0.97 的 top:"Styles"→"样式"
// 导致 Lezer 引擎崩溃)。用 indexOf 逐位置检查而非正则遍历字面量，避免压缩
// 代码的转义序列干扰字面量切分。
{
  const semanticHit = (needle) => {
    let from = 0, idx;
    while ((idx = bundleSrc.indexOf(needle, from)) !== -1) {
      if (contextReason(bundleSrc, idx, idx + needle.length)) return true;
      from = idx + needle.length;
    }
    return false;
  };
  const drop = [];
  for (const [key] of candidates) {
    if (semanticHit('"' + key + '"') || semanticHit('`' + key + '`')) drop.push(key);
  }
  for (const k of drop) candidates.delete(k);
  if (drop.length) log(`语义守卫剔除 ${drop.length} 条候选：${drop.slice(0, 10).map(JSON.stringify).join(', ')}`);
}

// 与 autotranslate.js 对齐：剔除含中文引号/"already|translated" 字样噪音，
// 按出现次数降序(真 UI 文案多处引用,噪音通常只出现 1 次)取前 MAX_BATCH。
// 候选预筛：按内容特征剔除明显的代码噪音(CSS/JSX/正则/拼接碎片)。
// 实测 0.0.97 bundle 150 条候选里 90%+ 是 isUIFacing 误判的噪音，全部喂给
// Codex 会浪费大量 token。预筛误杀的候选会被 LLM 批量翻译降级兜底，不会丢。
const noiseFilter = ([en]) => {
  if (!/^[A-Za-z]/.test(en)) return false;               // 非字母开头(空格/标点/符号残留)
  if (/!important/i.test(en)) return false;              // CSS 关键值
  if (/[^A-Za-z0-9\s.,!?'"()\-:;%@$\{\}]/.test(en)) return false; // 异常字符(反斜杠/反引号/等号等；@ 是 thread mention 合法字符)
  if (/\.jsx\(|=>|===|!==|\?\?|&&|\|\||\bnew\s+\w+\(/.test(en)) return false; // JS 表达式
  if (/[,:;]$/.test(en)) return false;                   // 代码符号结尾
  return true;
};
let list = [...candidates.entries()]
  .filter(([en]) => !/[“”‘’]/.test(en) && !/already|translated/i.test(en))
  .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
const rawCount = list.length;
list = list.filter(noiseFilter);
if (rawCount - list.length > 0) log(`候选预筛：${rawCount} → ${list.length} 条（过滤 ${rawCount - list.length} 条疑似代码噪音）`);
list = list.slice(0, MAX_BATCH);
if (list.length === 0) {
  log('没有发现新文案候选，无需翻译');
  console.log('CODEX_TRANSLATE_NONE');
  process.exit(0);
}
log(`候选 ${list.length} 条：new=${list.filter(([, v]) => v.src === 'new').length} missed=${list.filter(([, v]) => v.src === 'missed').length}（exact=${list.filter(([, v]) => v.kind === 'exact').length} template=${list.filter(([, v]) => v.kind === 'template').length}）`);
log(`count>=2: ${list.filter(([, v]) => v.count >= 2).length} / count==1: ${list.filter(([, v]) => v.count === 1).length}`);

if (extractOnly) {
  for (const [k, v] of list) log(`  [${v.src}/${v.kind}] x${v.count} ${JSON.stringify(k.slice(0, 120))}`);
  log('[extract-only] 未调用 codex，以上为全部待翻译候选');
  console.log('CODEX_TRANSLATE_NONE');
  process.exit(0);
}
if (DRY) {
  for (const [k, v] of list.slice(0, 15)) log(`  [${v.src}/${v.kind}] x${v.count} ${JSON.stringify(k.slice(0, 90))}`);
  if (list.length > 15) log(`  … 其余 ${list.length - 15} 条省略`);
}

// ---- 2. 上下文卡片 --------------------------------------------------------------
function occurrences(key, section) {
  const out = [];
  const needle = section === 'template' ? '`' + key + '`' : '"' + key + '"';
  let i = bundleSrc.indexOf(needle);
  while (i !== -1 && out.length < 3) {
    out.push(bundleSrc.slice(Math.max(0, i - 160), i + key.length + 160).replace(/\n/g, '\\n'));
    i = bundleSrc.indexOf(needle, i + 1);
  }
  if (out.length) return { found: true, ctx: out };
  const segs = key.split(/\$\{[^}]*\}/g).map((s) => s.trim()).filter((s) => s.length >= 12);
  segs.sort((a, b) => b.length - a.length);
  for (const seg of segs.slice(0, 2)) {
    const j = bundleSrc.indexOf(seg);
    if (j !== -1) out.push(bundleSrc.slice(Math.max(0, j - 200), j + seg.length + 320).replace(/\n/g, '\\n'));
  }
  return { found: false, ctx: out };
}

function trigrams(s) {
  const t = new Set();
  for (let i = 0; i < s.length - 2; i++) t.add(s.slice(i, i + 3));
  return t;
}
function similarity(a, b) {
  const ta = trigrams(a), tb = trigrams(b);
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter++;
  return inter / (ta.size + tb.size - inter || 1);
}
function similarEntries(key, section, n = 4) {
  return Object.entries(dict[section] || {})
    .filter(([k]) => k !== key)
    .map(([k, zh]) => ({ k, zh, sim: similarity(key, k) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, n)
    .filter((x) => x.sim > 0.05);
}

function buildCards(entries) {
  return entries.map(([key, v]) => {
    const occ = occurrences(key, v.kind);
    const sim = similarEntries(key, v.kind);
    return {
      key, kind: v.kind, src: v.src, found: occ.found, occurrences: occ.ctx, similar: sim,
    };
  });
}

// ---- 3. codex 调用 --------------------------------------------------------------
function proxyAlive() {
  try {
    execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '5', 'http://127.0.0.1:3128/v1/models'], { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch { return false; }
}
if (!proxyAlive()) { log('净化代理 127.0.0.1:3128 未运行，转人工'); console.log('CODEX_TRANSLATE_FAIL'); process.exit(2); }

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, '.translator.json'), 'utf8')); } catch {}
// 兼容单模型(cfg.apiKey)与多模型(models[0].apiKey)两种配置
const apiKey = process.env.HANHUA_LLM_KEY || cfg.apiKey || (Array.isArray(cfg.models) && cfg.models[0] && cfg.models[0].apiKey) || '';
if (!apiKey) { log('无 API key（.translator.json），转人工'); console.log('CODEX_TRANSLATE_FAIL'); process.exit(2); }

const WORKDIR = path.join(ROOT, 'work');
fs.mkdirSync(WORKDIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 17);

function cardText(card) {
  const occ = card.found
    ? card.occurrences.map((o) => '    ' + JSON.stringify(o.slice(0, 340))).join('\n')
    : card.occurrences.length
      ? card.occurrences.map((o) => '    (锚文本命中，新写法大概率在此窗口) ' + JSON.stringify(o.slice(0, 340))).join('\n')
      : '    (完全未找到，且锚文本无命中)';
  const sim = card.similar.map((s) => `    [${s.sim.toFixed(2)}] ${JSON.stringify(s.k)} => ${JSON.stringify(s.zh)}`).join('\n') || '    (无)';
  const hint = card.src === 'missed'
    ? '类型: 词典旧词条失配——官方可能改写了文案(判 rewrite/delete)或该文案已不存在(判 skip)'
    : '类型: 新文案——bundle 里有但词典没有(判 new)或不是界面文案(判 skip)';
  return `### 条目 ${card.key === undefined ? '?' : ''} [${card.kind}]\n${hint}\nkey: ${JSON.stringify(card.key)}\nbundle 上下文:\n${occ}\n词典相似旧词条:\n${sim}`;
}

function runCodexBatch(cards) {
  const cardTexts = cards.map((c, i) => cardText(c, i)).join('\n\n');
  const PROMPT = `你是 Freebuff 桌面应用汉化词典的维护助手。官方发布了新版本，需要你处理一批词典条目。请逐条判定处理方式。

判定依据（按优先级）：
1. "词典旧词条失配"类（key 在 bundle 中找不到，但"锚文本命中"窗口里出现高度相似的新写法）→ 官方改写了该文案，必须 rewrite：old=失配的词典旧 key，key=窗口里的新写法，zh 沿用旧中文并按新措辞微调
2. "新文案"类（key 在 bundle 中原样找到且是界面文案）→ new（翻译成中文）
3. key 完全找不到、锚文本无命中、词典相似词条也无高相似 → 官方删除了该文案，delete
4. 上下文显示 key 出现在 top:、name:、value:、case、===、import 等代码语义位置，或它是代码/规则名/枚举值/文件名/CSS 类/URL → 不是 UI 文案，必须 skip
5. 拿不准就 skip，宁缺勿滥

严格只输出一个 JSON 数组，不要输出任何解释文字、不要 markdown 代码块围栏：
[
  {"action":"rewrite","section":"template","old":"失配的词典旧 key","key":"bundle 中的新写法","zh":"中文翻译"},
  {"action":"new","section":"exact","key":"新文案","zh":"中文翻译"},
  {"action":"delete","section":"exact","old":"词典中已无对应文案的旧 key"},
  {"action":"skip","key":"该条 key","reason":"简短原因"}
]

硬性规则：
1. action ∈ rewrite/new/delete/skip；section ∈ template/exact
2. rewrite/new 的 key 必须从 bundle 上下文窗口中原样复制，一个字符都不能改；特别注意转义——上下文里的 \\\\" 在你的输出 JSON 字符串里就写 \\"（单层），不要双重转义
3. zh 必须是自然简体中文；${'${'}...${'}'} 占位符原样保留、数量与 key 完全一致（变量名也保持新写法里的名字）
4. zh 里禁止出现反引号
5. rewrite 的 old 必须与"key:"行逐字符相同（单层转义）
6. 每条输入条目都必须有对应输出（包括 skip）

待处理条目：

${cardTexts}`;

  const lastMsg = path.join(WORKDIR, `codex-last-${stamp}.txt`);
  const codexLog = path.join(WORKDIR, `codex-${stamp}.log`);
  log(`调用 codex 翻译 ${cards.length} 条（最长 12 分钟）...`);
  const cwd = fs.mkdtempSync('/tmp/codex-translate-');
  fs.writeFileSync(path.join(cwd, 'task.txt'), PROMPT);
  try {
    execFileSync('codex', [
      'exec', '--sandbox', 'read-only', '-C', cwd,
      '--skip-git-repo-check',
      '--output-last-message', lastMsg,
      '读取 task.txt 里的任务说明并完成它。把最终 JSON 数组直接作为你的最后消息输出。',
    ], {
      env: { ...process.env, ROUTER_API_KEY: apiKey },
      timeout: 12 * 60 * 1000,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    const rc = typeof e.status === 'number' ? e.status : 2;
    if (e.stdout) fs.writeFileSync(codexLog, e.stdout.toString() + '\n' + (e.stderr || '').toString());
    log(`codex 失败（退出码 ${rc}），日志: ${codexLog}`);
    throw Object.assign(new Error('codex 执行失败'), { code: 'CODEX_FAIL', detail: codexLog });
  }
  const raw = fs.readFileSync(lastMsg, 'utf8').trim();
  fs.writeFileSync(codexLog, raw);
  if (!raw) throw Object.assign(new Error('codex 无输出'), { code: 'CODEX_EMPTY' });
  return raw;
}

// ---- 4. JSON 提取 + 转义规整 ----------------------------------------------------
function parseOps(raw) {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) throw new Error('输出中找不到 JSON 数组');
  let ops;
  try { ops = JSON.parse(raw.slice(start, end + 1)); }
  catch { throw new Error('JSON 解析失败'); }
  if (!Array.isArray(ops) || !ops.length) throw new Error('空方案');
  const escapeCandidates = (s) => {
    const out = [s];
    for (let i = 0; i < 2; i++) {
      const prev = out[out.length - 1];
      const u = prev.replace(/\\\\/g, '\u0001').replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\u0001/g, '\\');
      if (u !== prev) out.push(u); else break;
    }
    return out;
  };
  for (const op of ops) {
    if (op.old != null && dict[op.section] && dict[op.section][op.old] === undefined) {
      for (const c of escapeCandidates(op.old)) { if (dict[op.section][c] !== undefined) { op.old = c; break; } }
    }
    if (op.key != null) {
      const wrap = (s) => (op.section === 'template' ? '`' + s + '`' : '"' + s + '"');
      if (!bundleSrc.includes(wrap(op.key))) {
        for (const c of escapeCandidates(op.key)) { if (c !== op.key && bundleSrc.includes(wrap(c))) { op.key = c; break; } }
      }
    }
  }
  return ops;
}

// ---- 5. 确定性校验(一条不过全不落库) --------------------------------------------
const CODE_CTX = /[{,(]\s*(?:top|name|value|type|kind|rule|mode|tag|id)\s*:\s*["'`]?$/;
const slotsOf = (s) => [...String(s).matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]).sort().join('|');
function validateOps(ops) {
  const errors = [];
  const applicable = [];
  for (const op of ops) {
    const tag = `${op.action}:${String(op.key || op.old).slice(0, 60)}`;
    if (!['rewrite', 'new', 'delete', 'skip'].includes(op.action)) { errors.push(`${tag}: 未知 action`); continue; }
    if (op.action === 'skip') continue;
    if (!['exact', 'template'].includes(op.section)) { errors.push(`${tag}: 非法 section`); continue; }
    if (op.action === 'delete' || op.action === 'rewrite') {
      if (!(dict[op.section] || {})[op.old]) { errors.push(`${tag}: old 不在词典`); continue; }
    }
    if (op.action === 'delete') { applicable.push(op); continue; }
    const needle = op.section === 'template' ? '`' + op.key + '`' : '"' + op.key + '"';
    const idx = bundleSrc.indexOf(needle);
    if (idx === -1 && !(op.section === 'exact' && bundleSrc.includes("'" + op.key + "'"))) {
      errors.push(`${tag}: key 不在 bundle 中`);
      continue;
    }
    const at = idx !== -1 ? idx : bundleSrc.indexOf("'" + op.key + "'");
    if (at !== -1) {
      const before = bundleSrc.slice(Math.max(0, at - 48), at);
      if (CODE_CTX.test(before) || /case\s+["']?$/.test(before) || /===?\s*["']?$/.test(before)) {
        errors.push(`${tag}: 出现在代码语义位置`);
        continue;
      }
    }
    // semantic_guard 双保险：key 在 bundle 任一处出现于语义 API 参数/平台 API
    // 参数/语义属性等位置也拒绝落库（Codex 可能输出提取层没拦住的写法）。
    {
      const needle = op.section === 'template' ? '`' + op.key + '`' : '"' + op.key + '"';
      let from = 0, at2;
      let sem = false;
      while ((at2 = bundleSrc.indexOf(needle, from)) !== -1) {
        if (contextReason(bundleSrc, at2, at2 + needle.length)) { sem = true; break; }
        from = at2 + needle.length;
      }
      if (sem) { errors.push(`${tag}: 出现在代码语义位置(semantic_guard)`); continue; }
    }
    if (!/[\u4e00-\u9fff]/.test(op.zh || '')) { errors.push(`${tag}: zh 无中文`); continue; }
    if (op.section === 'template' && slotsOf(op.key) !== slotsOf(op.zh)) {
      errors.push(`${tag}: 占位符不一致`);
      continue;
    }
    {
      const kb = (String(op.key).match(/`/g) || []).length;
      const zb = (String(op.zh).match(/`/g) || []).length;
      if (kb === 0 && zb > 0) { errors.push(`${tag}: zh 含反引号`); continue; }
      if (kb > 0 && zb !== kb) { errors.push(`${tag}: zh 反引号数量与 key 不一致`); continue; }
    }
    applicable.push(op);
  }
  return { errors, applicable };
}

// ---- 6. 分批执行 + 落库 -----------------------------------------------------------
async function main() {
  const groups = [];
  for (let i = 0; i < list.length; i += MAX_BATCH) groups.push(list.slice(i, i + MAX_BATCH));
  let totalApplied = 0;
  const applied = { rewrite: 0, new: 0, delete: 0, skip: 0 };
  const allErrors = [];

  fs.copyFileSync(DICT, path.join(WORKDIR, `dict-before-codex-${stamp}.json`));

  for (let gi = 0; gi < groups.length; gi++) {
    const cards = buildCards(groups[gi]);
    let raw;
    try { raw = runCodexBatch(cards); }
    catch (e) {
      if (e.code === 'CODEX_FAIL') { console.log('CODEX_TRANSLATE_FAIL'); process.exit(2); }
      console.log('CODEX_TRANSLATE_FAIL');
      process.exit(3);
    }
    let ops;
    try { ops = parseOps(raw); }
    catch (e) {
      log(`方案解析失败: ${e.message}`);
      console.log('CODEX_TRANSLATE_FAIL');
      process.exit(3);
    }
    const { errors, applicable } = validateOps(ops);
    if (errors.length) {
      log(`校验失败 ${errors.length} 条（一条不落库原则，本批方案作废）：`);
      for (const e of errors.slice(0, 20)) log(`  ✗ ${e}`);
      allErrors.push(...errors);
      continue; // 本批放弃，继续下一批
    }
    for (const op of applicable) {
      applied[op.action]++;
      if (DRY) continue;
      if (op.action === 'rewrite') { delete dict[op.section][op.old]; dict[op.section][op.key] = op.zh; }
      else if (op.action === 'new') { dict[op.section][op.key] = op.zh; }
      else if (op.action === 'delete') { delete dict[op.section][op.old]; }
      totalApplied++;
    }
    log(`第 ${gi + 1}/${groups.length} 批方案：rewrite=${applied.rewrite} new=${applied.new} delete=${applied.delete} skip=${applied.skip}`);
    if (!DRY && totalApplied > 0) {
      fs.writeFileSync(DICT, JSON.stringify(dict, null, 2) + '\n');
      log(`已落库 ${totalApplied} 条（备份: work/dict-before-codex-${stamp}.json）`);
    }
    if (gi < groups.length - 1) await new Promise((r) => setTimeout(r, 2000));
  }

  if (DRY) {
    log(`DRY 模式，方案共 ${applied.rewrite + applied.new + applied.delete + applied.skip} 条（未落库）：rewrite=${applied.rewrite} new=${applied.new} delete=${applied.delete} skip=${applied.skip}`);
    if (allErrors.length) log(`校验失败 ${allErrors.length} 条（未落库）`);
    const anyAction = applied.rewrite + applied.new + applied.delete + applied.skip > 0;
    console.log(anyAction ? 'CODEX_TRANSLATE_OK' : 'CODEX_TRANSLATE_NONE');
    process.exit(0);
  }

  if (totalApplied > 0) {
    console.log(`CODEX_TRANSLATE_OK（落库 ${totalApplied} 条）`);
    process.exit(0);
  }
  log('无有效落库（全部被拒/校验失败/仅 skip）');
  console.log(allErrors.length ? 'CODEX_TRANSLATE_FAIL' : 'CODEX_TRANSLATE_NONE');
  process.exit(allErrors.length ? 4 : 0);
}

main().catch((e) => {
  console.error('codex-translate 失败:', e.message);
  console.log('CODEX_TRANSLATE_FAIL');
  process.exit(1);
});