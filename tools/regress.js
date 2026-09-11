#!/usr/bin/env node
// 回归闸门：比对新旧两版「已汉化产物」，列出新版里仍是英文、而旧版没有的自然语言片段。
//
// 为什么需要它：minifier 每次发版都会改模板里的变量名，词典键随之失配，靠 remap 迁移。
// 但迁移是「按去掉变量后的文字骨架」找位置——同一句话在代码里若有多种变体（变量写法不同），
// 两条词条可能被指到同一处、互相覆盖，剩下那处就变回英文。这种漏翻不会让 build.sh 的
// 「all keys matched」失败（因为它只检查词典里的词条有没有匹配到东西），属于静默回归，
// 只有把新旧两版产物对一遍才看得出来。
//
// 关键实现：比对前把 ${...} 插值整体抹掉，变量改名就不会造成误报；模板字面量按「每两个相邻
// 反引号之间」逐段取（含嵌套模板的内层段），不能用非重叠匹配，否则奇数段会被跳过。
//
// 用法：
//   node tools/regress.js <旧产物> <新产物>
//   旧/新产物都可以是：目录（含 ui/index.html 或 assets/index-*.js）、pack zip、bundle 文件
//
// 退出码：0 = 没有新增英文片段；1 = 发现新增英文片段（需人工确认）；2 = 有输入无法解析
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// --- 片段提取 -----------------------------------------------------------------

// 把 ${...}（含嵌套花括号 / 嵌套模板）整体替换成空格，只留自然语言骨架
function stripInterp(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 0;
      i += 2;
      while (i < s.length) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') {
          if (depth === 0) {
            i++;
            break;
          }
          depth--;
        }
        i++;
      }
      out += ' ';
    } else {
      out += s[i];
      i++;
    }
  }
  return out;
}

const WORD = /[A-Za-z]{2,}/g;

// 出现这些就基本是代码，不是给人看的文案。注意 } 不在此列：嵌套模板会让它把上一层的
// 收尾花括号留在本段里（如 paywall 的 `:"Drops"} to …`），那是正常文案。
const CODEISH = /[(){}\[\];=<>]|&&|\|\||=>|\?\.|\?\?|function |typeof |const |let |var |\[object|\\n|console\.|\.js\b/;
// 自然语言的强信号：至少出现一个常见小词
const COMMON = new RegExp(
  '\\b(' +
    [
      'the', 'and', 'or', 'to', 'of', 'in', 'you', 'your', 'yours', 'for', 'with', 'is', 'are',
      'not', 'this', 'that', 'these', 'those', 'from', 'will', 'can', 'cannot', 'when', 'then',
      'after', 'before', 'more', 'than', 'use', 'used', 'uses', 'if', 'on', 'day', 'days',
      'month', 'months', 'first', 'all', 'new', 'only', 'while', 'instead', 'have', 'has',
      'left', 'out', 'but', 'any', 'get', 'gets', 'add', 'adds', 'costs', 'cost', 'buys', 'buy',
      'plan', 'wallet', 'usage', 'hour', 'hours', 'session', 'sessions', 'message', 'messages',
      'tool', 'tools', 'free', 'trial', 'premium', 'unlimited', 'charged', 'spend', 'refund',
      'connect', 'connected', 'choose', 'select', 'search', 'add', 'remove', 'delete', 'save',
    ].join('|') +
    ')\\b',
  'i'
);

function isProse(plain, rawLen) {
  const t = plain.replace(/\s+/g, ' ').trim();
  if (t.length < 10 || t.length > 300) return false;
  if (rawLen > 800) return false; // 超长多半是拼进来的代码
  if (!/ /.test(t)) return false;
  if (CODEISH.test(t)) return false;
  // 单个残留的 } 允许（嵌套模板），再多就不是文案了
  if ((t.match(/[{}]/g) || []).length > 1) return false;
  const words = t.match(WORD) || [];
  if (words.length < 3) return false;
  const lower = words.filter((w) => /^[a-z]/.test(w)).length;
  if (lower / words.length < 0.6) return false;
  if (!COMMON.test(t)) return false;
  return true;
}

function collectFragments(file) {
  const src = fs.readFileSync(file, 'utf8');
  const set = new Set();
  const add = (raw) => {
    const plain = stripInterp(raw);
    if (/[\u4e00-\u9fff]/.test(plain)) return; // 已汉化
    if (isProse(plain, raw.length)) set.add(plain.replace(/\s+/g, ' ').trim());
  };
  for (const m of src.matchAll(/"((?:[^"\\\n]|\\.){8,600})"/g)) add(m[1]);
  // 模板：逐段取每两个相邻反引号之间的内容（转义反引号不算分隔）
  const ticks = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '`' && src[i - 1] !== '\\') ticks.push(i);
  }
  for (let i = 0; i + 1 < ticks.length; i++) {
    const seg = src.slice(ticks[i] + 1, ticks[i + 1]);
    if (seg.length >= 8 && seg.length <= 600) add(seg);
  }
  return set;
}

// --- 输入解析 -----------------------------------------------------------------

function mainBundleInDir(dir) {
  for (const p of [path.join(dir, 'ui', 'index.html'), path.join(dir, 'index.html')]) {
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, 'utf8').match(/src="\.\/(assets\/[^"]*\.js)"/);
    if (m) {
      const bundle = path.join(dir, m[1]);
      if (fs.existsSync(bundle)) return bundle;
    }
  }
  for (const sub of [path.join(dir, 'ui', 'assets'), path.join(dir, 'assets'), dir]) {
    if (!fs.existsSync(sub)) continue;
    const hit = fs.readdirSync(sub).find((f) => /^index-.*\.js$/.test(f));
    if (hit) return path.join(sub, hit);
  }
  return null;
}

function extractZip(zip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanhua-regress-'));
  const sysRoot = process.env.SYSTEMROOT || process.env.SystemRoot || '';
  const bsdtar = sysRoot ? path.join(sysRoot, 'System32', 'tar.exe') : '';
  const attempts = [];
  if (bsdtar && fs.existsSync(bsdtar)) attempts.push([bsdtar, ['-xf', zip, '-C', dir]]);
  attempts.push(['unzip', ['-qo', zip, '-d', dir]]);
  attempts.push(['7z', ['x', '-y', '-o' + dir, zip]]);
  for (const [cmd, args] of attempts) {
    try {
      execFileSync(cmd, args, { stdio: 'ignore' });
      return dir;
    } catch {
      /* 换下一个解压工具 */
    }
  }
  return null;
}

function resolveBundle(input) {
  if (!fs.existsSync(input)) return null;
  const st = fs.statSync(input);
  if (st.isDirectory()) return mainBundleInDir(input);
  if (/\.zip$/i.test(input)) {
    const dir = extractZip(input);
    return dir ? mainBundleInDir(dir) : null;
  }
  return input;
}

// --- 主流程 -------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('用法：node tools/regress.js <旧产物> <新产物>（目录 / pack zip / bundle 文件）');
  process.exit(2);
}

const oldBundle = resolveBundle(args[0]);
const newBundle = resolveBundle(args[1]);
if (!oldBundle || !newBundle) {
  console.error(`无法定位主 bundle：${oldBundle ? '' : args[0] + ' '}${newBundle ? '' : args[1]}`);
  console.error('（期望目录里有 ui/index.html，或 assets/index-*.js，或直接给 bundle / pack zip）');
  process.exit(2);
}

const oldSet = collectFragments(oldBundle);
const newSet = collectFragments(newBundle);
const added = [...newSet].filter((x) => !oldSet.has(x)).sort();

console.log(`回归闸门：${path.basename(oldBundle)} → ${path.basename(newBundle)}`);
console.log(`  旧版英文片段 ${oldSet.size} 处；新版 ${newSet.size} 处；新版独有 ${added.length} 处`);

if (added.length === 0) {
  console.log('  ✓ 未发现新增英文片段');
  process.exit(0);
}

console.log('  ❌ 新版出现以下英文片段（漏翻/迁移回归，或有意保留）：');
for (const x of added) console.log('    · ' + x.slice(0, 200));
console.log('  处理：能翻的补进 dict.json 后重跑 bash build.sh；确认有意保留的，发布时用');
console.log('        bash tools/release.sh --allow-english 放行。');
process.exit(1);
