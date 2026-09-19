#!/usr/bin/env node
// probe_token_epoch 自测（不依赖 Freebuff 产物，CI 可跑）。
//
// 为什么需要它：探针最重要的两条纪律，靠人眼盯代码是盯不住的——
//   a) 抽不到函数时必须 rc 2（无法取证），不能悄悄报「缺陷已消失」或「补丁没生效」；
//   b) 判决本身必须真的跟着补丁走：同一份源码，打上 token-epoch 补丁前后要给出相反的结论。
// 后者在 CI 上尤其重要：它等于「补丁真的改变了行为」这条断言，不依赖真实 bundle 也能验。
//
// 覆盖：
//   1. 合成源码（形态照抄真实 bundle 里的 ID()/Zt()）：打补丁前缺陷可复现、打补丁后已消除；
//   2. 最小性与上限：只对 403 生效（5xx / 网络失败不许误丢缓存、不许重试），且**只重试一次**；
//   3. 抽不到锚点 / 时序跑不起来 → 抛错（调用方转 rc 2），绝不静默返回状态；
//   4. CLI 退出码契约：0 / 1 / 2 三条路径，且无法取证时 rc 2 优先于 --expect；
//   5. 本机有真实产物时顺带取证一次（没有就跳过，CI 上属正常）。
//
// 用法：node tools/test_probe_token_epoch.js        # 退出码非 0 表示回归
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const { verdict, build, scenario, ID } = require('./probe_token_epoch.js')
const { applyPatches } = require('./apply_ui_code_patch.js')

const WORK = path.join(__dirname, '..', 'work', 'test-probe-token-epoch')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

let fail = 0
const chk = (cond, label) => {
  if (cond) console.log(`  ok  ${label}`)
  else {
    console.log(`  FAIL ${label}`)
    fail++
  }
}

// 合成源码：下面这三段是从真实 bundle 里**逐字**抄来的（含 var / 短名 / 三元 / 对象展开 /
// 同一行里的 `}catch(`），只是周边被裁到最小。形态必须忠实：锚点与补丁都依赖压缩产物的写法，
// 自己「重写一遍更通顺的版本」会让测试通过、真实 bundle 失败（或者反过来）。
// 探针只会抽 tokenCache 与 request 两个函数，其余依赖由 harness 提供。
const SYNTH = [
  'class go extends Error{constructor(e,n,i=null){super(e),this.status=n,this.body=i,this.name="ApiError"}}',
  'const dG=15e3;let mg;',
  'function rt(){return typeof window>"u"?void 0:window.freebuffDesktop}',
  'function ID(){var t,e;if(mg===void 0)try{mg=((e=(t=rt())==null?void 0:t.apiToken)==null?void 0:e.call(t))??null}catch{mg=null}return mg}',
  'function OG(t){try{return JSON.parse(t)}catch{return null}}',
  'async function Zt(t,e,n=!1){const i=n?new AbortController:null;let r=!1;const s=n?setTimeout(()=>{r=!0,i==null||i.abort()},dG):null;try{const o=ID(),a=await fetch(t,{...e,...o?{headers:{...e==null?void 0:e.headers,"x-freebuff-launch-id":o}}:{},...i?{signal:i.signal}:{}}),l=await a.text(),u=l?OG(l):null;if(!a.ok)throw new go(pG(u,a.status),a.status,u);return u}catch(o){throw o instanceof go?o:r?new go("Opening your saved workspace took too long.",0):new go("connection failed",0)}finally{s&&clearTimeout(s)}}',
  '',
].join('\n')

const writeFile = (name, content) => {
  const f = path.join(WORK, name)
  fs.writeFileSync(f, content)
  return f
}
const synthFile = writeFile('synthetic-bundle.mjs', SYNTH)

const runCli = (args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(__dirname, 'probe_token_epoch.js'), ...args], { encoding: 'utf8' }) }
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }
  }
}

;(async () => {
  // --- 1) 判决跟着补丁走（合成源码） -------------------------------------------
  console.log('\n1) 合成源码：打补丁前后必须给出相反结论')
  const before = await verdict(SYNTH)
  chk(before.defectPresent === true, '1) 原版：403 之后不自愈 ⇒ 缺陷可复现（补丁必要）')
  chk(before.patchEffective === false, '1) 原版：不算「补丁生效」')
  chk(
    /同一次调用内完成重试=否/.test(JSON.stringify(before.rows)) && /首次调用的请求序列=T1\s/.test(JSON.stringify(before.rows)),
    '1) 原版那次调用直接失败（只发了一次请求、带的是旧令牌 T1）——这就是用户看到的那次 403',
  )

  const applied = applyPatches(SYNTH)
  chk(applied.applied.includes('token-cache-resettable'), '1) 补丁 1 在合成源码里唯一命中并应用')
  chk(applied.applied.includes('reset-and-retry-on-403'), '1) 补丁 2 在合成源码里唯一命中并应用')
  const after = await verdict(applied.text)
  chk(after.defectPresent === false, '1) 打补丁后：缺陷不再复现')
  chk(after.patchEffective === true, '1) 打补丁后：403 之后自愈（同一次调用内重试成功），且只对 403 生效')
  chk(
    /同一次调用内完成重试=是/.test(JSON.stringify(after.rows)) && /首次调用的请求序列=T1→T2\s/.test(JSON.stringify(after.rows)),
    '1) 打补丁后同一次调用内先带旧令牌、重试带上当前令牌 T2，调用成功（用户无感）',
  )

  // --- 2) 最小性与上限 ---------------------------------------------------------
  console.log('\n2) 最小性与上限：只对 403 生效，且只重试一次')
  const rows500 = after.rows.find((r) => r.label.includes('5xx'))
  chk(
    after.patchEffective === true && /首次调用的请求序列=T1\s/.test(rows500.text) && /未重试、缓存未被丢掉/.test(rows500.text),
    '2) 5xx 之后既没重试、也没误丢缓存（一共只两次请求，第二次调用仍带旧令牌）',
  )

  // 重试上限：orchestrator 谁也不认（令牌重读后仍被拒）→ 第二次请求后直接抛错，不许无限重发。
  // 假 fetch 在超过 20 次时抛错，免得实现回归成无限重试时把测试挂死。
  {
    const h = build(applied.text, '403')
    h.api.token()
    h.state.orchestrator = 'T9'
    h.state.token = 'T2'
    let n = 0
    const realFetch = h.state.fetch
    h.state.fetch = (u, init) => {
      if (++n > 20) throw new Error('疑似无限重试')
      return realFetch(u, init)
    }
    let ok = false
    try {
      await h.api.request('/api/threads', { method: 'POST', headers: {}, body: '{}' }, false)
      ok = true
    } catch {
      ok = false
    }
    chk(!ok && h.state.sent.length === 2, `2) 重试只做一次（令牌重读后仍被拒 → 直接抛错，实际发了 ${h.state.sent.length} 次请求）`)
  }

  // 首次调用内的请求次数：恰好两次（原版一次请求即失败）
  const timing403 = await scenario(applied.text, '403')
  chk(timing403.requestsInFirstCall === 2 && timing403.firstCallOk, '2) 首次调用内恰好重发一次，且这次调用是成功的')

  // --- 3) 拿不到证据就抛错，而不是猜 -------------------------------------------
  console.log('\n3) 无法取证必须抛错')
  for (const [label, src] of [
    ['完全不相干的文本', 'const x = 1;\nfunction unrelated(){return 2}\n'],
    ['只有请求包装器、缺令牌读取', 'async function Zt(t,e,n=!1){const i=n?new AbortController:null;return i}\n'],
  ]) {
    let threw = null
    try {
      await verdict(src)
    } catch (e) {
      threw = e
    }
    chk(threw !== null, `3) ${label} → 抛错（不会静默返回缺陷状态）`)
  }
  let buildThrew = false
  try {
    build('const x = 1;', '403')
  } catch {
    buildThrew = true
  }
  chk(buildThrew, '3) build() 对垃圾输入抛错')

  // --- 4) CLI 退出码契约 ------------------------------------------------------
  console.log('\n4) CLI 退出码契约（0 / 1 / 2）')
  const present = runCli([synthFile, '--expect', 'present'])
  chk(present.code === 0, `4) 原版 + --expect present → 0（实际 ${present.code}）`)
  chk(/缺陷可复现/.test(present.out), '4) 报告写「缺陷可复现（补丁仍然必要）」')

  const patchedFile = writeFile('synthetic-patched.mjs', applied.text)
  const absent = runCli([patchedFile, '--expect', 'absent'])
  chk(absent.code === 0, `4) 产物 + --expect absent → 0（实际 ${absent.code}）`)
  chk(/缺陷已消除/.test(absent.out), '4) 报告写「缺陷已消除，且只对 403 生效」')

  const wrongExpect = runCli([synthFile, '--expect', 'absent'])
  chk(wrongExpect.code === 1, `4) 原版 + --expect absent → 1（拿错 bundle 必须报出来，实际 ${wrongExpect.code}）`)

  const noExpect = runCli([synthFile])
  chk(noExpect.code === 0 && /未指定 --expect/.test(noExpect.out), `4) 不带 --expect → 只报告、rc 0（实际 ${noExpect.code}）`)

  const garbage = writeFile('garbage.js', 'const x = 1;\n')
  const bad = runCli([garbage, '--expect', 'present'])
  chk(bad.code === 2, `4) 抽不到锚点 → rc 2（实际 ${bad.code}）`)
  chk(/无法取证/.test(bad.out), '4) 输出里有「无法取证」而不是判决词')
  chk(!/缺陷已消除|缺陷可复现/.test(bad.out), '4) 不冒充判决结论')

  const badAbsent = runCli([garbage, '--expect', 'absent'])
  chk(badAbsent.code === 2, `4) 无法取证时 rc 2 优先于 --expect absent（实际 ${badAbsent.code}）`)

  chk(runCli([]).code === 2, '4) 不给参数 → rc 2')
  chk(runCli([garbage, '--expect', 'maybe']).code === 2, '4) --expect 取值非法 → rc 2')
  chk(runCli([path.join(WORK, 'nope.js')]).code === 2, '4) 文件不存在 → rc 2')

  // --- 5) 真实 bundle（本机有装机 / 快照时才跑） --------------------------------
  console.log('\n5) 真实 bundle 取证（本机没有就跳过）')
  const candidates = []
  const snap = path.join(__dirname, '..', 'work', 'pristine')
  try {
    for (const v of fs.readdirSync(snap)) {
      const dir = path.join(snap, v, 'ui', 'assets')
      if (!fs.existsSync(dir)) continue
      const js = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f.startsWith('index'))
      for (const f of js) candidates.push(path.join(dir, f))
    }
  } catch {
    /* 没有快照 */
  }
  let checked = 0
  for (const c of candidates.slice(-1)) {
    try {
      const v = await verdict(fs.readFileSync(c, 'utf8'))
      checked++
      chk(v.defectPresent === true, `5) 真实英文原版（${path.basename(c)}）里缺陷可复现（补丁仍然必要）`)
    } catch (e) {
      // 结构变了 → 无法取证，不算失败（由 build.sh 的补丁步与 ui_patch_status 报）
      console.log(`  --  ${path.basename(c)} 无法取证（${e.message}）`)
    }
  }
  if (!checked) console.log('  --  本机没有可核对的英文原版快照，跳过（CI 上属正常）')

  console.log(fail ? `\n${fail} 项失败` : '\n全部通过（探针身份 ' + ID + '，5 组用例）')
  process.exit(fail ? 1 : 0)
})()
