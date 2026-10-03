# 更新日志

> 这里只记三件事：**上游这一版改了什么、汉化跟着做了什么、对装机有什么影响**。
> 逐条账目（对差统计、词典条数与替换次数、各扫描的残留条数、发布包哈希）与工具口径不收在这里——
> 需要时看 `git log`：每次适配与发布的提交里都写着完整过程。

## [0.0.158] · 2026-10-03（已发布 `pack-v0.0.158`）

上游这一版几乎只动逻辑：上一版刚合并的 `Updates` + `Version` 两个设置页**又撤回**成
`Updates`（导航项与页面描述都回到旧形态，描述文案也从 `Your version of Freebuff and what's
new in it.` 退回 `Your version of Freebuff.`），其余是把压缩变量名又换了一轮、赞助价格表里
加了一条限时档期（`Free through Sunday, Oct 4 PT`）。新增界面文案只有这一条。

- **文案**：上游新增 0 条片段/ 2 条字面量（2 条片段级都没报到的），下线 1 条，疑似改写 0 组。
  词典 2069 → 2071 条（`exact` 1656 / `template` 288 / `code` 37 / `pattern` 90），
  替换总数 2481 → 2483、全命中；纯字面量词条覆盖 1606/1606（100.0%）。
- **词典迁移**：`remap` 自动改名 55 条模板（`cl`→`ml`、`Pr`→`Ar`、`fm`→`Cm`、`Fe`→`Ce` 一族），
  另有 8 条 `AMBIGUOUS`（同一锚文本在 bundle 里有多处、插值不一致）逐条在新 bundle 里核对上下文后
  人工定形：`Project: ${ir(e)}`→`${or(e)}`（新建会话的项目选择器）、`${H} pixels` 成死条目直接删
  （同义的 `${Math.round(f)} pixels` 本来就在词典里）、两条 `Regular price:` 分别落到 `${je}`（模型
  选择器行内）与 `${Ye}`（当前模型抬头）、`Remove ${Re.configKey}`→`${Ne.configKey}`、
  `Sponsored: ${gF(t/e)}`→`${ZW(t/e)}`、`Details for ${Zu}`→`${Ku}`。
- **About 撤回的连锁处理**：`Updates` / `Version` / `Your version of Freebuff.` 三条按 0.0.156 的
  原译法放回，`About` 与 0.0.157 那句描述删掉；`semantic_guard` 的 `CONSISTENT_LABELS` 从「关于」
  换回「更新」（同一张表，跟着换回去才对——这张表只允许“同表同值、进程内派生”时整表替换）。
- **顺带修掉一个存量 bug**（0.0.156 起就在）：设置页描述表 `{General:…, Updates:"Your version of
  Freebuff."}` 的键是**不带引号的标识符**，而 `exact` 只替换带引号的字面量，所以同一张表里
  `通用` / `外观` / `连接器` 都被翻了、偏偏 `Updates` 没翻——而导航数组已经整表变成 `["…","更新"]`，
  页面按中文页名去查这张表就**查不到**，“你的 Freebuff 版本。”这句描述一直不显示。按表里其他键的
  既有做法补了一条 `code` 词条（`,Updates:"` → `,更新:"`，bundle 里唯一命中），描述表才与导航对齐。
- **主进程**：上游多了 1 个文件（`electron/` 41 → 42 个），13 个补丁一次干净套用；
  主进程英文扫描 0 条疑似漏翻、0 条短标签待过目，约定保留 93 → 94 条（跟着新文件 +1）。
- **UI 行为补丁**：两组仍判 `KEEP`，行为取证通过。
- **四道发布闸门全绿**：主进程 0 条；回归闸门（对比 `pack-v0.0.156`）69 处新增英文全在登记表里、
  0 处未登记；单词级界面文案差集 0 处（本版界面位置英文 38 处 vs 上一版 20 处，扣除登记表无独有项）；
  字面量占用无冲突。
- **影响面**：`targetVersion` / `packVersion` 升到 0.0.158，已装 0.0.156 的机器会自动拉到这一版。

### 记一笔：`Free through Sunday, Oct 4 PT` 是会过期的词条

模型选择器里那条限时促销档期写死了日期（`{at:"2026-10-02T18:00:00Z", …, tagline:"Free through
Sunday, Oct 4 PT"}`）。本项目的惯例是**照翻**（0.0.153–0.0.155 就一直带着 `Deal ends Sep 30 · 15/hr
after`），但上游换档期时这个字面量会跟着变，旧词条就成了死条目、届时 `build.sh` 会在第 4 步以
MISSED 中止——**这是设计内的失败**，照新原文改键即可，不要用 `ALLOW_MISSED=1` 绕过去。

## [0.0.157] · 2026-10-03（未发布：装机版本已自动跟进到 0.0.158，本版只作为迁移基线留档）

上游这一版把 **gravity_index 的开发者服务接进了产品**：新增服务浏览面板
（`Browse services` / `Search 500+ services` / `Service categories` / `Grid view` / `List view` /
`Name (A–Z)` / `Loading services…` / `No service matches`），每个服务卡上的 `Get … API key` /
`Documentation` / `Website` / `Integrate` / `Setup`，以及一批解释这套机制怎么用的说明文案
（`Finds and sets up developer services for your project: …` / `Always on. There is no switch.` /
`The agent asks you before it creates an account on a service for you.` / `Integrate puts a request
in your open thread’s message box for you to send.` / `Open a thread first, then press Integrate.`）。
设置页那边把 `Updates` 与 `Version` 合并成了 `About`（`Your version of Freebuff and what’s new in
it.`），侧栏搜索加了 `Showing X of Y` 的命中计数，消息队列多了 `Queued prompt` / `Find services`。

- **文案**：上游新增 564 条片段 / 760 条字面量（其中 201 条片段级没报到的），下线 0 条、疑似改写 0 组。
  词典 2029 → 2069 条（`exact` 1654 / `template` 289 / `code` 36 / `pattern` 90），
  替换总数 2429 → 2481、全命中；纯字面量词条覆盖 1604/1604（100.0%）。
- **词典迁移**：`remap` 289 条模板全部 `SAME`（这版 minifier 没动插值名），`resituate` 回查
  2067 条旧词条全部命中、无 CONFIRM / GONE；新增的 95 条模板里大部分是把旧句子的插值改写成
  新形态的改写版（`Regular price:`、`Your hour is up.` 一族）。
- **约定保留**：本版新增 **736 条**，是历来最大的一笔——`gravity_index` 工具链连同 **Zod v4**
  一起打进 bundle，带进来几百条库内部诊断文案（`Invalid option: expected one of`、
  `Function types cannot be represented in JSON Schema` 等）与它自带的**几十种语言错误表**
  （`Nevalida enigo: atendiĝis` / `Of lítið: gert er fyrir að hafi` …）。它们都不是界面文案，
  翻了没有接收方、还会与库的英文文档对不上，与已登记的 react-window console.warn 同类，
  逐条写明理由登记进 `fragments`；`gravity_index` 的工具 schema 描述（`Widget type. Currently,
  the only supported widget is button.` 等）是**送给模型的 payload** 而不是给人读的文案，
  与已登记的 `Regions: Style changes to implement:` 同类。
- **主进程**：`electron/` 13 个补丁一次干净套用，锚点无漂移；主进程英文扫描 0 条疑似漏翻、
  0 条短标签待过目，93 条约定保留分类计数不变。
- **UI 行为补丁**：两组仍判 `KEEP`——上游没碰流式序号与令牌缓存，锚点全部唯一命中，产物侧行为取证通过。
- **四道发布闸门全绿**：主进程 0 条；回归闸门（对比 `pack-v0.0.156`）69 处新增英文全部落在登记表里、
  0 处未登记；单词级界面文案差集 0 处（本版界面位置英文 38 处 vs 上一版 20 处，扣除登记表后无独有项）；
  字面量占用无冲突。
- **顺带修掉的存量问题**（来自《汉化质量审查报告》）：
  - **P0：两条模板占位符被截断**，界面会把 JS 代码残骸直接渲染给用户——
    `…project folder is on t.currentBranch??"游离的 HEAD"`（丢了 `${e.` 与闭合 `}`）与
    `…wallet 中使用 3r?" 并结束当前会话""`（丢了 `${a`）。已改正，产物里不再出现裸代码。
  - **P0 的根因是闸门盲区**：`lint_dict` 的 E3 只拦「译文多出的插值」，且**数量少于原文属正常**
    （中文吸收复数），于是「残骸里连 `${` 都没有」这类破损能全绿通过。新增 **E6 模板残骸**规则：
    译文剔掉所有 `${…}` 后若仍匹配 `?"` / `":` / `??` / `===` / `!==` / `=>` / `||` / `.length`
    即判硬错误，并在 `test_remap.js` 配了 2 条真阳性 + 复数省略的阴性夹具。
  - **术语统一**：`thread` 全场 126 处译作「会话」，仍有 3 处作「线程」（`No outstanding changes
    relative to this thread's source branch.` / `Reading the thread's worktree…` / `Could not fork
    thread: …`）——中文里「线程」几乎专指 CPU thread，会误导成并发相关，已一并改回「会话」。
  - **语义守卫表**跟着上游换页：`Updates` 与 `Version` 合并成 `About`，`CONSISTENT_LABELS` 里的
    `更新` 换成 `关于`（这张表只在同表同值、进程内派生时才能整表替换，`About` 与其余成员同构）。
- **影响面**：`targetVersion` / `packVersion` 升到 0.0.157，但**没有发 Release**——本机 Freebuff
  在适配完成后自动更新到了 0.0.158，`pack-v0.0.157` 对装 0.0.158 的机器不适用；本版作为
  0.0.158 迁移的基线留档，不单独发布。

## [0.0.156] · 2026-10-02（已发布 `pack-v0.0.156`）

上游这一版把**广告位整块翻新并加了预览实验室**：新增 `Ad lab`（`All desktop formats | local mocks`），
可切换 `In the chat` 的格式（`Chat block` / `Chat banner` / `New-chat display banner` / `Showcase` /
`Spotlight` / `Intermission` / `Agentic invitation`），自定义素材（`Ad title` / `Destination` /
`Image fit` → `Fill the placement` / `Show the full image`、`Choose image` / `Replace image`）、
选择起始面板（`Start with` → `Panel closed` / `Panel open`）与最短展示时长（`Minimum time`），
并给出 `Click an ad to test its action.` / `Simulation only | no navigation or sponsored work started.`；
三张赞助卡各自成套文案——**Greptile**（`Greptile kills bugs` / `AI code review` / `Catch bugs.` /
`Before you merge.` / `from your whole codebase.` / `Bug caught` / `Suggested fix ` / `Handles missing users`）、
**Runable**（`Create with Runable` / `Create websites,` / `videos and slides` / `with AI.` /
`Describe it. Runable creates it.` / `Creative direction` / `Room to` / `imagine.`）、
**Freebuff 自家**（`The free coding agent` / `Big ideas.` / `Meet your builder.` / `Build your next idea` /
`Weekly momentum ` / `Active projects` / `Tasks completed` / `Last 7 days` / `All checks passed` /
` Built in 1m 12s` / `Your idea, ready to explore.`）。BYOK 侧补了「**添加模型**」流程
（`Add another model` / `Add model` / `The saved credential is reused. Each model’s key and limits are
managed separately.`），广告位新增**可关闭**提示（`Sidebar ad can now be dismissed.` /
`Panel ad can now be dismissed. Other panel tabs are available.`）。上架素材侧下线了
GLM 5.3 Flash 的限时促销（`Deal ends Sep 30` 一族）与侧栏余额兜底句。

- **文案**：上游新增 84 条片段 / 153 条字面量（片段级没报到的 68 条），下线 3 条，疑似改写 1 组。
  词典 1867 → 2029 条（`exact` 1617 / `template` 287 / `code` 35 / `pattern` 90），
  替换总数 2255 → 2429、全命中；纯字面量词条覆盖 1567/1567（100.0%）。
- **词典迁移**：`remap.js` 自动迁移 158 条模板变量名；另 13 条 AMBIGUOUS 与 11 条 MISSING
  逐条在新 bundle 里核对后手工改键（多数是压缩变量又换了一轮名，如 `${se.label}` → `${ae.label}`、
  `${Qe}` → `${Ne}`，两条断言模板按新形态各拆成两条），译文随新键同步。
- **单词级补漏**：`uipos_gap` 初检报出 40 处本版新界面文案——广告实验室的控件标签、赞助卡的
  展示文案、BYOK 表单、周几标签、`Sidebar 4:3` 等，能翻的全部补进词典；
  `Image` 因在 bundle 里同时是 markdown AST 的枚举成员（`e[e.Image=28]="Image"`）与比较值，
  `exact` 会被语义守卫拦下，改走 `pattern` 只翻界面属性位置。
- **约定保留**新增 13 条：8 条 fragments（DOM 选择器 `.explorer, .explorer-header`、
  三张赞助卡与自定义素材的 CSS 类名组合、BYOK 的 `/api/byok/connections/…/models`、
  两张卡的 `/placement-previews/…webp` 素材路径）与 5 条 uiStrings（广告卡里模拟代码截图的
  `'Guest'` / `getUser()` / `user =` / `user?.name ??` 与模拟地址栏 `localhost:3000`——
  属于演示内容，与 `git init` / `Initial commit` 同类）；品牌名 `Acme Deploys` / `Greptile` / `Runable` 一并登记。
- **主进程**：`electron/` 41 个文件里 13 个补丁全部一次干净套用，无需重锚定或 `regen`；
  主进程英文扫描 0 条疑似漏翻。
- **UI 行为补丁**：两组仍判 `KEEP`——上游没碰流式序号与令牌缓存，锚点全部唯一命中，
  产物侧行为取证通过。
- **四道发布闸门全绿**：主进程英文扫描 0 条；回归闸门（对比 `pack-v0.0.155`）0 处未登记英文；
  单词级界面文案差集 0 处（初检 40 处已全部补翻或登记）；字面量占用无冲突。
- **影响面**：`targetVersion` / `packVersion` 同时升到 0.0.156，已装 0.0.155 的机器按常规比较会自动拉到这一版。

### 记一笔：`uipos_gap` 把新增项按形态分三桶（发布后补）

本版适配时那 40 条单词级新增是人工逐条挑拣的（哪条是文案、哪条是 CSS 类名或路径），
下一次不必再这样。`tools/uipos_gap.js` 现在对每条未登记新增跑一遍 `classifyItem`
（纯形态判据），报告按三桶分组：

| 桶 | 形态 | 本版的例子 |
| --- | --- | --- |
| 能翻（补 `dict.json`） | 多词短语、首字母大写的单词标签 | `A different pace.` / `Accepted` / `Mon` |
| 该登记（形态上多半不是文案） | 路径与资源名、CSS 类名与选择器、命令行、代码与标识符 | `/api/byok/connections/…` / `fpc fpc-- fpc--asset` / `git init` / `user?.name ??` |
| 存疑（人工定夺） | 含 `${…}` 的模板串、带数字的标题式词、全大写缩写 | `Dismiss ${…} ad` / `Solar Mini 4` / `API` |

- 分类**只是建议，不参与退出码判定**——闸门的判据仍是「词典 + 登记表有没有覆盖」，
  分错只是白看一眼，不会让闸门变绿或变红；
- `--flat` 回到分桶前的平铺清单（跨版 diff 两版报告时更顺手）；`--limit` 改为**逐桶**生效；
- 自测补了 18 条分类用例（每条都取自本仓库登记表或本版实测）与 6 条分桶报告的端到端断言，
  含「`--flat` 不分桶但仍列出全部新增项」与「带括号注的文案 `Arguments (JSON array)`
  不能当代码」两条防回归（分类器初版就在这里判错过一次）。

### 记一笔：`resituate` 把「remap 够不着的旧词条」变成一条命令（发布后补）

本版适配时 `remap` 报了 13 条 AMBIGUOUS + 11 条 MISSING（加上 `missed_diagnose` 的「只在上一版
UI 出现」清单共 35 条），全靠人工在新 bundle 里逐条搜现形态。`tools/resituate.js` 把这一步自动化：
拿**本版英文原版**当语料，按分区形态分别定位——`template` 用固定段当锚、插值当捕获组（三种捕获
形态 + 固定段序列扫描兜底）；`code` 片段把标识符抹成通配做骨架子串搜索；`exact` / `pattern` 在完整
字面量集合里按词级相似度找改写句。唯一且可自证的直接给「新键 + 同步好的译文」（`RELOCATE`），
其余列 `CONFIRM`（多候选 / 散文改写）与 `GONE`（上游疑似下线）交人工；`--write` 只写回 `RELOCATE`，
绝不自动删（`--prune-gone` 才删，且不进自动流程）。

- 与 `remap` 共用一份模板底层 `tools/literal_skeleton.js`（解析 / 骨架 / 标识符改名 / 三种捕获形态），
  两处口径不再各写一份——这是过去 AMBIGUOUS 归因漂移的根源；`test_literal_skeleton.js` 钉住底层、
  `test_resituate.js` 钉住端到端（三路定位 + 写回自证 + 退出码），两者都进了 CI；
- `update.sh` 新增 **1b 步**：`remap` 之后自动跑一遍 `resituate --write`（`--prev-ui` / `--electron`
  从 `work/pristine/` 快照取，用来把「连上一版也没有」与「其实只在主进程」的条目分开），
  能自动的写回、其余进报告与小结；删死词条仍留人工。

## [0.0.155] · 2026-10-01（已发布 `pack-v0.0.155`）

上游这一版加了**跨项目搜索**：顶部搜索能搜会话、文件与文件内容（`Search chats and files` /
`Files and folders` / `Recent chats` / `Across your projects` / `File content`），检索过程中给出
`Looking through your projects…` / `Updating search results…`，查无结果时提示 `No matches found` 与
`Try another word, chat topic, or file name.`，空态是 `Your recent chats will appear here`；结果面板带
`Replace all matches` 与 `Close search`。设置页新增 **`Interface size`**（`Scale text, icons, and
controls…`、`${n} pixels`、两端标注 `Smaller` / `Larger`），窗口缩放随之从 WebView 改为主进程写一份
本机偏好（并同步窗口按钮区高度）。**手机同步整条下线**（`Sign in to enable.` / `Mirror to my phone` /
`This computer:` / `No matching threads.` / `Search threads` 等 7 条不再出现），工具输出侧补了
`Delete file` / `Opening…`。

- **文案**：片段级新增 27 处、下线 4 处、疑似改写 2 组；字面量级新增 40 条。词典 1829 → 1867 条
  （`exact` 1469 / `template` 276 / `code` 33 / `pattern` 89），替换总数 2213 → 2255、全命中。
  73 条模板变量自动迁移，8 条 remap 歧义（上游重压缩换了变量名）逐条按新形态修好，没有条目掉队。
- **单词级补漏**：`uipos_gap` 闸门报出的 7 处本版新界面文案——编辑工具的 diff 标签（`Before` / `After`）、
  界面大小滑杆两端的标注（`Smaller` / `Larger`）、命令面板的快捷键提示（` Navigate ` / ` Open`，保留
  原样的空格分隔）、diff 分段的 aria-label `Edit ${n+1}: ${path}`——每条在 bundle 里都只有 1 处出现、
  且都落在界面位置，全部按 `exact` / `template` 精确替换。
- **主进程**：`main.cjs` 补丁用 `regen_patch` 重生成（27 hunks / 435 行）、`mcp-consent-bridge.cjs` 重
  锚定，其余一次干净套用；**新增第 13 个补丁** `electron-zoom-menu.cjs.patch`——上游把缩放菜单从
  Electron 内建 `role`（随系统语言自动本地化）换成硬编码 `label`，`Actual Size` / `Zoom In` / `Zoom Out`
  会以英文直接出现在 View 菜单里，补翻成「实际大小 / 放大 / 缩小」并加译文哨兵。
- **约定保留**新增 6 条：界面缩放的 IPC 校验与安全错误 2 条（渲染端 catch 后显示自己的文案）、内存版
  safeStorage 的错误串 2 条（该文件仅 dev / 测试注入，打包版永不加载）、日志 1 条、字体名 `Google Sans` 1 条。
- **UI 行为补丁**：两组仍判 `KEEP`；窗口按钮区行为取证（`tools/probe_shell_colors.js`）随 0.0.154.1 一并进
  `build.sh` 自检，本版产物全绿（深色 / 浅色 / 高度与界面 CSS 一致）。
- **四道发布闸门全绿**：主进程英文扫描 0 条疑似文案；回归闸门（对比 `pack-v0.0.154`）0 处；单词级界面文案
  差集 0 处（初检 7 处已补）；字面量占用无冲突。
- **影响面**：`targetVersion` / `packVersion` 同时升到 0.0.155；上一轮改动（窗口按钮区配色修正）原计划单独发
  0.0.154.1，现并入本版一起发布。

### 记一笔：语义守卫被正则字面量带偏，`regen_patch` 静默丢块

本版 bundle 新增了一处带裸引号的正则字面量（`/[\n"\\]/g`），`tools/semantic_guard.js` 的扫描器不认正则，
把它当成字符串起点，引号配对整体错位 2600 字符，于是把 Freebucks 定价的中文误报成「semantic API argument」
——`postbuild` 直接中止构建（0.0.154 没有这处正则，所以直到这一版才暴露）。修法是给扫描器补上正则词法
（`isRegexStart` / `skipRegex`，模板 `${}` 内部一并处理），并新增 `tools/test_semantic_guard.js`（5 组用例，
含真实产物回放）进 CI。

另一处是 `tools/regen_patch.js`：它只搬「删除块 + 等长新增块」的映射，纯新增块带不上——0.0.154.1 的
`HANHUA_SHELL_COLORS` 插入段（61 行）就这么被静默丢过一次（靠 `postbuild` 哨兵才逮住）。现在
`plainAdditions()` 会把纯新增块在输出里点名，`tools/test_regen_patch.js` 也补了对应用例；本次重生成
`main.cjs` 补丁时靠它把丢掉的那段原样回插。

### 记一笔：`Edit` / `Write` 的精确制导

`Edit` / `Write` 既是界面文案（差异评论的编辑按钮、工具名 → 显示标签表），又是协议工具名的**比较值**
（`n === "Edit"`，比较对象来自外部数据）——整体 `exact` 会把后者一起翻掉，语义守卫当场拦下。现在改成
`pattern` 一处 + 8 条 `code` 具名片段，只翻显示位置，两处协议比较保持英文。

### 并入的窗口按钮区配色修正（原计划 `pack-v0.0.154.1`）

0.0.154 装机后，窗口右上角那三个系统按钮（— □ ×）底下一块矩形颜色与标签条**对不上**（实测按钮区
`#f0f0f0` 中性灰、标签条 `#e3e7e4`，差 13 级；高度是对的）。成因是这版上游把最外层配色改成**转发**：
CSS 里 `:root[data-theme=light]{--shell-base:#e3e7e4; … --chrome:var(--shell-base)}`，而标题栏补丁的
`lastVar()` 取到的是字符串 `var(--shell-base)`，直接当了 `titleBarOverlay.color`——那不是颜色，
Electron 只好回落成系统默认底色。**哨兵全绿**：`overlay: HANHUA_SHELL_COLORS.light,` 这行文本一个字
都没变，变的只是它的值。浅色下的正确值恰好等于补丁的 `fallback`，所以看起来「像是对的」。

- **修法**：`HANHUA_SHELL_COLORS` 里顺着 `var()` 引用解到底（同一选择器的块从后往前找，最多 6 层、
  防环），并要求结果匹配颜色字面量（`#hex` / `rgb()` / `hsl()`）；解不出、成环、不是颜色一律按
  「读不到」处理，回落 `fallback`——最坏等于上游写死值，不会比原版更糟。深色侧同一处转发一并修好。
- **新的行为取证**：`tools/probe_shell_colors.js`——把产物 `main.cjs` 里的 `HANHUA_SHELL_COLORS`
  **原样抽出来**跑一遍，再拿界面 CSS **独立**解一遍（不复用补丁的代码），比对底色 / 图标色 / 高度。
  判据刻意分成两层：① 四个颜色必须都是颜色字面量（把「转发没解到底」直接钉死）；② 必须等于界面
  CSS 级联的实际值。`build.sh` 的自检（`tools/postbuild.js`）现在会对产物跑它，rc 1 直接中止构建；
  自测 `tools/test_probe_shell_colors.js` 进 CI，其中「修好的块 rc 0 / 旧写法 rc 1」两条用例直接
  从 `patches/electron-main.cjs.patch` 的新增行里拼块——补丁改坏了自测就红。
- **踩坑（写给下一个探针）**：块里用的 `fs` / `path` 是 main.cjs 的**模块级**绑定，沙箱必须一并注入；
  少了它们块会进 `catch`、静默回落成写死值，探针于是把「读不到 CSS」误报成「值不对」。同样地，
  取界面 CSS 时按 `resourcesPath/orchestrator/ui` 搭临时舞台目录——直接指 `output/ui` 是读不到的。
- **影响面**：这一轮原计划单独发 0.0.154.1，现并入 0.0.155 一起发布——装机后右上角那块色差随之消失。

## [0.0.154] · 2026-09-30（已发布 `pack-v0.0.154`）

上游这一版给**外壳补上了应用级导航**：侧栏顶部多了 `App navigation`（`Home` 按钮 +
`Navigation history` 历史回跳），标签页行上可直接 `Close tab`，历史条目打不开会报
`Could not open this history entry.`；项目侧栏的「…」按钮接入整套菜单（`Project actions` /
`Project actions for <项目名>`）；**受限访问**换了新说法（`Limited access, verify country` 与
`Limited access. Verify your country from home internet or mobile data, without a VPN.`，
验证打不开是 `Couldn't open verification. Please try again.`）；工具提示补了**相对时间**
（`Just now` / `${n}m ago` / `${i}h ago` / `${r}d ago` / `${s} ${s===1?"week":"weeks"} ago`）
与「N 个会话需要输入」计数（`chat needs` / `chats need`），迁移提示提到 `your API provider`。
上一版的 `Back to threads`（返回会话）与 `Drag to reorder projects`（拖拽排序提示）随改版下线，
三条队列发件的 `(Enter)` 快捷键模板一并不再用。

- **文案**：新增 9 条片段 / 14 条字面量（13 条直接覆盖，1 条 CSS 类名 `app desktop-shell`
  登进登记表），下线 5 条，疑似改写 0 组。词典 1821 → 1829 条（`exact` 1440 / `template` 276 /
  `code` 25 / `pattern` 88），替换总数 2203 → 2213、全命中。
- **被删条目的复核**：上一轮把 14 条「0.0.154 原版里够不着」的条目直接核销，本版 uipos 闸门
  抓回一条漏网——`Remove ${Te.configKey}`（连接器移除按钮的 aria-label）不是下线，而是上游
  重压缩换了变量名，已按新形态 `Remove ${ye.configKey}` 迁移回词典。
- **主进程**：`electron/` 37 个文件里 `main.cjs` / `splash.cjs` 变了——上游重调了 shell 主题
  （深/浅色 overlay 底色与符号色、启动屏轨道与进度条配色）与标题栏高度（54 → 48，macOS 补了
  `trafficLightPosition`）；`patches/electron-main.cjs.patch` 三个 hunk 随之重维护，
  12 个补丁一次干净套用（无需 reanchor / regen）。
- **UI 行为补丁**：两组仍判 `KEEP`——行为取证（stream-epoch / token-epoch）在产物里全部通过。
- **登记表**：新增 1 条 fragments（`app desktop-shell`，主窗口与线程窗口的根 CSS 类名）。
- **四道发布闸门全绿**：主进程英文扫描 0 条；回归闸门（对比 `pack-v0.0.153`）新版独有英文 0 处；
  单词级界面文案差集 0 处（本版初检的 3 处——`Home` / `Project actions for ${…}` / `Remove ${…}`
  ——已全部覆盖）；字面量占用无冲突（初检 4 条假阳性，见下）。
- **影响面**：`targetVersion` / `packVersion` 同时升到 0.0.154，已装 0.0.153 的机器按常规比较会自动拉到这一版。

### 记一笔：`pattern` 词条的闸门判据与替换语义对齐

上游本版在主进程新增了 `menu:tabContext` / `shell:revealChange` / `discord:setEnabled` 等 IPC 通道名，
`tools/lint_collisions.js` 旧判据对 `pattern` 词条按「字面量**包含**该词」判，于是把 `Context` /
`Enabled` / `Enable` / `Change` 四条报成「会被写坏」。实测是假阳性：产物里 React 内部的
`"Context"`（`displayName||"Context"`）逐字节未动，`apply.js` 对 `main.cjs` 的替换仅 1 处（注释里的
`Claude Code is signed out`）——`pattern` 的替换和 `exact` 一样是**整串相等**（`dict.pattern[lit.value]`），
真正做子串替换的是 `code` 分区。判据已改为与替换语义逐一对齐（exact / pattern 整串，code 子串），
自测补了四条用例钉住。这四条词条也因此能留在 `pattern`：`Context` 在产物里是「UI 一处、React 内部两处」，
改走 `exact` 会把 React 的 displayName 一起翻掉。

## [0.0.153] · 2026-09-30（已发布 `pack-v0.0.153`）

上游这一版把**赞助任务与 MCP 连接两块补齐了**：赞助提案多了「最小化」按钮（`Minimize sponsored task`）
与**取消确认**（`Cancel this task` → `Cancel this task? It has not started, so nothing in your project
changes.`，配 `Cancel task` / `Keep it` 两颗按钮），暂停中的提案给出 `Held — press Resume to start it`
与 **`Resume`** 按钮，任务队列补了 `Queued — starting shortly` / `Queued — starts when the Mission
finishes`；连接器侧新增**「编辑连接」表单**（`Edit connection` / `Save connection` / `Server URL` /
`Working directory` / `Arguments (JSON array)` / `Saves to ` 与 `. Environment variables and headers
are preserved. …` / ` You may need to sign in again at the new address.`，标题是
`["Edit ", <名称>, " connection"]` 拼串）；模型目录新增 **`GPT-6.1 Sol`**（tagline `OpenAI flagship`），
给 `Muse Spark 1.3` 补了新徽标（`New: Meta's Muse Spark 1.3, 1M context, on every paid plan.`）与
`Falls back when busy`，`GLM 5.3 Flash` 挂上**限时促销价**（`Ending soon` / `Promotional · 1 session
a day` / `Deal ends Sep 30 · 15/hr after`）；侧栏新增**「需要输入」状态**（`Needs input` /
`${m} · Needs input` / `${m}${i?", needs input":…}`）与 `${t} ${t===1?"thread needs":"threads need"}
input` 计数标签。**上游把 0.0.152 刚上线的会话列表右键菜单整条删了**（`menu:threadContext` 与 preload 的
`threadContextMenu` 都不在了），更新对话框的六条旧文案、一条标注空间提示与两条旧模型 tagline 一并下线。

- **文案**：真新增 39 条（`exact` 35 / `template` 1 / `code` 3），下线 9 条，另有 9 条因上游改写、
  重压缩换了变量名而**原地迁移**（译文未动：`Project: ${f}` → `${h}`、`Remove ${Oe.configKey}` →
  `${Te.configKey}`、`([I,z])` → `([Q,z])`、`" code comment",f.length` → `,h.length` 等）。
  片段级 1480 → 1496 处（新增 24、下线 9、疑似改写 0 组），字面量级 2062 → 2091 条
  （新增 37，其中 15 条片段级没报到）。词典 1791 → 1821 条，替换总数 2162 → 2203、全命中。
- **通道拆分**：两条模板整条写进 `template` 会让片段级对差判成「未覆盖」（它按 key 剥掉插值后比对），
  按 0.0.152 的同款做法拆开——侧栏状态标签拆成三条 `exact`（`, needs input` / `, working` /
  `, unread update`），计数标签拆成两句 `exact` ＋ 一条 `code` 收掉插值后的 `} input`。
- **词典够不着的位置**：菜单项 `Delete` 被上游加了图标（值从 `children:"Delete"` 变成数组元素）、
  `["Edit ", <名称>, " connection"]` 是 children 拼串——`pattern` 只认第 0 层字面量，够不着，
  两处都改走 `code` 精确片段。
- **主进程**：`electron/` 37 个文件里 `main.cjs` / `preload.cjs` 变了——上游**删掉**了 0.0.152 的
  `menu:threadContext` 与 `threadContextMenu`，补丁里对应的那个 hunk 与 `tools/postbuild.js` 的
  `删除会话` 哨兵一并退场；其余 11 个补丁一次干净套用（补丁数仍 12，无需 reanchor / regen）。
- **UI 行为补丁**：两组仍判 `KEEP`——上游没碰流式序号与令牌缓存，探针在原版里都能复现、在产物里都能证伪。
- **登记表**：新增 5 条 fragments（`peak deal-ending` / `peak promotional` / `recommended new-model`
  三个 CSS 类名，与 API 路径 `/api/ad/proposal/ /cancel`、`/api/mcp/servers/ /connection`）
  与 1 条 uiStrings（模型名 `GPT-6.1 Sol`）。
- **四道发布闸门全绿**：主进程英文扫描 0 条疑似文案；回归闸门（对比 `pack-v0.0.152`）新版独有英文 0 处；
  单词级界面文案差集 0 处（本版初检报出的 5 处界面位置英文——`Cancel task` / `Resume` / `Delete` /
  `Edit ` / `${…} · Needs input`——已全部补翻；残留英文 14 → 13 条，均为品牌名 / 模型名 / 代码串）；
  字面量占用无冲突。
- **影响面**：`targetVersion` / `packVersion` 同时升到 0.0.153，已装 0.0.152 的机器按常规比较会自动拉到这一版。

## [0.0.152] · 2026-09-29（已发布 `pack-v0.0.152`）

上游这一版把**引导与余额这两块界面翻新了**：新用户会先过一套多步提问（`A few quick questions`，
带 `choose any` / `least to most` 两种题型提示、`Skip this question` / `Done — skip the rest` / `Skip all`
三种退出方式），设置页多出 **Permissions** 一节（说明智能体什么时候会停下来等批准，
以及 `Full access` 开关），侧栏余额卡从一句话拆成 **Daily / Wallet** 两行，
文案里的「余额」也一并改叫 **wallet**（`Your Freebucks wallet balance…` / `Freebucks wallet balance unavailable`）；
任务队列新增「本轮结束后暂停」与「标签页等待策略」两组文案（`Pause queue` / `Keep this tab open` /
`Close tab when done` / `Waiting for …` / `Restarts once you pause for a minute.`），
模型目录把 `Muse Spark 1.3 replaces Muse Spark 1.2` 的迁移提示搬到界面上。

- **文案**：真新增 45 条（`exact` 27 / `template` 10 / `code` 1 / `pattern` 7），下线 5 条，
  另有 11 条条目因上游改写、重压缩换了变量名而**原地迁移**（`${h?…}` → `${d?…}`、
  `lp(P.length,"item")` → `cp(…)`、`" code comment",h.length` → `,f.length` 等，译文未动）。
  片段级 1457 → 1480 处（新增 22、下线 3、疑似改写 4 组），字面量级 2026 → 2062 条。
  词典 1751 → 1791 条，替换总数 2117 → 2164、全命中。
- **通道问题**：`Could not save your answers.` 在 bundle 里是**模板插值内部**的字面量，
  整条写进 `template` 会让片段级对差判成「未覆盖」（它按 key 剥掉插值后比对）；
  拆成 `exact`（内层句子）＋ `code`（插值之后的 `} Carrying on anyway.`）两条，两通道都能看见。
  另有两条新增文案（`Permissions` 与整段 `Agents already edit files…`）因为**带分号**被字面量通道
  当成代码滤掉，只从 `uipos_gap` 那一侧报出来——两道体检互补，谁也不能少跑。
- **主进程**：`electron/` 37 个文件里 `main.cjs` 与 `preload.cjs` 变了，新增的是「会话列表右键菜单」这条 IPC
  （`menu:threadContext` ＋ `preload` 的 `threadContextMenu`），菜单里只有一项 **`Delete Thread`**（运行中禁用）。
  它进了 `patches/electron-main.cjs.patch`（补丁新增一个 hunk）与 `postbuild` 的 `MAIN_SENTINELS`；
  其余 12 个补丁一次干净套用，无需重锚定或 `regen`。
- **UI 行为补丁**：两组仍为 `KEEP`——上游没碰流式序号与令牌缓存那两处代码，探针在原版里都能复现、在产物里都能证伪。
- **四道发布闸门全绿**：主进程英文扫描 0 条疑似文案；回归闸门（对比 `pack-v0.0.151`）新版独有英文 0 处；
  单词级界面文案差集 0 处（界面属性位置残留英文 14 条，与上一版持平）；字面量占用无冲突。
- **影响面**：`targetVersion` / `packVersion` 同时升到 0.0.152，已装 0.0.151 的机器按常规比较会自动拉到这一版。

## [0.0.151] · 2026-09-28（已发布 `pack-v0.0.151`）

上游这一版是**安全加固 + 一处小界面**：orchestrator 现在要求**每个** `/api/` 请求都带 launch secret（以前只管写操作），
密钥除了经 IPC 交给渲染进程当请求头，还由主进程以 **HttpOnly cookie** 种进应用自己的 session，
好让 `EventSource`（`/api/events`）与终端 WebSocket 这类加不了请求头的请求也带上它；界面上侧栏多了一个 Discord 按钮，
设置里多了一句邀请。

- **文案**：真新增 3 条、下线 0 条——片段级 1455 → 1457、字面量级 2023 → 2026（其中 1 条片段级通道看不见）。
  `Want to talk to the team directly?` 与 `Join our Discord`（aria-label / tooltip 两处同一字面量）收进 `exact`，
  `` `Join ${…} people in our Discord` `` 收进 `template`；另有 13 条 `template` 因上游重压缩改了变量名，
  由 `tools/remap.js` 自动迁移（译文未动）。词典 1748 → 1751 条，替换总数 2113 → 2117、全命中。
- **主进程**：`electron/` 37 个文件里 `main.cjs` / `orchestrator-request.cjs` / `consent-window.cjs` 三份变了，
  改动都是安全加固的代码与注释（新增 `setLaunchCookie`），**没有用户可见文案**，12 个补丁一次干净套用。
- **UI 行为补丁**：两组仍为 `KEEP`——上游把 launch secret 的覆盖面从「写操作」扩到「所有 `/api/` 请求」，
  但**没有**修掉「渲染进程把令牌读一次就永久缓存」这个根因，403 自愈那组照旧需要。
- **四道发布闸门全绿**：主进程英文扫描 0 条疑似文案；回归闸门（对比 `pack-v0.0.150`）新版独有英文 0 处；
  单词级界面文案差集 0 处（初检界面属性位置英文 17 条＝上一版 14 条 + 本版 3 条新文案，补完词典后回到 14 条）；
  字面量占用无冲突。
- **影响面**：`targetVersion` / `packVersion` 同时升到 0.0.151，已装 0.0.150 的机器按常规比较会自动拉到这一版。

## [0.0.150] · 2026-09-27（已发布 `pack-v0.0.150`）

上游这一版是**两处收尾修复**：智能体被停止后偶尔一直挂住、停止一轮后上下文计量显示 0。
（官方没有 0.0.149 的 Windows 安装包，本包直接从 0.0.148 跳到 0.0.150。）

- **文案**：真新增 **0 条**、下线 **0 条**——上游一句用户可见文案都没动：片段级对差两边各 1455 处、
  字面量级两边各 2023 条，持平；`MISSED` 空、全命中 2113 处替换。
  唯一需要迁移的是 1 条 `template` 条目的插值变量名（`n.todos.filter(gDe)` → `n.todos.filter(vDe)`，任务队列那句 `… done`），
  由 `tools/remap.js` 自动改好，译文未动。
- **主进程**：`electron/` 37 个文件与 0.0.148 **逐字节相同**（快照逐文件 sha1 比对），12 个补丁一次干净套用，
  无需重锚定或 `regen`。
- **UI 行为补丁**：两组（`stream-epoch` 崩溃重启后那条回复永不完成 / `token-epoch` 换 launch id 后写操作 403）
  原版体检均为 `KEEP`——上游仍带着这两个缺陷，探针在原版里都能复现、在产物里都能证伪，产物侧行为取证通过。
- **三道体检全绿**：上游新增文案 0 条待补翻；回归闸门（对比 `pack-v0.0.148`）新版独有英文 0 处；
  单词级界面文案差集 0 处（界面属性位置残留英文 14 条，与上一版持平）。四道发布闸门全绿。
- **影响面**：`targetVersion` / `packVersion` 同时升到 0.0.150，已装 0.0.148 的机器按常规比较会自动拉到这一版。

## [0.0.148] · 2026-09-26（已发布 `pack-v0.0.148`）

上游做的是**把「更新」这一整块重写**：设置页新增 **Updates** 一节（版本号、检查更新、一行状态），
**整个「暂停更新」机制被删掉**（`updater.cjs` 里的暂停状态、`update:set-pause` 与它的两条报错全无），
更新卡片换成了一套新状态表（检查中 / 已最新 / 可用 / 下载中 / 待安装 / 安装中 / 失败 / 不可用），
顺带给赞助提案补了**连接账户**流程（`Connect and start`、`Open <广告主>`、卡片上的 `(Ad)` 标记）
与任务队列的几句状态文案（`Working on the current step` / `Waiting for the queue to resume`）。

- **文案**：真新增 62 条（`exact` 43 / `template` 17 / `code` 2），下线 47 条旧词条——最大的一坨是「暂停更新」面板
  （`Paused through ` / `App updates` / `Resume updates` 一族）与更新卡片旧状态表（`All up to date` / `Keep this version` /
  `Install and restart` / `Restart now` 等）；另有 69 条 `template` 因上游重压缩改了变量名，由 `tools/remap.js` 自动迁移（译文未动）。
- **主进程**：`electron/` 37 个文件里 `main.cjs` / `preload.cjs` / `updater.cjs` 三份变了；
  **`patches/electron-updater.cjs.patch` 整条退场**（补丁数 13 → 12）——它翻的两条报错随「暂停更新」机制一起被上游删掉，
  `tools/postbuild.js` 里对应的两条 `updater.cjs` 译文哨兵同步删除；其余 12 个补丁一次干净套用，无需重锚定。
- **非翻译改动**：`tools/semantic_guard.js` 的 `CONSISTENT_LABELS` 加入 `更新`——Updates 一节与 0.0.131 那批设置标签同构
  （同一张表里既做比较又做显示），整表替换才不会留下半截英文。
- **登记表**：新增 2 条「有意保留英文」——`/api/ad/proposal/ /connect`（`adProposalConnect` 的 API 路径）
  与 `noopener noreferrer sponsored`（赞助卡片的 `rel` 属性值）；两条都是代码串，不是给人读的界面文案。
- **三道体检全绿**：上游新增文案 0 条待补翻；回归闸门（对比 `pack-v0.0.147`）新版独有英文 0 处；
  单词级界面文案差集 0 处（界面属性位置残留英文 17 → 14 条）。四道发布闸门全绿。
- **影响面**：`targetVersion` / `packVersion` 同时升到 0.0.148，已装 0.0.147 的机器按常规比较会自动拉到这一版。

### 记一笔：`pattern` 短词会撞上「字面量占用」闸门的假阳性

Updates 那节的标题 `Version` 本该按惯例进 `pattern`（短词只翻界面属性位置），但 `tools/lint_collisions.js`
对 `pattern` 词条是按「字面量**包含**该词」判的（防的是 pattern 替换字面量内部子串那种情形），
而主进程那些未压缩文件里，提取器会把跨引号的代码配成**超长字面量**，`webContents.send(...)` 那段正好落在里面
——闸门于是报「IPC / 事件通道名」。实测 `node tools/apply.js updater.cjs` 替换次数为 **0**、逐字节无差异，是纯假阳性。
该词条改用 `exact`（整个产物里 `"Version"` 只有那一处，就是节标题）：`exact` 的判据是**整串相等**，不会被超长字面量沾到。

## [0.0.147] · 2026-09-25（已发布 `pack-v0.0.147`）

上游做的是**「时段到点后不再每次都问」**：设置页新增 **Sessions** 一节（说明 + 一个开关
「自动开启下一个会话」），额度用完弹出的那个询问框也多了一个「始终自动开启」按钮。

- **文案**：新增 7 条——`exact` 4 条（设置节标题 `Sessions`、开关标签、节说明句、
  `Turn off automatic starts in Settings → General.`）、`template` 2 条（保存失败提示、
  询问框里新出现的那句 `Sending starts a new hour of …`）、`pattern` 1 条（按钮 `Always start automatically`）；
  上游本版**没有下线任何文案**。另有 24 条 `template` 因上游重压缩改了变量名，由 `tools/remap.js` 自动迁移（译文未动）。
- **主进程**：`electron/` 37 个文件与 0.0.146 **逐字节相同**，13 个补丁一次干净套用，无需重锚定。
- **三道体检全绿**：上游新增文案 0 条待补翻；回归闸门（对比 `pack-v0.0.146.2`）新版独有英文 0 处；
  单词级界面文案差集 0 处。
- **影响面**：`targetVersion` / `packVersion` 同时升到 0.0.147，已装 0.0.146.x 的机器按常规比较会自动拉到这一版。

## [0.0.146] · 2026-09-25（已发布 `pack-v0.0.146` / 修正重发 `.1`、`.2`）

上游做的是**「就地赞助运行」（in-place sponsored run）**：接受赞助提案后不再另开分支，改动直接写进本项目文件夹、不提交，
交给用户审查或撤销；同时**把同意窗口整体重写**（新的 pill 按钮、`warn-mark`、`#more` 折叠区）。

- **文案**：新增 23 条 `exact`（赞助卡片与撤销流程的状态标签 `Before you keep it` / `Done — pull request merged` 一族、
  免费运行那组 `Free agent run`、两条长说明句、一条错误提示 `The conversation changed — try again`）与 2 条 `template`；
  下线 9 条旧状态标签（`Sponsored PR merged` 一族、`Start sponsored thread` 等，被上游的状态表取代）。
- **主进程**：7 条用户可见文案落在词典够不到的地方（`consent-window.html` 的 `IN_PLACE_SENTENCE` / `UNDO_NOTE`，
  `mcp-consent-bridge.cjs` 的赞助常量与三个按钮文案），两个补丁按 0.0.146 原文由 **`tools/regen_patch.js` 重生成**
  （上游在 hunk 中间改了缩进又整段重写，行号与计数交给工具算），补丁数仍 13。
- **影响面**：`targetVersion` 仍为 0.0.146、只升第四段；已装 `0.0.146` / `0.0.146.1` 的机器按四段比较会自动拉到 `.2`。

### 修正重发 `pack-v0.0.146.1`：窗口按钮区（— □ ×）的**图标色**也对齐页面

`0.0.146` 那版标题栏补丁只接管了底色（`--chrome`）与高度（`--tabbar-height`），`SHELL_THEMES.*.overlaySymbol`
仍是上游写死的 `#9a9aa0` / `#63636b`，而页面里图标用的是 `--faint`。现在 `HANHUA_SHELL_COLORS` 一并读 `--faint`
（同一套「同一选择器取最后一块」规则），`SHELL_THEMES` 两处 `overlaySymbol` 改为引用它；读不到就回落上游原值。

### 修正重发 `pack-v0.0.146.2`：按钮区不再盖住标签条底下那条线

`.tabbar` 底部有 `border-bottom: 1px solid var(--border)`，但右侧按钮区那一段看不见——原生 overlay 是主进程按
`titleBarOverlay.height` 从窗口顶部画的独立色块，压在渲染内容之上，高度与标签条相同时正好盖住那一行 1px 的线。
高度改为「标签条高度 − 标签条底部边框宽度」（从同一份 CSS 解析 `.tabbar` 的 `border-bottom` 宽度，上游以后改宽度也跟着变）。

## [0.0.145] · 2026-09-25（已发布 `pack-v0.0.145` / 修正重发 `.1`）

跟随上游自动更新连跨三版（0.0.143 / 0.0.144 / 0.0.145）。上游这三版只做了一件事：设置页新增**「应用更新」面板**
（把自动检查与下载暂停到你选的日期）；同时**删掉上一版刚上线的「降速与续费」提示面板**——于是这一版是「一边补、一边清死词条」。

- **文案**：新增 9 条（`exact` 4 条，含带尾随空格的 `Paused through `；`pattern` 5 条短标签 `App updates` / `Pause through` /
  `Resume updates` / `Change pause date` / `Pause updates`）；下线 12 条（「降速与续费」整块的死词条：
  `Slowed down.` / `Renew for` / `it covers` 等，含两条 `template` 与一条 `pattern`）；改写 1 条
  （`Your account, mobile sync, …` 里加了 `app updates`）。
- **主进程**：`electron/updater.cjs` 新增的 `update:set-pause` 有两条用户可见报错经 IPC 抛回渲染进程、词典够不着
  → 新增 `patches/electron-updater.cjs.patch`（补丁数 12 → **13**），并配译文哨兵。
- **非翻译改动**：窗口右上角系统按钮区**跟丢 UI 配色与高度**——上游 0.0.131 换了整套浅色配色（`--chrome` → `#edf1ee`）
  又把标签条压矮（`--tabbar-height` 60px → 48px）时只改了 UI 侧，主进程那张影子表（`overlay` / `titleBarOverlay.height: 54`）
  一路没跟着改，**英文原版同样错位、与翻译无关**。改为从 UI 的 CSS 里读这两个变量，读不到就回落当前这组值，不会比原版更糟。
- **影响面**：这处改动是在 `pack-v0.0.145` 发布**之后**才入仓的，所以修正重发为 **`0.0.145.1`**（`targetVersion` 仍 0.0.145，
  控制器按四段比较会自动拉到）。

## [0.0.142] · 2026-09-24（已发布 `pack-v0.0.142`）

上游界面只新增**两条**文案，人工活主要在主进程：新增 **COD-642 的 Windows 无沙箱提示**。

- **两条新文案**（都进 `exact`）：`offered-for-another-os`（赞助提案不是给这台机器发的）与
  `file_layer_unavailable`（这个驱动器上做不到把改动留在项目文件夹内）。
- **主进程**：`electron/` 里只有 `consent-window.html`（`.floor` 样式 + 页面自己的 `WINDOWS_FLOOR_SENTENCE`）与
  `mcp-consent-bridge.cjs`（`platform` 参数 + `SPONSORED_WINDOWS_FLOOR_SENTENCE` + `floorDisclosed` 回执）变了；
  上游刻意让两份拷贝逐字相同，译文照此**保持两份一致**。
- **补丁**：这两个补丁的 hunk 都被上游新插的行顶开（是「上游改写」不是行号漂移，`reanchor_patch` 救不了）→
  改为**从旧补丁提取「英文行 → 中文行」映射、套到「快照 + 词典」镜像后重新生成**，行号交给工具算。
  这条路径固化成 `tools/regen_patch.js`（`--broken` 只处理套不上的、`--from` 可叠加映射来源、默认试运行；自测进 CI）。
- **踩坑**：手工重写补丁时漏了赞助对话框的两条按钮文案（`? ['否', '是']` / `: ['取消', local ? '运行' : '连接'],`）——
  这类漏译不会让构建失败、只会让窗口里冒英文，是 `postbuild` 的 `MAIN_SENTINELS` 哨兵抓出来的。

## [0.0.141] · 2026-09-24（已发布 `pack-v0.0.141`）

**迄今最小的一次适配**：上游只新写了一句界面文案，主进程一个字都没动。

- **唯一的新文案**：`The sponsored task started, but its thread could not be opened`（接受赞助提案后打开那条新会话失败的兜底提示），
  按惯例收进 `exact`（全库仅 1 处），尾标点跟随原文。
- `electron/` 37 个文件与上一版**逐字节相同**，12 个补丁一次干净套用、无需重锚定；`ui/` 侧只有主 bundle 换了名字。

## [0.0.140] · 2026-09-24（已发布 `pack-v0.0.140`）

本机跨了 0.0.137–0.0.140 四个版本一次追上，也是**迄今最大的一次文案改写**。

- **Git 准备文案整段重写**（快照 → 首次提交、预览 → 摘要）：`Set up local Git to track changes. …` →
  `This folder needs local Git before sponsored work can start. …`、`Create a Git repository and commit a checkpoint, then recheck.` →
  `Recheck, and Freebuff can create a local Git repository with a first commit for you.` 等，**15 条 `exact` 因此下线**；
  `Review the initial snapshot. …` 那段还被拆成模板拼接句，旧词条同样下线、按新句重写。
- **三块新功能带文案**：上下文压缩（`Compacting context…` / `Context compacted`）、降速与续费提示（`Slowed down.` / `Renew for`）、
  改动列表的路径过滤与提案交互（`Filter changed files by path` / `Offered in another conversation. Start it from there.` /
  `Open pull request on GitHub`）。
- **模型目录**：新增 `Solar Mini 4`（作为 `Solar Pro 4` 的迁移目标）与隐身模型 `Space Bunny Alpha`；模型名按约定保留英文，
  只有那几句成句文案要翻。
- **两处「不该进 `exact`」的判断**：`dependencies` 在 bundle 里有 26 处子串、只有 1 处是界面标签，走 `code` 分区连上下文替换；
  `This project has too many files to summarize here (…)` 是单引号串（`too_many_files:'…'`），exact 不认、`pattern` 锚点也不匹配，同样走 `code`。
- **上游新增的英文复数助手 `sp()`**：5 个调用点全在本次要翻的文案里，中文量词会被渲染成「2 个文件s」；加一条 `code`
  把它的默认复数改成单数，中文量词才能直接当第二参用。
- **主进程**：`mcp-consent-bridge.cjs` 的补丁上下文正落在上游改掉的同一行，`reanchor_patch` 救不了，改用**三方合并**
  （base=0.0.136 原版 / ours=原版+旧补丁 / other=0.0.140 原版）重做正文并补上新的 `Uncommitted changes:`（做法记在 `docs/更新维护.md`）。
- **教训**：`Delete thread` 是组件属性 `action:"…"`，而 `action:` 不在 `ATTR_ANCHORS` 里，放 `pattern` 会在构建末尾以 MISSED 报错，改放 `exact` 才命中。

## [0.0.136] · 2026-09-23（已发布 `pack-v0.0.136`）

上游动的是**模型目录**与一条 Codex 更新回执。

- **模型目录换了一批**：新增 `Opus 5.5`（旧 `Opus 5` 下线但留了迁移映射），老模型数组里 `GPT-5.6-Sol` / `GPT-5.6-Luna`
  改名为 `GPT-6-Sol` / `GPT-6-Luna`，`gpt-5.6-terra` 整条删掉（`id.startsWith("gpt-5.6")` 的一律过滤）。
  模型名按约定保留英文，所以本版**真正要翻的新文案为 0**。
- **Codex 更新回执**：模板 `Codex updated — ${label} is ready to pick` 下线，改成字面量
  `Codex updated — model availability refreshed`（本版唯一新增的一条 `exact`）。

## [0.0.135] · 2026-09-23（已发布 `pack-v0.0.135`）

上游只做了一件事：**新增 `GPT-6 Luna` 模型**（跑在 OpenAI flex 容量上）。

- 模型目录多了 `displayName:"GPT-6 Luna"`，`tagline` 复用已有的 `Strong all-around`、推理档位也用既有标签，
  所以本版真正要翻的**只有它那条 tooltip**（`Runs on OpenAI flex capacity: …`）。
- 主进程只有 `shell-lifetime.cjs` 变了：socket 心跳从固定 1s 改成 `DEFAULT_PING_MS = 3000`（省电），
  新增代码只有注释与常量、无用户可见文案，`patches/` 无需改动。

## [0.0.134] · 2026-09-23（已发布 `pack-v0.0.134`）

上游动的是**项目侧栏**（可折叠、可拖宽）与侧栏上的余额小徽章。

- **新增文案**：`Expand left sidebar` / `Collapse left sidebar`、`Resize left sidebar`（aria-label）、
  `Projects · Open project`、`Not enough room left in the message for that skill`、`Confirm delete`。
- **上游把侧栏那批组件在 bundle 里重复打进了一份**（压缩短名不同），于是 `Dismiss notification` / `Project:` / `Close` /
  `Freebucks / hour` / `N pixels` / `Remove ${…configKey}` 各有两种形态 → 7 条词条按新形态改名，两份价钱 / 像素文案各补一条 template。
- `electron/` 仍是 37 个文件、没有新补丁。

## [0.0.133] · 2026-09-22（已发布 `pack-v0.0.133`）

上游只动了两块界面（任务输入框、附件菜单）外加一个平台 bug。

- **任务输入框**：「没填提示就排队」的拦截换成**长度上限**提示（`A mission can be at most ${…} characters`），
  选中某个任务时占位符换成 `Describe the mission — Enter runs the one selected below`。
- **附件菜单**：` Attach files or folder` / ` Upload images` 去掉前导空格并拆成三条（`Attach files` / `Attach folder`；
  macOS 才给「文件 + 文件夹」合并对话框）。主进程为此新增 `electron/attachment-dialog.cjs`（按平台给原生对话框的 `properties`）——
  **这正是 0.0.131 起实测到的「Windows 上只选得到文件夹」那个 bug 的修法**。
- **两条单词级文案**：侧栏会话选择器按「已打开 / 已关闭」分组（`Open` / `Closed`），设置面板多了 `Close settings`。
- **主进程**：`electron-main.cjs.patch` 的 `dialog:pickAttachments` hunk 因上游改了函数签名与 `properties` 行而失配，
  改掉那一行上下文后 `reanchor_patch.js --all --write` 重锚定 23 个 hunk（其余是文件前半段插了 `require` 造成的整体行号漂移）。

## [0.0.132] · 2026-09-22（已发布 `pack-v0.0.132`）

上游改动很小：**评价反馈**那一块重做，外加付费套餐徽标。

- **新增 12 条**（全进 `exact`）：`Rate this response` / `Good response` / `Bad response` / `What went wrong` /
  `Thanks — noted.` / `Thanks — that helps.` / `Could not send that. Try again.`、付费套餐徽标与墙
  （`Paid plan` / `Included with a paid plan.` / `See plans →`），以及单词级 `Send`。
- **登记一条有意保留的英文**：CSS 类名 `model-badge muted`（与 `streak-day on` 同类）。
- 顺带修掉提取器的「括号盲区」：带插入语的文案（如本版新增的 `What went wrong? (optional)`）
  以前在片段级与字面量级两条通道里都看不见。

## [0.0.131.1] · 2026-09-22（同版修正重发，已发布 `pack-v0.0.131.1`）

同一 `targetVersion` 内的修正重发：补上 19 条单词级 / 模板级漏翻，并把 0.0.131 适配里靠临时脚本、
肉眼挑、事后才发现的地方全部固化成**工具与闸门**（各自带 CI 自测）：

- 词典条目命中体检前置（`missed_diagnose.js`，`build.sh` 第 0b 步）：「词典条目必须能命中 UI bundle」
  以前要构建跑到第 4 步才以 MISSED 中止、提示方向还是错的，现在解包前就按「命中 / 只在主进程 / 只在上一版 / 两边都没有」报出来。
- 单词级文案差集（`uipos_gap.js`）：片段级要 ≥3 词、字面量级要 ≥2 词、`regress` 只认句子，
  `Settings` / `Theme` / `Reset` 这类单词文案三条通道全看不见；新工具做「本版产物 − 上一版产物 − 登记表」的差集。
- 字面量占用检查（`lint_collisions.js`）：`Cookies` 在主进程既是筛选器标签又是磁盘目录名，翻掉会让 Cookie 导入静默找不到文件——
  现在按「文件系统调用参数 / 比较位置 / IPC 通道名」三种形态直接失败。
- 补丁锚点预检 + 重锚定（`patch_preflight.js` / `reanchor_patch.js`）：分诊「行号漂移」与「上游改写」，前者一条命令修好。
- 「有意保留英文」仓库内可审（`intentional-english.json`）：以前只能发布时敲 `--allow-english`（一把全放行、仓库里没有记录），
  现在逐条登记、闸门会打印理由、登记项失效时提醒清理。
- 顺手修掉两处脚本真 bug：`release.sh` 闸门二结束就删临时目录，导致闸门三悄悄退化成「看全量」；
  `apply.js` 的幂等判据会把「同译文的兄弟词条」藏住的死词条当成已应用。
- **影响面**：`targetVersion` 仍 0.0.131、`packVersion` 追加第四段，控制器按四段比较会把已装 `pack-v0.0.131` 的机器判为「有新包可应用」。

## [0.0.131] · 2026-09-22（已发布 `pack-v0.0.131`）

**上游连跳三个版本（0.0.129 / 0.0.130 / 0.0.131），是本项目适配过最大的一次改动。**

- **上游新增**：终端分屏、任务（mission）与技能选择器、项目预览、网页标注，以及一整套**浏览器子系统**
  （Chrome / Edge / Arc / Safari 的 Cookie 导入、原生浏览器窗口、页面录制、视口预设）；
  设置页从一页重构成 `General / Appearance / Connectors / Projects / Skills / API Providers` 导航。
- **汉化**：词典大扩容（exact 1297 / template 230 / code 14 / pattern 67，替换总数 1929）；
  新增四份浏览器相关补丁（浏览器权限 / 导入 / 文件选择对话框、右键菜单 `Inspect element`、录制的用户可见报错）；
  `electron/` 新增 6 个文件（`browser-cookies.cjs` / `browser-import.cjs` / `browser-native.cjs` / `browser-preload.cjs` / `browser-recorder-preload.cjs` / `browser-recorder.html`）。
- **14 条单词级新文案**（`Settings` / `Projects` / `General` / `Missions` / `Theme` / `Reset` / `Width` / `Height` /
  `Availability` / `Browser` / `System` 与 3 条设备预设）是属性位置体检报出来的；设置页那组既是比较用的 id 又是显示文案，
  按「整体一致替换」处理（同一常量在 bundle 里一起换掉，比较与显示都跟着走）。
- **踩坑记录（下次别再犯）**：词典条目**必须能在 UI bundle 命中**（`build.sh` 对 UI 侧 MISSED 是硬失败），
  所以「只在主进程出现」的文案只能写成补丁——这一版先把 38 条浏览器子系统文案塞进 `dict.json`，构建在 UI 侧 `MISSED (38 keys)` 中止后才拆开；
  `Cookies` 还是 `browser-import.cjs` 里的**磁盘路径后缀**，进词典会让导入找不到文件，只能留给补丁只改筛选器那处。

## [0.0.128] · 2026-09-21（已发布 `pack-v0.0.128`）

上游把**「非高峰时段定价」的说明整段收窄**（返回对象的 `detail` 字段直接删掉、tooltip 从三句砍到一句），**没有新写任何文案**。

- **改写 1 条**：`Off-peak: … The price at session start is locked for the full hour.` → `Off-peak: ${r.price} Freebucks/hour, daily ${f}.`。
  变量名一个没改，所以 `remap` 报的是 **MISSING** 而不是 **RENAMED**——这正是「上游整段重写」与「minifier 改名」的区分点。
- **下线 3 条死词条**：两条 `detail` 模板，与 exact 里的 ` Your first-tab discount is also included in the displayed price.`。
- `electron/` 下 30 个文件与 0.0.127 **逐字节相同**（`patches/` 无需改动），`index.html` 只是换了 bundle 文件名。

## [0.0.127] · 2026-09-20（已发布 `pack-v0.0.127`）

上游**没有新写任何界面文案**（片段级 1515 vs 1515、字面量级 1966 vs 1966 全等，`electron/` 30 个文件逐字节相同），
本轮的活几乎全在验证侧。

- **真正要翻的只有一条含分号的新句**：`Can't reach Freebuff's servers on this network — try another connection; turns resume when it's back`
  （离线条幅的 `api_unreachable` 分支，0.0.126 已翻好的 `No internet — turns resume when you reconnect` 是它的兄弟分支），收进 `exact`。
  含 `;` 的字面量在两条对差通道里同时不可见，它是盲区扫描的「两边都有」桶报出来的。

## [0.0.126] · 2026-09-19（已发布 `pack-v0.0.126`）

上游给会话加了**「上下文压缩」**（`POST /api/thread/<id>/compact`，入口在 token 用量弹层里的一个 quiet 按钮、只对 codebuff harness 显示），
另加了一个 Discord 状态开关。

- **新增 8 条**：`Compact`（短标签，进 `pattern`）、`Compacting…`、`Compact context`、`Available once this turn finishes.`、
  `` `Compacted · ${…} → ${…}` ``（模板）、`Nothing older to condense yet.`、`Could not compact this thread.`，
  以及带前导空格的 `" Show in Discord status"`（图标与文字之间的分隔，空格连同收进 `exact`）。
- **改写 2 条**：`resets in ${…}` 随 remap 迁移（同一句骨架在 bundle 里命中 3 处、插值不同，人工比对后改名）；
  「首个标签页折扣」长句里 `shared across Desktop and CLI` 被上游改成 `shared across Web, Desktop and CLI.`，译文同步加「Web、」。
- **新主进程文件 `electron/discord-presence.cjs`**：把状态推到用户 Discord 个人资料上，主进程侧三句是用户可见文案、词典够不着
  → 新增对应补丁（`Agent at work` / `Coding with Freebuff` / `Get Freebuff`；`large_text` 的 `Freebuff` 是品牌名，保留英文）。

## [0.0.124.1] · 2026-09-19（同版修正重发，已发布 `pack-v0.0.124.1`）

**起因是一次实测复现**：装机是中文，界面却报「无法打开标签页: forbidden」。

- **根因**：写操作要求请求头 `x-freebuff-launch-id` 与 orchestrator 启动时拿到的值完全相等，而渲染进程把令牌**读一次就永久缓存**
  （读到 `null` 也缓存）。orchestrator 崩一次重启就会换一个新 launch id，此后的写操作全线 403、直到重载窗口——
  「开一个新标签页」本身就是一次写操作，所以它和「消息未发送」是同一个原因。
- **修法分两半**：① 渲染侧新增 UI 行为补丁 `token-epoch`——拿到 403 时丢掉缓存、**在同一次调用内**用新令牌重发
  （只重试一次，5xx 与网络失败不重试，不误伤）；② `apply.sh` 新增闸门「应用在跑就拒绝换文件」（`--force` 逃生），
  避免热换造成的「渲染侧已换、主进程仍是旧的」混合态；另加 `tools/forbidden_probe.js` 一条命令回答「这台机器现在 / 下次会不会再中」。
- **影响面**：这次改了产物，故按惯例修正重发为 `0.0.124.1`（`targetVersion` 仍 0.0.124），已装 0.0.124 的机器会自动更新。

## [0.0.124] · 2026-09-19（已发布 `pack-v0.0.124`）

上游新增**「非高峰时段定价」**与赞助邀请卡的**「验收 / 兼容状态」**。

- **新增 20 条**：非高峰徽标与三处 tooltip（含首个标签页折扣那句尾注）；验收状态表四个新标签
  （`Verified` / `Verification failed` / `Setup needed` / `Couldn't verify`）与「重新验证 / 修订已过期」提示；
  两条 aria-label 进 `pattern`；额度说明里的 `Unlimited messages and tool calls.`。
- **卡片标题是唯一需要倒装的一处**：上游把它拆成三个 JSX 子节点（`children:["Sponsored ",o.advertiserName," invitation"]`），
  中文语序得反过来，用一条 `code` 分区词条整段改写；同名的 aria-label 模板另加一条 template。
- 主进程经对差**零漏翻**、`patches/` 无需改动；新增模型 `Claude Fable 5.1` 按约定保留英文。
- **发布工具的一处静默跳过**：`release.sh` 原来用 `curl` 拉远端资产，而直连不通的网络里会超时并留下空文件——
  于是 packVersion 防呆读不到远端版本、闸门二直接打印「跳过」。两处都改用 `gh`（按 release asset id 读），curl 只作退路，
  且「取不到」时明确出声，与「远端就没发过包」区分开。

## [0.0.123] · 2026-09-18（已发布 `pack-v0.0.123`）

上游给赞助工作加了**「本地 Git 配置」这一整关**（兼容性检查前先做 Git 检查、审阅并批准初始快照），
提案卡片随之加了「账户配置 / 连接与验证」两步引导。

- **新增 65 条**（exact 57 / template 6 / pattern 2）、**下线 6 条**随上游改写的死词条：
  Git 配置卡的状态表 9 条、审阅流程（`Review the initial snapshot. Only files you select will be committed locally. …` /
  `Commit name` / `Commit email` / `Approve local Git setup` / `Check again` 等）、报错与结果
  （`Could not inspect Git. …` / `Setup was interrupted. …` / `Local Git snapshot created. …`）、
  「目录在已有的 Git 仓库里」那一组（`This folder is inside an existing Git repository.` 一族），
  以及提案卡上的三步引导（`Finish setup and verify` / `Before you merge` / `1. Review the code` …）。
- **三条改写的句子按新文重写**：`Freebuff will not initialize Git or install anything.` →
  `Git setup requires a separate file review and approval. Freebuff will not install Git automatically.`；
  `…needs a committed checkpoint…` → `This Git repository needs a reviewed initial snapshot.`（旧的短句仍在、保留）；
  `This project is not a Git repository yet. …` → `This folder needs a Git check before sponsored work can begin.`
- **顺带补翻两条从 0.0.120 起就没翻的连接器 setupNote**（Figma 与 Prismic 那两条含分号的长句）。
- 主进程经对差**零漏翻**、`patches/` 无需改动。

## [0.0.120] · 2026-09-17（已发布 `pack-v0.0.120`）

上游新增**「赞助式 Supabase 配置邀请」（schemaVersion 1）**整块界面、文件预览的磁盘 / 未保存状态说明，
以及额度说明里的「为什么有这个限制？」+ 国家 / 地区验证。新增 42 条、下线 1 条、2 条模板随压缩改名手工迁移。

- **赞助式 Supabase 配置邀请卡**：标题、`Prepare this project for Supabase ${…}.` 一族、兼容性说明两条、
  `Y$e` 映射表 11 条（`Freebuff couldn't read this project's package manifest…` 等）、
  按钮与加载态 `Recheck setup` / `Check compatibility` / `Rechecking…`。
- **文件预览状态**：`Disk version · unsaved edits preserved` / `Unsaved edits preserved` / `File preview · read-only` /
  `Back to edits` / `Couldn’t open this file in the main window.` / `This file isn’t available in this thread’s workspace.`。
- **额度说明与「限制访问」的出路**：`Why this limit?`、`Your allowance depends on your plan, country and network.`、
  30 天锁定的那段长说明、`Verify your country ↗`、`Loading verification link…`、额度菜单项 ` Country & allowance`。
- **顺带揪出并补掉一条真漏翻**：`` `Checking the installed ${t.label} CLI…` ``——它落在对象字面量的插值模板里，
  `uipos` 只看 JSX 属性位置、`mainscan` 只看主进程、盲区扫描只给得出截断到插值处的片段，于是长期被当成有意保留。
  **注意：已发布的 `pack-v0.0.120` 里没有这条修正**，要分发到别的机器需补发一个包。
- 主进程无需改动（`mainscan` 对差 0 条疑似漏翻）。

## [0.0.114] · 2026-09-16（已发布 `pack-v0.0.114`）

上游新增**「首个标签页折扣」（first-tab discount）的 4 条文案**：两条 tooltip（可用 / 占用中）与两条 agent 菜单行。

- `firstTabDiscount` 在 bundle 里共 16 处命中，按字面量去重后正好这 4 条，折扣没有别的界面文案。
- 主进程与 0.0.113 产物**逐字节一致**，`patches/` 无需改动。
- **新增两个工具**：`tools/upstreamdiff.js`（两版**英文原版**对差——「本版要翻什么」本来就不需要上一版汉化包，
  首次发布 / 离线也能用）与 `tools/pristine.js`（英文原版快照仓库，可跨机器搬：`capture` / `export` / `import`，
  含 `--from-release`；发布后自动附到 Release）。本版起 Release 多一个附加资产 `pristine-0.0.114.json.gz`。
- 说明：**`pack-v0.0.113` 从未发布**——上游当天就跳到 0.0.114，适配与发布合并成这一版。

## [0.0.113] · 2026-09-16（已发布 `pack-v0.0.113`）

上游把 **Freebucks 每日额度的说明整段重写**（新增 `eD()` 下次补充提示），赞助任务多了一条沙箱阻断原因。
下线 1 条、新增 9 条。

- **余额提示整句重写**：旧句 `… Spent before your wallet, and they do not carry over — refills in …` 变成
  `… Spent before your wallet; unused daily Freebucks do not carry over. ${eD(u,o)} Timezone changes apply after the next refill.`
  （插值函数由 `Ps(…)` 换成新的 `eD(…)`）；旧词条留着会卡 MISSED 门禁，已改写。
- **新增 `eD()` 一整套补充提示**（4 条 + 1 个常量）：`The daily refill is due. …`、`Check your daily reset countdown.`、
  带内嵌模板的「下次补充时间（你的设备时间）」、`` ` Reset timezone: ${…}.` ``（时区名是数据、不译）与余额环上的 `Updating balance…`。
- **入门卡片整段重写**（`Your daily Freebucks refill at midnight in your reset timezone. …`）。
- **赞助任务新增 1 条阻断原因**：`Sponsored tasks cannot start because the workspace sandbox is not working on this machine. …`
  （`containment-probe-failed` 分支；同一张表里其余四条 0.0.112 就已在词典里）。
- 主进程与 0.0.112 产物**逐字节一致**，`patches/` 无需改动。
- **顺带补翻主进程遗留英文（3 个文件、29 处）**：这批文案 0.0.112 之前就在、7 个补丁没覆盖到，
  而 `regress` / `uipos` / `blindscan` 都只盯 UI bundle——Bun 崩溃对话框整段（`Freebuff failed to start` 等）、
  标签页右键菜单与原生对话框（`Export as Markdown…` / `Move to New Window` / `Get Compatibility Build` / `All Images`）、
  启动失败对话框正文、`shell:openIn` 的六条报错、MCP 同意窗口的字段标签与按钮
  （`['No','Yes']` / `['Cancel', local ? 'Run it' : 'Connect']`、`Task:` / `Procedure:` / `Folder:` / `Branch:`）。

## [0.0.112] · 2026-09-15（已发布 `pack-v0.0.112`）

上游新增**「继续被中断的轮次」**与消息队列暂停态的一整组文案，BYOK 连接说明与 DeepSeek 限时促销 tooltip 被整段重写。

- **继续被中断的轮次**（回合被 orchestrator 崩溃打断后 composer 里出现的按钮）：`Continue the interrupted turn`
  （队列非空时用 `…, then run queued messages`）、`Continue interrupted turn`（aria-label）、`Continuing…`，
  以及点下去实际发出的 `Continue the interrupted request from where you left off.`。
- **消息队列暂停态整组重写**（旧的一组「Resume…」整句下线）：`Send now to go first, or resume the queue.`、
  `Send now, then run queued messages (Enter)`、`Add this message to the queue; keep the queue paused` 等；
  按钮本体 `Resume queue` / `Send now` / `Add to queue` / `Send message` 都在。
- **BYOK 连接说明改写 3 条 + 运行中提示 1 条**，DeepSeek 限时促销 tooltip 整段重写（旧的两条词条留着会卡 MISSED 门禁）。
- **其余新增**：`Project threads` / `Worktree` / `Customized Freebuff built-in · ${…}`；
  顺带补翻 1 条历史遗留（技能徐章的前缀一直是英文，旧词典只收了插值里的两个值）。
- **下线 9 条**（7 `exact` + 2 `template`）：`Resume`、`Send and resume queue (Enter)`、`Send message and resume queue` 一族。
- 主进程无需改动（`electron/*.cjs` 与 0.0.110 产物**逐字节一致**）。

## [0.0.110] · 2026-09-13（已发布 `pack-v0.0.110` / 修正重发 `.1`、`.2`、`.3`）

上游把整块**「会话退款」面板撤了**（合并成 composer 里的一句提示）、重写了推理档位标签；另顺带补翻 24 条历史遗留英文。

- **下线 19 条词条**（15 `exact` + 4 `template`）：`Retrying session end` / `Refund processing` / `Session refunds` 一族
  （留着会卡住 MISSED 门禁）。
- **推理档位四条标签整组重写**（`Sprint — what was asked, working, with essential proof` 等；`Crafted — …` 一字未动）。
- **新的退款提示是 JSX 文本节点拼出来的**（`children:["Session", … "from", …]`）：`uipos` 看不见模板插值内部、
  `pattern` 又只认第 0 层字面量，所以拆成 `code` 逐字片段 + `exact` 两半分则钉住。
- **顺带补翻 24 条历史遗留英文**（0.0.109 及更早就在，藏在 `children` 数组的三元分支、模板插值内部或函数默认值里）：
  连接器 / MCP 面板与目录的 setupNote、预览报错模板、购买时段与高峰定价 tooltip、「编辑一条消息」一族、移动端镜像状态；
  另修两处译文里残留的英文回退值（`new thread` → `新会话`、`unknown` → `未知`）。
- 主进程无需改动（0.0.110 只动了 `shell-lifetime.cjs` 的退出握手与版本号）。

### 修正重发 `pack-v0.0.110.1`：连接器目录漏翻

新工具 `tools/blindscan.js` 第一次跑就扫出连接器目录里的 setupNote 漏洞（Gmail / Calendar 两张卡上各一处），
按惯例把 `packVersion` 升到第四段重发——**已装 0.0.110 的机器才会自动拉到**，`targetVersion` 仍为 0.0.110。

### 修正重发 `pack-v0.0.110.2`：orchestrator 崩溃重启后写操作全 403

渲染进程把 `apiToken()` 读一次就**永久缓存**，而 orchestrator 每次重启都换新 launch id → 此后每个 `POST /api/*`
都被按 launch id 挡下（界面只显示「消息未发送: forbidden」），只读请求全部照常，看起来「应用没坏，就是发不出去」。
改法一行：`const launchId = apiLaunchToken ?? randomUUID()`（重启时沿用本次应用会话已发出的 id；
令牌依旧只经同步 IPC 交给本窗口、从不进 argv、也不发给上游）。

### 修正重发 `pack-v0.0.110.3`：被打断的那一轮回复永远不结束

回合内的流式序号由 orchestrator 持有、**每个新回合从 0 重新计数**，而渲染进程的守卫「序号不增就整条丢弃」
把新进程的低序号全挡掉，回复停在崩溃前的内容、`done` 永远不为真（composer 已解锁，看起来只是「卡住」）。
这是仓库里**第一处不是翻译的产物改动**，也是首次为 UI bundle 引入行为补丁机制（`tools/apply_ui_code_patch.js`）：
重连分支给未 `done` 的消息打 `streamSeq:-1`、守卫对 `-1` 放行、合并规则对 `-1` 保留本地内容。
补丁验收分三层：**锚点唯一命中 → 译文哨兵 → 行为取证**（第三层才是真的修好了）。

## [工程] · 2026-09-13

新增 **`tools/blindscan.js`**：把 0.0.110 适配时一次性用的「原版 vs 产物」对差脚本固化成正式工具，
接进 `update.sh` 的残留扫描，专治 `uipos` / `fieldscan` / `regress` 都够不着的那批英文
（`children:[cond?"A":"B"]` 三元分支、模板插值内部的字面量、函数默认值与赋值语句里的字符串）。
判据只有一条：片段在**原版里与引号相邻**、在**产物里原样还在** ⇒ 词典没碰过它。

## [0.0.109] · 2026-09-12（已发布 `pack-v0.0.109`）

**上游是纯 SDK 改动，界面文案零变化**——词典一字未改，只升版本重建。这是首次数得清「改了 0 条」的适配：
0.0.109 的渲染 bundle 与主进程 electron 文件与 0.0.108 **逐字节一致**，`dict.json` 无需增删。

## [0.0.108] · 2026-09-12（已发布 `pack-v0.0.108`）

本机自动更新从 0.0.106 直接跳到 0.0.108，所以 0.0.107 与 0.0.108 一起适配。

- **新增 9 条**（对话历史翻页 / 编辑较早消息，全新功能）：`pattern` 6 条属性位置
  （`Newer messages` / `Older messages` / `Return to latest` / `Return to latest messages` / `Conversation pages` /
  `Conversation outside the viewport — focus to read`）与 `exact` 3 条整句（`Could not load history` /
  `This history page changed. Return to latest and try again.` / 编辑横幅那句）。
- **主进程新增文件需要补丁**：0.0.107 起 asar 里多了 `electron/renderer-health.cjs`（渲染进程内存采样 + 崩溃恢复），
  它的 `showMessageBox` 弹窗是用户直接看到的（`Freebuff window stopped` / `This window ran out of memory.` /
  `Reload window` / `Close window`）→ 新增对应补丁，`postbuild` 加**可选哨兵**（老版本 asar 里没这个文件，缺失只警告）。
- 说明：`pack-v0.0.106` 未单独发布，本次直接从 0.0.105 跳到 0.0.108。

## [0.0.106] · 2026-09-11（已发布 `pack-v0.0.106`）

上游改 BYOK 提供商面板文案与会话状态标签，共 13 条词条改动；主进程与 0.0.105 **逐字节一致**。

- **新增 7 条**：BYOK 面板的两条说明（0.0.106 把 0.0.105 的两条提示合并成一句）、`Add or manage your API keys` /
  `Your keys · Your provider’s billing`、会话状态标签 `Hosted session slots are in use`，`pattern` 收 `Selected`；
  另顺带补齐一条 0.0.105 就存在的 BYOK 提示（旧词典没收）。
- **下线 6 条**（上游改写下线，留着会卡 MISSED 门禁）、改写 1 条；2 条 remap 歧义条目人工改名。

## [0.0.105] · 2026-09-11（已发布 `pack-v0.0.105`）

上游 BYOK 面板微调 + 新增两条 Freebucks 付费提示，共 11 条新词条；主进程与 0.0.104 **逐字节一致**。

- **新增**：`Provider setup ↗` / `No providers found. Try “Custom”.` / `Search providers…` /
  `Preset only. Your model’s coding support still needs testing.` 与两处 aria-label（走 `pattern`）；
  Freebucks 提示两条（含一条带前导空格、与金额前缀拼接的）；两条 paywall 确认分支模板。
- **下线 2 条**：`One key, many models` / `OpenAI-compatible API`（上游不再用这两句宣传语）。

## [0.0.104] · 2026-09-11（已发布 `pack-v0.0.104`）

上游新增**「自带密钥（BYOK）API 提供商」整块界面**，共 75 条新词条。

- **BYOK 界面全量中文化**（设置页入口 + 提供商管理弹窗 + 模型选择器里的分组）：
  表单（`Provider` / `Base URL` / `Model ID` / `API key` / 上下文窗口与输出上限）、
  列表与操作（`Add provider` / `Check connection` / `Replace key` / `Remove provider` / `Keep provider`）、
  模型选择器分组（`Your models. Your provider account.` / `Direct to your provider. Billed to your account.`）、
  反馈与模板（`Credential verified. Coding support is still untested.` / `` `New API key for ${…}` ``）与全部 aria-label。
- **补齐三处 0.0.103 就存在的历史漏翻**（额度环 label、两条通知 / 移除词条的插值名），
  4 条以未闭合 `${条件?` 结尾的「半截模板」词条按新 bundle 逐字回填。
- **模型名保留英文**（`GPT-6-Astra` / `GPT-5.6-*` / `Opus 5` / `Sonnet 5` / `Fable 5.1`），`tagline:"0 Freebucks"` 品牌词同样保留。
- 主进程与 0.0.103 **逐字节一致**，`patches/` 无需改动。

## [0.0.103.2] · 2026-09-11

**补齐 connectors / MCP 面板**——面板各层文案 + 目录里 100 条第三方连接器介绍，共 217 处替换。

- **根因是 `pattern` 分区的匹配形态太窄**：状态标签几乎都长在三元分支
  （`label:t.status==="idle"?"Ready when needed":"Disconnected"`）或压缩后的默认参数里，
  旧实现只认「锚点紧跟字面量」，于是整片漏翻。`pattern` 改成扫描式匹配四种形态（含模板插值内部），
  并把 `actionLabel` 纳入锚点。
- **`pattern` 补上 MISSED 上报**：零命中的词条以前静默放过（实测长期躺着 31 条死条目），
  现在会像 exact / template 一样列进 MISSED 并让构建失败。
- **`Connected` 走 `code` 分区整体一致替换**：它既是状态标签的生成值、又被用于过滤「已连接」列表，
  只翻生成处会让过滤器失配（`semantic_guard` 因此新增 `CONSISTENT_LABELS` 白名单，
  只放行「本进程内派生的展示标签、不写盘 / 不发请求 / 不跨进程」这一类）。
- **新增 `tools/fieldscan.js`**：按字段列出仍是英文的条目——100 条目录介绍正是因为 `description:`
  不在 `uipos` 的锚点里才长期无人发现。

## [0.0.103.1] · 2026-09-11（同版修正重发）

修复两处被用户回报的短标签漏翻（「files 和 delete 没汉化」）：资源管理器标签 `Files`（此前根本没有词条）
与删除确认按钮 `Delete`（它在产物中以三元分支 `children:…?"Delete":"Restore"` 与默认参数 `confirmLabel:n="Delete"`
两种形态出现，旧匹配够不着）；顺带修掉同机制的「@ 提及」菜单分组标题与技能弹窗的「删除 / 恢复」。

- **影响面**：`packVersion` 升为 `0.0.103.1`（`targetVersion` 仍 0.0.103）。这是首次实践「同一 Freebuff 版本内修正重发」
  的第四段约定——控制器按四段比较，已装 0.0.103 的机器会看到「有新包可应用」并自动拉取；
  此前同号重发只能 `--force`，且已装机的机器拿不到修复。

## [工程] · 2026-09-11

**「半截模板」键不再靠人工发现**：词典里有 4 条以未闭合 `${条件?` 结尾的 template 键（外层模板里内嵌模板三元的写法），
`remap.js` 旧实现遇到花括号不闭合直接判为不可解析 → **永远落 MISSING**，变量改名只能人肉抄一遍。
现在末段未闭合的插值记成 partial 表达式、跟着 minifier 改名自动迁移；`lint_dict.js` 新增 **E5**：
这类键只有在 template 分区、译文逐字节复现同一尾巴、且英文骨架登记在 `TRUNCATED_TEMPLATE_ANCHORS` 时才放行，否则硬错误。

## [0.0.103] · 2026-09-11（已发布 `pack-v0.0.103`）

装机从 0.0.101 直升（没有 0.0.102 的包）。

- **补翻新增模型文案 11 条**：0.0.103 的模型选择器从 10 个模型扩到 21 个，新增 9 个——
  tagline（`Smart & Fast` / `Fastest` / `Strong all-around` / `1M context` / `Unlock by referring friends` /
  `Novita route — evaluation only` / `Via CrofAI` / `Queues, then falls back`）与数据使用、限速提示；
  模型名（DeepSeek V4.1 Flash / MiniMax M3 / Gemini 3.8 Flash / GLM 5.2 / Kimi K3 等）按约定保留英文。
- **补翻 Freebucks 钱包 / paywall 文案 8 条**（其中 5 条是本次版本变更引入的）：套餐升级文案与模型套餐提示
  （嵌套模板，逐段词条）；另修掉一条**回归**——付费时长提示被 minifier 改名后只剩一条词条，
  而新版把两种变体合到了同一句，`remap` 只覆盖到其中一种，导致该句变回英文。
- 顺带补齐同一界面历史上就未翻的三条。

## [0.0.101] · 2026-09-10（已发布 `pack-v0.0.101`）

- **新增 MCP 连接器界面文案**：`Add connector` / `Connect and choose tools` / `Search connectors` 收进 `exact`；
  `Connected` / `Choose tools` / `Needs approval` / `Needs sign-in` 收进 `pattern`。
- **`Connected` 从 exact 挪到 pattern（重要）**：0.0.101 新增了把 `"Connected"` 用作 `l.label==="Connected"` 比较的代码，
  全局 exact 会命中代码位置、被语义守卫拦下并直接让构建失败（`semantic-blocked`）；pattern 只作用于
  `label:` / `children:` 等界面属性位置，界面标签照常翻译、代码比较不受影响。
- **移除 19 条原文已不在 0.0.101 的词条**（本来就没匹配上，产物内容不变；删除后「防呆全命中」才恢复有效）。

## [工程] · 2026-09-10

- **下线服务器自动更新**：删除 `tools/autoupdate.sh`（无人值守流水线）、`docs/服务器自动更新.md`、
  `tools/notify.js` + `.notify.json.example`（失败告警）与 `tools/codex-fix.js`（流水线自修复）——
  版本适配起改走本地手动流程（`tools/update.sh` → 补 `dict.json` → `build.sh` → `apply.sh`，发布用 `release.sh`）。
- **精简 `tools/`（44 → 16 个）**：砍掉服务器自动化时代遗留的脚本（冒烟闸门、词典审计、翻译链路与一次性排查脚本），
  只留构建、版本迁移、找漏翻所需的那几个；`docs/` 两篇合并为 `docs/更新维护.md` 一篇。
- **词典对齐装机 v0.0.100（36 条失配词条）**：14 条只是 minifier 变量改名（从产物 bundle 重新提取真实模板并逐字自验证后回填），
  22 条原文已不在该版本（库内部报错、agent 提示词、已被官方改写的钱包文案）→ 移除；明细留档 `work/missed-0.0.100.json`。
  此后 `build.sh` 不再需要 `ALLOW_MISSED=1`。

## [0.0.92] · 2026-09-05（已发布 `pack-v0.0.92`）

- 复核新版文案：新增模型 `GLM 5.3 Flash` 是模型名、按约定保留英文，其余用户可见文案沿用现有词典——
  **本版无需新增可翻译文案**。

## [0.0.91] · 2026-09-05（已发布 `pack-v0.0.91`）

- **补翻新增界面文案**：赞助插播（`Sponsored break` / `Close sponsor break` / `Why this ad?` / `You can continue`）、
  限时模型试用（`Limited-time trial`）、会话 / 操作界面（`More actions`、新版队列计数、上下文用量、模型价格提示、赞助提案报错）。
- **修复动态错误模板译文**：恢复 `Could not update this sponsored proposal` / `Could not switch branch` 里的 `${...}` 插值，
  确保错误信息不会把表达式源码直接显示给用户。
- 工具链：`tools/apply.js` 先处理完整 template、再处理 exact 字面量（否则 `unknown error` 先被替换，模板就组不上）。

## [0.0.88] · 2026-09-05（已发布 `pack-v0.0.88`）

**额度系统全面改版：Freebucks 钱包**——会话购买从「次数」改成「每小时单价 + 每日 Freebucks 额度」，
补翻新额度 / 钱包 UI 全套约 40 处。

- 引导弹窗（`Meet Freebucks` 与四个要点卡）、额度环的 hint / status（含月度奖励与奖励到账两式）、
  模型选单价格文案（`/hr` 后缀等）、支付 / 状态按钮与标签（`Get more` / `Use wallet` / `Switch` / `Upgrade` / `Limited access`）、
  `Lower limits` 说明卡。
- 其他补翻：模型 tagline 改写、计划分享（`Copy plan` / `Copy plan as Markdown` / `Plan copied`）、
  `Attaching images needs the desktop app` 等。
- 修掉词典模板交互：两条含 `"unknown error"` 内联字符串的模板曾被 `remap` 误把键 / 值回写为英文，
  恢复为「exact 先跑、模板键用 `"未知错误"`」的既有约定。

## [0.0.87] · 2026-09-04（已发布 `pack-v0.0.87`）

**主进程「赞助任务（sponsored proposal）」新流程全面中文化**（v0.0.87 新增）。

- `mcp-consent-bridge.cjs` 的赞助确认对话框（`Run this sponsored task?` / 「否 / 是」按钮 / `wants to integrate itself into this project…`），
  顺带补翻 v0.0.86 即存在但漏翻的本地 / 远程连接器两段 explanation；`consent-window.html` 新增赞助布局
  （who / rest 双 span 拆分广告主名与句子，译文保留前导空格）；`main.cjs` 新增「附加图片」文件对话框。
- **渲染进程补翻 52 条新词条**：赞助提案 UI 全套（状态标题表、操作、默认 whyThis 与四种不可用原因、标签页徽标与提示模板）、
  预览元素选择 / 缩放、管理员审批、`Attach images` / `Markdown view` / `Source` / `Move to new window` 等。
- **结构变更迁移**：文件计数复数改成内联模板（` file${t===1?"":"s"}`）、`Agent changed ` 拼接改成模板词条；
  移除已下线的拖拽提示。

## [0.0.86] · 2026-09-03（已发布 `pack-v0.0.86`）

- **GLM 5.2 推荐活动整体改名为「高级会话 / 赏金（Bounty）」**：删除 8 条旧词条并补翻对应新文案
  （`Reward session unlocked` / `Earned sessions` / `Refer friends for more free sessions` /
  `Today’s premium sessions used` 等）；奖池标题里的 `GLM 5.2 promo` → `Bounty promo`，
  译文由「GLM 5.2 推广」更正为「赏金推广」。
- **标签页关闭交互重写**：旧的两条删除，改为状态化 label / tooltip
  （`Close tab when done` / `Closing this tab…` / `Click to cancel.` / `Couldn't cancel the tab close`）。
- 移除已下线文案两条。

## [0.0.84] · 2026-09-02（已发布 `pack-v0.0.84`）

- 本轮渲染 bundle 内容哈希不变，**变更全部在主进程 asar**：五份既有补丁与 0.0.83 逐字节一致，
  另**新增 `electron-open-in.cjs.patch`**。
- **补翻两条存量漏翻**（0.0.83 就存在、主进程单引号字符串词典覆盖不到）：「打开方式」右键菜单的 `Copy path`
  与打开失败的兜底 toast `Could not open that path`；渲染端配套两条 template 同步补翻。

## [0.0.83] · 2026-09-02（已发布 `pack-v0.0.83`）

- **补翻 0.0.83 新增文案 2 条**：应用内更新日志面板标题 `What's new` 与其 aria 标签；
  模型列表新英文 tagline 与 0.0.82 译文逐字相同、无需新增。

## [0.0.82] · 2026-09-02（已发布 `pack-v0.0.82`）

- **补翻 0.0.82 重写的用量面板与限额提示条**（新增 30 条、删除 3 条失效词条）：额度环 hint 六连、
  面板标题与状态行（`Free sessions are used first · today resets in …` 等）、限额提示条与 CTA（`Get more sessions` / `See plans`）、
  关闭与 toast 的 aria、状态标签与环 label。
- **防呆加固**：`build.sh` 对 UI bundle 构建日志断言 `all keys matched`——此前仅检查「替换次数 > 0」，
  死键（MISSED）不报错，本轮 `5-day limit reached` 死键正是靠这个新检查暴露的。
- **版本号规范调整**：packVersion 不再用 `x.y.z.1` 修复后缀、直接与 targetVersion 保持一致
  （曾短暂发布的 `pack-v0.0.82.1` 已删除，由 `pack-v0.0.82` 取代）。

## [0.0.79] · 2026-09-01（已发布 `pack-v0.0.79`）

- **新增文案翻译**：0.0.79 新增的 agent 工具按钮 label 21 条（`pattern`）+ guidance 使用说明 15 条（`exact`）。

### 词典修复版 · 2026-09-01（之二）

- **补翻 0.0.79 漏掉的一批用户可见文案**（新增 86 条、清理 9 条失效词条）：强度选择器 1–5 档悬浮提示、
  空空间 / 起步页、邀请页脚、Claude Code 运行时安装、应用更改（Apply）流程、技能编辑器、
  会话状态 / 通知、文件浏览器 / 差异、登录 / 提权 / 反馈 / 更新弹窗、终端无障碍播报与拖拽键盘操作提示。

## 工具链 · 2026-08-30

- **发布通道上线**：新增 `tools/release.sh`（打包 `output/` + 生成 `pack-manifest.json` + 发 GitHub Release），
  `build.sh` 给产物注入 `<meta name="hanhua-pack">` 版本戳；发布前对比远端 packVersion，未升版即拒绝（`--force` 才允许覆盖）。
- **免责声明调整**：从「仅限本机自用、勿公开传播」改为「面向已合法获取 Freebuff Desktop 的用户供个人自用，
  可经本项目 Release 渠道获取与分发（勿商用、勿移除声明）」；首个汉化包 `pack-v0.0.78` 发布。
- 多开控制器侧：每 30 分钟检查 pack Release，targetVersion 一致且 packVersion 更新时自动下载、
  SHA512 校验、解包（含 zip-slip 防护）到 `output/`。

## [0.0.78] · 2026-08-30（已发布 `pack-v0.0.78`）

- 装机目录无 `hanhua-backup-*`（备份链已断），本轮首次实战「无备份时回退用安装目录英文原版」的构建回退；
  主进程补丁全部干净套用。
- 词典迁移：`remap` 自动迁移 6 条 template 的 minifier 改名；1 条被判 AMBIGUOUS（锚文本在新 bundle 多义命中）
  人工核对确认仅是格式化函数改名，同步 key 与译文后全命中。

## 工具链 · 2026-08-29（之二）

- 修掉 `tools/remap.js` 里内嵌的原始 NUL 字节（分隔符写成字面 0x00 字节，GitHub 把该文件识别为二进制、
  不显示内容与 diff），改为等价的 `\u0000` 转义。
- **首次构建不再依赖备份**：`build.sh` / `tools/update.sh` 找不到 `hanhua-backup-*` 时自动改用安装目录当前的英文原版作 pristine，
  解决「先有 backup 还是先有 output」的鸡生蛋问题；安装目录已是汉化版且无备份（备份链已断）时明确报错，避免拿汉化产物当原版。
- `tools/apply_ui_patch.js` 补齐 MISSED 逐条报告（与 `apply.js` 对齐）。

## 工具链 · 2026-08-27

- **版本迁移自动化**：新增 `tools/update.sh` 一键流水线（重映射 → 构建 → 残留扫描 → 待办汇总）；
  `tools/remap.js` 按**英文锚文本**定位 template 词条、自动迁移 `${...}` 的 minifier 改名（RENAMED / AMBIGUOUS / MISSING 分类报告）。
- **构建防呆自检**（针对 0.0.70 补丁静默跳过、0.0.72 悬空模板崩溃两类历史事故）：补丁套用失败即中止、
  补丁后主进程 `node --check`、UI bundle 替换次数为 0 即中止；新增 `tools/postbuild.js` 断言 index.html 汉化标记与译文哨兵。
- **词典质量门禁**：新增 `tools/lint_dict.js` 并接入 GitHub Actions（另加工具脚本语法冒烟）。
- 小工具：`tools/status.sh`（装机 vs output vs 备份状态一览）、`tools/prune_backups.sh`（清理累积备份）。

## [0.0.77] · 2026-08-29

- **补翻新增 / 改写文案约 20 条**：用量窗口体系重做（5 天 / 月度窗口的状态说明与用量汇总行）、
  会话额度句式改写、闲置会话回收提示、GLM 推广卡标题改条件模板。
- 词典随 minifier 重命名更新：`remap` 自动迁移 29 条 template 变量名，7 条被上游改写的词条人工重建。
- 有意保留英文：用量窗口极简 label（`5-day` / `month`，避免子串误伤代码标识符）、模型名、编辑器与技术标识。

## [0.0.76] · 2026-08-27

- 13 条 template 的变量名随新构建重排（逐条核对 bundle 原文后更新，译文不变）。
- 补翻 4 条属性位置文案（`Locate folder…` / `Close this space` / 状态胶囊 `disabled` / `failed`）。

## [0.0.75] · 2026-08-26

- **产品改动较大**：归档 / 置顶、便签、工作摘要、首页线程目录等一批界面被移除或重写，
  约 87 条 `exact` + 54 条 `template` 词条随之移除（git 历史可找回）。
- 补翻新增 / 改写文案：新更新弹窗、登录第二步拆分（Claude Pro 套餐 / Codex + API key）、
  Spaces / None 标签、标签页 aria、会话配额与推荐文案、技能与连接器搜索、评论与队列。

## [0.0.74] · 2026-08-25

- **结构变更**：渲染 bundle 不再打包进 `app.asar`，改由 orchestrator 从 `resources/orchestrator/ui` 提供；
  `apply.sh` / `build.sh` 已适配新路径，安装目录改为 `@codebufffreebuff-desktop`。
- 补翻：空间菜单 aria、新建空间路径拼接、已关闭标签页空态与搜索无结果、关闭空间前未保存文件的确认、浏览器登录等待提示等。

## [0.0.73] · 2026-08-25

- 重新生成主进程补丁，适配新增的 `splash.cjs` 与菜单结构变化；启动页补丁改为保留每版 bundle / CSS 文件名，
  避免更新后加载旧资源。
- 补翻：空间（New space）及空间菜单、已关闭标签页、最近编辑文件、转到标签页、MCP 工具筛选的 `Safe only` 等；
  修复新版恢复英文的主进程退出确认、应用菜单、文件对话框、沙箱失败提示与 MCP 同意窗口。

## [0.0.72] · 2026-08-24

- 重新生成所有主进程补丁以适配结构变更；新增 `package.json`（`"type": "commonjs"`）解决 Desktop 目录的 ESM 冲突；
  `build.sh` 补丁级别 `-p2` → `-p1`，UI 补丁改用 `tools/apply_ui_patch.js` 直改（绕开 `.gitattributes` 的 CRLF 与 `git apply` 的兼容问题）。
- 补翻 `Open Project…` 菜单项、MCP 同意窗口按钮、consent-window.html 按钮、orchestrator 忙碌对话框详情等。
- **修复启动崩溃**：补丁替换悬空了原模板字符串，主进程抛 `SyntaxError: Unexpected template string` 无法启动；
  改为完整替换四行英文、末行保留反引号使 `${monitor}` 正常插值。

## [0.0.71] · 2026-08-23

- 重新生成所有主进程补丁（行尾统一 LF）；上游移除了标签页右键菜单的「Move to New Window」，
  菜单适配为仅剩 Rename Tab / Close Tab。

## [0.0.70] · 2026-08-22

- 重新生成 `patches/ui-index.html.patch`（新 bundle 名 + 混合行尾），**index.html 汉化首次真正生效**——
  旧 `build.sh` 在子目录执行 `git apply` 时补丁被静默跳过，`output/ui/index.html` 一直是英文。
- 修 `build.sh`：改为在仓库根目录执行 `git apply --directory=output`，去掉吞错误的 `|| true` 与重定向，
  词典 MISSED 现在会正常打印。
- 补翻约 60 处（标签页上限、登录第二步拆分、MCP 同意窗口、反馈对话框、文件浏览器提示、技能删除确认、更新弹窗等）；
  安装时自动备份原版到 `resources/hanhua-backup-<时间戳>/`。

## [0.0.68] · 2026-08-21

- **二次排查**：重新扫描渲染 bundle 与主进程，修复 58 处用户可见英文（词典增至 exact 607 / template 82 / code 4），
  复查后 bundle 与主进程均无用户可见英文残留。
- **项目重组**（为上传 GitHub）：新增 `build.sh`（原版 + 词典 + 补丁的可复现构建，对 v0.0.68 验证逐字节一致）
  与 `patches/`（词典覆盖不到的人工修改）；`apply-hanhua.sh` → `apply.sh`、`restore-hanhua.sh` → `restore.sh`；
  扫描中间产物移入 `work/`；补齐 README、LICENSE 与 `docs/`。
- 合规调整：README 补充免责声明，明确汉化产物仅限自用、不公开分发。

## [0.0.68] · 首次汉化

- 渲染进程约 720 处文案中文化（词典 exact 607 / template 82 / code 4 / pattern 3）。
- 主进程：启动页、应用菜单 / 标签页右键菜单、退出确认、文件对话框、编排器失败对话框、
  MCP 连接器同意窗口、Linux 沙箱失败提示。
- `apply.sh` / `restore.sh` 一键安装与还原，自动备份。

