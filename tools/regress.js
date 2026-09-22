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
// 「有意保留英文」不再只能靠发布时敲 --allow-english 全放行：默认读仓库根的
// intentional-english.json，逐条登记（带理由）的片段进「已登记」桶、不进失败判定，
// 未登记的新增片段依旧报错。登记项在产物里消失后会提醒清理（不失败）。
//
// 用法：
//   node tools/regress.js <旧产物> <新产物> [--allow-file <json>] [--no-allow]
//   旧/新产物都可以是：目录（含 ui/index.html 或 assets/index-*.js）、pack zip、bundle 文件
//
// 退出码：0 = 没有未登记的新增英文片段；1 = 有（需人工确认或登记）；2 = 有输入无法解析
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
// 关键字要带词边界：以前写成 `let `（带尾空格）会把「Wa**llet** 」这种普通词里的 let 也当关键字，
// 于是「Wallet 开头的整句」全被当成代码滤掉（0.0.114 适配时才发现：比对的合成句里带 wallet 的
// 永远进不了清单）。`;` 留着：重叠配对会抽出 `"a");x=1;(` 这种跨代码边界的片段，靠它甩掉。
// `instanceof` 是 0.0.120 适配时补进关键字组的：拼接式的片段（如 `,message:k instanceof
// Error?k.message:`）里恰好带着 message 这个常见小词，其余判据都拦不住它，而它跟 function /
// typeof 一样是 JS 关键字——不认它，回归闸门就会把「上游改了错误处理代码」误报成新增英文。
//
// **反引号（`）** 是 0.0.133 适配时补的：重叠配对遇到模板字面量会跨过模板定界符，抽出
// `:Xt?` - -menu`:void 0,` 这种「压缩代码 + 模板尾巴」的混合片段（源文本是
// `"aria-controls":Xt?`${ft}-${Xt}-menu`:void 0,` —— 开引号其实是 "aria-controls" 的**闭引号**）。
// 它带着 menu / void / 数字，两条判据都拦不住：upstreamdiff 会把它列进「待补翻」，而「本版
// 新增了什么」的真文案就藏在这条噪音后面（0.0.133 的 `Open` / `Closed` 就是先补了真文案、
// 噪音才单独露出来的）。判据：**自然文案里的反引号只可能是第三方库在引用标识符**
// （shiki 的 `` Please use `lazyRender` … ``、react-window 的 `` The `smooth` scroll … ``），
// 那种消息按惯例保留英文、进不进对差清单都没意义；而我们自己的文案一条都不带反引号——
// 实测两版产物在闸门口径（≥3 词 + 常见小词）下各 28 条含反引号片段，**全部是第三方库消息**，
// 宽口径下每一条跨引号片段都能在同一个集合里找到「不带反引号的孪生片段」（同一句文案的
// 模板分段版），也就是说这条判据不会让任何真文案从清单里消失。
//
// **`void`** 与反引号是同一个场合的姊妹判据：模板按「相邻反引号」逐段取，夹在两个模板之间的
// 那段代码也会被当成一段「文案」（如 `:void 0,"aria-activedescendant":Xt?` —— 前一个模板
// 收尾、下一个模板开始之间的代码）。压缩产物里的 `void 0` 就是 `undefined`，文案里不会出现
// 它，所以它跟 function / typeof 一样按关键字拦下来；实测四份 bundle（两版原版 + 两版产物）
// 在闸门口径下含 void 的片段 **0 条**、宽口径下各 5 条且全是这种代码（CSS 属性 / aria 属性
// 的取值代码），没有一条真文案被这条判据误伤。
const CODEISH = /[(){}\[\];=<>`]|&&|\|\||=>|\?\.|\?\?|\b(?:function|typeof|const|let|var|instanceof|void)\b|\[object|\\n|console\.|\.js\b/;
// 括号要在**紧贴标识符**时才算代码（`fetch(url)`、`a[i]`）；被空白与词尾包起来的 ` (…)` 多半是
// 文案里的插入语（`What went wrong? (optional)`、`Charged once (per session)`）。以前括号一律当
// 代码符号，于是「带插入语的界面文案」在片段级与字面量级两条通道里**都**看不见：0.0.132 新增的
// 反馈框占位符 `What went wrong? (optional)` 就是这样两处都漏的（最后是 uipos 的属性位置体检
// 报出来的）。判代码前先把这类插入语折掉，其余代码符号照旧拦：`fetch(url, (opts))` 折完还留着
// `fetch(`，`items.map(e=>(e.name))` 折完还留着 `=>`。
const ASIDE = /\s\(([^()]{0,40})\)/g;
function foldAsides(t) {
  return t.includes('(') ? t.replace(ASIDE, ' ') : t;
}
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

// opts.minWords / opts.requireCommon 的两个默认值就是回归闸门用的口径（≥3 词 + 必须含常见小词，
// 尽量不漏报、也尽量不把术语当句子）。tools/upstreamdiff.js 要「上游新增了哪些文案」的全量清单，
// 会用更宽的口径（minWords 2、不要求常见小词）再看一遍同一份提取结果——两处共用一个提取器，
// 免得「是不是文案」的判断在两支工具里各说各话。
function isProse(plain, rawLen, opts = {}) {
  const minWords = opts.minWords ?? 3;
  const requireCommon = opts.requireCommon ?? true;
  const t = plain.replace(/\s+/g, ' ').trim();
  if (t.length < 10 || t.length > 300) return false;
  if (rawLen > 800) return false; // 超长多半是拼进来的代码
  if (!/ /.test(t)) return false;
  if (CODEISH.test(foldAsides(t))) return false;
  // 单个残留的 } 允许（嵌套模板），再多就不是文案了
  if ((t.match(/[{}]/g) || []).length > 1) return false;
  const words = t.match(WORD) || [];
  if (words.length < minWords) return false;
  const lower = words.filter((w) => /^[a-z]/.test(w)).length;
  if (lower / words.length < 0.6) return false;
  if (requireCommon && !COMMON.test(t)) return false;
  // kebab-case 标识符（CSS 类名 / data 属性）密集的片段是代码，不是文案：
  // 如 `agent-trigger has-byok`（0.0.106 新增的类名组合）会命中 COMMON 里的 has。
  const kebab = t.match(/[a-z][a-z0-9]*(?:-[a-z0-9]+)+/g) || [];
  if (kebab.length >= 2 && kebab.join('').length / t.replace(/\s+/g, '').length > 0.6) return false;
  return true;
}

// 路径入口（回归闸门用）。不要在这里「是路径就读文件、否则当源码」地嗅探：把 2.4 MB 的源码
// 文本当路径丢给 fs.existsSync 会直接触发 Node 的断言崩溃（idna.c / code_point），而且小样本
// 看不出来——真 bundle 一发即崩。要看源码文本请用下面显式的 collectFragmentsFromSource。
function collectFragments(file, opts = {}) {
  return collectFragmentsFromSource(fs.readFileSync(file, 'utf8'), opts)
}

function collectFragmentsFromSource(src, opts = {}) {
  const set = new Set();
  const add = (raw) => {
    const plain = stripInterp(raw);
    if (/[\u4e00-\u9fff]/.test(plain)) return; // 已汉化
    if (isProse(plain, raw.length, opts)) set.add(plain.replace(/\s+/g, ' ').trim());
  };
  // 字符串字面量：每个未转义引号都当「开引号」，向后读到下一个引号为止（重叠配对）。
  // 不能用「相邻引号两两配对」的正则：minified 产物里短字符串（`"span"` 仅 4 字符，
  // 不满足 {8,600}）会让引擎从它的右引号重新开始，整条链从此错位配对，把大半个字符串
  // 当代码丢掉——0.0.106 适配时实测漏报新增的 `Add or manage your API keys`、
  // `Your keys · Your provider’s billing`（靠 uipos 才发现）。重叠配对不会错位：
  // 真正的字符串其开引号必然在候选里，向后第一个引号就是它的闭合引号。
  for (let i = 0; i < src.length; i++) {
    const q = src[i];
    if ((q !== '"' && q !== "'") || src[i - 1] === '\\') continue;
    let j = i + 1;
    let buf = '';
    while (j < src.length && buf.length <= 600) {
      const c = src[j];
      if (c === '\\') {
        buf += c + (src[j + 1] ?? '');
        j += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '\n') break; // 串不能跨行：注释/正则里的引号就此收住
      buf += c;
      j++;
    }
    add(buf);
  }
  // 模板：逐段取每两个相邻反引号之间的内容（转义反引号不算分隔）
  for (const [seg] of templateSegments(src)) {
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

// 「有意保留英文」登记表：默认读仓库根目录的 intentional-english.json。
// 为什么要有它：以前唯一的办法是发布时敲 `--allow-english`——那是**一把全放行**的逃生口，
// 放行了什么、为什么放行，仓库里一行记录都没有（0.0.131 的 5 条只写进了 CHANGELOG 的散文里）。
// 登记表把这件事变成常规路径：逐条写理由、可审、可清理，换机器/CI 发布也不会忘。
function loadAllowlist(file) {
  const p = file || path.join(__dirname, '..', 'intentional-english.json');
  if (!fs.existsSync(p)) return { path: p, entries: new Map(), missing: false };
  let doc
  try {
    doc = JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (e) {
    console.error(`ERROR: 登记表不是合法 JSON：${p}\n  ${e.message}`)
    process.exit(2)
  }
  const entries = new Map()
  for (const it of doc.fragments || []) {
    const text = typeof it === 'string' ? it : it && it.text
    if (!text) continue
    entries.set(text, (it && it.why) || '')
  }
  return { path: p, entries, missing: false }
}

function main() {
  const argv = process.argv.slice(2)
  const positional = []
  let allowFile = null
  let noAllow = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--allow-file') allowFile = argv[++i]
    else if (a === '--no-allow') noAllow = true
    else if (a.startsWith('--')) {
      console.error(`未知参数：${a}（支持 --allow-file <json> / --no-allow）`)
      process.exit(2)
    } else positional.push(a)
  }
  if (positional.length !== 2) {
    console.error('用法：node tools/regress.js <旧产物> <新产物> [--allow-file <json>] [--no-allow]');
    console.error('  （旧/新产物可以是目录 / pack zip / bundle 文件；默认读 intentional-english.json）');
    process.exit(2);
  }
  const allow = noAllow ? { path: null, entries: new Map() } : loadAllowlist(allowFile)

  const oldBundle = resolveBundle(positional[0]);
  const newBundle = resolveBundle(positional[1]);
  if (!oldBundle || !newBundle) {
    console.error(`无法定位主 bundle：${oldBundle ? '' : args[0] + ' '}${newBundle ? '' : args[1]}`);
    console.error('（期望目录里有 ui/index.html，或 assets/index-*.js，或直接给 bundle / pack zip）');
    process.exit(2);
  }

  const oldSet = collectFragments(oldBundle);
  const newSet = collectFragments(newBundle);
  const added = [...newSet].filter((x) => !oldSet.has(x)).sort();
  const kept = added.filter((x) => allow.entries.has(x));
  const unknown = added.filter((x) => !allow.entries.has(x));

  console.log(`回归闸门：${path.basename(oldBundle)} → ${path.basename(newBundle)}`);
  console.log(`  旧版英文片段 ${oldSet.size} 处；新版 ${newSet.size} 处；新版独有 ${added.length} 处`);
  if (allow.path && added.length) {
    console.log(`  登记表：${path.relative(process.cwd(), allow.path)}（${allow.entries.size} 条）`);
  }

  if (kept.length) {
    console.log(`  ⓘ 已登记的「有意保留英文」${kept.length} 处（不进失败判定）：`);
    for (const x of kept) console.log(`    · ${x.slice(0, 200)}\n      ↳ ${allow.entries.get(x) || '（登记表里没写理由，建议补上）'}`);
    // 登记项随上游改动消失后不会被使用，留着会让人误以为还有效——提醒清理，但不失败。
    const gone = [...allow.entries.keys()].filter((x) => !newSet.has(x))
    if (gone.length) {
      console.log(`  ⓘ 登记表里有 ${gone.length} 条在本版产物里已看不见，可以清理：`);
      for (const x of gone.slice(0, 10)) console.log('    · ' + x.slice(0, 200));
    }
  }

  if (unknown.length === 0) {
    console.log('  ✓ 未发现未登记的新增英文片段');
    process.exit(0);
  }

  console.log('  ❌ 新版出现以下英文片段（漏翻/迁移回归，或有意保留）：');
  for (const x of unknown) console.log('    · ' + x.slice(0, 200));
  console.log('  处理：能翻的补进 dict.json 后重跑 bash build.sh；确认有意保留的，登进');
  console.log(`        ${path.relative(process.cwd(), allow.path || path.join(__dirname, '..', 'intentional-english.json'))}（逐条写理由，之后不再拦发布）；`);
  console.log('        临时全放行仍可用 bash tools/release.sh --allow-english。');
  process.exit(1);
}

// --- 字面量级提取 ---------------------------------------------------------------
//
// 为什么还需要一条「字面量级」通道：片段级判据（isProse）为「在 2.4 MB 压缩代码里只留句子、
// 少报噪音」付了代价——它要求 ≥3 词、小写词占比 ≥0.6、且含常见小词，于是**短标签系统性漏报**：
// `Recheck setup` / ` Country & allowance` / `Supabase invitation` 这类两词 Title case 标签的小写词
// 占比正好 0.5，`Rechecking…` 之类的单词标签又不足 2 词（0.0.120 适配时 6 条新文案就是这么漏掉的）。
//
// 这里换一条通道：只认「有明确引号边界的完整字符串」，因此不必再靠「像不像句子」防噪音，
// 改用「像不像标识符」来挡（路径 / 类名 / 键名 / MIME / data 属性）。
//
// 关键差别是**判断引号是开还是关**：片段级把每个引号都当开引号配对（重叠配对，防错位丢句），
// 代价是撇号也会开一段、抽出 `s unused allowance …balance.` 这种半截句（片段级靠 upstreamdiff
// 的 pruneSubsumed 藏起来）。字面量级只能给「真字符串」，所以先看前一个字符：跟在标识符 /
// `)` `]` `}` `.` 后面的引号是**闭引号**——`"Today's …"` 里那个撇号正是这种情况。

// 「前面这个字符说明引号是闭引号」：值终结符之后不可能再开一个字符串。
// `.` 也在此列：`balance."` 这种位置在合法 JS 里不会是开引号（属性访问后不能直接跟字符串）。
const VALUEISH = /[A-Za-z0-9_$)\].}]$/;
// 但关键字之后可以：`return"x"` / `case"y"` / `typeof"z"`（压缩产物里常不留空格）。不认它们就会
// 漏掉紧跟关键字的字符串——这类漏报很安静，正是这条通道要防的。
const AFTER_KEYWORD = /\b(?:return|case|typeof|in|of|new|do|else|delete|void|throw|yield|await|default|instanceof)$/;

function isOpeningQuote(src, i) {
  const before = src.slice(Math.max(0, i - 12), i);
  if (!VALUEISH.test(before)) return true;
  return AFTER_KEYWORD.test(before);
}

// 单词标签的形状：字母开头 + 只含字母/数字/空格/撇号/连字符 + 以自然语言标点收尾。
// 收得这么严是因为压缩产物里模板段会被反引号错配切出 `:W.controlKeyword,` / `,tooltip:L?` /
// `+P.markClass:T,` 这类代码残片——它们含 `,` `:` `?` `"`，只判「含非标识符字符」拦不住。
// 代价是 `Continue`（纯词、无标点）这类单词标签不在清单里：压缩代码里它与标识符无法区分，
// 交给 uipos / blindscan 兜底。
const LABELISH = /^[A-Za-z][A-Za-z0-9 '\u2019-]*[.\u2026!?:»→↗]$/;

// 字面量级的「是不是给人看的文案」判据（片段级 isProse 的补充，不是替代）。
// 无空格的一律从严（见 LABELISH）。注意判「无空格」而不是判词数：`align-items:center` 能抽出
// 3 个词，但它是个值，不是文案。
function isCopyLiteral(t) {
  if (t.length < 2 || t.length > 200) return false;
  if (/[\u4e00-\u9fff]/.test(t)) return false; // 已汉化
  if (!/[A-Za-z]/.test(t)) return false;
  if (CODEISH.test(foldAsides(t))) return false;
  if (/[{}<>]/.test(t)) return false; // 花括号 / 尖括号残留 = 插值或被切过的代码
  if (!/ /.test(t)) return LABELISH.test(t);
  const words = t.match(WORD) || [];
  if (words.length < 2) return false;
  // camelCase 粘连（`fooBar baz`）与 kebab 密集（`agent-trigger has-byok`）都不是文案
  if (/[a-z][A-Z]/.test(t)) return false;
  const kebab = t.match(/[a-z][a-z0-9]*(?:-[a-z0-9]+)+/g) || [];
  if (kebab.length >= 2 && kebab.join('').length / t.replace(/\s+/g, '').length > 0.6) return false;
  return true;
}

// 模板字面量：逐段取每两个相邻反引号之间的内容（含嵌套模板的内层段）。不能用非重叠匹配的正则，
// 否则奇数段会被跳过。返回 [内容, 内容起点] —— 起点供上游对差打上下文用。
function templateSegments(src) {
  const ticks = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '`' && src[i - 1] !== '\\') ticks.push(i);
  }
  const out = [];
  for (let i = 0; i + 1 < ticks.length; i++) out.push([src.slice(ticks[i] + 1, ticks[i + 1]), ticks[i] + 1]);
  return out;
}

// 返回 Map<归一化后的字面量, 首次出现位置>。归一化与片段级同一套（抹掉 ${...} 插值 + 折叠空白），
// 这样两边的文本可以直接互相比对（上游对差靠这一点去重）。
function collectLiteralsFromSource(src) {
  const out = new Map();
  const add = (raw, at) => {
    const t = stripInterp(raw).replace(/\s+/g, ' ').trim();
    if (out.has(t) || !isCopyLiteral(t)) return;
    out.set(t, at);
  };
  for (let i = 0; i < src.length; i++) {
    const q = src[i];
    if ((q !== '"' && q !== "'") || src[i - 1] === '\\') continue;
    if (!isOpeningQuote(src, i)) continue;
    let j = i + 1;
    let buf = '';
    let closed = false;
    while (j < src.length && buf.length <= 200) {
      const c = src[j];
      if (c === '\\') {
        buf += c + (src[j + 1] ?? '');
        j += 2;
        continue;
      }
      // 只认同类型引号闭合：另一种引号在字符串**内容**里是合法字符（`"Freebuff can't …"`
      // 里那个撇号）。片段级容忍这一点（它允许截断，反正 pruneSubsumed 会兜），字面量级
      // 却会把它当成「一条完整字符串」，报出 `Freebuff can` 这种半截句。
      if (c === q || c === '\n') {
        closed = true;
        break;
      }
      buf += c;
      j++;
    }
    // 没读到闭合引号（撞上代码 / 超过 200 字符）的候选不要：它是被切过的一段，不是完整字符串
    if (closed) add(buf, i + 1);
  }
  for (const [seg, at] of templateSegments(src)) add(seg, at);
  return out;
}

// 提取器与输入解析被 tools/upstreamdiff.js 复用（描述：同一份「minified bundle 里的英文自然语言
// 片段」判据只该有一处实现，0.0.106 那次重叠配对的修正就是在这里做的；0.0.120 适配后又把
// 「短标签漏报」的补救做成字面量级通道，同样只此一处）。
module.exports = {
  stripInterp,
  collectFragments,
  collectFragmentsFromSource,
  collectLiteralsFromSource,
  isCopyLiteral,
  resolveBundle,
  isProse,
  foldAsides,
  COMMON,
  mainBundleInDir,
};

if (require.main === module) main();
