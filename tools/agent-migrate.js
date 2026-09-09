#!/usr/bin/env node
// agent-migrate.js — MISSED 词条的 Codex agent 兜底修复
//
// 流水线位置：autoupdate.sh 在自动翻译两轮后仍有 MISSED 时调用，转人工前最后兜底。
// 设计红线：agent 只产出结构化迁移方案（JSON），落库前必须全部通过本脚本的
// 确定性校验；校验不过一条都不写。agent 运行在隔离目录 + read-only sandbox，
// 无法触碰 dict.json / .translator.json。
//
// 用法：node tools/agent-migrate.js <update-report.txt> <pristine-bundle.js> [--dry]
// 退出码：0=已应用  2=codex 不可用  3=输出非 JSON  4=校验失败  5=无 MISSED
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DICT = path.join(ROOT, 'dict.json');
const REPORT = process.argv[2];
const BUNDLE = process.argv[3];
const DRY = process.argv.includes('--dry');
if (!REPORT || !BUNDLE) {
  console.error('usage: node tools/agent-migrate.js <report> <bundle> [--dry]');
  process.exit(5);
}

const log = (m) => console.log(`[agent-migrate] ${m}`);

// ---- 1. 从构建报告提取 MISSED 明细 ------------------------------------------
// apply.js 的输出格式：`MISSED (N keys, no exact match):` 后跟 `  - "key"` 行。
const reportText = fs.readFileSync(REPORT, 'utf8');
const missedKeys = [];
const lines = reportText.split('\n');
let inMissed = false;
for (const line of lines) {
  if (/^MISSED \(\d+ keys/.test(line)) { inMissed = true; continue; }
  if (inMissed) {
    const m = line.match(/^  - "(.+)"$/);
    if (m) { missedKeys.push(JSON.parse('"' + m[1] + '"')); continue; }
    if (line.trim() === '' || /^missed /.test(line)) { inMissed = false; }
  }
}
// 按出现 section 分流：含 ${...} 的算 template 候选，其余 exact 候选
const entries = missedKeys.map((k) => ({
  key: k,
  section: /\$\{[^}]+\}/.test(k) ? 'template' : 'exact',
}));
if (!entries.length) { log('报告中没有 MISSED 明细'); process.exit(5); }
log(`提取到 ${entries.length} 条 MISSED：template=${entries.filter(e => e.section === 'template').length} exact=${entries.filter(e => e.section === 'exact').length}`);

const bundleSrc = fs.readFileSync(BUNDLE, 'utf8');
const dict = JSON.parse(fs.readFileSync(DICT, 'utf8'));

// ---- 2. 预消化上下文卡片（不给 agent 原始 bundle，省 token 且防漂移）----------
// 失配 key 在 bundle 中找不到时，用 key 的纯文本"锚片段"兜底搜索：命中即给
// 窗口——这是发现"官方新写法"的关键线索（人工迁移 0.0.97 时的做法）。
function occurrences(key, section) {
  const out = [];
  const needle = section === 'template' ? '`' + key + '`' : '"' + key + '"';
  let i = bundleSrc.indexOf(needle);
  while (i !== -1 && out.length < 3) {
    out.push(bundleSrc.slice(Math.max(0, i - 160), i + key.length + 160).replace(/\n/g, '\\n'));
    i = bundleSrc.indexOf(needle, i + 1);
  }
  if (out.length) return { found: true, ctx: out };
  // 锚文本兜底：取 key 的纯文本段（去 ${...}），长片段优先
  const segs = key.split(/\$\{[^}]*\}/g).map((s) => s.trim()).filter((s) => s.length >= 12);
  segs.sort((a, b) => b.length - a.length);
  for (const seg of segs.slice(0, 2)) {
    const j = bundleSrc.indexOf(seg);
    if (j !== -1) {
      out.push(bundleSrc.slice(Math.max(0, j - 200), j + seg.length + 320).replace(/\n/g, '\\n'));
    }
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

const cards = [];
for (const e of entries) {
  const occ = occurrences(e.key, e.section);
  cards.push({
    section: e.section,
    key: e.key,
    inBundle: occ.found,
    occurrences: occ.ctx,
    similar: similarEntries(e.key, e.section),
  });
}

// ---- 3. 组装 prompt 并调用 codex（read-only + 隔离目录）---------------------
const cardText = cards.map((c, i) => {
  const occ = c.inBundle
    ? c.occurrences.map((o) => '    ' + JSON.stringify(o.slice(0, 340))).join('\n')
    : c.occurrences.length
      ? c.occurrences.map((o) => '    (锚文本命中，新写法大概率在此窗口) ' + JSON.stringify(o.slice(0, 340))).join('\n')
      : '    (完全未找到，且锚文本无命中)';
  const sim = c.similar.map((s) => `    [${s.sim.toFixed(2)}] ${JSON.stringify(s.k)} => ${JSON.stringify(s.zh)}`).join('\n') || '    (无)';
  return `### 条目 ${i + 1} [${c.section}]
key: ${JSON.stringify(c.key)}
bundle 上下文:
${occ}
词典相似旧词条:
${sim}`;
}).join('\n\n');

const PROMPT = `你是 Freebuff 桌面应用汉化词典的迁移助手。官方发布了新版本，构建时发现以下词典条目在新 bundle 中"未命中"（词典里的 key 与 bundle 中的实际文案对不上）。请逐条判定处理方式。

判定依据（按优先级）：
1. key 找不到但"锚文本命中"窗口里出现了高度相似的新写法（变量名/措辞小改）→ 官方改写了该文案，必须 rewrite：old=失配的词典 key，key=窗口里的新写法，zh 沿用旧中文并按新措辞微调
2. key 在 bundle 中原样找到且是界面文案，但词典没有对应词条 → new（新文案，翻译）
3. 锚文本完全无命中、词典相似词条也无高相似 → 官方删除了该文案，delete
4. 上下文显示 key 出现在 top:、name:、value:、case、===、import 等代码语义位置 → 代码字符串不是 UI 文案，必须 skip
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
2. rewrite/new 的 key 必须从 bundle 上下文窗口中原样复制，一个字符都不能改；特别注意转义——上下文里的 \\\" 在你的输出 JSON 字符串里就写 \\"（单层），不要双重转义
3. zh 必须是自然简体中文；${'${'}...${'}'} 占位符原样保留、数量与 key 完全一致（变量名也保持新写法里的名字）
4. zh 里禁止出现反引号
5. rewrite 的 old 必须与"key:"行逐字符相同（单层转义）
6. 代码字符串、规则名、枚举值、文件名 → skip
7. 每条输入条目都必须有对应输出（包括 skip）

待处理条目：

${cardText}`;

// ---- 4. 运行 codex ------------------------------------------------------------
// 代理探活失败直接转人工（退出码 2），不硬等。
function proxyAlive() {
  try {
    execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '5', 'http://127.0.0.1:3128/v1/models'], { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch { return false; }
}
if (!proxyAlive()) { log('净化代理 127.0.0.1:3128 未运行，转人工'); process.exit(2); }

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, '.translator.json'), 'utf8')); } catch {}
const apiKey = process.env.HANHUA_LLM_KEY || cfg.apiKey || '';
if (!apiKey) { log('无 API key（.translator.json），转人工'); process.exit(2); }

const WORKDIR = path.join(ROOT, 'work');
fs.mkdirSync(WORKDIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 17);
const lastMsg = path.join(WORKDIR, `agent-last-${stamp}.txt`);
const codexLog = path.join(WORKDIR, `agent-codex-${stamp}.log`);

log('调用 codex（deepseek-v4-flash，最长 12 分钟）...');
const cwd = fs.mkdtempSync('/tmp/codex-agent-');
fs.writeFileSync(path.join(cwd, 'task.txt'), PROMPT);
let rc = 0;
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
  rc = typeof e.status === 'number' ? e.status : 2;
  if (e.stdout) fs.writeFileSync(codexLog, e.stdout.toString() + '\n' + (e.stderr || '').toString());
  log(`codex 失败（退出码 ${rc}），转人工。日志: ${codexLog}`);
  process.exit(2);
}

const raw = fs.readFileSync(lastMsg, 'utf8').trim();
fs.writeFileSync(codexLog, raw);
if (!raw) { log('codex 无输出，转人工'); process.exit(3); }

// ---- 5. 提取 JSON --------------------------------------------------------------
let ops;
{
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) { log('输出中找不到 JSON 数组，转人工'); process.exit(3); }
  try { ops = JSON.parse(raw.slice(start, end + 1)); }
  catch { log('JSON 解析失败，转人工'); process.exit(3); }
}
if (!Array.isArray(ops) || !ops.length) { log('空方案，转人工'); process.exit(3); }

// 转义规整：agent 复制转义字面量时可能双重转义（词典真实形态是 \"，agent 给了 \\\"）。
// 规整到词典/bundle 认识的形态；规整不了留给校验器拒绝。
function escapeCandidates(s) {
  const out = [s];
  for (let i = 0; i < 2; i++) {
    const prev = out[out.length - 1];
    const u = prev.replace(/\\\\/g, '\u0001').replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\u0001/g, '\\');
    if (u !== prev) out.push(u); else break;
  }
  return out;
}
for (const op of ops) {
  if (op.old != null && dict[op.section] && dict[op.section][op.old] === undefined) {
    for (const c of escapeCandidates(op.old)) {
      if (dict[op.section][c] !== undefined) { op.old = c; break; }
    }
  }
  if (op.key != null) {
    const wrap = (s) => (op.section === 'template' ? '`' + s + '`' : '"' + s + '"');
    if (!bundleSrc.includes(wrap(op.key))) {
      for (const c of escapeCandidates(op.key)) {
        if (c !== op.key && bundleSrc.includes(wrap(c))) { op.key = c; break; }
      }
    }
  }
}
log(`agent 方案 ${ops.length} 条：${JSON.stringify(ops.map(o => o.action))}`);

// ---- 6. 确定性校验（一条不过全不落库）----------------------------------------
const slotsOf = (s) => [...String(s).matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]).sort().join('|');
const CODE_CTX = /[{,(]\s*(?:top|name|value|type|kind|rule|mode|tag|id)\s*:\s*["'`]?$/;
const errors = [];
for (const op of ops) {
  const tag = `${op.action}:${String(op.key || op.old).slice(0, 60)}`;
  if (!['rewrite', 'new', 'delete', 'skip'].includes(op.action)) { errors.push(`${tag}: 未知 action`); continue; }
  if (op.action === 'skip') continue;
  if (!['exact', 'template'].includes(op.section)) { errors.push(`${tag}: 非法 section`); continue; }
  if (op.action === 'delete' || op.action === 'rewrite') {
    if (!(dict[op.section] || {})[op.old]) { errors.push(`${tag}: old 不在词典`); continue; }
  }
  if (op.action === 'delete') continue;
  // rewrite / new：key 必须在 bundle 中真实出现
  const needle = op.section === 'template' ? '`' + op.key + '`' : '"' + op.key + '"';
  const idx = bundleSrc.indexOf(needle);
  if (idx === -1 && !(op.section === 'exact' && bundleSrc.includes("'" + op.key + "'"))) {
    errors.push(`${tag}: key 不在 bundle 中`);
    continue;
  }
  // 代码语义位置黑名单（黑屏教训：top:"Styles" 被翻成"样式"导致引擎崩溃）
  const at = idx !== -1 ? idx : bundleSrc.indexOf("'" + op.key + "'");
  if (at !== -1) {
    const before = bundleSrc.slice(Math.max(0, at - 48), at);
    if (CODE_CTX.test(before) || /case\s+["']?$/.test(before) || /===?\s*["']?$/.test(before)) {
      errors.push(`${tag}: 出现在代码语义位置`);
      continue;
    }
  }
  if (!/[\u4e00-\u9fff]/.test(op.zh || '')) { errors.push(`${tag}: zh 无中文`); continue; }
  if (op.section === 'template' && slotsOf(op.key) !== slotsOf(op.zh)) {
    errors.push(`${tag}: 占位符不一致`);
    continue;
  }
  // 反引号规则：key 含嵌套模板反引号时 zh 允许等量保留（结构一致）；key 无则禁止
  {
    const kb = (String(op.key).match(/`/g) || []).length;
    const zb = (String(op.zh).match(/`/g) || []).length;
    if (kb === 0 && zb > 0) { errors.push(`${tag}: zh 含反引号`); continue; }
    if (kb > 0 && zb !== kb) { errors.push(`${tag}: zh 反引号数量与 key 不一致`); continue; }
  }
}
if (errors.length) {
  log(`校验失败 ${errors.length} 条（一条不落库原则）：`);
  for (const e of errors.slice(0, 20)) log(`  ✗ ${e}`);
  process.exit(4);
}
const applied = { rewrite: 0, new: 0, delete: 0, skip: 0 };
for (const op of ops) applied[op.action]++;

// ---- 7. 应用 ------------------------------------------------------------------
if (DRY) {
  log('DRY 模式，方案如下（未落库）:');
  for (const op of ops) log(`  ${JSON.stringify(op)}`);
  process.exit(0);
}
fs.copyFileSync(DICT, path.join(WORKDIR, `dict-before-agent-${stamp}.json`));
for (const op of ops) {
  if (op.action === 'rewrite') { delete dict[op.section][op.old]; dict[op.section][op.key] = op.zh; }
  else if (op.action === 'new') { dict[op.section][op.key] = op.zh; }
  else if (op.action === 'delete') { delete dict[op.section][op.old]; }
}
fs.writeFileSync(DICT, JSON.stringify(dict, null, 2) + '\n');
log(`已落库：rewrite=${applied.rewrite} new=${applied.new} delete=${applied.delete} skip=${applied.skip}（备份: work/dict-before-agent-${stamp}.json）`);
process.exit(0);
