// UI 主 bundle 的外科手术补丁（服务端文案的渲染点改写 + Intl 安全的单位替换）。
// 为什么存在：词典只能替换**字面量**，而两类文案够不着——
//   1. 服务端下发的整句（streak 胶囊的 line.label，如 "1 day streak"）：bundle 里没有原文，
//      只能在渲染点做模式改写（/^(\d+) days? streak$/ → 连续 N 天）；
//   2. "day"/"days" 这类**多用途字面量**：同串还出现在 Intl.RelativeTimeFormat 的单位表里
//      （i("day")），词典全局替换会把日期相对时间打崩，只能按函数锚点定点替换。
// 与 apply_ui_patch.js 同约定：命中原文或已含译文=幂等通过；两者皆无 = MISSED（硬失败），
// 上游改写该处时不允许静默丢补丁。
// 注入的中文用 \u 转义写入，避免 postbuild 的「代码语义常量中文哨兵」误报。
// Usage: node tools/apply_ui_js_patch.js <index-*.js>
'use strict'
const fs = require('fs')

const f = process.argv[2]
if (!f) {
  console.error('usage: node tools/apply_ui_js_patch.js <bundle.js>')
  process.exit(1)
}

const replacements = [
  // streak 胶囊：服务端 label（"N day(s) streak"）→ 连续 N 天；其它 label 原样透传
  [
    'className:"streak-count",children:n.label',
    'className:"streak-count",children:(x=>{const m=/^(\\d+) (?:day|days) streak$/.exec(x);return m?"\\u8fde\\u7eed "+m[1]+" \\u5929":x})(n.label)',
  ],
  // 窗口关闭按钮 tooltip：pattern 分区被 "Close panel"/"Close chat pane" 含住无法入库，
  // 这里按渲染点直接改写（锚点全 bundle 唯一）
  [
    '"data-tooltip":"Close"',
    '"data-tooltip":"\u5173\u95ed"',
  ],
  // 0.0.183：这两句词典够不着，只能按字面量定点改写（同一个原因：文件头第 2 条的分区语义）——
  //   · 「每天 X，而非免费版的每天 Y」那句整条是**模板字面量**，里面还嵌了一层 ${c?`${c}: `:""}，
  //     template 分区解析到嵌套反引号就断了，dict 里留着这条只会永远 MISSED（已撤词条）；
  //     而且词典会先把那层里的 `: ` 换成 `：`，所以锚点**不能整行照抄原文**——按结构匹配英文主干，
  //     把被压缩改名的 ${o(r)} / ${n.displayName} / ${o(i)} 交给捕获组原样带回。
  //   · 「本设备上的工作会停止…」这句本版从双引号改成了模板字面量，exact 分区只认双引号字面量。
  // 两句的译文沿用词典里已有的措辞，不另起。
  [
    /\$\{([\w$]+)\((\w)\)\} a day on \$\{([\w$.]+)\} instead of \$\{([\w$]+)\((\w)\)\} for free\. /,
    '在 ${$3} 上是每天 ${$1($2)}，免费版是每天 ${$4($5)}。',
    /在 \$\{[\w$.]+\} 上是每天 \$\{/,
  ],
  [
    'Work on this device will stop until you reopen Freebuff. Your chat history and saved file changes will be kept.',
    '在你重新打开 Freebuff 之前，本设备上的工作会停止。你的聊天记录和已保存的文件更改将会保留。',
  ],
  // 0.0.183：两个短标签在词典里进不去——pattern 区与 exact 区都有「以它们开头的更长词条」
  // （"Open without saved tabs" / "Open " / "Hours balances" / "Hours aren’t available…" /
  //  "Wallet hours balance unavailable"），dictapply 直接判 ADD_COLLISION 拒绝。
  // 四处锚点各自在全 bundle 唯一，按渲染点改写。
  // "Open" 三处都是**站点状态**（与 Closed / Draft 同一族），所以译成「开放」而不是「打开」。
  ['title:"Hours"', 'title:"时长"'],
  ['children:"Open"', 'children:"开放"'],
  ['?"Draft":"Open"', '?"Draft":"开放"'],
  ['open:"Open"', 'open:"开放"'],
  ['children:"Wallet"', 'children:"钱包"'],
  // 0.0.183 环境切换的加载态：`${…?"Preview":"Production"}` 这种「插值里带三元+双引号」的模板，
  // template 分区的解析器吃不下（写进词典就是一句 MISSED，构建直接被挂住），只能按字面量定点改。
  // 锚点取的是**词典跑完之后**的形态——本文件在 apply.js 之后执行，两个环境名已被词典换成
  // 「预览 / 生产」，照抄英文原文当锚点必然 MISSED（实测踩过一次）。
  ['Loading ${o==="preview"?"预览":"生产"}…', '正在加载 ${o==="preview"?"预览":"生产"}…'],
  // 「N day(s)」单位格式器（设置页 Current/Longest streak 的值）：单位改「天」，保持与胶囊一致；
  // 不能走词典，见文件头第 2 条。锚点**不写死函数名和 NumberFormat 的变量名**：这两个名字每版都会
  // 被重新压缩改掉（0.0.179 是 _V/Cue，0.0.183 是 RW/hhe），而函数体一个字节没动。写死名字等于每版
  // 都要人工重锚一次，失败时还会以「上游改写了锚点」的名义把误报当成真改写。名字交给捕获组原样带回，
  // 这里只锁结构。第三个元素是幂等探针：先看它，命中即视为已应用，绝不二次替换。
  [
    /function ([\w$]+)\(e\)\{return`\$\{([\w$]+)\.format\(e\)\} \$\{e===1\?"day":"days"\}`\}/g,
    'function $1(e){return`${$2.format(e)} \\u5929`}',
    /\$\{[\w$]+\.format\(e\)\} \\u5929/g,
  ],
  // 购买时段的续用提示（0.0.186 上游把时间尾巴改成条件式 ${N6(V.model,I)?"":` until ${…}`}）：
  // 三个引号字面量已由词典翻掉，剩下的模板文本既不是独立字面量、又带嵌套反引号，
  // template 分区吃不下，只能按结构定点改写。压缩后的函数名/变量名每版都换（0.0.186 是
  // N6、V、I），一律交给捕获组原样带回；参数位用 [\w.$] 而不是 \w——上游传的是 V.model。
  // 锚点取的是词典跑完之后的形态（本文件在 apply.js 之后执行）。
  // 正则里的引号写成 \x22：`?""`:` 这三对引号加冒号连着反引号，肉眼漏一个冒号就静默不命中
  // （0.0.186 适配时连踩两次），转义写出来能一眼数清。
  [
    /\}\$\{([\w$]+)\(([\w.$]+),([\w$]+)\)\?\x22\x22:` until \$\{new Date\((\w+)\.expiresAt\)\.toLocaleTimeString\(\[\],\{hour:\x22numeric\x22,minute:\x222-digit\x22\}\)\}`\}\. No additional charge\./g,
    '}${$1($2,$3)?"":` 直到 ${new Date($4.expiresAt).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}`}。不额外收费。',
    /\?\x22\x22:` 直到 \$\{new Date/g,
  ],
  // 0.0.186：JSX 拼接句（children 数组把一句拆成几个文本节点，词典只能替单个字面量，语序拼不出中文），
  // 按渲染点整句改写。锚点取「词典跑完之后的形态」——这几段词典没覆盖，与原文逐字节相同。
  [
    '["Couldn’t publish to ",s]',
    '["\u65e0\u6cd5\u53d1\u5e03\u5230 ",s]',
  ],
  [
    '["No sessions charged in the last ",t??7," days."]',
    '["\u6700\u8fd1 ",t??7," \u5929\u5185\u6ca1\u6709\u4ea7\u751f\u8ba1\u8d39\u7684\u4f1a\u8bdd\u3002"]',
  ],
  [
    '["Links to ",t," will stop working after this change."]',
    '["\u6b64\u66f4\u6539\u540e\uff0c\u6307\u5411 ",t," \u7684\u94fe\u63a5\u5c06\u5931\u6548\u3002"]',
  ],
  [
    '"from the first sale"',
    '"\u6765\u81ea\u9996\u6b21\u9500\u552e"',
  ],
  // 退款回执主干：整条是模板字面量，里面嵌了 ${r?`…`:""}，template 分区解析到嵌套反引号就断；
  // 内层那句词典已经替成中文，所以锚点用「外层英文 + 变量」的结构匹配，变量名交给捕获组带回。
  [
    /, credited back to the \$\{([\w$]+)\} daily pool and your wallet/,
    ', \u5df2\u9000\u56de \${$1} \u6bcf\u65e5\u989d\u5ea6\u6c60\u548c\u4f60\u7684\u94b1\u5305',
    /\u5df2\u9000\u56de \$\{[\w$]+\} \u6bcf\u65e5\u989d\u5ea6\u6c60/,
  ],

]

let s = fs.readFileSync(f, 'utf8')
let applied = 0
const missed = []
for (const [from, to, probe] of replacements) {
  if (from instanceof RegExp) {
    if (probe && probe.test(s)) {
      applied++ // 已应用过（幂等）
      continue
    }
    // 数命中必须用带 g 的副本：String.match(不带 g 的正则) 返回的是「整段 + 每个捕获组」的数组，
    // 五个捕获组的锚点命中一次也会给出 length 6——会被当成「命中 6 次」判成锚点不唯一。
    const counter = from.global ? from : new RegExp(from.source, from.flags + 'g')
    const hits = [...s.matchAll(counter)]
    if (!hits.length) {
      missed.push('结构锚点未命中（函数体形态变了？）：' + String(from).slice(0, 70))
      continue
    }
    if (hits.length !== 1) {
      // 命中多处却按单一位置设计＝锚点不够具体，静默全替换会把别处的同类结构一起改掉
      missed.push(`锚点命中 ${hits.length} 次（设计要求唯一）：` + String(from).slice(0, 70))
      continue
    }
    s = s.replace(from, to)
    applied++
    continue
  }
  if (s.includes(from)) {
    s = s.split(from).join(to)
    applied++
  } else if (s.includes(to)) {
    applied++ // 已应用过（幂等）
  } else {
    missed.push(from.slice(0, 70))
  }
}
fs.writeFileSync(f, s)
console.log(`apply_ui_js_patch: ${applied} replacements`)
if (missed.length) {
  console.error('MISSED（上游改写了锚点，补丁没打上）:')
  for (const m of missed) console.error('  - ' + m)
  // 缺口发布模式（ALLOW_MISSED=1）：锚点没命中只意味着这几处保持英文，产物本身没坏。
  // 严格模式仍然硬退——那是「要么全中、要么人工重锚」的默认口径。
  if (process.env.ALLOW_MISSED === '1') {
    console.error(`WARN: ALLOW_MISSED=1 缺口发布模式——这 ${missed.length} 处渲染点保持英文，下次人工重锚`)
  } else {
    process.exit(1)
  }
}
