#!/usr/bin/env node
// ci_wiring.js 自测（纯合成夹具，不联网、不装 Freebuff，CI 可跑）。
//
// 这道守卫守的是「自测真的在 CI 上跑过」——它是**唯一**能发现「新加了自测忘记接线」的地方，
// 所以它自己最容易坏的地方得钉死：
//   1. **假绿灯**：明明漏了接线却 rc 0。夹具里漏掉一条 → 必须 rc 1，且点名是哪一条；
//   2. **反向误报**：把注释里提到的文件名、把 `node --check tools/x.js` 这种非自测调用当成接线，
//      于是干净的 workflow 被判成「悬空引用」——那会让守卫自己变成噪音（本仓库的注释就爱提文件名，
//      块外与块内两种注释都有夹具）；
//   3. **接进去了但没真跑**：同一自测接两处、步骤带 `if:`、触发 paths 不再覆盖 tools/**——
//      这三样只警告不拦（不等于接线断了），但必须在输出里说出来，否则等于没盯；
//   4. **环境不对时的姿态**：workflow 不存在 / tools 目录里一个自测都没有 / 参数缺值 → rc 2，
//      不能把「没校验」说成「校验通过」。
// 最后一条断言对着**真仓库**跑：真实的 ci.yml × 真实的 tools/，数目要与磁盘上的自测数一致，
// 并且 --list 里能看到本文件自己（它就是「新加自测必须接线」的第一个活样本）。
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const TOOL = path.join(REPO, 'tools', 'ci_wiring.js')
const WORK = path.join(REPO, 'work', 'test-ci-wiring')
fs.rmSync(WORK, { recursive: true, force: true })

const write = (rel, body) => {
  const p = path.join(WORK, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}

// --- 夹具：一个只有两个自测的 tools/ + 若干份 workflow --------------------------------
const stub = (what) => `// 夹具：${what}（ci_wiring 只看文件名，不读内容）\n`
write('tools/test_alpha.js', stub('alpha'))
write('tools/test_beta.js', stub('beta'))
write('tools/lint_dict.js', stub('lint_dict（非自测）'))
write('tools/test_not_js.sh', '#!/usr/bin/env bash\n') // 不是 .js，两侧都不该收
write('tools-empty/README.md', '夹具：一个不含自测的目录\n')

const stepName = (n) => [`      - name: ${n}`]
const runBlock = (lines, extra = []) => [...extra, '        run: |', ...lines.map((l) => '          ' + l)]
const runInline = (cmd, extra = []) => [...extra, `        run: ${cmd}`]
// 块外注释与块内注释各写一个**不存在**的 node 自测名：只要有一个被当成接线，干净夹具就会
// 因为「悬空引用」而 rc 1——这条断言就是「注释不算接线」的守卫。
const wf = ({ paths = "['dict.json', 'tools/**']", lines = [] }) =>
  [
    'name: lint',
    '',
    '# 块外注释：node tools/test_ghost_outside.js 不算接线',
    'on:',
    '  pull_request:',
    `    paths: ${paths}`,
    '',
    'jobs:',
    '  dict-lint:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    ...lines,
    '',
  ].join('\n')

const allSteps = [
  ...stepName('词典 lint（非自测的 node 调用不该被收）'),
  ...runInline('node tools/lint_dict.js'),
  ...stepName('自测组（折叠块形态）'),
  ...runBlock([
    '# 块内注释：node tools/test_ghost_inside.js 也不算接线',
    'node tools/test_alpha.js',
    'node --check tools/lint_dict.js',
  ]),
  ...stepName('另一个自测（单行 run: 形态）'),
  ...runInline('node tools/test_beta.js'),
]
write('ci-complete.yml', wf({ lines: allSteps }))
write('ci-missing.yml', wf({ lines: allSteps.filter((l) => !l.includes('tools/test_beta.js')) }))
write(
  'ci-stale.yml',
  wf({
    lines: [...allSteps, ...stepName('引用了不存在的自测'), ...runInline('node tools/test_ghost.js')],
  }),
)
write(
  'ci-dup.yml',
  wf({
    lines: [
      ...stepName('第一次接 alpha'),
      ...runInline('node tools/test_alpha.js'),
      ...stepName('又接了一遍 alpha'),
      ...runInline('node tools/test_alpha.js'),
      ...stepName('beta 正常'),
      ...runInline('node tools/test_beta.js'),
    ],
  }),
)
write(
  'ci-gated.yml',
  wf({
    lines: [
      ...stepName('只在 Windows 上跑的自测'),
      ...runInline('node tools/test_alpha.js', ["        if: runner.os == 'Windows'"]),
      ...stepName('beta 正常'),
      ...runInline('node tools/test_beta.js'),
    ],
  }),
)
write('ci-nopaths.yml', wf({ paths: "['dict.json', 'manifest.json']", lines: allSteps }))

const run = (args) => {
  try {
    // stderr 也显式 pipe：rc 2 的用例里工具会把 ERROR 写 stderr，不接住就会漏进自测输出里
    return { code: 0, out: execFileSync('node', [TOOL, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}
const fixture = (name) => ['--ci', path.join(WORK, name), '--tools', path.join(WORK, 'tools')]

let fail = 0
const chk = (ok, msg) => {
  console.log((ok ? '  ok  ' : '  FAIL ') + msg)
  if (!ok) fail++
}

// --- 接线完整：rc 0，且不得把注释里的名字 / --check 当成接线 ---------------------------
const complete = run(fixture('ci-complete.yml'))
chk(complete.code === 0, `接线完整 → rc 0（实际 ${complete.code}）`)
chk(/✓ 接线完整/.test(complete.out), '打印「接线完整」')
chk(/磁盘上 2 个自测，workflow 里点到 2 个/.test(complete.out), '两侧数目都报出来（2 个自测）')
chk(!/ghost_outside|ghost_inside/.test(complete.out), '块外与块内注释里提到的名字都不算接线')
chk(!/::error::/.test(complete.out), '干净夹具没有任何 ::error:: 注解')

// --- 漏接线：rc 1 并点名是哪一条 ----------------------------------------------------
const missing = run(fixture('ci-missing.yml'))
chk(missing.code === 1, `漏接线 → rc 1（实际 ${missing.code}）`)
chk(/E1 漏接线：tools\/test_beta\.js/.test(missing.out), '点名漏掉的那条自测')
chk(!/E1 漏接线：tools\/test_alpha\.js/.test(missing.out), '接了线的 alpha 不被误报')
chk(/::error::ci_wiring/.test(missing.out), '漏接线时打 ::error:: 注解')

// --- 悬空引用：workflow 里跑了、磁盘上没有 -------------------------------------------
const stale = run(fixture('ci-stale.yml'))
chk(stale.code === 1, `悬空引用 → rc 1（实际 ${stale.code}）`)
chk(/E2 悬空引用：.*tools\/test_ghost\.js/.test(stale.out), '点名悬空引用')
chk(/引用了不存在的自测/.test(stale.out), '把所在步骤名带出来（排障不用翻 workflow）')
chk(!/E1 漏接线/.test(stale.out), '两个自测都接了线，不该再报漏接线')

// --- 重复接线：只警告不拦 ------------------------------------------------------------
const dup = run(fixture('ci-dup.yml'))
chk(dup.code === 0, `重复接线 → rc 0（只是浪费，不拦，实际 ${dup.code}）`)
chk(/W1 重复接线：tools\/test_alpha\.js 被 2 处/.test(dup.out), '点出重复的那条与处数')
chk(!/::error::/.test(dup.out), '重复接线不打 ::error::')

// --- 步骤带 if:：只警告，且说清「其它 runner 上等于没接」------------------------------
const gated = run(fixture('ci-gated.yml'))
chk(gated.code === 0, `带 if: 的步骤 → rc 0（实际 ${gated.code}）`)
chk(/W2 会被跳过：tools\/test_alpha\.js/.test(gated.out), '点名会被跳过的自测')
chk(/runner\.os == 'Windows'/.test(gated.out), '把 if: 的条件原文带出来')

// --- 触发路径不覆盖 tools/**：只警告 -------------------------------------------------
const nopaths = run(fixture('ci-nopaths.yml'))
chk(nopaths.code === 0, `paths 不含 tools/** → rc 0（实际 ${nopaths.code}）`)
chk(/W3 触发路径/.test(nopaths.out) && /tools\/\*\*/.test(nopaths.out), '警告触发路径里没有 tools/**')

// --- 环境不对：一律 rc 2，不许把「没校验」说成「通过」---------------------------------
const noFile = run(['--ci', path.join(WORK, 'nope.yml'), '--tools', path.join(WORK, 'tools')])
chk(noFile.code === 2, `workflow 不存在 → rc 2（实际 ${noFile.code}）`)
chk(/ERROR: workflow 不存在/.test(noFile.out), '明说 workflow 不存在')

const emptyTools = run(['--ci', path.join(WORK, 'ci-complete.yml'), '--tools', path.join(WORK, 'tools-empty')])
chk(emptyTools.code === 2, `tools 目录里没有自测 → rc 2（实际 ${emptyTools.code}）`)
chk(/一个 test_\*\.js 都没有/.test(emptyTools.out), '明说目录里没有自测')

const noValue = run(['--ci'])
chk(noValue.code === 2, `--ci 缺值 → rc 2（实际 ${noValue.code}）`)
const badArg = run(['--wat'])
chk(badArg.code === 2, `未知参数 → rc 2（实际 ${badArg.code}）`)
const help = run(['-h'])
chk(help.code === 0 && /退出码/.test(help.out), '-h → rc 0 且给出退出码说明')

// --- 真仓库回放：真实 ci.yml × 真实 tools/ ------------------------------------------
const real = run([])
chk(real.code === 0, `真仓库 → rc 0（实际 ${real.code}）${real.code === 0 ? '' : '\n' + real.out}`)
const diskTests = fs.readdirSync(path.join(REPO, 'tools')).filter((n) => /^test_.*\.js$/.test(n))
const m = real.out.match(/磁盘上 (\d+) 个自测，workflow 里点到 (\d+) 个/)
chk(!!m, '真仓库的输出里报出两侧数目')
if (m) {
  chk(Number(m[1]) === diskTests.length, `磁盘侧数目与 tools/ 里的自测数一致（${m[1]} vs ${diskTests.length}）`)
  chk(Number(m[1]) === Number(m[2]), `两侧数目一致（磁盘 ${m[1]} / workflow ${m[2]}）`)
}
const listed = run(['--list'])
chk(/tools\/test_ci_wiring\.js ← ci\.yml:/.test(listed.out), '--list 里能看到本自测自己（它也得接线）')

// --- 真仓库形态的负向夹具：拿真 ci.yml 改一行 -------------------------------------------
// 上面那些夹具是「最小 workflow」，形状单一；这里拿真实文件（CRLF、两种 run 形态、两个 job、
// 带注释与多行块）改一行，证守卫在真实形态上也能抓，而且 CRLF 不会漏进输出。
const realCi = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8')
const REAL_TOOLS = path.join(REPO, 'tools')
write('ci-real-dropped.yml', realCi.replace(/^\s*run: node tools\/test_remap\.js\r?\n/m, ''))
write('ci-real-swapped.yml', realCi.replace(/node tools\/test_remap\.js/, 'node tools/test_ghost2.js'))
const dropped = run(['--ci', path.join(WORK, 'ci-real-dropped.yml'), '--tools', REAL_TOOLS])
chk(dropped.code === 1, `真 ci.yml 删掉一步 → rc 1（实际 ${dropped.code}）`)
chk(/E1 漏接线：tools\/test_remap\.js/.test(dropped.out), '真文件上也能点名漏掉的那条')
chk(!/E2 悬空引用/.test(dropped.out), '只删了一步，不该冒出悬空引用')
chk(!/\r/.test(dropped.out), 'CRLF 的 workflow 解析后输出里不带裸 \\r')
const swapped = run(['--ci', path.join(WORK, 'ci-real-swapped.yml'), '--tools', REAL_TOOLS])
chk(swapped.code === 1, `真 ci.yml 换掉一个名字 → rc 1（实际 ${swapped.code}）`)
chk(
  /E1 漏接线：tools\/test_remap\.js/.test(swapped.out) && /E2 悬空引用：.*tools\/test_ghost2\.js/.test(swapped.out),
  '换掉名字时漏接线与悬空引用同时报出',
)

console.log(fail ? `\n✗ ci_wiring 自测失败 ${fail} 条` : '\n✓ ci_wiring 自测通过')
process.exit(fail ? 1 : 0)
