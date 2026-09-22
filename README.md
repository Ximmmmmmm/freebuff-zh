# Freebuff Desktop 汉化包 / Chinese Localization 🇨🇳

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![GitHub last commit](https://img.shields.io/github/last-commit/Ximmmmmmm/freebuff-zh)
![GitHub Repo stars](https://img.shields.io/github/stars/Ximmmmmmm/freebuff-zh?style=social)
![GitHub forks](https://img.shields.io/github/forks/Ximmmmmmm/freebuff-zh?style=social)
[![Target](https://img.shields.io/badge/目标-Freebuff%20Desktop%20v0.0.132-blue)](https://freebuff.com)
[![lint](https://github.com/Ximmmmmmm/freebuff-zh/actions/workflows/ci.yml/badge.svg)](https://github.com/Ximmmmmmm/freebuff-zh/actions/workflows/ci.yml)

**中文关键词 / Keywords**: Freebuff 汉化、Freebuff 中文版、Freebuff Chinese localization、AI coding agent 中文、Freebuff 翻译、Electron 汉化、localization pack

Freebuff Desktop（`@codebuff/freebuff-desktop` v0.0.132）的**简体中文汉化包**，直接修改已打包产物，无需源码、不涉及任何联网改动。

> **English**: A Simplified-Chinese localization pack for Freebuff Desktop — the free AI coding agent. Patches the packaged app directly, no source build required. If you're a Chinese-speaking Freebuff user, this is for you.

## ✨ 特性

- **覆盖全面**：渲染进程约 1961 处文案 + 主进程菜单 / 对话框 / 同意窗口全面中文化；connectors / MCP 面板（状态标签、详情面板与目录里 100 条连接器介绍）与 v0.0.104 新增的 BYOK（自带密钥）API 提供商界面已全量中文化
- **词典驱动**：`dict.json`（exact 1311 / template 236 / code 15 / pattern 68），幂等应用、可审计
- **可复现构建**：`build.sh` 从原版 + 词典 + 补丁**逐字节重建**汉化产物  （v0.0.77 曾对照 Release 产物验证；v0.0.83 / v0.0.87 / v0.0.88 / v0.0.90 / v0.0.91 / v0.0.92 / v0.0.103 / v0.0.104 / v0.0.105 / v0.0.106 / v0.0.107 / v0.0.108 / v0.0.109 / v0.0.110 / v0.0.112 / v0.0.113 / v0.0.114 / v0.0.120 / v0.0.123 / v0.0.124 / v0.0.126 / v0.0.127 / v0.0.128 / v0.0.131 / v0.0.132 适配经防呆自检通过）
- **v0.0.132 适配**：上游改动很小（评价反馈那一块重做）：片段级 1461 → 1468（新增 7 / 下线 0 / 改写 0），字面量级 1964 → 1976（新增 12，其中 5 条片段级没报到），`electron/` 36 个文件无增删、12 个补丁全部干净套用。12 条补翻全部进 exact（exact 1299 → 1311）：评价反馈那套（`Rate this response` / `Good response` / `Bad response` / `What went wrong` / `Thanks — noted.` / `Thanks — that helps.` / `Could not send that. Try again.`）、付费套餐徽标与墙（`Paid plan` / `Included with a paid plan.` / `See plans →`）与按钮 `Send`；替换数 1960 → 1961、`all keys matched`、`missed_diagnose` 1630 条全命中、待补翻 0 条（`upstreamdiff` 小结仍列 1 条，是已登记的 CSS 类名 `model-badge muted`——那个工具不读登记表）。这一版还修掉**提取器的括号盲区**：括号以前一律当代码符号，于是带插入语的文案在片段级与字面量级**两条通道里都看不见**——本版新增的反馈框占位符 `What went wrong? (optional)` 就是这么漏的（最后是 `uipos` 的属性位置体检报出来的，正是它 16 处的那一条）；现在只有「紧贴标识符」的括号才算代码（`fetch(url, (opts))` 照旧拦住），并钉了 4 条自测断言。`Send` 则是 `uipos_gap` 6b 步报出来的单词级文案。另登记一条有意保留的英文：CSS 类名组合 `model-badge muted`（与 `streak-day on` 同类）
- **v0.0.131 适配**：上游连跨三版（0.0.129 / 0.0.130 / 0.0.131）大改：终端分屏、任务与技能选择器、项目预览、网页标注，以及一整套**浏览器子系统**（Cookie 导入、原生浏览器窗口、页面录制、视口预设），设置页重构为 `General / Appearance / Connectors / Projects / Skills / API Providers` 导航。对差账：片段级 1512 → 1430（新增 108 / 下线 183），字面量级 1963 → 1917（新增 207，其中 95 条片段级没报到）；`electron/` 新增 6 个文件（`browser-*.cjs` / `browser-recorder.html`）。词典 exact 1297 / template 230 / code 14 / pattern 67，替换总数 1929，模板变量重映射 0 条（230 SAME）、歧义 0 条、MISSING 0 条，`all keys matched`；补完后「待补翻」剩下的 28 条全是压缩产物噪音、react-window 内部日志与页面标注 payload。两条自动通道都看不见的**单词级新文案**（`Settings` / `Projects` / `General` / `Missions` / `Theme` / `Reset` / `Width` / `Height` / `Availability` / `Browser` / `System` 与设备预设 `Desktop · 1280 × 720` 等 14 条）是 `uipos` 报出来的（52 → 35，其余是品牌名 / 模型名）。主进程新增 `patches/electron-browser-*.patch` 四份（对话框、右键菜单、Cookie 导入与录制的用户可见报错），并把智能体侧协议报错与磁盘路径登记进 `mainscan.js` 的 `INTENTIONAL`——`mainscan` 疑似文案 16 → **0**；**踩坑记住**：词典条目必须能在 UI bundle 命中（UI 侧 MISSED 是硬失败），只在主进程出现的文案只能写成补丁。回归闸门 238 vs 238 新增 5 处，全部有意保留（react-window 三条内部 `console.warn`、标注 payload 里的 `Regions: …`、CSS 类名 `streak-day on`），逐条登进 `intentional-english.json`（写明理由，仓库内可审）。另修好两处**工具自己错**：`semantic_guard` 的模板字面量引号配对、`probe_token_epoch` 从 fix 现场读辅助函数名（并加自检）
- **v0.0.128 适配**：上游把「非高峰时段定价」的说明整段收窄——`Kz(...)` 里 `detail` 字段整个删掉、tooltip 只剩一句，**没有新写任何文案**：片段级 1515 → 1512（下线 3）、字面量级 1966 → 1963（新增 1 / 下线 4），`electron/` 下 30 个文件与 0.0.127 **逐字节相同**（`diff -rq` 无输出，`patches/` 无需改动），`index.html` 只换了 bundle 文件名。**改写 1 条**：长 tooltip `` `Off-peak: ${r.price} Freebucks/hour, daily ${f}. Regular price: ${r.regularPrice} Freebucks/hour. The price at session start is locked for the full hour.` `` → `` `Off-peak: ${r.price} Freebucks/hour, daily ${f}.` ``（变量名没变，所以 `remap` 报的是 MISSING 而不是 RENAMED）。**下线 3 条死词条**：两条 `detail` 模板（`` `Off-peak · normally ${…}/hr · until ${…} ${…}` `` / `` `Off-peak ${…}/hr · ${…}` ``，`detail` 字段已从返回值里消失）与 exact 里的 `" Your first-tab discount is also included in the displayed price."`（连它那个 `firstTabDiscount` 三元一起被上游删了）。这一版唯一的「新字面量」就是改写后那条 tooltip 的碎片（`Off-peak: Freebucks/hour, daily .`）：`upstreamdiff` 片段级报「新增 0」、字面量级报「新增 1 / 待补翻 0」——它是新模板的固定段而不是新句子，两本账对得上。替换数 1988 → 1985（exact 1310 / template 288 / code 9 / pattern 80，`all keys matched`）；模板变量重映射 0 条、歧义 0 条、MISSING 3 条（即上述死词条，删完复扫为 0）。`update.sh` 七步全绿：上游新增文案词典已全覆盖、回归闸门 238 vs 238 新增 0 处、`mainscan` 零漏翻、UI 行为补丁 5 组锚点全 KEEP、两道行为取证通过；残留扫描回到基线（`uipos` 15 条 / `fieldscan` 1 条 / `blindscan` 279 条）
- **v0.0.127 适配**：上游这一版**没新写任何界面文案**——片段级 1515 vs 1515、字面量级 1966 vs 1966 全等，`electron/` 下 30 个文件与 0.0.126 逐字节相同（`diff -rq` 无输出）。真正要翻的只有一条含分号的新句：`Can't reach Freebuff's servers on this network — try another connection; turns resume when it's back`（离线条幅的 `api_unreachable` 分支，紧挨着 0.0.126 已翻好的 `No internet — turns resume when you reconnect`）。**`upstreamdiff` 看不见它**：又是 0.0.123 记账的 `CODEISH` 盲区——含 `;` 的字面量在片段级（`isProse`）与字面量级（`isCopyLiteral`）同时不可见，所以两边都报「新增 0」，是 `blindscan` 把它切成两片报出来的（`uipos` 的 `label` 桶同期 15 → 16 印证同一句）。随后用一次**遮蔽分号的全量字面量对差**确认全量只此一条：做法不是重写提取器，而是在喂给 `tools/regress.js` 自己的 `collectLiteralsFromSource` 之前把全文的 `;` 换成一个等长占位字符——字面量边界只跟引号 / 反斜杠 / 换行有关，配对与位置完全不变，`CODEISH` 却不再把它当代码（报告时换回来；0.0.124 的教训是随手写的正则会因错配引号把整条跳过去）。模板变量重映射 5 条、歧义 0 条、MISSING 0 条（`"R"→"P"`、`"Ui(P)"→"Ui(R)"`、`"L.trim()"→"$.trim()"`、`"Pn($)"→"Pn(L)"`、半截模板 `(P==null?void 0:P.balance)??0` → `(R==null?void 0:R.balance)??0`），`upstreamdiff` 报的唯一一组「疑似改写」其实就是最后这条半截模板的变量改名（`:R?` vs `:P?`）。替换数 1987 → 1988，`all keys matched`；上游新增文案词典已全覆盖、`mainscan` 零漏翻、行为补丁体检 KEEP、回归闸门 238 vs 238 新增 0 处、`uipos` 15 条 / `blindscan` 279 条（回到基线）
- **v0.0.126 适配**：上游给会话加了「上下文压缩」（`POST /api/thread/<id>/compact`，入口在 token 用量弹层里的一个 quiet 按钮，只对 codebuff harness 显示）与一个 Discord 状态开关——新增 8 条（exact 6 / template 1 / pattern 1）、改写 2 条：压缩那组是 `Compact`（短标签，进 pattern）、`Compacting…`、`Compact context`、`Available once this turn finishes.`、`` `Compacted · ${zr(Q.preTokens)} → ${zr(Q.postTokens)}` ``、`Nothing older to condense yet.`、`Could not compact this thread.`，账户菜单那条是带前导空格的 `" Show in Discord status"`（按既有惯例连同空格收进 exact）。两条改写里，`resets in ${ao(m.resetAt,o)}` 被 remap 报成 AMBIGUOUS（同一句骨架在 bundle 里命中 3 处、插值不同），人工比对确认取 `lo(m.resetAt,o)` 那处后改名；「首个标签页折扣」长句被上游整段改成 `shared across Web, Desktop and CLI.`，按新句改写。新主进程文件 `electron/discord-presence.cjs`（Discord Rich Presence）把当前状态推到用户的 Discord 个人资料上，那三句是用户可见文案、词典够不着，因此新增 `patches/electron-discord-presence.cjs.patch`（`Agent at work` / `Coding with Freebuff` / `Get Freebuff`；`large_text` 的品牌名保留英文），另三条内部错误串与日志（`handshake timed out` / `closed before ready` / `discord presence connected`）进 `mainscan.js` 的 `INTENTIONAL` 名单并写明理由。这一版还修掉一次**「探针自己错」的静默误判**：`probe_token_epoch` 的 harness 把 ApiError 类名写死成 `go`（0.0.124 时的压缩名），0.0.126 里 minifier 改成了 `Ds`，抽出来的请求包装器一引用就 ReferenceError → 有效的补丁被判成「未生效」、构建在自检处中止；现在类名与两个辅助函数名都从 bundle 现场取，类名取不到就报「无法取证」rc 2 而不是给假结论。替换数 1979 → 1987，模板变量重映射 36 条、歧义 1 条人工改名；上游新增文案词典已全覆盖，主进程 `mainscan` 零漏翻，行为补丁体检 KEEP，回归闸门 238 vs 238 新增 0 处，`uipos` 15 条 / `blindscan` 279 条（与上版持平）
- **v0.0.124.1（同版修正重发）**：修掉实测到的「无法打开标签页: forbidden」——本机 orchestrator（Bun 进程）对写操作要求 `x-freebuff-launch-id`，而渲染进程把这个令牌**读一次就永久缓存**，崩溃重启换了 id 之后每个写操作（发消息 / 停止 / 编辑 / **开新标签页**，那也是一次 `POST /api/threads`）都被判 403，只读功能照常。这一版让**渲染进程自己从那次 403 里恢复**：拿到 403 时丢掉陈旧令牌并**立即用新令牌重发同一次请求**（只重试一次）——连触发的那一次调用都是成功的，用户再也看不到那句 forbidden，也不必等下一次操作（UI 行为补丁 `token-epoch` 组，两条协同：`token-cache-resettable` 给缓存注入失效函数 `_hanhuaResetToken()`，`reset-and-retry-on-403` 在请求包装器里丢缓存并重发，函数签名与 catch 由同一条补丁一起改、小名字经捕获组原样带回；只认 403——网络失败 / 5xx 与令牌无关，不丢缓存也不重试）。判据是**行为而非文本**：新增 `tools/probe_token_epoch.js`（异步探针，从 bundle 里原样抽出取值函数与请求包装器跑一遍事故时序；`postbuild` 用子进程跑它的 CLI 当硬检查：原版必须仍是「那次调用直接失败」、产物必须是「同一次调用内请求序列 T1→T2 且调用成功」，且 5xx 不重试不误丢缓存、最多只重试一次）+ 自测，`ui_patch_status.js` 的缺陷登记表也补上了这一组。另两件不涉产物的：`apply.sh` 新增「应用在跑就拒绝换文件（`--force` 逃生）」的闸门——热换文件正是这次「界面中文、主进程还是英文原版」那个混合态的成因；新增 `tools/forbidden_probe.js` 一键体检（读装机 `app.asar` 里的 `electron/main.cjs` 看 launch id 补丁在不在、比对实例启动时间找混合态、并探 `/healthz`，rc 0/1/2，**拿不到证据一律 2**）。`packVersion` 升 `0.0.124.1`（`targetVersion` 仍 `0.0.124`），已发布为 `pack-v0.0.124.1`（两道发布闸门均过：主进程零漏翻、回归闸门 238 vs 238 新增 0 处），控制器检查后即可下发
- **v0.0.124 适配**：上游新增「非高峰时段定价」（徽标 `Off-peak`、`` `Off-peak pricing · ${t.regularPrice} Freebucks/hour at peak` `` / `` `Peak pricing · ${t.price} Freebucks/hour off-peak` `` 两条 tagline、`` `Off-peak · normally ${r.regularPrice}/hr · until ${l.format(o)} ${d}` `` 与 `` `Off-peak ${r.price}/hr · ${f}` `` 两条 detail、那条「会话开始时价格锁一整小时」的长 tooltip 与尾随的首个标签页折扣注脚）与赞助邀请卡的「验收 / 兼容状态」（新组件 `generic-setup-invitation`：四个状态标签 `Verified` / `Verification failed` / `Setup needed` / `Couldn't verify`、`Verify again`、` · Stale revision`、`This run has no frozen acceptance-criteria contract.`、`Verification has not finished.`、`This sponsored invitation expired.`、`Sponsored setup currently supports a compatible local project.` 与邀请卡正文那段）——新增 20 条（exact 15 / template 7 / code 1 / pattern 2，含两处合计）、改写 1 条随上游拆分的半截模板，替换数 1935 → 1979，模板变量自动重映射 67 条、歧义 5 条人工改名。另有一条漏掉的新文案 `Git is ready, but the sponsored compatibility check could not finish. Continue to try again; your local snapshot is preserved.` 陷在 0.0.123 记录的 `CODEISH` 盲区里（含 `;` 的字面量对差两条通道都看不到），是 `blindscan` 报出来的，随后用一次含分号字面量专项重扫确认全量只有这一条（重扫的取字面量循环要复用 `regress.js` 的引号配对规则，随手写的正则会因错配引号把它跳过去）。卡片标题 `Sponsored {广告主} invitation` 被上游拆成三个 JSX 子节点，中文语序要倒过来，因此用一条 `code` 词条整段改写（同名 aria-label 走 template）。这一版还发现**第三个盲区**：单词字面量在片段级（≥3 词）与字面量级（≥2 词）两个通道里都不可见、`uipos` 又只扫属性位——新验收状态表里的 `"Verified"` 正好落在普通对象字面量里，`upstreamdiff` 的 22 条新增里没有它（19 已覆盖 + 3 未覆盖的账刚好对得上），靠人工比对状态表确认后补进 exact；`upstreamdiff` 剩下 3 条里 2 条是 URL / 压缩变量噪音、1 条是新增模型 displayName（按约定保留英文）。主进程 `mainscan` 零漏翻，`patches/` 无需改动，行为补丁体检 KEEP，回归闸门 238 vs 238 新增 0 处
- **v0.0.123 适配**：上游给赞助工作加了「本地 Git 配置」这一整关（兼容性检查前先做 Git 检查、审阅初始快照、批准本地提交），提案卡随之加了「账户配置 / 连接与验证」两步引导——新增 65 条（exact 57 / template 6 / pattern 2）、下线 6 条随上游改写的死词条，替换数 1871 → 1935，模板变量自动重映射 66 条、歧义 1 条人工改名（`Remove ${…}` 压缩改名）。这一版还揪出两个对差通道**共有的一个盲区**：`tools/regress.js` 的 `CODEISH` 把「含 `;`」的字面量一律当代码（本意是甩掉重叠配对抽出的 `");x=1;("` 跨边界片段），而英文文案常用分号——于是带分号的句子在片段级（`isProse`）与字面量级（`isCopyLiteral`）里**同时不可见**，本版 6 条（`Git metadata could not be read…`、`Setup was interrupted…`、`Live integration verification…`、`Review the changes and setup notes…`、`Git is not installed or cannot be found…`（macOS/Linux 长句）、`Limited-time first-tab discount…`）就是这样躲过 `upstreamdiff` 的（它只报 50 条，实际要翻 56 条），顺带也解释了两条**从 0.0.120 起就没翻**的连接器 setupNote（Figma / Prismic）。这次是用一次「含分号字面量全量对差」逐条揪出来的，补完后该扫描为 0 条。主进程 `mainscan` 零漏翻，`patches/` 无需改动，行为补丁体检 KEEP，回归闸门 238 vs 238 新增 0 处
- **v0.0.120 适配**：上游新增「赞助式 Supabase 配置邀请」（schemaVersion 1）整套界面、文件预览的磁盘/未保存状态说明、以及额度说明里的「为什么有这个限制？」与「Verify your country ↗」国家/地区验证流程（含 30 天锁定那段长说明）——新增 42 条、下线 1 条，替换数 1817 → 1870（发布后靠新加的字面量级对差又揪出 1 条漏翻 `` `Checking the installed ${t.label} CLI…` ``，补上后为 1871）；模板变量自动重映射 67 条、歧义 2 条人工改名（`Remove ${…}` 那一族与 `resets in ${…}`）。本轮把上游对差工具漏掉的 6 条短句逐条补了出来（`Recheck setup` / `Check compatibility` / `Rechecking…` / ` Country & allowance` / `Supabase invitation`，以及被整句包含的 `This Git repository needs a committed checkpoint.`——两三个词或与已翻长句重叠的片段按设计不单列；事后给该工具补了「字面量级」这一层，这类短文案不再需要手工挖），并修掉 `tools/probe_stream_epoch.js` 的两处取证缺陷（消息 id 生成器的压缩名 0.0.120 从 `Ec` 变 `Pc`，写死名字会让行为取证退化成「仅凭哨兵放行」；CLI 入口的 `let verdict` 与模块函数 `verdict()` 同名触发 TDZ）。主进程 `mainscan` 零漏翻，`patches/` 无需改动，行为补丁体检 KEEP
- **v0.0.114 适配**：上游新增「首个标签页折扣」（`firstTabDiscount`）的 4 条文案——`HM()` 拼出的两条 tooltip（`` `First-tab discount: up to ${e.amount} Freebucks off one session at a time, shared across Desktop and CLI. Prices shown include the discount.` `` 与 `Your first-tab discount is in use. Parallel sessions pay the regular price. The discount becomes available when that session ends.`）与 agent 菜单里那行 `` `First-tab discount · up to ${…} Freebucks off` `` / `First-tab discount in use`——新增 4 条、下线 0 条，替换数 1813 → 1817；模板变量自动重映射 37 条、歧义 2 条人工改名（`Remove ${…}` / `Could not select ${…}: ${…}` 这对老面孔，首跑正是它俩把构建卡在 MISSED 上）。主进程 `electron/*.cjs` 与 0.0.113 产物**逐字节一致**，`patches/` 无需改动，行为补丁体检 KEEP。本轮还把两件事固化成了工具：`tools/mainscan.js`（主进程英文对差，接进 `update.sh` 第 5 步与 CI）与 `tools/upstreamdiff.js`（上游新增文案对差，不依赖汉化包，接进第 6 步；英文原版由 `build.sh` 登记成快照 `work/pristine/<版本>/`，从下一版适配起自动给出待翻清单）与 `tools/pristine.js`（快照仓库：上一版原版可 export / import / 发布后从 Release 取，换机器也不丢基线）
- **v0.0.113 适配**：上游把 Freebucks 每日额度的说明整段重写——余额提示变成 `${zi(u.remaining)} of today's ${zi(u.limit)} ${Qs} left. Spent before your wallet; unused daily Freebucks do not carry over. ${eD(u,o)} Timezone changes apply after the next refill.`，新加的 `eD()` 带来一整套「下次补充」提示（`The daily refill is due. …` / `` `Next refill: … (your device time).` `` 与其内嵌的 `` ` Reset timezone: …` `` / `Check your daily reset countdown.`），入门里那句 `… midnight Pacific. Nothing to earn, nothing to wait for.` 改成 `… midnight in your reset timezone. …`，赞助任务新增一条沙箱阻断原因 `Sponsored tasks cannot start because the workspace sandbox is not working on this machine. No paid task has started.`——下线 1 条、新增 9 条，替换数 1807 → 1813；模板变量自动重映射 47 条、歧义 1 条人工改名。主进程 27 个 `electron/*.cjs` 与 0.0.112 产物**逐字节一致**，`patches/` 无需改动，行为补丁体检 KEEP。顺带**补翻主进程遗留英文 29 处**（0.0.112 之前就在、7 个补丁没盖到的一批：Bun 崩溃对话框整段、标签页菜单 `Export as Markdown…` / `Move to New Window`、按钮 `Get Compatibility Build`、`shell:openIn` 的六条报错、MCP 同意窗口的说明行与按钮组、赞助任务的 `Task:` / `Procedure:` 字段标签），三个补丁文件改为从「原版 + 词典」真实基线重新生成，`postbuild.js` 新增 13 条译文哨兵
- **v0.0.112 适配**：新增「继续被中断的轮次」（`Continue the interrupted turn` 一组 5 条）与消息队列暂停态的文案（`Send now to go first, or resume the queue.` / `Send now, then run queued messages (Enter)` / `Type a message — sent before the queue` / `Add this message to the queue; keep the queue paused`），BYOK 连接说明改写 3 条（`…until you select the replacement in the model picker.` 等）、移除确认句扩写（`? Tasks using it will stop before their next model request. Select another provider or a Freebuff model to continue the same conversation.`）、模型选择器的运行中提示 1 条，以及 DeepSeek 限时促销 tooltip 整段重写（旧的两条 `drops / Drops … on a plan` 词条下线，新增 `${a}: ` / `${u} hour…` / `… a day on ${n.displayName} instead of ${o(i)} for free.` 三条）——下线 9 条、新增 20 条，替换数 1796 → 1807；模板变量自动重映射 65 条、歧义 2 条人工改名。顺带补翻 1 条历史遗留（技能徽章前缀 `Customized Freebuff built-in · …`，旧词典只翻了插值里的 `all projects` / `this project`）。主进程 `electron/*.cjs` 与 0.0.110 产物**逐字节一致**，`patches/` 无需改动，行为补丁体检 KEEP
- **v0.0.110 适配**：上游把整块「会话退款」面板撤掉、合并成 composer 里的一句提示（`Session … from … auto-ended after inactivity · … Freebucks returned.`），并重写了 4 条推理档位标签（`Sprint — what was asked…` / `Focused — …checked through the real surface` / `Thorough — proven and pruned…` / `Exhaustive — the most careful version…`）——下线 19 条、新增 6 条，替换数 1785 → 1796；模板变量自动重映射 15 条、歧义 0 条。主进程只动了 `shell-lifetime.cjs`（退出时先发 `quit`，无用户可见文案），`patches/` 无需改动。顺带补翻 **24 条历史遗留英文**——连接器面板与目录、预览报错 `Could not launch/stop the preview: …`、购买时段与 `Peak pricing` tooltip、「编辑一条消息」嵌套模板族、MCP 开关与移动端镜像状态；这些字符串藏在 `children` 三元分支 / 模板插值 / 函数默认值里，`uipos` 与 `regress` 都扫不到，是逐个从原版 bundle 里比对出来的（回归闸门英文片段 262 → 242，新增 0）
- **v0.0.109 适配**：上游这一版只动了 SDK（`node_modules/@codebuff/sdk` 的 `read_files` 支持读取图片附件），渲染进程 bundle 与主进程 `electron/*.cjs` 与 0.0.108 **逐字节一致**——词典无需增删（替换数仍为 1785，`all keys matched`）、模板变量重映射 0 条、`patches/` 无需改动。新增的 SDK 拒读提示（`Image is … KB; images over … KB cannot be attached.`）是给模型看的库内部文案，按惯例保留英文
- **v0.0.108 适配**：上游新增「对话历史翻页 + 编辑较早消息」功能，补齐 9 条新文案（`pattern` 里的 `Newer messages` / `Older messages` / `Return to latest` / `Return to latest messages` / `Conversation pages` / `Conversation outside the viewport — focus to read`，`exact` 里的 `Could not load history` / `This history page changed. Return to latest and try again.` / `Editing an earlier message — …`），替换数 1774 → 1785；模板变量自动重映射 47 条，2 条 remap 歧义条目人工改名。0.0.107 新增主进程文件 `electron/renderer-health.cjs`（渲染进程健康采样 + 「窗口已停止」恢复弹窗），为此新增 `patches/electron-renderer-health.cjs.patch` 与 `postbuild.js` 的可选哨兵；其余 6 个补丁在 0.0.108 上仍干净套用（`main.cjs` 上游改动只是接线，补丁无需改动）
- **v0.0.106 适配**：BYOK 提供商面板文案改写（新增 `Select a provider in the model picker of a new or existing Freebuff task. …` / `You can switch this task to your API provider. …` / `Add or manage your API keys` / `Your keys · Your provider’s billing` 与 `pattern` 里的 `Selected`，下线 6 条旧文案，改写 1 条），并补上会话状态标签 `Hosted session slots are in use`；顺带补齐 0.0.105 漏翻的 `This task uses your selected provider. …`（共 13 条改动，替换数 1773 → 1774）。主进程 6 个 electron 文件经补丁后与 0.0.105 逐字节一致，`patches/` 未改动；12 条模板变量自动重映射，2 条 remap 歧义条目人工改名。另修复回归闸门漏报整句新增英文的提取器缺陷（见 `CHANGELOG`）
- **v0.0.105 适配**：BYOK 提供商面板文案微调（`Provider setup ↗` / `No providers found. Try “Custom”.` / `Search providers…` / `Requests go to ` / `Preset only. … still needs testing.` 与 aria-label `App tools`、`Providers`），并收起上游下线的两句宣传语（`One key, many models` / `OpenAI-compatible API`）；新增两条 Freebucks 付费确认分支与两处余额提示（共 11 条，替换数 1762 → 1773）。主进程 6 个 electron 文件经补丁后与 0.0.104 逐字节一致，`patches/` 未改动；49 条模板变量自动重映射，2 条 remap 歧义条目（`Remove ${…}`、`Could not select ${…}: ${…}`）人工改名
- **v0.0.104 适配**：新增「自带密钥（BYOK）API 提供商」整块界面中文化（设置页入口、提供商管理弹窗、模型选择器分组、表单与全部 aria-label 共 75 条），并补齐 3 处 0.0.103 就存在的历史漏翻（额度环 `resets in …` 标签、`Dismiss notification: …`、`Remove ${…}`）；v0.0.104 的主进程文件与 0.0.103 逐字节一致，补丁无需改动
- **v0.0.103 适配**：自动重映射 56 条模板变量；补齐模型选择器新增 9 个模型的标签与数据使用 / 限速提示，以及 Freebucks 钱包 / paywall 的套餐升级与付费时长文案（模型名按约定保留英文）；v0.0.88 起 Freebucks 钱包额度系统（每日额度 + 钱包 + 按小时计价的会话购买）全新界面全套中文化
- **一键安装/还原**：`apply.sh` / `restore.sh`，自动备份，随时回退英文原版
- **工具链完整**：`tools/` 提供版本迁移、构建核查、残留扫描和发布脚本。
  残留扫描分四层：`uipos.js` 扫界面属性位置（含三元分支、`actionLabel`、JSX 文本节点），
  `fieldscan.js` 扫 `description:` / `tagline:` / `hint:` 这类属性锚点之外的字段，
  `blindscan.js` 把英文原版与产物对一比，抓 `children` 三元分支 / 模板插值内部 / 函数默认值里
  那批前两者都够不着、`regress` 也判不成句子的英文（0.0.110 的 24 条历史遗留就是它扫出来的），
  `mainscan.js` 再把**主进程** `electron/*.cjs` 与产物对一遍——菜单 / 原生对话框 /
  `shell:openIn` 报错 / MCP 同意窗口历来只靠手写补丁，漏一条不会有任何构建报错
  （0.0.113 适配时一次扫出 29 处，有的从 0.0.104 以前就在）
- **上游新增文案清单**：`tools/upstreamdiff.js` 拿**两版英文原版**对差（不依赖上一版汉化包），列出本版上游新写 / 改写 / 下线的文案，并把「词典未覆盖」的那批单独拎出来当待翻清单——`build.sh` 每次把本版英文原版登记成快照 `work/pristine/<版本>/`，`update.sh` 第 6 步自动取最新两版比一次；只有一版基线时它会打印补齐办法，不当静默跳过。比对分**两层**：片段级（≥3 词、要含常见小词，句子感强）之外再加一层**完整字符串**（字面量级），否则两词 Title case 标签（`Recheck setup` / ` Country & allowance`）与单词标签（`Rechecking…`）这类短文案会漏掉；短标签单列、不拦退出码，字面量的「已覆盖」判整串相等（子串相同不算）。但两层各有一条词数下限（≥3 / ≥2），**单词字面量两边都进不来**——0.0.124 新增的验收状态表里 `success:"Verified"` 就是这样漏掉的（它既不在 UI 属性位、也不是多词句），这类只能靠人工看新代码（0.0.131 起由 `tools/uipos_gap.js` 兜住：本版产物 − 上一版产物 − `intentional-english.json`，不再靠人从 `uipos` 的几十条里肉眼挑）；反过来，新组件里那两条 `` `${o.advertiserName} invitation` `` / `"Sponsored "` 是 `uipos` 的 aria-label 桶与 text-node 桶扫出来的
- **英文原版快照可跨机器搬**：`tools/pristine.js` 管快照仓库（`capture` 从备份 / 装机原版 / NSIS 安装包采集，`export` / `import` 单文件搬运，`publish` / `--from-release` 走自己的 Release，`list` 逐文件 sha1 校验并顺带探官方发布源上还有哪些版本的安装包）。上一版原版在本机是会被抹掉的（自动更新覆盖装机原版，更新缓存装完即删）：换机器或清过 `work/` 之后，`node tools/pristine.js import --from-release latest` 一条命令就能把基线拿回来
- **版本迁移自动化**：`tools/update.sh` 一键串起重映射 → 补丁体检（UI 行为 + 主进程锚点预检）→ 构建 → UI 残留扫描 → 主进程英文扫描 → 上游新增文案 + 回归闸门 → 单词级界面文案差集 + 字面量占用。其中
  `tools/remap.js` 自动把 template 词典条目的 `${...}` 变量名迁移到新 bundle，也包括以未闭合
  `${条件?` 结尾的「半截模板」嵌套词条（对 v0.0.75→v0.0.76 的 13 条改名全量命中验证），
  不再逐条手工核对
- **发布回归闸门**：`tools/regress.js` 把新构建与上一版已发布包对一遍——比对前抹掉 `${...}`
  插值（变量改名不误报）、模板逐段取（嵌套模板不漏），只要出现新增英文自然语言片段就中止
  发布，拦住「词典全命中但某句变回英文」这类静默回归（`update.sh` / `release.sh` 自动调用）；
  `release.sh` 发布前还有三道闸门：**主进程闸门**（`tools/mainscan.js`）——`electron/*.cjs` 里还有
  没译的界面文案就中止发布；**单词级文案闸门**（`tools/uipos_gap.js`）——上面几条对差通道都有词数下限
  （≥3 词 / ≥2 词），`Settings` / `Theme` / `Reset` 这类单词文案它们看不见，这道闸门拿「本版产物 −
  上一版产物 − 登记表」补上；**字面量占用闸门**（`tools/lint_collisions.js`）——词条会不会在
  `electron/*.cjs` 里当路径 / 比较值 / IPC 通道名用（`Cookies` 那种：翻掉会让 Cookie 导入静默
  找不到文件，而构建全绿、界面正常，只有真去用那个功能才暴露）。确认有意保留英文时，逐条登进
  `intentional-english.json`（写明理由、仓库内可审）而不是敲 `--allow-english` 全放行
- **CI 上的三道快照闸门**：`.github/workflows/ci.yml` 另跑一个 `snapshot-gates` job——先从我们自己的 Release 取本版**英文原版快照**（`pristine.js import --from-release`），再跑**字面量占用**（`tools/lint_collisions.js`）/ **补丁锚点预检**（`tools/patch_preflight.js`）/ **单词级界面文案**（`tools/uipos_gap.js`）这三道（包在 `tools/ci_gates.sh` 里）。它们不需要装 Freebuff、不需要解 `app.asar`，所以能在 PR 上就拦下「词典把代码里的值翻了」「补丁锚点漂了」「新加的单词标签没登记」。这套闸门自测（`test_ci_gates.js`）专门钉住两件事：闸门失败时必须真 rc 1（假绿灯防线），以及拿不到快照时的跳过路径会打 `::warning::` 而不是冒充通过。
- **构建防呆自检**：`build.sh` 在解包前先跑 `tools/lint_dict.js`（词典结构 / 半截模板键，
  此前只在 CI 跑、本地流程形同虚设）与 `tools/missed_diagnose.js`（词条命中体检：够不着本版 UI bundle
  的条目按「只在主进程出现 / 只在上一版出现 / 两边都没有」归类，解包前就报清该往哪边补——
  0.0.131 那次 38 条主进程专属文案被塞进词典，构建跑到第 4 步才以 `MISSED` 中止，提示的方向是错的），
  之后对补丁后的主进程做 `node --check`、词典替换次数为 0 即中止；补丁套不上时直接给分诊命令
  （`tools/patch_preflight.js`：行号漂移 vs 上游改写；漂移用 `tools/reanchor_patch.js --all --write` 一条命令修好），
  构建后由 `tools/postbuild.js` 断言 `ui/index.html` 汉化标记与译文哨兵——杜绝历史上出现过的
  「补丁静默跳过」「悬空模板启动崩溃」两类事故
- **词典质量门禁**：`tools/lint_dict.js` 校验结构与 `${...}` 占位符一致性、查重复键，
  并把「半截模板」词条（以未闭合 `${条件?` 结尾）当硬错误拦下——必须未改尾巴、形态可迁移
  且在 `TRUNCATED_TEMPLATE_ANCHORS` 里登记过；`build.sh` 解包前先跑它，已接入 GitHub Actions
  （CI 另跑 `tools/test_remap.js`：合成「变量改名」bundle 验证迁移、并覆盖 lint 的三条负面用例）

## 📦 快速开始（安装）

> ⚠️ 汉化产物（修改后的 `app.asar` / `ui/`）派生自 Freebuff 的专有软件，仅面向已合法获取 Freebuff Desktop 的用户供个人自用（可经本项目的 Release 渠道获取），请勿商用。详见文末免责声明。

先在本机构建产物，再安装：

```bash
bash build.sh     # 在仓库根目录运行；自动选原版：优先安装目录里最近的 hanhua-backup-*，没有备份（首次构建）则直接用安装目录的英文原版，生成 hanhua/output/
bash apply.sh     # 应用汉化（自动备份原文件）
```

> 也可以在[多开控制器](https://github.com/Ximmmmmmm/freebuff-controller)里一键应用，无需命令行。

脚本会先把现有 `app.asar` 和 `ui/` 备份到 `resources/hanhua-backup-<时间戳>/`，再替换，**重启应用生效**。

如果你已经拿到一份产物目录（自行构建的），也可以：

```bash
bash apply.sh /path/to/unpacked   # 传入产物所在目录（仓库根目录运行）
```

手动安装：
1. 把 `app.asar` 复制到 `%LOCALAPPDATA%\Programs\@codebufffreebuff-desktop\resources\`
2. 把 `ui/` 整体替换 `resources\orchestrator\ui\`

### 更新汉化包（发布 → 客户端自动拉取）

汉化包可以作为 GitHub Release 分发，多开控制器会像检查 Freebuff 更新一样检查并拉取新包：

```bash
bash build.sh                       # 构建最新产物（自动打入 packVersion 版本戳）
bash tools/release.sh               # 打包 + 生成 pack-manifest.json + 发布 Release（需 gh CLI 已登录；取远端资产一律走 gh，不依赖 github.com 直连）
bash tools/release.sh --no-upload   # 只打包到 dist/，打印手工上传步骤
```

- **发布端**：Release tag `pack-v<packVersion>`，附件为 `hanhua-pack-<版本>.zip`（= `output/` 打包）、`pack-manifest.json`（packVersion / targetVersion / asset / sha512），以及**本版英文原版快照** `pristine-<版本>.json.gz`（发布成功后自动附上；控制器不读它，是给别的机器当「上一版原版」基线用的，`node tools/pristine.js import --from-release <版本>`）
- **客户端**：控制器每 30 分钟检查一次（与 Freebuff 更新检查共用同一条代理链）。仅当 manifest 的 targetVersion 与本机 Freebuff 版本**完全一致**且 packVersion 更新时才下载，SHA512 校验、解包后落到 `output/`，随后自动应用（无需点击）
- **packVersion**：跟随 targetVersion；同一 targetVersion 内的修正重发追加第四段（如 `0.0.103.1`，`targetVersion` 不变）。控制器按四段比较，已装旧包的机器会被判定「有新包可应用」并自动拉取；只有回滚线上烂包这类应急场景才用 `release.sh --force` 同号覆盖
- ⚠️ 汉化产物派生自 Freebuff 专有软件，发布 Release 即公开传播，与文末免责声明的「仅限本机自用」条款冲突——是否发布由你决定，发布前请确认接受并相应调整声明

### 还原英文原版

```bash
bash restore.sh   # 从最近一次备份还原（仓库根目录运行）
```

## 🔧 从源码重建（构建）

仓库**不提交**二进制产物（`output/`、`backup/` 已 gitignore）。需要自己构建时：

```bash
bash build.sh                       # 自动选原版：优先最近的 hanhua-backup-*，没有备份则用安装目录的英文原版
bash build.sh <app.asar> <ui-dir>   # 或显式指定原版文件
```

构建管线（v0.0.77 曾对照 Release 产物逐字节验证；v0.0.78 起由构建防呆自检兜底，v0.0.82 起额外断言词典对主 bundle 全命中）：

```
原版 app.asar ──解包──▶ tools/apply.js（dict.json 词典）──▶ patches/（人工补丁）──▶ 重打包 ──▶ output/app.asar
原版 ui/      ──apply_ui_patch.js（index.html 直改）──▶ output/ui/（主 bundle 再套 apply.js 词典）
```

> 注意：asar 容器头部可能因 `@electron/asar` 版本不同存在细微差异（内容一致），不影响运行。首次运行 `build.sh` 需要联网（`npx` 拉取 `@electron/asar`）。

## 🗂️ 目录结构

本仓库（`freebuff-zh`）是独立的汉化项目；配套的多开控制器是独立仓库 [freebuff-controller](https://github.com/Ximmmmmmm/freebuff-controller)：

```
├── dict.json          # 翻译词典（exact / template / code / pattern 四类）
├── intentional-english.json # 「有意保留英文」登记表（逐条写理由；回归/单词级/占用三道闸门共用）
├── manifest.json      # 词典适配的 Freebuff 版本（多开控制器读取做兼容检查）
├── patches/           # 人工补丁：词典覆盖不到的手工修改（主进程 7 个文件；index.html 由 tools/apply_ui_patch.js 直改）
├── tools/             # 构建 / 版本迁移 / 找漏翻脚本（见 docs/更新维护.md）
│   ├── update.sh      # 一键版本迁移：重映射 → 补丁体检（UI 行为 + 主进程锚点预检）→ 构建 →
│   │                  #   UI 残留扫描 → 主进程扫描 → 上游新增文案 + 回归闸门 →
│   │                  #   单词级界面文案差集 + 字面量占用 → 汇总
│   ├── remap.js       # template 词典条目随 minifier 改名自动迁移
│   ├── postbuild.js   # 构建产物自检（index.html 标记 / 主进程语法与译文哨兵）
│   ├── lint_dict.js   # 词典质量门禁（结构 / 重复键 / 占位符一致性）
│   ├── missed_diagnose.js # 词条命中体检（只在主进程 / 只在上一版 / 两边都没有；build.sh 第 0b 步）
│   ├── test_remap.js  # remap / lint 自测（合成「变量改名」bundle，CI 跑）
│   ├── test_missed_diagnose.js # 词条命中体检自测（四类归属 / 退出码，CI 跑）
│   ├── uipos_gap.js   # 单词级界面文案差集（本版产物 − 上一版产物 − 登记表；补两条对差通道的盲区）
│   ├── test_uipos_gap.js # 差集自测（解析口径 / 两侧差集 / 登记表 / 退出码，CI 跑）
│   ├── lint_collisions.js # 字面量占用（词条会不会在 electron/ 里当路径 / 比较值 / IPC 通道名）
│   ├── test_lint_collisions.js # 占用检查自测（三种形态 + 假阳性防线，CI 跑）
│   ├── patch_preflight.js # 主进程补丁锚点预检（行号漂移 vs 上游改写，附修法）
│   ├── reanchor_patch.js  # 补丁重锚定（只改 @@ 头；目标＝快照 + 词典，与 build.sh 口径一致）
│   ├── test_patch_preflight.js # 预检 / 重锚定自测（分诊 / 幂等 / 镜像口径，CI 跑）
│   ├── ci_gates.sh    # CI 的三道快照闸门（字面量占用 / 补丁锚点预检 / 单词级文案；不装 Freebuff）
│   ├── test_ci_gates.js # 闸门自测（假绿灯防线 / 跳过路径 / 退出码，CI 跑）
│   ├── regress.js     # 发布回归闸门（新旧产物英文片段比对，release/update 调用）
│   ├── test_regress.js # 回归闸门自测（登记表逐条豁免 / --allow-english / 退出码，CI 跑）
│   ├── blindscan.js   # 盲区扫描：原版 vs 产物，找 uipos/fieldscan/regress 都扫不到的英文
│   ├── mainscan.js    # 主进程扫描：electron/*.cjs 原版 vs 产物（跳过注释，三桶分类）
│   ├── test_mainscan.js # mainscan 自测（CI 跑）
│   ├── upstreamdiff.js # 上游新增文案：两版英文原版对差（新增 / 改写 / 下线，不依赖汉化包）
│   ├── test_upstreamdiff.js # upstreamdiff 自测（CI 跑）
│   ├── pristine.js    # 英文原版快照仓库：capture / export / import（含 --from-release）/ publish / list / path
│   ├── test_pristine.js # pristine 自测（CI 跑）
│   └── apply_ui_patch.js # 直接替换 UI index.html 翻译（替代 git apply）
├── build.sh           # 可复现构建：原版 + 词典 + 补丁 → output/（含防呆自检）
├── apply.sh           # 安装汉化到应用（自动备份）
├── restore.sh         # 从备份还原英文原版
├── docs/              # 汉化维护说明（日常恢复 / 版本适配 / 发布）
└── work/              # 扫描中间产物与英文原版快照 work/pristine/（gitignore，不入库）
```

## ⚠️ 注意事项

- **自动更新会覆盖汉化**：应用自带 electron-updater，更新后汉化文件会被替换。装有多开控制器
  （v1.8.17+）的话，它默认开启「自动恢复汉化」，在打开控制器时 / 启动实例前 / 检测到版本变化时
  自动换回中文，本地跑完 `bash build.sh` 后也会自己发现新构建换上（没有开关、无需点任何按钮）；
  不用控制器时重新执行 `apply.sh`（或用 `build.sh` 对新版本重新构建）。详见 `docs/更新维护.md`。
- **修正重发要升第四段**：控制器只在 packVersion 变新时才下载。同一 Freebuff 版本内又改了词典，
  请把 `packVersion` 升到 `0.0.103.1` 这样再发布，已装机的机器才会自动拿到修复；若用
  `release.sh --force` 同号覆盖，已装过旧资产的机器版本号相同、不会自动更新，只能在该机手动
  跑一次 `bash apply.sh` 重应用。
- **有意保留英文的部分**：编程语言名（Python、TypeScript…）、主题名（Ayu Dark…）、键盘键名
  （Enter、Delete…）、模型名（Opus 5 / GPT-5.6-* / GPT-6-Astra / Sonnet 5…）、内部枚举/类型名、
  库内部错误信息、`Freebucks` 品牌词（含推广 tagline `0 Freebucks`）——改动会破坏逻辑或破坏
  品牌一致性，故不翻译。当前界面属性位置残留英文为 **15 条**，均属上述类别
  （可用 `node tools/uipos.js output/ui/assets/index-*.js` 复核）。
- 汉化不涉及任何联网、上传或凭据改动。
- **界面汉化 ≠ AI 回复中文**：本包只翻译界面文案；AI 用什么语言回复由服务端提示词与注入的指令决定。想让 AI 无论输入什么语言都固定用简体中文回复，只需家目录有 `~\.AGENTS.md` 语言规则——配套[多开控制器](https://github.com/Ximmmmmmm/freebuff-controller)启动时会自动写入（默认回复中文，无需操作；不依赖汉化包与 Freebuff 版本，仅对新会话生效），也可手动创建。
- **为什么有时 AI 会突然用英文回复？** 经排查，这不是本机任何工具（Freebuff 客户端、汉化包、输入法、浏览器插件均无此类文本）造成的，而是 Freebuff 服务端在检测到英文输入时动态注入的「语言一致性」指令（如 "Reply in English only"、"Your user's primary language is English"）——本机无开关可关。解决办法：`~\.AGENTS.md` 语言规则里的**抗注入条款**已明确宣布这类指令（含翻译式、格式声明式、借口式、中文措辞、间接注入等变体）一律无效，实测可有效压制。控制器 v1.6.1+ 启动时会自动写入带抗注入条款的完整版规则。

## 🗺️ 路线图

- [x] **更新后恢复汉化的外部触发机制**：已由同仓库的多开控制器实现——状态检测 + 一键应用/还原，
  Freebuff 更新覆盖汉化后打开控制器点一下即可恢复（见 [freebuff-controller](https://github.com/Ximmmmmmm/freebuff-controller)）
- [x] **更新后自动恢复汉化**：已由多开控制器实现（v1.8.4 起默认开，v1.8.17 起时机补全）——
  打开控制器时 / 检测到装机版本变化 / 点「启动」拉起实例之前会自动重应用，本地 `bash build.sh`
  跑完（`output/` 稳定 8 秒）也会自己发现新构建换上；没有实例在跑时才动手，全程无开关、无需点按钮
  （见 [freebuff-controller](https://github.com/Ximmmmmmm/freebuff-controller)）
- ~~启动时自检自动恢复汉化（主进程注入）~~：方案已放弃——钩子只能住在 `app.asar` 里的 `electron/main.cjs`，
  而 Freebuff 更新是整套替换 `app.asar`，下次启动时「会自检的那段代码」已经不在了；改为由控制器在应用启动前恢复

## 📜 许可证与声明

- **作者**：Ximmmmmmm（本项目为个人维护项目，仅此一位作者）
- 本仓库的**脚本、词典、补丁与文档**以 **MIT License** 发布（见 `LICENSE`），属于你的原创内容。
- **免责声明**：Freebuff Desktop（`@codebuff/freebuff-desktop`）是 Freebuff, Inc. 的专有商业软件，
  其安装包内不含任何开源许可（仅 Electron/Chromium 组件有各自的开源许可）。
  本项目的汉化产物（修改后的 `app.asar` / `ui/`）派生自该软件，**仅面向已合法获取
  Freebuff Desktop 的用户供个人自用**：可经本项目的 Release 渠道获取与分发，但请勿
  用于商业用途、请勿移除本声明或声称原创，并请遵守 Freebuff 的服务条款。
  如 Freebuff 官方提出异议，请立即停止分发并删除相关文件。购买正版是对开发者的支持。
