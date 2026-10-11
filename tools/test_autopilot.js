#!/usr/bin/env node
// autopilot.sh 自测（不依赖真装机、不碰网络、不落地：全部走 fixture + 环境覆盖）。
//
// 钉住的是「探测与守门」这半边——它决定自动化跑不跑、什么时候必须停下来喊人：
//   1. 上游没新版 → rc 0 无事可做；有新版本 → rc 3 且给机器可读的 NEW_VERSION（配计划任务用）
//   2. 版本比较必须是**数值**三段比：0.0.170 > 0.0.99（字典序会判反，这是真踩过的类型）
//   3. feed 拉不动 → rc 1（网络问题 ≠ 无新版，fail-closed）
//   4. 上游比已适配版还旧（回滚）→ rc 1 转人工
//   5. 新版还没装到本机 → rc 3 给两条路（自更新 / 手动装），不硬来
//   6. 装机源纯净性：汉化版（lang=zh-CN）/ LocalPatches 污染（!=="false"）→ rc 1 拒用
//   7. 纯净 + 版本就位：--plan 打印计划退 0，不产生任何落地副作用
'use strict'
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const REPO = path.join(__dirname, '..')
const SCRIPT = path.join(REPO, 'tools', 'autopilot.sh')
const WORK = path.join(REPO, 'work', 'test-autopilot')
fs.rmSync(WORK, { recursive: true, force: true })

const write = (rel, body) => {
  const p = path.join(WORK, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}

// --- fixture --------------------------------------------------------------------------
const manifest169 = write('manifest-169.json', JSON.stringify({ targetVersion: '0.0.169', packVersion: '0.0.169.1' }))
const manifest99 = write('manifest-99.json', JSON.stringify({ targetVersion: '0.0.99', packVersion: '0.0.99.1' }))
const manifest170 = write('manifest-170.json', JSON.stringify({ targetVersion: '0.0.170', packVersion: '0.0.170.1' }))
const feed169 = write('feed-169.yml', 'version: 0.0.169\nfiles:\n  - url: Freebuff-0.0.169-win-x64.exe\nreleaseNotes: |\n  - 测试备注\n')
const feed170 = write('feed-170.yml', 'version: 0.0.170\nfiles:\n  - url: Freebuff-0.0.170-win-x64.exe\nreleaseNotes: |\n  - 新版说明\n')

// 纯原版装机 fixture：非汉化 index.html + 干净的 bundle
const instPure = path.join(WORK, 'install-pure')
fs.mkdirSync(path.join(instPure, 'resources', 'orchestrator', 'ui', 'assets'), { recursive: true })
fs.writeFileSync(path.join(instPure, 'resources', 'app.asar'), 'fixture asar')
fs.writeFileSync(
  path.join(instPure, 'resources', 'orchestrator', 'ui', 'index.html'),
  '<html lang="en"><script type="module" src="./assets/index-abc.js"></script></html>',
)
fs.writeFileSync(
  path.join(instPure, 'resources', 'orchestrator', 'ui', 'assets', 'index-abc.js'),
  'const adv = localStorage.getItem("adv")==="true";\nconst s = "Cancel";\n',
)

// 汉化版装机 fixture（lang=zh-CN）
const instHanhua = path.join(WORK, 'install-hanhua')
fs.mkdirSync(path.join(instHanhua, 'resources', 'orchestrator', 'ui', 'assets'), { recursive: true })
fs.writeFileSync(path.join(instHanhua, 'resources', 'app.asar'), 'fixture asar')
fs.writeFileSync(
  path.join(instHanhua, 'resources', 'orchestrator', 'ui', 'index.html'),
  '<html lang="zh-CN"><script type="module" src="./assets/index-abc.js"></script></html>',
)
fs.writeFileSync(path.join(instHanhua, 'resources', 'orchestrator', 'ui', 'assets', 'index-abc.js'), 'const s = "取消";\n')

// LocalPatches 污染 fixture（高级模式默认开启的形态）
const instPoison = path.join(WORK, 'install-poison')
fs.mkdirSync(path.join(instPoison, 'resources', 'orchestrator', 'ui', 'assets'), { recursive: true })
fs.writeFileSync(path.join(instPoison, 'resources', 'app.asar'), 'fixture asar')
fs.writeFileSync(
  path.join(instPoison, 'resources', 'orchestrator', 'ui', 'index.html'),
  '<html lang="en"><script type="module" src="./assets/index-abc.js"></script></html>',
)
fs.writeFileSync(
  path.join(instPoison, 'resources', 'orchestrator', 'ui', 'assets', 'index-abc.js'),
  'const adv = localStorage.getItem("adv")!=="false";\n',
)

const run = (args, env = {}) => {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
      timeout: 60000,
  })
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') }
}

let fail = 0
const chk = (ok, msg) => {
  console.log((ok ? '  ok  ' : '  FAIL ') + msg)
  if (!ok) fail++
}

// --- 1) 探测：无新版 / 有新版 ----------------------------------------------------------
const up = run(['--check'], { HANHUA_AUTOPILOT_FEED: feed169, HANHUA_AUTOPILOT_MANIFEST: manifest169 })
chk(up.code === 0 && /STATUS=up-to-date/.test(up.out), `上游无新版 → rc 0 无事可做（rc=${up.code}）`)
chk(/无事可做/.test(up.out), '  报告说清了结论')

const nv = run(['--check'], { HANHUA_AUTOPILOT_FEED: feed170, HANHUA_AUTOPILOT_MANIFEST: manifest169 })
chk(nv.code === 3 && /NEW_VERSION=0\.0\.170/.test(nv.out), `有新版 → rc 3 + 机器可读版本号（rc=${nv.code}）`)
chk(/STATUS=new-version/.test(nv.out), '  STATUS=new-version')
chk(/新版说明/.test(nv.out), '  releaseNotes 带出来了（给报告用）')

// --- 2) 版本比较必须数值：0.0.170 > 0.0.99（字典序会判反 → 误报回滚）---------------------
const numeric = run(['--check'], { HANHUA_AUTOPILOT_FEED: feed170, HANHUA_AUTOPILOT_MANIFEST: manifest99 })
chk(numeric.code === 3, `数值比较：0.0.170 大于 0.0.99（rc=${numeric.code}，字典序实现会误判成 1=回滚）`)

// --- 3) feed 拉不动 → fail-closed rc 1 -------------------------------------------------
const offline = run(['--check'], { HANHUA_AUTOPILOT_FEED: path.join(WORK, 'no-such-feed.yml'), HANHUA_AUTOPILOT_MANIFEST: manifest169 })
chk(offline.code === 1 && /STATUS=blocked/.test(offline.out), `feed 拉不动 → rc 1（rc=${offline.code}）`)
chk(/网络问题不等于/.test(offline.out), '  说清了「拉不到 ≠ 无新版」')

// --- 4) 上游回滚 → rc 1（已适配 0.0.170，上游退回 0.0.169）-------------------------------
const rollback = run(['--check'], { HANHUA_AUTOPILOT_FEED: feed169, HANHUA_AUTOPILOT_MANIFEST: manifest170 })
chk(rollback.code === 1 && /回滚/.test(rollback.out), `上游比已适配版还旧 → rc 1 转人工（rc=${rollback.code}）`)

// --- 5) 新版还没装到本机 → rc 3 给两条路 ------------------------------------------------
const notInstalled = run([], {
  HANHUA_AUTOPILOT_FEED: feed170,
  HANHUA_AUTOPILOT_MANIFEST: manifest169,
  HANHUA_AUTOPILOT_INSTALL: instPure,
  HANHUA_AUTOPILOT_INSTALLED_VERSION: '0.0.169',
})
chk(notInstalled.code === 3 && /STATUS=not-installed/.test(notInstalled.out), `新版未装机 → rc 3（rc=${notInstalled.code}）`)
chk(/自更新|手动下载/.test(notInstalled.out), '  给出两条路（自更新 / 手动装）')

// --- 6) 装机源纯净性：汉化版 / LocalPatches 污染 → rc 1 ----------------------------------
const hanhua = run([], {
  HANHUA_AUTOPILOT_FEED: feed170,
  HANHUA_AUTOPILOT_MANIFEST: manifest169,
  HANHUA_AUTOPILOT_INSTALL: instHanhua,
  HANHUA_AUTOPILOT_INSTALLED_VERSION: '0.0.170',
})
chk(hanhua.code === 1 && /汉化版/.test(hanhua.out), `汉化版装机 → 拒用 rc 1（rc=${hanhua.code}）`)

const poison = run([], {
  HANHUA_AUTOPILOT_FEED: feed170,
  HANHUA_AUTOPILOT_MANIFEST: manifest169,
  HANHUA_AUTOPILOT_INSTALL: instPoison,
  HANHUA_AUTOPILOT_INSTALLED_VERSION: '0.0.170',
})
chk(poison.code === 1 && /LocalPatches/.test(poison.out), `LocalPatches 污染 → 拒用 rc 1（rc=${poison.code}）`)

// --- 7) 纯净 + 版本就位：--plan 打印计划退 0，零副作用 -----------------------------------
const plan = run(['--plan'], {
  HANHUA_AUTOPILOT_FEED: feed170,
  HANHUA_AUTOPILOT_MANIFEST: manifest169,
  HANHUA_AUTOPILOT_INSTALL: instPure,
  HANHUA_AUTOPILOT_INSTALLED_VERSION: '0.0.170',
})
chk(plan.code === 0 && /STATUS=planned/.test(plan.out), `纯净源 + --plan → rc 0（rc=${plan.code}）`)
chk(/执行计划/.test(plan.out) && /autopilot\.sh/.test(plan.out), '  计划列出 update.sh / auto_translate / dictapply / build_locked 全链')
chk(/纯净性检查通过/.test(plan.out), '  纯净性检查有明确的通过行')

// --- 8) 环境/用法：装机目录不存在 → rc 2；未知参数 → rc 2 --------------------------------
const noDir = run([], {
  HANHUA_AUTOPILOT_FEED: feed170,
  HANHUA_AUTOPILOT_MANIFEST: manifest169,
  HANHUA_AUTOPILOT_INSTALL: path.join(WORK, 'no-such-install'),
})
chk(noDir.code === 2, `装机目录不存在 → rc 2（rc=${noDir.code}）`)
chk(run(['--bogus'], { HANHUA_AUTOPILOT_FEED: feed169 }).code === 2, '未知参数 → rc 2')

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
