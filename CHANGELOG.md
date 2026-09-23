# 更新日志

## [0.0.134] · 2026-09-23（已发布 `pack-v0.0.134`）

跟随上游自动更新到 0.0.134。这一版上游动的是**项目侧栏**（可折叠 / 可调宽的左侧栏）与侧栏上的余额小徽章：

- **左侧栏布局开关**：新增 `sidebar-layout-toggle` 按钮，`label:t?"Expand left sidebar":"Collapse left sidebar"`；
  分隔条改成带 `role:"separator"` 的可拖拽控件，`aria-label:"Resize left sidebar"`。
- **侧栏余额小徽章**（`sidebar-new-chat sidebar-balance`）：`aria-label` 是三元，左右两支分别是
  `` `${Qf(t.balance)} Freebucks` `` 与 `"Freebucks balance unavailable"`；`data-tooltip` 复用已有的
  「今日剩余 … + 钱包余额」那句，`children` 是徽章本身。
- **两条新的界面文案**：项目侧栏「打开项目」按钮的 `data-tooltip:"Projects · Open project"`；
  消息里插入技能芯片时的报错 `Not enough room left in the message for that skill`（与既有的
  `…for that suggestion` / `…for that element` / `…to quote that` 同族）。
- **一处整段改写**：移除项目的确认态不再用独立模板，而是内联成
  `` `${L===de?"Confirm delete":"Remove project"} ${ge}` `` —— 于是 `Confirm delete` 变成一条新的字面量，
  旧的 `Remove project ${ge}` 词条作废（已下线，`Remove project` 与 `Confirm delete` 由 exact 覆盖）。
- **上游把侧栏那批组件在 bundle 里**重复打进了一份**（第二份的压缩短名不同）：`Dismiss notification` /
  `Project:` / `Close` / `Freebucks / hour` / `N pixels` / `Remove ${…configKey}` 这些句子在本版各有两种形态。
  `remap` 因此报 6 条 AMBIGUOUS（锚文本在 bundle 命中 2 处且插值不一致）——它们**不是**歧义，是两份拷贝；
  逐条按新形态改名，并给两份价钱 / 像素文案各补一条 template（`` `${Math.round(f)} pixels` `` /
  `Regular price: ${ut} Freebucks / hour`）。`missed_diagnose` 首跑点名 7 条「只在上一版 UI 出现」，
  这正是那 7 条改名的条目（含 1 条真下线）。

对差账：片段级 1374 → 1379（新增 5）、字面量级 1924 → 1931（新增 7，其中 2 条片段级没报到，正是那两个单词级的
`Resize left sidebar` / 第二份 `N pixels`）；`electron/` 仍是 37 个文件、**没有新补丁**。

发布资产（`hanhua-pack-0.0.134.zip` / `pack-manifest.json` / `pristine-0.0.134.json.gz`），
四道闸门（主进程扫描 / 回归闸门 / 单词级文案差集 / 字面量占用）全过；线上包下载回来后独立哈希，
与本地包、与 manifest 声明三方一致：

```
sha512(base64) = 8Io7BD2bQKojX+b1h51MSc0w/ZeYEijr8DKFGnO70JUIV4D1mAQFTyCuyHMicA8bdkP+0PqHog9hu3Q62K4qSg==
```

- **词典补翻 7 条、改名 7 条、下线 1 条**：新增 exact 7 条（`Collapse left sidebar` / `Expand left sidebar` /
  `Resize left sidebar` / `Confirm delete` / `Freebucks balance unavailable` / `Projects · Open project` /
  `Not enough room left in the message for that skill`）与 template 3 条（`` `${Qf(t.balance)} Freebucks` `` /
  `` `${Math.round(f)} pixels` `` / `Regular price: ${ut} Freebucks / hour`）。exact 1316 → 1323 /
  template 237 → 239（共 1645 条），替换数 1967 → 1984、`all keys matched`、`missed_diagnose` 1645 条
  全部命中本版 UI bundle。
- **主进程补丁与 UI 行为补丁**：12 个补丁**一次干净套用**（本版没动补丁覆盖区，`reanchor` 无需介入）；
  两组 UI 行为补丁按 `ui_patch_status` 判为 `KEEP`（上游仍带着 stream-epoch 与 token-epoch 两个缺陷），
  产物侧 5/5 哨兵 + 两道行为取证照旧通过。
- **又揪出一条跨引号噪音（`regress` / `upstreamdiff` 共用的提取器）**：这一版新写的余额徽章把「属性表」摆在了
  两个模板之间——`` "aria-label":t?`${Qf(t.balance)} Freebucks`:"Freebucks balance unavailable","data-tooltip":t?`…` ``，
  模板分段通道于是抽出 `:"Freebucks balance unavailable","data-tooltip":t?`。它没有反引号、也没有 `void`，
  前三十几个字符还像句正常英文，于是稳稳进了「待补翻」，而**真正该翻的 `Freebucks balance unavailable`
  就贴在它旁边**。判据补上第 17 组：**引号紧贴逗号 / 冒号**（`,"` 与 `"\s*:`）——自然文案里逗号与引号之间
  总有空格（`He said, "hello"`）。依据仍是先量后改：四份 bundle（两版原版 + 两版产物）里符合这两条形态的
  片段各只有这一条，全是这种 JSX 属性表；真文案不会因此消失——同一条字面量在字面量级通道里照旧抽到
  （`test_upstreamdiff` 第 17 组把「旧口径会放行它」与「旁边的真字面量仍进待补翻」都钉住）。

## [0.0.133] · 2026-09-22（已发布 `pack-v0.0.133`）

跟随上游自动更新到 0.0.133。这一版上游只动了两块界面（**任务输入框**与**附件菜单**）外加一个平台 bug：

- **任务输入框**：原来「没填任务提示就排队会被拒」那条 `Enter a mission prompt before queueing` 被删掉，
  改成**长度上限**提示 `` `A mission can be at most ${up.toLocaleString()} characters` ``；在任务选择器里
  选中某个任务时，占位符换成 `Describe the mission — Enter runs the one selected below`（原来的
  `Describe what this mission should accomplish…` 仍在，是没选中任务时的分支）。
- **附件菜单**：` Attach files or folder` / ` Upload images` 去掉前导空格并拆成三条——`Attach files or folder`
  只在 macOS 给「文件+文件夹」合并对话框，Windows / Linux 拆成 `Attach files` / `Attach folder`。主进程
  为此新增 `electron/attachment-dialog.cjs`（按平台给原生对话框的 `properties`），`main.cjs` / `preload.cjs`
  跟着接线——这正是 0.0.131 起实测到的「Windows 上只选得到文件夹」那个 bug 的修法。
- **另外两条单词级新文案**：项目侧栏的会话选择器现在按「已打开 / 已关闭」分组（`Ce("Open")` / `Ce("Closed")`
  两个分组标签，两三个词，三条对差通道本来就看不见），设置面板多了关闭按钮标签 `Close settings`。

对差账：片段级 1468 → 1469（新增 4 / 下线 3 / 疑似改写 5 组——后两组都是压缩变量改名的噪音），
字面量级 1976 → 1980（新增 7，其中 3 条片段级没报到）；`electron/` 36 → 37 个文件（新增的
`attachment-dialog.cjs` 只有配置与注释、无用户可见文案，**不需要新补丁**）。

发布资产（`hanhua-pack-0.0.133.zip` 30,429,884 B / `pack-manifest.json` / `pristine-0.0.133.json.gz`），
四道闸门（主进程扫描 / 回归闸门 / 单词级文案差集 / 字面量占用）全过；线上包下载回来后独立哈希，
与本地包、与 manifest 声明三方一致：

```
sha512(base64) = md7D8MQI2scKZzCyY/EhAT7YEYVzTn8Q65yJ38KDlUoZ/o6rLm9BL2UiOHMrnuMtFW+f6sGmbYscS0YjSQFobA==
```

- **词典补翻 9 条、下线 3 条死词条**：新增 exact 8 条（`Attach files or folder` / `Attach files` /
  `Attach folder` / `Upload images`——前两条是原来带前导空格条目的改写，`Close settings` /
  `Describe the mission — Enter runs the one selected below` / `Open` / `Closed`）与 template 1 条
  （`` `A mission can be at most ${up.toLocaleString()} characters` ``）；下线的 3 条是
  `Enter a mission prompt before queueing` 与两个带前导空格的附件标签。exact 1311 → 1316 /
  template 236 → 237（共 1636 条），替换数 1961 → 1967、`all keys matched`、
  `missed_diagnose` 1636 条全部命中本版 UI bundle；重映射歧义 1 条人工改名：`Close ${te.label}` →
  `Close ${ee.label}`（remap 报「锚文本在 bundle 命中 2 处且插值不一致」，人工比对 `panel-tab-close`
  那处确认）——其余 53 条自动迁移。`Open` / `Closed` 是两三个词的短标签，`upstreamdiff`（≥3 词 / ≥2 词）
  与 `regress`（只认句子）都看不见，是 6b 步的 `uipos_gap` 报出来的。
- **主进程补丁**：`electron-main.cjs.patch` 里 `dialog:pickAttachments` 那个 hunk 失配——上游把处理函数签名
  改成 `(event, kind)`、把 `properties: [...]` 换成 `properties: attachmentDialogProperties(kind)`。
  改掉那一行上下文后跑 `node tools/reanchor_patch.js --all --write` 重锚定 23 个 hunk（其余是上游在文件
  前半段插了一行 `require` 造成的整体行号漂移），12 个补丁全部干净套用；产物侧哨兵与两道行为取证照旧通过。
- **又揪出一类静默失败：`uipos` 把「字符串里的 `label:`」当成界面属性锚点**。这一版新写的会话选择器分组键
  是 `` key:`label:${xe}:${R}` ``，锚点命中它之后 `valueTextAt` 会一路吞到下一个深度 0 的逗号，把后面 200
  字符压缩代码当成「`label` 的值」报成一条界面位置英文——而 `uipos_gap` 是发布闸门之一，于是它会**卡在一个
  根本不存在的文案上**；更麻烦的是两条真文案（`Open` / `Closed`）就藏在这条噪音后面，人眼扫一遍很容易直接
  跳过（本轮正是先把它们补进词典、噪音才单独露出来）。现在锚点必须是**属性名**（前一个字符是属性边界），
  顺带挡住 `k.label:`Open in ${k.label}`` 与 `n.children:[n]` 这类属性读取误报——实测 2.4 MB 的 bundle 里
  2372 处命中只挡掉 11 处，正例一条不少。新增 `tools/test_uipos.js` 自测（正例保留 + 两类误报挡住）并接进 CI。
- **又一类跨引号噪音不再进清单（`regress` / `upstreamdiff` 共用的提取器）**：这一版报完还剩下两条
  「待补翻短片段」（`` :P?` - -menu`:void 0, `` 与 `` :Xt?` - -menu`:void 0, ``）与两组「疑似改写」
  （`:void 0,"aria-activedescendant":Xt?`）。它们都不是文案：模板按「相邻反引号」逐段取，
  夹在两个模板之间的代码也会被当成一段；引号的重叠配对又会从某个 **闭引号**起读到下一个引号，
  抽出「压缩代码 + 模板尾巴」。判据补了两条（`CODEISH`）：**裸反引号**（自然文案里不会出现它，
  出现就说明这一片段跨了模板定界符）与 **`void`**（压缩产物里的 `undefined`，与 `typeof` /
  `instanceof` 同类）。实测四份 bundle：闸门口径下含 `void` 的片段 **0 条**、含反引号的 28 条
  **全是第三方库消息**（shiki / oniguruma / react-window 用反引号引用标识符那种，本来就按惯例
  保留英文）；宽口径下每一条跨引号片段都能在同一个集合里找到「不带反引号的孪生片段」（同一句
  文案的模板分段版），**不会让任何真文案从清单里消失**——`test_upstreamdiff` 新增第 16 组用例钉住
  这两条判据（含「旧口径会放行它」的对照，实测把判据还原后 4 项断言立刻变红）。
  由此 `intentional-english.json` 里那条 react-window 消息（`` The `smooth` scroll … ``）在提取阶段
  就被滤掉、永远不会再被报出来，已移除（不再需要登记）。
- 项目体检：回归闸门相对 `pack-v0.0.132` 未登记新增 0 处（220 vs 220——比上一版的 248 少 28 条，
  正是上面那批含反引号的第三方库消息，两边同步掉一样的数）；主进程英文扫描疑似文案 0 条；
  6b 步界面位置英文 17 → 17（扣除登记表 15 条后本版独有 0 处）；字面量占用 0 条；UI 行为补丁 KEEP
  （5/5 哨兵 + stream-epoch / token-epoch 取证通过）；残留扫描回到基线（`uipos` 17 条 / `fieldscan` 1 条 /
  `blindscan` 279 条）；`upstreamdiff` 小结：待补翻 0 条、疑似改写 0 组、下线 1 条（真被上游删掉的
  那句 `Enter a mission prompt before queueing`）。

## [0.0.132] · 2026-09-22（已发布 `pack-v0.0.132`）

跟随上游自动更新到 0.0.132。这一版上游改动很小（**评价反馈**那一块重做，外加付费套餐徽标），
对差账：片段级 1461 → 1468（新增 7 / 下线 0 / 疑似改写 0），字面量级 1964 → 1976（新增 12，
其中 5 条片段级没报到）；`electron/` 仍是 36 个文件、没有增删，12 个主进程补丁全部干净套用。

发布资产（`hanhua-pack-0.0.132.zip` 30,428,508 B / `pack-manifest.json` / `pristine-0.0.132.json.gz`），
四道闸门（主进程扫描 / 回归闸门 / 单词级文案差集 / 字面量占用）全过；线上包下载回来后独立哈希，
与本地包、与 manifest 声明三方一致：

```
sha512(base64) = AVn95mkystlrpVc4h1eVNLi//iQrF9U5bLbNgX7VkKSqNYNO+/THnLqoS+wn6t9Z07Baezcrk+vPi3TOUzM1KA==
```

- **词典补翻 12 条**（全部进 `exact`，exact 1299 → 1311）：评价反馈那一套
  （`Rate this response` / `Good response` / `Bad response` / `What went wrong` /
  `Thanks — noted.` / `Thanks — that helps.` / `Could not send that. Try again.`）、
  付费套餐徽标与墙（`Paid plan` / `Included with a paid plan.` / `See plans →`），以及那个
  `Send` 按钮（单词级，由 6b 步的 `uipos_gap` 报出来）。替换数 1960 → 1961、`all keys matched`；
  `missed_diagnose` 1630 条词条全部命中本版 UI bundle；待补翻 0 条——`upstreamdiff` 的小结仍会列
  1 条，那是已登记的 CSS 类名 `model-badge muted`（当时该工具不读登记表——这一轮之后已拉平：现在也读，见下）。
- **修掉提取器的「括号盲区」**（`tools/regress.js`）：括号以前一律当代码符号，于是**带插入语的文案
  在片段级与字面量级两条通道里都看不见**——本版新增的反馈框占位符 `What went wrong? (optional)`
  就是这么漏的（12 条清单里它是最后才由 `uipos` 的属性位置体检报出来的）。现在只有「紧贴标识符」
  的括号才算代码（`fetch(url, (opts))` 照旧拦住），并钉了 4 条自测断言（含这条真实文案与函数调用
  的对照）；`test_upstreamdiff` 从 13 组用例扩到 14 组。
- **登记一条有意保留的英文**：`model-badge muted`（CSS 类名组合，就在 `Paid plan` 徽标那段，文案
  本身已翻）进 `intentional-english.json` 的 fragments，与 `streak-day on` 同类。
- 项目体检：模板变量重映射 0 条 / 歧义 0 条；回归闸门相对 `pack-v0.0.131.1` 未登记新增 0 处；
  6b 步界面位置英文 16 → 15（`Send` 补翻后本版独有 0 处）；主进程英文扫描 0 条；字面量占用 0 条；
  UI 行为补丁 KEEP（5/5 哨兵 + stream-epoch / token-epoch 取证通过）。

## [0.0.131.1] · 2026-09-22（已发布 `pack-v0.0.131.1`）

同一 `targetVersion`（0.0.131）内的修正重发：补上 19 条单词级 / 模板级漏翻，并把 0.0.131 适配里
靠临时脚本、肉眼挑、事后才发现的地方全部固化成**工具与闸门**（各自带 CI 自测）。
`targetVersion` 不变、`packVersion` 追加第四段，控制器按四段比较会把已装 `pack-v0.0.131` 的机器
判定为「有新包可应用」并自动拉取。

发布资产（`hanhua-pack-0.0.131.1.zip` 30,427,232 B / `pack-manifest.json` / `pristine-0.0.131.json.gz`），
发布时四道闸门（主进程扫描 / 回归闸门 / 单词级文案差集 / 字面量占用）全过；线上包下载回来后独立哈希，
与本地包、与 manifest 声明三方一致：

```
sha512(base64) = ogzMscUMSTJzk+a1DvV9100fd6TSco7m/JC7+0zaMig09uBOppDOMnwNzUzWkjXJ2cckvIKGrxacJiv6as9Xsg==
```

- **词典补翻**：`uipos_gap` 第一次跑就揪出 19 处单词级 / 模板级漏翻（exact +9 / template +6 /
  code +1 / pattern +1）；同时清掉 7 条被「同译文的兄弟词条」藏住的死词条（`Resume the queue` /
  `The queue is paused.` / `Get more sessions` / `Created` …，`apply.js` 的幂等判据一并修正，见下一条）。
  构建后 `uipos_gap` 回扫本版独有 **0 处**，回归闸门 238 vs 238 新增 0 处。
- **词典条目命中体检前置**（`tools/missed_diagnose.js`，`build.sh` 第 0b 步）：以前「词典条目必须能在
  UI bundle 命中」是个隐式约束，38 条主进程专属文案要构建跑到第 4 步才以 `MISSED` 中止，提示方向
  还是错的。现在解包前就按「命中 / 只在主进程 / 只在上一版 / 两边都没有」四类报出来，并说清该往
  词典还是补丁补。
- **修好 `remap.js` 的模板捕获**（`tools/test_remap.js` 那 10 项失败）：`STRICT_CAP` 忘了 `${…}`
  外壳所以永远命不中，实际全靠惰性捕获兜底，而惰性捕获在相邻插值（`${a}${b}`）处会把边界切错。
  两种捕获形态已钉成显式回归用例，真实 bundle 仍是 230 SAME 无回归。
- **单词级文案盲区**（`tools/uipos_gap.js`）：片段级要 ≥3 词、字面量级要 ≥2 词、`regress` 只认句子，
  于是 `Settings` / `Theme` / `Reset` 这类单词文案三条通道全看不见。新工具做「本版产物 − 上一版
  产物 − 登记表」的差集，接进 `update.sh` 6b 步与 `release.sh` 闸三；第一次跑就揪出 19 处漏翻
  （已补进词典，回扫本版独有 0 处）。
- **字面量占用检查**（`tools/lint_collisions.js`）：`Cookies` 在主进程既是筛选器标签又是磁盘目录名，
  翻掉会让 Cookie 导入静默找不到文件。现在按「文件系统调用参数 / 比较位置 / IPC 通道名」三种形态
  直接失败，并对跨文件复用的字面量标注位置形态（`数组元素` / `键值` / `调用参数`）；只扫字面量位置，
  不用 `includes()` 扫全文（`discordEnabled` 之于 `Enabled` 那类假阳性已被自测钉住）。
- **补丁锚点预检 + 重锚定转正**（`tools/patch_preflight.js`、`tools/reanchor_patch.js`）：上游在补丁
  覆盖区前插几行就会让后面所有 hunk 的行号整体偏移，`git apply` 报「未干净套用」——但「行号漂移」
  与「上游改写」的处置完全不同。现在逐 hunk 分诊：漂移一条命令重锚定（只改 `@@` 头、幂等），
  改写则明确要求人工重维护。目标文本用「快照 + 词典」镜像，与 `build.sh` 打补丁时的状态一致
  （直接比对英文原版会把上下文带中文的 `consent-window.html` 误判成上游改写）。
- **「有意保留英文」仓库内可审**（`intentional-english.json`）：以前唯一的办法是发布时敲
  `--allow-english`（一把全放行，放行了什么、为什么，仓库里一行记录都没有），现在逐条登记、
  闸门会把理由一并打印、登记项失效时提醒清理；`--allow-english` 退回临时排障用途。

CI 新增五道自测：`test_missed_diagnose.js`、`test_regress.js`、`test_uipos_gap.js`、
`test_lint_collisions.js`、`test_patch_preflight.js`（连同修好的 `test_remap.js`，本地 15 个自测
全绿）。另外顺手修了两处**脚本真 bug**：`release.sh` 闸门二结束就把临时目录删了，导致闸门三拿到
失效的上一版包路径、悄悄退化成「看全量」；`apply.js` 的幂等判据以「本次运行写进去的译文」为凭据，
同译文的兄弟词条会把死词条藏起来。

**这些闸门现在也跑在 PR 上**（不影响产物，故不需重发）：`.github/workflows/ci.yml` 新增
`snapshot-gates` job — 先从我们自己的 Release 取本版英文原版快照（`pristine.js import --from-release`，
`pristine.js` 的取数同时支持 `GITHUB_TOKEN`，免得在 CI 共享出口 IP 上吃匿名 API 限额），再跑
`tools/ci_gates.sh` 里的三道：字面量占用 / 补丁锚点预检 / 单词级界面文案。它们不需要装 Freebuff、
不需要解 `app.asar`，所以能在 PR 阶段就把「词典把代码里的值翻了」「补丁锚点漂了」「新加的单词标签
没登记」拦下；本版还没发过 Release 时打 `::warning::` 并 rc 0（本地 `update.sh` 6b 步与 `release.sh`
闸三 / 闸四 上的同名闸门用真实产物，仍是最终把关）。`tools/test_ci_gates.js` 专钉两类自骗：闸门失败
却 rc 0（假绿灯），以及拿不到快照时跳过路径冒充通过。



## [0.0.131] · 2026-09-22（已发布 `pack-v0.0.131`）

**上游连跳三个版本（0.0.129 / 0.0.130 / 0.0.131），是本项目适配过最大的一次改动**：终端分屏、任务（mission）与技能
选择器、项目预览、网页标注，以及一整套**浏览器子系统**（Chrome / Edge / Arc / Safari 的 Cookie 导入、原生浏览器窗口、
页面录制、视口预设）；设置页从一页重构成 `General / Appearance / Connectors / Projects / Skills / API Providers` 的导航。
对差账（英文原版 vs 英文原版）：片段级 1512 → 1430（新增 108 / 下线 183 / 疑似改写 17 组），字面量级 1963 → 1917
（新增 207，其中 95 条片段级没报到）；`electron/` 新增 6 个文件（`browser-cookies.cjs` / `browser-import.cjs` /
`browser-native.cjs` / `browser-preload.cjs` / `browser-recorder-preload.cjs` / `browser-recorder.html`），`cdp-bridge.cjs` /
`main.cjs` / `preload.cjs` / `updater.cjs` 有改动。

- **词典**：exact 1297 / template 230 / code 14 / pattern 67，替换总数 1929；模板变量重映射 **0 条**（230 SAME）、歧义 0 条、
  MISSING 0 条，`all keys matched`。上游新增文案补完后「待补翻」剩 28 条，全部是压缩产物噪音：类名与标识符片段
  （`terminal-drop-preview edge-` / `send-key ready` / `:c?void 0:r,disabled:n,`）、react-window 与 `wheelDelta` 内部代码、
  页面标注 payload、以及和服务端比较用的关闭原因串（`terminal closed` / `project closed`）。
- **单词级新文案**：两个自动通道有系统性盲区（片段级要 ≥3 词、字面量级要 ≥2 词），`Settings` / `Projects` / `General` /
  `Missions` / `Theme` / `Reset` / `Width` / `Height` / `Availability` / `Browser` / `System` 与设备预设
  （`Desktop · 1280 × 720` 等 3 条）这 14 条是 `uipos` 报出来的（52 → 35；剩下的 35 条是品牌名、模型名、JSON 示例）。
  设置页那组既是比较用的 id 又是显示文案（`t==="Appearance"`、`v2e=[…]`），按「整体一致替换」处理——同一条常量
  在 bundle 里被一起换掉，比较与显示都跟着走；`semantic_guard` 的放行理由已写进工具注释。
- **主进程**：新增 `patches/electron-browser-*.patch` 四份（浏览器权限 / 导入 / 文件选择对话框、右键菜单 `Inspect element`、
  录制的用户可见报错，26 + 9 + 2 + 2 处），另把「智能体侧协议报错」（`Browser action interrupted by human input…` /
  `Close browser DevTools before using agent browser control.` / `Unknown browser command.` / `Unknown native browser method.`）、
  「浏览器配置的磁盘路径」（`Cookies` / `Local State` / `Library/Application Support` …）与品牌名（`Freebuff Browser` /
  `Microsoft Edge`）登记进 `mainscan.js` 的 `INTENTIONAL` 名单并写明理由：`mainscan` 疑似文案 **16 → 0**、短标签 0。
- **踩坑记录（下次别再犯）**：词典条目**必须能在 UI bundle 命中**——`build.sh` 对 UI 侧 MISSED 是硬失败，所以「只在主进程
  出现」的文案只能写成补丁。这一版先把 38 条浏览器子系统文案塞进了 `dict.json`，构建在 UI 侧报 `MISSED (38 keys)` 中止；
  之后拆成「UI 命中的留词典 / 主进程专属走 patches」。另外 `Cookies` 这个字面量在 `browser-import.cjs` 里还是**磁盘路径后缀**，
  进词典会让导入找不到文件，只能留给补丁只改筛选器那处。
- **回归闸门**：238 vs 238，新增 5 处，全部**有意保留**：react-window 的三条内部 `console.warn`（`Failed to get offset for index:` /
  `Failed to scroll to index after attempts.` / `` The `smooth` scroll behavior … ``）、页面标注 payload 里的
  `Regions: … / Style changes to implement:`（与既有 `Component:` / `Feedback:` 同类，是送给模型的上下文）、以及 CSS 类名拼接
  `streak-day on`。按项目惯例用 `bash tools/release.sh --allow-english` 放行，并在发布说明里逐条列出；这一版成为新基线后
  下一版不再重复报。
- **工具修复（这一版撞出的两处「工具自己错」）**：`semantic_guard` 把模板字面量里的引号当成字符串定界符，引号配对错位后会把
  不相干的片段误判成 `new Event(...)` 的参数而拦下构建，现在按模板配对逐段扫描；`probe_token_epoch` 不再写死辅助函数名，
  而是从抽出来的请求包装器本体上回引读取（minifier 改名后写死的名字会让**有效补丁**被判成「未生效」并中止构建），
  并补了一条「合成运行时里不存在的名字」的自检，自测 22 项全绿。
- **验证**：`update.sh` 七步——构建自检全绿（布局 / `lang="zh-CN"` / 主进程语法与译文哨兵 / UI 行为补丁 5 条哨兵与两道
  行为取证 `stream-epoch` + `token-epoch`）、UI 行为补丁体检 KEEP×2、`mainscan` 零漏翻、`uipos` 35 条；
  `tools/test_mainscan.js` / `test_upstreamdiff.js` / `test_blindscan.js` / `test_probe_*.js` / `test_ui_*.js` / `test_pristine.js`
  等自测通过（`tools/test_remap.js` 在 HEAD 上就有 10 项失败，本轮未触碰 `tools/remap.js`，与本版无关）。
- **资产**：`targetVersion` / `packVersion` 均为 `0.0.131`，发布为 `pack-v0.0.131`（附本版英文原版快照 `pristine-0.0.131.json.gz`）。

## [0.0.128] · 2026-09-21（已发布 `pack-v0.0.128`）

**上游这一版把「非高峰时段定价」的说明整段收窄**——`Kz(...)` 返回的对象里 `detail` 字段直接删掉、tooltip 从三句话砍到一句，
**没有新写任何文案**。片段级英文片段 1515 → 1512（新增 0、下线 3），字面量级 1966 → 1963（新增 1 / 下线 4），`electron/` 下
30 个文件与 0.0.127 **逐字节相同**（`diff -rq` 无输出，`patches/` 无需改动），`index.html` 只是换了 bundle 文件名
（`index-BQ2DjWRr.js` → `index-Bb6jUn1K.js`）。所以这一轮真正要动的只有 4 条词条：

- **改写 1 条**：`` `Off-peak: ${r.price} Freebucks/hour, daily ${f}. Regular price: ${r.regularPrice} Freebucks/hour. The price at session start is locked for the full hour.` ``
  → `` `Off-peak: ${r.price} Freebucks/hour, daily ${f}.` ``。变量名一个没改，所以 `remap.js` 报的是 **MISSING**（锚文本不在新 bundle）
  而不是 **RENAMED**——正是「上游整段重写」与「minifier 改名」这两种情形的区分点。
- **下线 3 条死词条**：两条 `detail` 模板（`` `Off-peak · normally ${r.regularPrice}/hr · until ${l.format(o)} ${d}` `` 与
  `` `Off-peak ${r.price}/hr · ${f}` ``，`detail` 字段已从返回值里消失）与 exact 里的
  `" Your first-tab discount is also included in the displayed price."`（尾随那个 `firstTabDiscount` 三元被上游一起删掉）。
- **新版唯一的「新增字面量」是改写后 tooltip 的碎片**：`Off-peak: Freebucks/hour, daily .`（插值被抹掉后的固定段）。所以
  `upstreamdiff` 两层的账是「片段级新增 0 / 字面量级新增 1」——它属于**新模板**而不是新句子，「待补翻」为 0 是对的；
  照旧用一次「遮蔽分号」的全量字面量对差复核，0.0.127 → 0.0.128 **只多 1 条、只少 4 条**，与上面完全一致。
- **验证**：模板变量重映射 0 条（287 SAME）、歧义 0 条、MISSING 3 条（即上述死词条，删完复扫为 0），替换数 1988 → 1985
  （exact 1310 / template 288 / code 9 / pattern 80），`all keys matched`。`update.sh` 七步全绿——上游新增文案词典已全覆盖、
  回归闸门 238 vs 238 新增 0 处、`mainscan` 零漏翻、UI 行为补丁 5 组锚点全 KEEP、产物侧两道行为取证
  （`stream-epoch` + `token-epoch`）通过；残留扫描回到基线：`uipos` 15 条、`fieldscan` 1 条、`blindscan` 279 条。
- **资产**：`targetVersion` / `packVersion` 均为 `0.0.128`，发布为 `pack-v0.0.128`（附本版英文原版快照 `pristine-0.0.128.json.gz`）。

## [0.0.127] · 2026-09-20（已发布 `pack-v0.0.127`）

**上游这一版没有新写任何界面文案**——片段级 1515 vs 1515、字面量级 1966 vs 1966 全等，`electron/` 下 30 个
文件与 0.0.126 **逐字节相同**（`diff -rq` 无输出），所以这一轮的活几乎全在验证侧。真正要翻的只有**一条含分号的新句**：

- **新增 1 条：离线条幅的 `api_unreachable` 分支**。
  `Can't reach Freebuff's servers on this network — try another connection; turns resume when it's back`
  出现在同一个三元的另一支旁边（0.0.126 就已翻好的 `No internet — turns resume when you reconnect` 是它的兄弟分支），
  收进 exact。这条 **`upstreamdiff` 报不出来**：又是 0.0.123 记账的 `CODEISH` 盲区——含 `;` 的字面量在片段级
  （`isProse`）与字面量级（`isCopyLiteral`）**同时不可见**，于是「新增 0、下线 0」看起来完全干净。它是 `blindscan`
  的「两边都有」桶报出来的（长句被切成 `Can't reach Freebuff's servers on this network` 与
  `turns resume when it's back` 两片，各自都不含分号），`uipos` 的 `label` 桶同期从 15 条涨到 16 条也印证了同一句。
- **用一次「遮蔽分号」的全量字面量对差确认全量只此一条**（临时脚本，见下）：换掉 `;` 后逐版本比对**所有**字符串
  字面量及其模板段，0.0.126 → 0.0.127 **只多 1 条**、少 0 条，正是这句；补翻后重扫为 0。
- **遮蔽分号的手法（为什么不是重写提取器）**：字面量的边界判定只跟引号 / 反斜杠 / 换行有关，`;` 只是内容里的
  普通字符——所以在**喂给 `tools/regress.js` 自己的 `collectLiteralsFromSource` 之前**把全文的 `;` 换成一个等长的
  占位字符，配对结果与位置完全不变，而 `CODEISH` 不再把它当代码；报告时再换回来。这样取字面量的仍是那套经过实战的
  引号配对实现，而不是又写一个正则（0.0.124 的教训：随手写的 `"([^"\\]|\\.){8,400}"` 会在带转义的字符串后错位，
  实测把整条跳过去、报 0 条）。
- **模板变量重映射 5 条、歧义 0 条、MISSING 0 条**：`"R" → "P" ; "R" → "P"`、`"Ui(P)" → "Ui(R)"`、
  `"L.trim()" → "$.trim()"`、`"Pn($)" → "Pn(L)"`、半截模板 `(P==null?void 0:P.balance)??0` →
  `(R==null?void 0:R.balance)??0`。`upstreamdiff` 报的那**唯一一组「疑似改写」**其实就是最后这条半截模板的变量改名
  （`:R?` vs `:P?`），不是真改写——两版文案完全一致，只有压缩名在变。
- **验证**：`update.sh` 七步全绿——上游新增文案词典已全覆盖、回归闸门 238 vs 238 新增 0 处、`mainscan` 零漏翻、
  UI 行为补丁 5 组锚点全 KEEP、产物侧行为取证（`stream-epoch` + `token-epoch`）两项均过；替换数 1987 → 1988
  （exact 1311 / template 290 / code 9 / pattern 80），`all keys matched`。残留扫描回到基线：`uipos` 15 条（模型名 /
  品牌词 / 库内部 / 示例）、`fieldscan` 1 条（`tagline: 0 Freebucks`）、`blindscan` 279 条。
- **资产**：`targetVersion` / `packVersion` 均为 `0.0.127`，发布为 `pack-v0.0.127`（附本版英文原版快照
  `pristine-0.0.127.json.gz`，给别的机器当基线）。

## [0.0.126] · 2026-09-19（已发布 `pack-v0.0.126`）

**上游这一版给会话加了「上下文压缩」**（`POST /api/thread/<id>/compact`，入口在 token 用量弹层里的
一个 quiet 按钮，只对 codebuff harness 显示），另加了一个 Discord 状态开关。词典新增 8 条、改写 2 条，
替换数 1979 → 1987（exact 1310 / template 290 / code 9 / pattern 80），`all keys matched`。

- **新增（上下文压缩 7 条）**：`Compact`（短标签，进 pattern）、`Compacting…`、`Compact context`、
  `Available once this turn finishes.`、`` `Compacted · ${zr(Q.preTokens)} → ${zr(Q.postTokens)}` ``、
  `Nothing older to condense yet.`、`Could not compact this thread.`。其中那条 `Compacted · …` 是**模板**：
  它由压缩结果拼出来（`` `Compacted · ${zr(Q.preTokens)} → ${zr(Q.postTokens)}` `` / `"Nothing older to condense yet."`
  同一处三元），片段级对差只能拆出 `Compacted · ` 这种短片段，靠 `upstreamdiff` 的字面量级 + 人工读新代码确认。
- **新增（账户菜单 1 条）**：`" Show in Discord status"`（Discord Rich Presence 的开关）。这条字面量带前导空格
  （图标与文字之间的分隔），按既有惯例连同空格收进 exact 并保留同形译文。
- **改写 2 条**：① `resets in ${ao(m.resetAt,o)}` 随 remap 迁移为 `resets in ${lo(m.resetAt,o)}`
  ——remap 把它报成 **AMBIGUOUS**（同一句骨架在 bundle 里命中 3 处、插值不同：`lo(m.resetAt,o)`、
  `lo(d.blocked.resetsAt,s)`、`lo(t.resetAt,n)`），人工比对确认应取 `lo(m.resetAt,o)` 那处后改名，
  另两处本来就有各自独立的词条；② 「首个标签页折扣」长句里 `shared across Desktop and CLI` 被上游改成
  `shared across Web, Desktop and CLI.`，旧词条整条落 MISSED，按新句改写（译文同步加「Web、」）。
- **新主进程文件 `electron/discord-presence.cjs`（Discord Rich Presence）**：它把当前状态推到用户的 Discord
  个人资料上，主进程侧那三句是**用户可见文案**，词典够不着，因此新增
  `patches/electron-discord-presence.cjs.patch`（`Agent at work` → 「代理正在工作」、
  `Coding with Freebuff` → 「正在使用 Freebuff 编码」、按钮 `Get Freebuff` → 「获取 Freebuff」；
  `large_text` 的 `Freebuff` 是品牌名，保留英文）。另三条不是文案：`handshake timed out` / `closed before ready`
  是重试判定用的内部错误串、`discord presence connected` 是控制台日志——已按既有惯例进 `tools/mainscan.js` 的
  `INTENTIONAL` 名单并写明理由，不再每版重复报。
- **修掉「探针自己错」的一次静默误判**：构建在自检处中止，报 `行为取证未达标：token-epoch —— 补丁插入了但未生效`，
  而补丁其实好好地插在产物里（`_hanhuaRetried`、`_hanhuaResetToken()` 都在，403 分支也正确）。根因在探针的 harness：
  它把 ApiError 类名**写死成 `go`**（0.0.124 时的压缩名），而 0.0.126 里 minifier 把它改成了 `Ds`——抽出来的请求
  包装器一引用 `Ds` 就 ReferenceError，第一次调用直接失败，于是「补丁有效的产物」被判成「补丁未生效」。
  现在类名、错误消息构造、JSON 解析三个短名字全部**从 bundle 现场取**（`class X extends Error{…this.name="ApiError"}`
  等锚点），并且**类名取不到就报「无法取证」rc 2**，而不是拿错名字硬跑出一个假结论。`test_probe_token_epoch`
  5 组用例全过（含「打补丁前后结论相反」与真实原版 bundle 顺带取证）。
- **验证**：`update.sh` 七步全绿——上游新增文案词典已全覆盖、回归闸门 238 vs 238 新增 0 处、主进程 `mainscan`
  零漏翻、UI 行为补丁（`stream-epoch` / `token-epoch`）原版体检 KEEP、产物侧行为取证两项均通过；`uipos` 残留 15 条、
  `blindscan` 疑似文案 279 条（与 0.0.123 / 0.0.124 持平，均为模型名 / 品牌词 / 库内部 / 示例）。
- **资产**：`targetVersion` / `packVersion` 均为 `0.0.126`，发布为 `pack-v0.0.126`（含本版英文原版快照
  `pristine-0.0.126.json.gz`，供别的机器取基线）。

## [0.0.124.1] · 2026-09-19（同版修正重发，已发布 `pack-v0.0.124.1`）

**起因是一次实测复现**：装机是中文，界面却报「无法打开标签页: forbidden」。修法分两半——
「怎么装、怎么查」（仓库与安装脚本，不动产物）与「渲染进程自己从那一次 403 里恢复」（**动产物**）。
因为后者改了 `output/`，按「同一 targetVersion 内的修正重发」惯例把 `packVersion` 抬到 `0.0.124.1`
（否则已装 0.0.124 的机器不会自动更新到这次修复）；`targetVersion` 仍 `0.0.124`。
**已发布**为 `pack-v0.0.124.1`，资产三份：`hanhua-pack-0.0.124.1.zip`（sha512 与
`pack-manifest.json` 里那条核对一致，控制器下载后校验会过）、`pack-manifest.json`、
`pristine-0.0.124.json.gz`（本版英文原版快照，供别的机器取「上一版原版」当对差基线）。
发布时两道闸门都过：主进程零漏翻（29 个文件的英文全在 INTENTIONAL 名单里）、回归闸门
238 vs 238 新增 0 处。本机装机也按此更新过一遍（`bash build.sh && bash apply.sh`，应用需已
彻底退出，否则会被 `apply.sh` 的新闸门挡住），复验为：三个文件 sha256 与 `output/` 一致、
装机 bundle 的 403 自愈探针达标、`forbidden_probe` rc 0。

- **先定位：`forbidden` 只有一个来源。** 装机 `resources/orchestrator/orchestrator.js`（10 MB）里
  返回 `{"error":"forbidden"}` 的地方**只有一处**：写方法（POST/PUT/PATCH/DELETE）+ `/api/` 要求
  请求头 `x-freebuff-launch-id` 与它启动时从 `FREEBUFF_LAUNCH_ID` 拿到的值**完全相等**（`/healthz`
  不匹配则 401 `invalid launch id`，探针就拿这条当尺子）。界面那句文案来自词典的 `"Could not open tab"`
  → 「无法打开标签页」，触发点是 `openTab` → `POST /api/threads`——**开一个新标签页本身就是一次写操作**，
  所以它和「消息未发送」是同一个原因，不是新增的故障。现场另两条佐证：装机端口上
  `curl -X POST .../api/thread/probe/rename` 原样返回 `403 {"error":"forbidden"}`；渲染 bundle 里
  令牌是 `let mg; function ID(){ if(mg===void 0) mg = apiToken() ?? null }` —— **读一次永久缓存，
  读到 null 也缓存**。
- **触发条件：换文件时应用正跑着（混合态）。** 装机文件是运行中进程**按需从磁盘读**的，而两侧时机
  不同：渲染侧（`ui/`）每个窗口加载/重载都重读，主进程（`app.asar` 里的 `main.cjs`）只在**进程启动时**
  读一次。实测时间线就是现成例子：0.0.124 的自动更新把汉化覆盖回英文（02:44），主实例 10:12 启动
  （内存里是**英文原版** `main.cjs`），10:20/10:25 才把汉化落盘——那个进程于是成了「界面中文、主进程
  英文」；证据是它与 `hanhua-backup-20260919-102042/app.asar` 里的 `const launchId = randomUUID()`
  与英文 `ui/index.html`（两份都对过）。本机 Bun 崩过并在 10:12 写下 `verdict: baseline`（主实例日志
  里跑的是 `bun-baseline.exe`），而**各 slot 实例没有这份记忆**（slot-3 目录里没有 `bun-runtime.json`，
  跑的是标准 `bun.exe`）；崩溃重启换新 launch id 之后，写操作就全线 403。
- **`apply.sh` 新增闸门：应用在跑就拒绝换文件（`--force` 逃生）。** `restore.sh` 早就挡住这一条，
  理由是「文件被占用、删一半」；`apply.sh` 当年只覆盖不删所以没加——但混合态的代价更贵。`--force`
  热换后脚本会提醒：**彻底退出再启动**，别只重载窗口（重载只换渲染侧，主进程仍是旧的）。
- **新增 `tools/forbidden_probe.js` + 自测（CI 跑）。** `node tools/forbidden_probe.js` 一条命令回答
  「这台机器现在/下次会不会再中」：自带最小 asar 读取（不依赖 npx、离线可用；读取器拿真实
  `app.asar` 核对过，80034 字节里正确读出 `const launchId = apiLaunchToken ?? randomUUID()`），
  比对运行中实例的启动时间与装机文件的写入时间找混合态，并探 `/healthz` 确认该 orchestrator 要不要
  令牌。退出码 0 / 1 / 2，**拿不到证据一律 2，不冒充「正常」**（与 `probe_stream_epoch` 同一套口径）。
  自测 9 组：合成装机夹具 + 注入进程列表覆盖判定表与容差（实例只早一点点不算混合态）、真实装机存在时
  额外核对一次解析器（防「自造自读」）。实测对本机给出 `✓ 没发现会触发 403 forbidden 的条件`
  （slot-3 启动于 10:36，晚于装机文件写入时间 10:25）。
- **改产物：渲染进程收到 403 时自己丢掉陈旧令牌（UI 行为补丁 `token-epoch` 组）。** 上面那些都是
  「少出事」与「查得出」；真正的自愈在渲染侧——旧的主进程补丁只在**同一次会话内**钉住 launch id，
  而渲染进程更早的缺陷是：令牌**读一次就永久缓存**（`let mg; function ID(){…mg = apiToken() ?? null}`，
  读到 `null` 也缓存），所以只要 orchestrator 崩过一次重启（或跑着的是没带补丁的旧主进程），此后的写操作
  就全线 403 直到窗口重载。两条补丁协同：`token-cache-resettable` 给那张缓存注入失效函数
  `_hanhuaResetToken()`，`reset-and-retry-on-403` 在请求包装器拿到 **403** 时丢掉缓存、**立即用新
  令牌重发同一次请求**（只重试一次；重试后再 403 就直接抛错）——所以连触发的那一次调用都是成功的，
  用户再也看不到那句 forbidden，不必等下一次操作。只认 403：网络失败 / 5xx 与令牌无关，不丢缓存也
  不重试（探针专测了这两条：不误伤、不无限重发）。那条补丁把函数签名与 catch 一起改（锚点从签名
  跨到 catch），两处的小名字都由捕获组原样带回，minifier 改名不失配。
- **新增 `tools/probe_token_epoch.js` + 自测（CI 跑）**：行为取证而不是文本哨兵——探针从 bundle 里
  把取值函数与请求包装器（`async`）**原样抽出来**，假 orchestrator 按事故时序跑一遍：原版是「403 之后
  那一次调用直接失败（只发一次请求，带的是旧令牌 T1）」，产物是「**同一次调用内**请求序列 T1→T2、
  调用成功（用户无感）」，且「5xx 之后不重试、缓存未被丢掉」（不误伤）；另有一条「只重试一次」的
  上限用例（令牌重读后仍被拒 → 直接抛错，不许无限重发）。`postbuild` 把它接成硬检查（用它自己的 CLI 开子进程跑，免得把自检改成异步），
  `ui_patch_status.js` 的缺陷登记表也补上了这一组（退场判定会给 KEEP/REWRITE/RETIRE/UNKNOWN）。
  实测：对 0.0.124 英文原版 `--expect present` → rc 0（缺陷可复现，补丁仍必要），对本次产物
  `--expect absent` → rc 0（已自愈）；`bash build.sh` 自检打印「行为取证通过：token-epoch」。

## [0.0.124] · 2026-09-19

**适配 0.0.124：上游新增「非高峰时段定价」与赞助邀请卡的「验收/兼容状态」**——降价时段的徽标与
三处 tooltip（含首个标签页折扣那句尾注）、赞助验收状态表的四个新标签（`Verified` /
`Verification failed` / `Setup needed` / `Couldn't verify`）与「重新验证 / 修订已过期」提示，
外加一条只有邀请人名的卡片标题（上游把它拆成三个 JSX 子节点）。新增 20 条（exact 15 / template 7 /
code 1 / pattern 2 里去掉重复计数后共 22 处改动点）、改写 1 条随上游拆分的半截模板，替换数 1935 → 1979。
主进程 `electron/*.cjs` 经 `mainscan` 对差**零漏翻**，`patches/` 无需改动，UI 行为补丁体检 KEEP，
回归闸门 238 vs 238 新增 0 处。

- **适配 Freebuff v0.0.124**：targetVersion / packVersion 升至 0.0.124；渲染 bundle
  `index-CsS7ws7U.js` → `index-CzdmryNF.js`。装机又是由自动更新覆盖（0.0.123 → 0.0.124），
  `hanhua-backup-*` 一并被清掉，所以 `build.sh` 走的仍是「安装目录当前的英文原版即 pristine」那条路径，
  构建时顺手把 0.0.124 的原版快照登记进 `work/pristine/0.0.124/`（`work/pristine/0.0.123/` 正好当上游对差基线）。
- **模板变量自动重映射 67 条**，**歧义 5 条人工改名**（都命中同一个原因：锚文本在 bundle 里命中多处且插值不一致，
  `remap` 按设计不猜）：`` `Could not select ${fe.name}: ${Ge}` `` → `` `${pe.name}` / `${Ze}` ``、
  `` `resets in ${ao(g.resetAt,o)}` `` → `` `${ao(m.resetAt,o)}` ``、`` `resets in ${g}` `` → `` `${m}` ``、
  `` `Dismiss notification: ${g.message}` `` → `` `${m.message}` ``、`` `Remove ${Pe.configKey}` `` → `` `${Re.configKey}` ``。
  另 1 条 MISSING 是半截模板 `` `… buys one hour of unlimited messages and tool calls. Charged once, when the session starts.${te?` ``：
  上游把这段嵌套模板三元改写成了两个独立模板（`${de?"Unlimited messages and tool calls.":…}`），
  于是改写成**完整模板** `` `${Le} ${Ns} buys …starts.` ``（新变量名取自新 bundle），
  同时把它从 `tools/lint_dict.js` 的 `TRUNCATED_TEMPLATE_ANCHORS` 登记表里退场——半截模板只在形态仍在时才是特例。
- **新增文案集中在两处**：
  - **非高峰时段定价**（新函数 `yv` / `f9e` 配 `offPeak` 时段表）：徽标 `Off-peak`、
    `` `Off-peak pricing · ${t.regularPrice} Freebucks/hour at peak` ``、
    `` `Peak pricing · ${t.price} Freebucks/hour off-peak` ``、
    `` `Off-peak · normally ${r.regularPrice}/hr · until ${l.format(o)} ${d}` ``、`` `Off-peak ${r.price}/hr · ${f}` ``
    与那条长 tooltip（`` `Off-peak: ${r.price} Freebucks/hour, daily ${f}. Regular price: ${r.regularPrice} Freebucks/hour. The price at session start is locked for the full hour.` ``
    尾随 ` Your first-tab discount is also included in the displayed price.`）。注意这与既有的 DeepSeek
    `Peak pricing: +${t.peak.surcharge} …` 加价提示是两码事，那条仍在、无需改动；
  - **赞助邀请卡（`generic-setup-invitation`）与验收状态表**（新组件 + 新函数 `zRe`）：
    `Verify again`、` · Stale revision`、`Verification failed`、`Setup needed`、`Couldn't verify`、`Verified`
    （`Checking…` / `Code ready` 早就在词典里，这次把同一张表的另外四个补齐）、
    `This sponsored invitation expired.`、`This run has no frozen acceptance-criteria contract.`、
    `Verification has not finished.`、`Sponsored setup currently supports a compatible local project.`、
    `This is an invitation only: nothing has started and you will not be charged. Compatibility must be checked before sponsored work can begin.`，
    两条 aria-label 进 `pattern`（`Acceptance criteria verification` / `Expired sponsored invitation`），
    以及额度说明里的 `Unlimited messages and tool calls.`。
  - 卡片标题是**唯一一处需要倒装**的：上游把它拆成三个 JSX 子节点
    （`children:["Sponsored ",o.advertiserName," invitation"]`），中文语序得反过来，所以用一条 `code` 分区词条
    整段改写成 `[o.advertiserName," 的赞助邀请"]`；同名的 aria-label 模板
    （`` `${o.advertiserName} invitation` ``）另加一条 template 词条。这条 `code` 词条带压缩变量名 `o`，
    下次 minifier 改名时会落 MISSED（不会静默坏掉），届时按新名改一次即可。
- **发现第三个盲区（本版只漏一条，已手工补上）**：**单词字面量**在两个对差通道里都不可见——片段级要求 ≥3 词、
  字面量级要求 ≥2 词，而 `uipos` 只扫 `children:` / `label:` / `title:` / `placeholder:` / `aria-label` /
  `data-tooltip` / `confirmLabel:` / `actionLabel:` 这些属性位。本版新加的验收状态表恰好是
  `$2={pending:"Checking…",success:"Verified",failed:"Verification failed",setup_needed:"Setup needed",code_ready:"Code ready",couldnt_verify:"Couldn't verify"}`
  ——`"Verified"` 正好是单词、又落在普通对象字面量（不是 UI 属性位），于是 `upstreamdiff` 的 22 条新增里没有它、
  `uipos` 也扫不到：那 22 条的账刚好对得上（19 条已覆盖 + 3 条未覆盖）。这次是靠人工比对这块新状态表确认的。
  剩下 3 条 upstreamdiff 未覆盖项里，2 条是噪音（`/api/ad/proposal/`、`/verify-again` 是 URL 路径；
  `:pe?`` - -menu`:void 0,` 是压缩变量改名残片），1 条是新增模型 displayName `Claude Fable 5.1`（按约定保留英文）；
  补上 `Verified` 后该对象六个状态标签全部有译文。另一点也值得记：新邀请卡的
  `` `${o.advertiserName} invitation` `` 与 `"Sponsored "` 文本节点都是 **`uipos` 扫出来的**
  （aria-label 桶与 text-node 桶各一条），不是靠对差工具。
- **又一条陷在已知盲区里的新文案（靠 blindscan 揪出）**：`Git is ready, but the sponsored compatibility check could not finish. Continue to try again; your local snapshot is preserved.`——又是那个 `;`：0.0.123 记录的 `CODEISH` 盲区（含 `;` 的字面量在片段级与字面量级同时不可见）这次就吃了这一条，`upstreamdiff` 的待翻清单里没有它。它是 `blindscan` 的「两边都有」桶报出来的（切割成 `Git is ready` / `your local snapshot is preserved.` 两片）；随后又用一次**含分号字面量专项重扫**（对 `pristine 0.0.123 → 0.0.124` 两版、与产物三边比）确认全量只有这一条真文案（另一条命中是 shiki 的语言映射表，属库内部）。专项重扫的取字面量循环**必须复用 `regress.js` 那套引号配对 / `isOpeningQuote` 规则**：随手写的 `"([^"\\]|\\.){8,400}"` 会在遇到带转义的字符串后错位，把它整个跳过去（本次实测：正则版报 0 条，按 regress 规则报 2 条）。修 `CODEISH` 本身仍留待单独一轮。
- **发布工具的一处静默跳过（直连不通的网络里才暴露）**：`tools/release.sh` 原来用 `curl` 拉
  `browser_download_url` 取远端 `pack-manifest.json` 与上一版汉化包，而 `github.com` /
  `objects.githubusercontent.com` 在直连不通的环境里会超时并留下空文件——于是 packVersion 防呆
  读不到远端版本（规则静默失效）、闸门二直接打印「未能下载上一版包，跳过」。0.0.124 发布时实测：
  `curl` 卡满 62 秒后 `(28) Failed to connect to github.com port 443`，而同一条命令换成走
  api.github.com 的 `gh` 一秒内拿到。现在两处都改用 `gh`（`gh_asset` 按 release asset id +
  `Accept: application/octet-stream` 读；闸门二用 `gh release download`），curl 只作退路，
  且「取不到」时明确出声（`! … 本道闸门未执行`），与「远端就没发过包」区分开。本次 0.0.124 的
  闸门二是事后用 `gh release download` 拉**线上真实资产**补跑的：238 vs 238、新增 0 处 ✓。
- **渲染进程残留**（`uipos`）15 条，与 0.0.123 持平且全部有意保留：8 个模型名（含新增的 `Fable 5.1`）、
  2 个 placeholder（`bun install` 与 `{ "mcpServers": … }` 样例）、CodeMirror 内部的 ` Action: ${u}…`
  aria-label、品牌词 `Freebuff ` / `Limited-time` / `mcpServers`。主进程 `mainscan` 零疑似漏翻。

## [0.0.123] · 2026-09-18

**适配 0.0.123：上游给赞助工作加了「本地 Git 配置」这一整关**（兼容性检查前先做 Git 检查、审阅并批准
初始快照），提案卡片随之加了「账户配置 / 连接与验证」两步引导——新增 65 条（exact 57 / template 6 /
pattern 2）、下线 6 条随上游改写的死词条，替换数 1871 → 1935。主进程 `electron/*.cjs` 经 `mainscan`
对差**零漏翻**，`patches/` 无需改动，UI 行为补丁体检 KEEP，回归闸门 238 vs 238 新增 0 处。

- **适配 Freebuff v0.0.123**：targetVersion / packVersion 升至 0.0.123；渲染 bundle
  `index-R2ptq7SB.js` → `index-CsS7ws7U.js`。装机由多开控制器自动更新（0.0.120 → 0.0.123），而更新会连
  `hanhua-backup-*` 一起清掉，所以 `build.sh` 走的仍是「安装目录当前的英文原版即 pristine」那条路径，
  构建时顺手把 0.0.123 的原版快照登记进 `work/pristine/0.0.123/`（下次适配的基线）。
- **模板变量自动重映射 66 条**，**歧义 1 条人工改名**：`` `Remove ${$e.configKey}` `` →
  `` `Remove ${Pe.configKey}` ``（锚文本 `Remove ${…}` 在 bundle 里命中多处且插值不一致，remap 按设计
  不猜）；另有 2 条随上游改写落进 MISSING/下线：`` `Create your ${t.advertiser_name} project` ``
  与首个标签页折扣那条长 tooltip。
- **新增文案集中在两处**：
  - **赞助工作的 Git 配置卡**（`adInvitationGit*`，嵌在 schemaVersion 1 的邀请卡里）：状态表 9 条
    （`This project is too large for automatic Git preparation. …` / `Git is not installed or cannot be found. Install Git and check again.` /
    那条带 macOS/Linux 安装方式的长句 / `Git metadata could not be read. Repair the repository before continuing; Freebuff will not overwrite it.` /
    `Git cannot access this folder. Check its permissions, then try again.` / `The Git inspection timed out. Try again.` /
    `This folder cannot be safely prepared. Open the project directly and try again.` / `Set up local Git to track changes. No GitHub account or upload is needed.` /
    `This repository needs an initial snapshot. Review the files before creating it.` /
    `Git is ready. Continue to check the remaining sponsored setup requirements.` / `Git setup needs further inspection.`）、
    审阅流程（`Review the initial snapshot. Only files you select will be committed locally. …` / `Commit name` / `Commit email` /
    `These identify this local commit only. Your global Git settings will not change.` / `Approve local Git setup` /
    `Set up local Git and continue` / `Check again` / `Review Git setup` / `Checking Git…` / `Code ready` /
    `Setup steps` / 步骤标签 `Account` / `Verify`，后两个按既有约定进 `pattern`）、
    报错与结果（`Could not inspect Git. Check again or request a new offer if this one expired.` /
    `Could not prepare a file preview. Nothing was approved.` / `Setup is not available in this state. Check the explanation before continuing.` /
    `Setup could not finish or the reviewed files changed. Review a fresh preview before trying again.` /
    `Setup was interrupted. Check Git again before retrying; your files have been preserved.` /
    `Local Git snapshot created. Sponsored work still requires a separate plan and approval.`）、
    以及「目录在已有的 Git 仓库里」那一组（`This folder is inside an existing Git repository.` /
    `… Open its root to continue.` / `Open repository root` / `Repository root opened. Continue in that project to check sponsored compatibility with the new workspace.` /
    `Could not open this repository root. Check again.`；另有一条 `Opening ` 文本节点（后面接仓库根目录的
    `<code>`）是 `uipos` 扫出来的，它与随后的 ` expands the project to that repository. No files will be changed or uploaded.`
    拼成一句）；
  - **提案卡上的「账户配置 / 连接与验证」引导**：`Finish setup and verify` / `Finish setup` / `Before you merge` /
    `Account setup may be needed after the code is ready.` / 三步标题与说明（`1. Review the code` /
    `2. Set up your account` / `3. Verify in your app` 与各自的 detail）/ `` `Connect ${t.advertiser_name}` `` /
    `` `Set up ${t.advertiser_name}` `` / `Your code is ready. Create an account or sign in, then add your project settings.` /
    `Create account ` / `Use existing account` / `Use the account setup instructions in the run’s notes.` /
    `How to connect and verify` / `Live integration verification is not recorded by this card. …` / `Continue account setup`。
- **上游改写的三句按新文改写**：`Freebuff will not initialize Git or install anything.` →
  `Git setup requires a separate file review and approval. Freebuff will not install Git automatically.`；
  `This Git repository needs a committed checkpoint. Commit a checkpoint, then check compatibility again.` →
  `This Git repository needs a reviewed initial snapshot.`（旧的那条**短句** `This Git repository needs a committed checkpoint.` 仍在，保留）；
  `This project is not a Git repository yet. Create a Git repository and commit a checkpoint, then check compatibility again.` →
  `This folder needs a Git check before sponsored work can begin.`；首个标签页折扣 tooltip 加了 `Limited-time` 前缀
  与「划掉的价格是原价」，并新增 `` `regular price ${Se}/hr` `` 这条 aria-label。删掉的死词条共 6 条
  （上述 3 条 exact + 2 条 template + 1 条上游已删的折扣 tooltip）。
- **发现两个对差通道共有的一个盲区（本版就漏了 6 条，已手工补上）**：`tools/regress.js` 的 `CODEISH`
  把「含 `;`」的字面量一律当代码（本意是甩掉重叠配对抽出的 `");x=1;("` 这类跨代码边界片段），而英文文案
  很常用分号——于是**带分号的句子在片段级（`isProse`）与字面量级（`isCopyLiteral`）里同时不可见**，
  `upstreamdiff` 既不会把它们列进待翻清单、`blindscan` 也看不到。本版 6 条（`Git metadata could not be read…`、
  `Setup was interrupted…`、`Live integration verification…`、`Review the changes and setup notes…`、
  `Git is not installed or cannot be found…`（macOS/Linux 长句）、`Limited-time first-tab discount…`）正是这样
  漏掉的：工具只报 50 条待补翻，实际要翻 56 条。这一次靠一次「含分号字面量全量对差」把两个版本都过了一遍，
  除本版 6 条外还揪出**两条从 0.0.120 起就没翻**的连接器 setupNote（Figma 的
  `Remote access is limited to Figma MCP Catalog clients; …` 与 Prismic 的 `This vendor repository is archived; …`），
  一并补上；补完后该扫描为 0 条。修 `CODEISH` 本身是另一件事（它同时是发布闸门的判据，要连同 `regress` 的
  238 vs 238 一起重新取证），留待单独一轮。
- **渲染进程残留**（`uipos`）12 条，全部有意保留：8 个模型名、2 个 placeholder（`bun install` 与
  `{ "mcpServers": … }` 样例）、CodeMirror 内部的 aria-label、品牌词 `Freebuff `。
- **`remap` 报出的 2 条 MISSING 与 ud 的 3 条尾部噪音**都属于已知形态：前者是上游改写的旧词条（见上），
  后者是 1 条模板残片（``,heading:`Connect `,description:``，其模板 `` `Connect ${t.advertiser_name}` `` 已翻）
  与 2 条 CSS 类名（`btn primary proposal-advertiser-cta` 一族）——都不影响替换。

## [0.0.120] · 2026-09-17

**适配 0.0.120：上游新增「赞助式 Supabase 配置邀请」（schemaVersion 1）整块界面、文件预览的
磁盘/未保存状态说明、以及额度说明里的「为什么有这个限制？」+ 国家/地区验证**——新增 42 条、
下线 1 条、2 条模板随压缩改名手工迁移，替换数 1817 → 1870（发布后靠新工具又揪出 1 条漏翻，
补上后仓库当前为 **1871**，见下）。主进程 `electron/*.cjs`
经 `mainscan` 对差**零漏翻**，`patches/` 无需改动。

- **适配 Freebuff v0.0.120**：targetVersion / packVersion 升至 0.0.120；渲染 bundle
  `index-BHuq3B1m.js` → `index-R2ptq7SB.js`。装机版本跳过 0.0.115–0.0.119 直接到 0.0.120
  （多开控制器在本机自动更新），`build.sh` 走的仍是「安装目录即英文原版」路径。
- **模板变量自动重映射 67 条**，**歧义 2 条人工改名**（锚文本在 bundle 里命中多处且插值不一致）：
  `` `resets in ${oo(u.resetAt,o)}` `` → `` `resets in ${ao(g.resetAt,o)}` ``、
  `` `Could not select ${fe.name}: ${Ze}` `` → `` `Could not select ${fe.name}: ${Ge}` ``；
  另一条死词条 `Showing the first 512 KB read-only`（上游已删）随之移除。
- **新增文案集中在三处**：
  - **赞助式 Supabase 配置邀请卡**（`supabase-setup-invitation`，schemaVersion 1 带来的整套新句）：
    标题 `Sponsored Supabase setup invitation` / `Sponsored Supabase invitation`、
    `` `Prepare this project for Supabase ${wD[o.angle]}.` `` / `` `Supabase may help with ${wD[o.angle]} in this project.` ``、
    `This is an invitation only: …` 两条、Git 检查点那组（`This folder is not a Git repository yet.` /
    `This Git repository needs a committed checkpoint.` / `Create a Git repository and commit a checkpoint, then recheck.` /
    `Freebuff will not initialize Git or install anything.`）、
    兼容性说明两条、`Y$e` 映射表 11 条（`Freebuff couldn't read this project's package manifest…` 等）、
    按钮与加载态 `Recheck setup` / `Check compatibility` / `Rechecking…`；
  - **文件预览状态**：`Disk version · unsaved edits preserved` / `Unsaved edits preserved` /
    `File preview · read-only` / `Back to edits` / `` `${g} could not be loaded in this file preview.` ``、
    `Couldn’t open this file in the main window.` / `This file isn’t available in this thread’s workspace.`；
  - **额度说明与「限制访问」的出路**：`Why this limit?`、`Your allowance depends on your plan, country and network.`、
    30 天锁定的那段长说明（`Using a cloud PC, or moved recently? …`）、`Verify your country ↗`、
    `Loading verification link…` / `Could not load the verification link. Close this explanation and try again.`、
    额度菜单项 ` Country & allowance`。
- **上游对差工具会漏掉短句**：`tools/upstreamdiff.js` 这轮只报出 36 条（其中 2 条还是提取器的
  误报），剩下 6 条（`Recheck setup`、`Check compatibility`、`Rechecking…`、` Country & allowance`、
  `Supabase invitation`、以及被整句包含的 `This Git repository needs a committed checkpoint.`）
  是**逐条比对两版 bundle 的字面量**、再用 `build.sh` 的 MISSED 与 `uipos` 补出来的——
  短到两三个词、或与已翻长句重叠的片段，它按设计不单列。补完后该工具对本版报「待补翻 1 条」，
  且那一条就是上一段那类纯代码片段。
- **修 `tools/probe_stream_epoch.js` 的两处取证缺陷**（与词典无关，但会让行为取证失效）：
  ① 消息 id 生成器的**压缩名随版本变**（0.0.114 是 `Ec`、0.0.120 是 `Pc`），harness 里写死 `Ec`
  导致行为取证直接报 `Pc is not defined`，`postbuild` 退化成「仅凭哨兵放行」——改成按结构抽名字
  （`ID_GEN_ANCHOR`）；② CLI 入口 `main()` 里 `let verdict` 与模块级 `verdict()` 同名，`let` 的 TDZ
  让命令行运行一律抛 `Cannot access 'verdict' before initialization` 并被误报成「抽不到锚点」。
  修完实测：原版**缺陷可复现**（补丁仍必要），产物**缺陷已消除且守卫仍在**。
- **回归闸门的两个误报被修掉**（`tools/regress.js`）：新旧版对差曾经多出 2 处英文片段
  （`,message:k instanceof Error?k.message:` 一族），它们是提取器从压缩代码里切出来的、
  恰好带着 `message` 这个常见小词所以溜过了「是文案吗」的判据——把 `instanceof` 跟
  `function` / `typeof` / `const` / `let` / `var` 一样写进 `CODEISH` 关键字组后，
  闸门回到 **0 处、rc=0**（238 vs 238），发布不需要 `--allow-english` 放行。
  顺带：`tools/upstreamdiff.js` 复用同一份提取器，那两条噪声也从它的清单里消失了。
- **上游对差补上「字面量级」这一层**（`tools/upstreamdiff.js` + `tools/regress.js`）：上一段那 6 条
  漏报的根因不是比对逻辑，而是片段级判据为了在 2.4 MB 压缩代码里少报噪音而定的三条要求
  （≥3 词、小写词占比 ≥0.6、含常见小词）——两词 Title case 标签的小写词占比正好 0.5，`Rechecking…`
  又不足 2 词。现在同一份源码再扫一遍**完整字符串**（`collectLiteralsFromSource`：按「同类型引号
  闭合 + 前一字符判断是开引号还是闭引号」取整串，判据换成「像不像标识符」），比片段级多收短标签；
  「已覆盖」改用**整串相等**（片段级的子串匹配迁就抽取产物，会让含 `…checkpoint.` 的长句键把
  另一条独立字符串判成已覆盖）。四个桶：文案 / 短片段 / 字面量（拦退出码）+ 短标签（单列、不拦）；
  反过来字面量级的边界也帮片段级清理撇号截断出的半截句（`pruneSubsumed` 拿整串当「更长的东西」，
  但本身也是完整字符串的例外）。实测：拿适配前的词典跑 0.0.114→0.0.120，那 6 条全部进了报告（5 条进待翻清单，
  `Rechecking…` 进短标签节）；
  用现在的词典跑则**只剩 1 条真漏翻 + 1 条纯代码片段**——那条真漏翻是
  `` `Checking the installed ${t.label} CLI…` ``（它落在对象字面量的插值模板里：`uipos` 只看 JSX 属性
  位置、`mainscan` 只看主进程、`blindscan` 虽然看得到、但只能给出截断到插值处的片段
  `Checking the installed`（后面接着 `${t.label}`），那条埋在几百条 CodeMirror / Shiki 语言名的
  噪音里，当时被当成有意保留）。
  这条**已经补掉**：`template` 新增 `` "Checking the installed ${t.label} CLI…" `` →
  「正在检查已安装的 ${t.label} CLI…」，替换数 1870 → **1871**（template 279 → 280）；重建后
  `blindscan` 里那条残留消失、`regress` 对上一版包仍 238 vs 238（rc=0）、`uipos` 仍 14 条
  （全是有意保留）、`build.sh` 自检全绿（纯字面量覆盖 1188/1188）。注意：**已发布的
  `pack-v0.0.120` 里没有这条修正**，要把它分发到别的机器需补发一个包。
- **主进程无需改动**：`mainscan` 对差 0 条疑似漏翻；`uipos` 残余英文回到 14 条，全部属于
  有意保留（模型名 / 品牌词 / JSON 样例 / `bun install` / CodeMirror 内部 aria-label）。

## [0.0.114] · 2026-09-16

**适配 0.0.114：上游新增「首个标签页折扣」（first-tab discount）的 4 条文案**——新增 4 条、
下线 0 条，替换数 1813 → 1817。主进程 `electron/*.cjs` 与 0.0.113 产物**逐字节一致**，
`patches/` 无需改动。

- **适配 Freebuff v0.0.114**：targetVersion / packVersion 升至 0.0.114；渲染 bundle
  `index-02HepJVd.js` → `index-BHuq3B1m.js`，样式表仍为 `index-YJ7gnGWz.css`（与 0.0.113 产物哈希
  一致，本轮 CSS 零变化）。本机自动更新又把装机汉化覆盖回英文，且这次 `hanhua-backup-*` 被**一并清掉**，
  `build.sh` 走的仍是「安装目录即英文原版」这条首次构建路径；本次 `apply.sh` 已把英文原版存成
  `hanhua-backup-20260916-112157`。
- **模板变量自动重映射 37 条**（`qi(…)→Ui(…)`、`Tn(…)→Pn(…)`、`zi(…)→Bi(…)`、`eD(u,o)→tD(u,o)`、
  `DO()→QO()`、`Ez/Cz/wz/kz` 一族整体移位、半截模板 `ve?→be?` 等），**歧义 2 条人工改名**
  （都是 0.0.105 就中过一次的老面孔：锚文本在 bundle 里命中多处且插值不一致，工具拒绝猜）：
  `` `Remove ${Ae.configKey}` `` → `` `Remove ${$e.configKey}` ``、
  `` `Could not select ${de.name}: ${We}` `` → `` `Could not select ${fe.name}: ${Ze}` ``。
  修完即 `all keys matched`——首跑时正是这 2 条把构建卡在 MISSED 上。
- **新增「首个标签页折扣」4 条**（`HM()` 拼出 tooltip，`agent-menu-note` 那行显示 children）：
  - tooltip（可用时）`` `First-tab discount: up to ${e.amount} Freebucks off one session at a time,
    shared across Desktop and CLI. Prices shown include the discount.` ``；
  - tooltip（占用中）`Your first-tab discount is in use. Parallel sessions pay the regular price.
    The discount becomes available when that session ends.`；
  - agent 菜单行 `` `First-tab discount · up to ${ve.firstTabDiscount.amount} Freebucks off` ``；
  - agent 菜单行（占用中）`First-tab discount in use`。

  折扣没有别的界面文案：`firstTabDiscount` 在 bundle 里共 16 处命中，按字面量去重后正好这 4 条。
- **主进程无需改动**：`electron/*.cjs` 与 0.0.113 产物经 `diff -rq` 实测**逐字节一致**，
  7 个补丁干净套用，`postbuild` 哨兵与行为取证全过；`tools/ui_patch_status.js` 对 0.0.114 原版给出
  **KEEP**（3 条锚点各命中 1 处、上游仍带该缺陷）。`tools/mainscan.js`（0.0.113 新增的工具，本轮第一次
  真正投入适配流程）报 疑似 0 / 短标签 0 / 约定保留 66。
- **门禁实测**（`tools/update.sh` 七步全绿）：`lint_dict` 0 错误（exact 1192 / template 276 / code 8 /
  pattern 75）；词典对主 bundle **替换 1817 处 + `all keys matched`（MISSED 0）**；`uipos` 14 条
  （首跑 16 条就是新文案那两条，补完回落）、`fieldscan` 1 条（`tagline: 0 Freebucks`）、
  `blindscan` 283 条（首跑 287 条，多的 4 条正是折扣文案），三条均与 0.0.112 / 0.0.113 持平；
  `postbuild` 自检通过（UI 行为补丁 3/3 条哨兵 + 行为取证通过）。
- **回归闸门**：对比 `pack-v0.0.113`，英文片段 **240 → 240、新增 0 处** ✓——它首跑就揪出了那 4 条折扣文案
  （`First-tab discount in use` / `First-tab discount · up to Freebucks off` / 两条 tooltip），
  补翻后转绿，又一次先于人工发现新版文案。（数字比 0.0.113 那次小，是因为本轮修了下面的提取器
  关键字判据：重跑同一对比从 242 → 240，两个方向都用同一套口径，对比本身不受影响。）
- **修掉提取器里的两个真 bug（`regress.js`，upstreamdiff 共用）**：
  - `CODEISH` 里的语句关键字写成带尾空格的 `let ` / `var `，于是「Wa**llet** 开头的整句」被当成代码
    滤掉；改成 `\b(?:function|typeof|const|let|var)\b`（真 bundle 里当前 0 处命中，但这是迟早会踩的坑），
    代价是 5 条库内部 / CSS 类名片段不再进清单；
  - `collectFragments(file)` 一度写成「是路径就读文件、否则当源码」的嗅探——把 2.4 MB 源码文本当路径
    丢给 `fs.existsSync` 会直接触发 Node 的断言崩溃（`idna.c / code_point`），且只在大 bundle 上必现。
    改为两个显式入口：`collectFragments(file)` 只收路径，`collectFragmentsFromSource(src)` 收文本。
- **新增 `tools/upstreamdiff.js`：上游新增文案清单，不靠上一版汉化包。**「本版要翻什么」这件事本来就
  不需要汉化包——两版**英文原版**一比就知道，而 `regress` 的前提（存在上一版包）首次发布 / 离线就没了。
  - **原版从哪来**（真正的难点）：装机目录的英文原版会被自动更新覆盖（本轮 `hanhua-backup-*` 被一并清掉），
    所以 `build.sh` 每跑一次就把本版英文原版归档到 `work/upstream/<targetVersion>-<bundle 名>`（唯一手里
    正好拿着英文原版的地方），`--auto` 取最新两版，也可直接给两个路径（bundle / ui 目录 / resources 目录）；
    本轮又把它升级成可搬运的快照仓库 `work/pristine/<版本>/`（见下面 pristine 那条）。
  - **判据与 `regress` 共用同一份提取器**（抹掉 `${...}` 再比，minifier 改名不误报），但口径更宽
    （≥2 词、不要求常见小词）且分两个桶（文案 / 短片段），并与词典做子串比对，把新增拆成
    **词典未覆盖（待翻清单）/ 已覆盖**两半；一段改写按词重合度**配对**成一组（不再是一增一下线两件事）；
    报告另有「上一版下线」桶（对应词条可能已成死条目）。
  - **接进流程**：`update.sh` 第 6 步（与回归闸门同一个步骤：两个基线、两个视角），结论进小结
    （`词典已全覆盖 ✓` / `⚠ 有待补翻` / `跳过（还没有上一版原版缓存）`），CI 跑
    `tools/test_upstreamdiff.js`（11 组用例：插值改名不算新增、分桶与词典覆盖、改写配对、注释 / CSS /
    代码片段不进、两桶口径与 Title case 短标签的现状、`--auto` 挑版本号最大的两版、快照仓库作基线且按版本去重、退出码 0/1/2）。
  - **实测**（拿本版原版裁掉那 4 条折扣文案冒充「上一版」）：报告正好列出这 4 条为上游新增、且 4 条都已
    被词典覆盖（exit 0）——即本版若早有这份清单，补翻清单是现成的；真实跑 `update.sh` 时该步在
    有缓存的情况下也如期工作了。
- **新增 `tools/pristine.js`：英文原版快照仓库，把「上一版英文原版」变成可跨机器搬的东西。**
  起因是上一条留的尾：那份归档只活在本机的 `work/` 里，换机器、清过 `work/`、或让另一台机器发布，
  基线就没了——而这一步一旦没有基线就只是「跳过」，正是这套流程一直在治的安静失效。
  - **本机到底还有哪些原版（实测）**：`hanhua-backup-*` 备份（自动更新会一并清掉）与未汉化的装机目录
    是**本机仅有的两个活源头**；Freebuff 的更新下载缓存
    （`%LOCALAPPDATA%/@codebufffreebuff-desktop-updater/`）里**没有安装包**——electron-updater 装完即删，
    只剩一个 `current.blockmap`；临时目录里的安装包只活几分钟（本轮 11:17 还在、随后就被清掉）。
  - **官方发布源是永久的那一个**：更新源 `freebuff.com/api/desktop/updates/win-x64/latest.yml` 302 到
    GitHub Release（`CodebuffAI/codebuff-community` 的 `freebuff-desktop-v*`），旧版安装包**至今可下**
    （0.0.110 / 0.0.112 / 0.0.113 / 0.0.114 实测均为 200），`list --remote` 用 HEAD 把它们列出来
    （不计 API 配额）。只有 win 的 NSIS 解包需要 7-Zip（本机没有）；缺他时 `capture --exe` 会把三条
    替代办法直接打出来（装 7-Zip / 图形界面解包后 `capture <目录>` / 改走 import）。
  - **快照内容**：`ui/index.html` + 主 bundle + `electron/` 下的 `.cjs/.html`（与 `mainscan` 的枚举口径
    一致）。第一版只收了 `.cjs`，结果 `consent-window.html` 漏在外面——快照当原版时 `mainscan` 的
    「两边都有才比」会把那个文件静默跳过，于是改成 `\.(cjs|html)$` 并加了自测。
  - **子命令**：`capture`（备份 / 装机原版 / 已解包目录 / app.asar / NSIS 安装包）·
    `export` / `import`（单文件 `.json.gz`，Node 内置 zlib，无外部依赖；`--from-release` 直接从我们自己的
    Release 取）· `publish`（附到 `pack-v<版本>` Release）· `list [--remote]`（逐文件 sha1 校验，损坏就报 ✗）·
    `path`（给 shell 脚本用的可用快照目录）。退出码 0 / 1（损坏、冲突）/ 2（用法、缺依赖、取不到来源）。
  - **接进流程**：`build.sh` 把原来的单文件归档换成 `capture`（已存在就一行跳过，不重写；失败只提醒不拦构建，
    缺的只是「下一次的基线」）；`release.sh` 闸一找不到本机原版时退一步用快照里的 `electron/`（免解包，
    发布机可以不装 Freebuff），发布成功后自动 `publish` 把快照作为附加资产传上去（失败只 WARN）；
    `update.sh` 第 6 步只有一版基线时不再只说「下次再说」，直接打出三条补齐命令。
    `upstreamdiff --auto` 同时认快照仓库与旧式单文件归档，并**按版本去重**——否则同一版会被当成
    「上一版」与「本版」自比，结论永远是「新增 0 条」。
  - **自测**：`tools/test_pristine.js`（CI 跑，9 组）：采集口径含 `.html`、`*.test.cjs` 不入、幂等与 `--force`、
    版本从 app.asar 的 `package.json` 推断（文件名与之不符时打 WARN 并按包内登记）、解包器调用形态、
    NSIS 安装包的两次 7z 编排与缺 7-Zip 时的三条替代办法、坏输入与路径穿越、export→import **逐字节往返**、
    篡改文件 / 版本冲突拒收、`list` 能发现缺件、退出码 0/1/2 契约、参数引号按平台取（见下条）。
  - **CI 揪出一个只在 POSIX 上炸的 bug**：NSIS 解包出来的目录名恰好就叫 `$PLUGINSDIR`，而 `run()` 用双引号
    包参数——POSIX sh 的双引号里 `$` **仍会展开**，于是内层 `app-64.7z` 的路径变成 `/…/nsis//app-64.7z`，
    Linux / macOS 上 `capture --exe` 第二步必挂；Windows 的 cmd.exe 不展开 `$`，本地怎么跑都是绿的。
    改为按平台取引号形式（Windows 双引号 / POSIX 单引号并转义内部单引号），两条分支都写进自测
    （POSIX 分支在 Windows 上跑不到，不这样钉就只能等 CI）。这次是**先推上去让 CI 跑**才发现的，
    `gh run view --log-failed` 里那行 `nsis//app-64.7z` 就是全部证据。
  - **实测**：`capture --install` 从 `hanhua-backup-20260916-112157` 拿到 31 个文件（含 28 个主进程文件）；
    `export` 得到 1.2 MB 的 `pristine-0.0.114.json.gz`；把它 import 回来与导出前逐文件比对一致；
    拿一份合成的上一版快照跑 `upstreamdiff --auto`，报告如实列出本版新增的 3 条折扣文案；
    `release.sh` 闸一在「用快照」与「解包 asar」两条路径上给出**完全相同的数字**
    （28 个文件 / 946 条字面量 / 两边都有 817 条 / 约定保留 66 条）。
- **已发布**：汉化包 Release `pack-v0.0.114`（`hanhua-pack-0.0.114.zip` 14 012 411 B + `pack-manifest.json`），
  两道英文闸门全绿，`pack-manifest.json` 的 sha512 与本地 `dist/` 包逐一核对一致。
  本版起 Release 多一个附加资产 **`pristine-0.0.114.json.gz`**（30 个文件，与本地 `work/pristine/0.0.114/`
  逐文件 sha1 一致）——别的机器一条 `pristine.js import --from-release 0.0.114` 就有了发布闸门要的英文
  原版，不必装过 Freebuff、也不依赖本机更新缓存。（`pack-v0.0.113` 从未发布：上游当天就跳到 0.0.114，
  适配与发布合并成这一版。）

## [0.0.113] · 2026-09-16

**适配 0.0.113：上游把 Freebucks 每日额度的说明整段重写（新增 `eD()` 下次补充提示），
赞助任务多了一条沙箱阻断原因**——下线 1 条、新增 9 条，替换数 1807 → 1813。
主进程与 0.0.112 产物**逐字节一致**，`patches/` 无需改动。

- **适配 Freebuff v0.0.113**：targetVersion / packVersion 升至 0.0.113；渲染 bundle
  `index-BGPVyb6x.js` → `index-02HepJVd.js`，样式表仍为 `index-YJ7gnGWz.css`（与 0.0.112 产物
  哈希一致，本轮 CSS 零变化）。本机自动更新把装机汉化覆盖回了英文，且 `hanhua-backup-*` 已不在，
  `build.sh` 走的仍是「安装目录即英文原版」这条首次构建路径；这次 `apply.sh` 会把英文原版
  存成 `hanhua-backup-<时间戳>`，之后 `remap` / 回归对比又有 pristine 可用。
- **模板变量自动重映射 47 条**（`tools/remap.js`：`Ps(…)→oo(…)`、`Ns→Qs`、`v.branch→S.branch`、
  `QO()→DO()` 等），**歧义 1 条人工改名**（锚文本在 bundle 命中 3 处且插值不一致，工具拒绝猜）：
  `` `resets in ${Ps(u.resetAt,o)}` `` → `` `resets in ${oo(u.resetAt,o)}` ``。
  另有 1 条落 MISSING，正是上游整段重写的余额提示（见下）。
- **Freebucks 余额提示整句重写**：旧句 `… Spent before your wallet, and they do not carry over —
  refills in …` 变成 `… Spent before your wallet; unused daily Freebucks do not carry over. ${eD(u,o)}
  Timezone changes apply after the next refill.`（插值函数由 `Ps(u.resetAt,s)` 换成新的 `eD(u,o)`，
  即 0.0.113 新加的「下次补充」提示函数）；旧词条留着会卡 MISSED 门禁，已改写。
- **新增 `eD()` 一整套补充提示**（共 4 条 + 1 个常量）：
  `The daily refill is due. This is the last confirmed balance; an updated balance will appear shortly.`
  （`resetAt` 已过时）、`Check your daily reset countdown.`（拿不到时间的兜底）、
  `` `Next refill: ${n.toLocaleString(void 0,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}
  (your device time).${t.resetTimeZone?…}` ``（含内嵌模板的「重置时区」尾巴，译文沿用「从内层模板的
  收尾反引号接着写」的半截模板形态，并在 `lint_dict.js` 的 `TRUNCATED_TEMPLATE_ANCHORS` 里
  登记了新骨架 `(your device time).`）、
  `` ` Reset timezone: ${t.resetTimeZone.replace(/_/g," ")}.` ``（内层模板本体，时区名是数据不译）、
  以及余额环上的 `Updating balance…` 常量。
- **入门卡片整段重写**：`Your daily Freebucks refill at midnight Pacific. Nothing to earn, nothing to
  wait for.` → `Your daily Freebucks refill at midnight in your reset timezone. Your first refill may
  arrive earlier; timezone changes can delay a later refill. Your balance shows the next refill time.`
  （旧词条下线，新句进 `exact`）。
- **赞助任务新增 1 条阻断原因**：`Sponsored tasks cannot start because the workspace sandbox is not
  working on this machine. No paid task has started.`（`lF` 阻断原因表的
  `containment-probe-failed` 分支，是本次唯一新增的赞助任务文案；同一张表里其余四条
  —— Windows / 其他平台 / 缺 bubblewrap / 缺桌面同意桥 —— 0.0.112 就已在词典里，未变动）。
- **主进程无需改动**：解包比对确认 0.0.113 的 27 个 `electron/*.cjs` 与 0.0.112 产物**逐字节一致**
  （asar 里唯一新增的是 SDK 测试文件 `node_modules/@codebuff/sdk/src/__tests__/
  sponsored-containment-probe.test.ts`），7 个补丁仍干净套用，`postbuild` 的哨兵与行为取证全过；
  `tools/ui_patch_status.js` 对 0.0.113 原版给出 **KEEP**（3 条锚点各命中 1 处、缺陷仍可复现）。
- **门禁实测**：`lint_dict` 0 错误（exact 1190 / template 274 / code 8 / pattern 75）；词典对主 bundle
  **替换 1813 处 + `all keys matched`（MISSED 0）**；`uipos` 界面属性位置残留 14 条（与 0.0.110 / 0.0.112
  持平，均为约定保留的模型名 / `Freebuff` / MCP 配置示例 / `bun install` / CodeMirror 内部标签）、
  `fieldscan` 1 条（`tagline: 0 Freebucks`）；`blindscan` 疑似文案 283 条（与 0.0.112 持平，
  新增 0 条应用文案，唯一「新增」是 `in r3.documentElement.style` 这类代码片段）；
  `postbuild` 自检通过（纯字面量词条覆盖 1148/1148）；`remap` 对英文原版重跑：274 条模板全 SAME、
  歧义 0、MISSING 0。
- **回归闸门**：对比 `pack-v0.0.112`，英文片段 **242 → 242、新增 0 处** ✓（首跑时它先揪出了赞助任务的
  那条新文案，补翻后转绿）。
- **顺带补翻主进程遗留英文（3 个文件、29 处改动）**：这批文案 **0.0.112 之前就在**，7 个补丁
  没覆盖到，而 `regress` / `uipos` / `blindscan` 都只盯 UI bundle（扫不到主进程），是逐个从原版
  `electron/*.cjs` 比对出来的：
  - **Bun 崩溃对话框整段**（`orchestrator-failure.cjs` 的 `describeBunCrash`）：标题
    `Freebuff failed to start`、正文 `This is a bug inside Bun rather than in Freebuff, and the log has
    the full report.`，以及 Windows 兼容版本那两行说明（`On this PC the standard build of that
    runtime is the one crashing. …`）；
  - **菜单与原生对话框**（`main.cjs`）：标签页右键菜单 `Export as Markdown…` /
    `Move to New Window` / `Move Tab to New Window`，崩溃对话框按钮 `Get Compatibility Build`，
    附件选择器的文件类型 `Images` / `All Images`，保存对话框标题 `Export thread as Markdown`；
  - **启动失败对话框的正文**：`The shell lifetime server is unavailable.`、
    `Failed to start the orchestrator with "…": …`、`The bundled Bun runtime could not be launched.` /
    `Make sure Bun is installed or set FREEBUFF_BUN_PATH.`、
    `The failed orchestrator could not be stopped. Restart Windows and try again.`，以及 Linux
    沙箱失败对话框结尾的 `(… process: …)` 括注；
  - **`shell:openIn` 的六条报错**：`Invalid open request` / `Invalid open target` /
    `Invalid line number` / `That application is not available` / `The workspace path is
    unavailable` / `That application cannot open this path`（都经 IPC 回到界面提示）；
  - **MCP 同意窗口**（`mcp-consent-bridge.cjs`）：第二行说明
    `Environment variable names are shown; their values are not.`、按钮组
    `['No', 'Yes']` / `['Cancel', local ? 'Run it' : 'Connect']`，以及赞助任务那组字段标签
    `Task:` / `Procedure:` / `User task N:` / `Folder:` / `Branch:`（`Command:` / `Arguments:` /
    `Directory:` / `Environment:` / `Address:` 那一组早就译过了）；
  - **补丁重生成与哨兵**：这三个文件的 `patches/electron-*.patch` 改为从**真实基线**（原版 LF +
    词典，即 `build.sh` 打补丁前的状态）重新生成，现有改动与本次补翻合并成一份；`git apply`
    干净套用，产物侧与预期内容逐字节一致。`tools/postbuild.js` 为本次补翻新增 **13 条译文哨兵**
    （`main.cjs` 9 条、`orchestrator-failure.cjs` 2 条、`mcp-consent-bridge.cjs` 2 条），
    把「补丁只套了一半」挡在装机前；
  - **有意保留英文（不属遗留）**：`open-in.cjs` 里的应用名与可执行文件（Visual Studio Code /
    Cursor / Zed / Windows Terminal / Command Prompt / File Explorer / `Code.exe`…——产品名，
    且被用于探测匹配）、`Task Manager` / `Activity Monitor`、格式名 `Markdown`、
    `SIGKILL` / `SIGTERM`、CDP 协议方法名、`[orchestrator]` / `[updater]` 开头的控制台日志，
    以及 bridge 的 HTTP 错误码文本（日志与协议，不是界面文案）。
  - **复查方式**：`node tools/mainscan.js <原版 electron 目录> <产物 electron 目录>`——目标字符串
    全部消失，剩余英文都是上面「保留」那批（当时用的是 `work/` 下的临时审计脚本 `audit-main.js`，
    本次已固化成正式工具，见下条）。
- **新增 `tools/mainscan.js`：把这次「主进程英文对差」固化成正式工具，`update.sh` 从 6 步变 7 步。**
  上次的 29 处是靠 `work/` 下一个临时脚本扫出来的，靠人记得跑——而「主进程漏翻」恰恰是没有任何
  构建门禁会报的那类问题：`uipos` / `fieldscan` / `blindscan` / `regress` **全都只看 UI bundle**，
  主进程的文案（菜单、原生对话框、`shell:openIn` 报错、MCP 同意窗口）既不在词典的 `exact`
  （只替双引号字面量）也不在任何扫描器的视野里。
  - **判据只有一条**（与 `blindscan` 相同）：片段在**英文原版**里存在、在**产物**里原样还在 ⇒ 没被翻过；
    比较按文件进行，报告直接给 `main.cjs:495` 这样的位置与原版上下文。
  - **三桶而不是一堆**：`疑似文案`（多词 + 含常见小词，判据直接复用 `blindscan.js` 的 `isLikelyCopy`，
    两支工具的「像句子吗」结论不会互相打架；非空即 exit 1）、`短标签待过目`
    （`Invalid open request` / `Get Compatibility Build` 这类判不出句子感的短词，人工看一眼）、
    `约定保留`（品牌名 / 日志 / 协议错误码 / 协议方法名…，逐条登记在 `INTENTIONAL` 名单里**并写明理由**）。
    修好的标准因此不是「零英文」，而是**只剩约定保留这一桶**。
  - **刻意写了词法扫描**（`blindscan` 是刻意不写）：主进程是 27 个可读的 CJS 文件、没有 minified
    bundle 那种含怪模板的怪物，而这里最大的噪音是**注释**——`electron/*.cjs` 里大段英文注释占一半
    以上，朴素 grep 会把报告直接淹掉。于是逐个字符扫：跳注释、认正则字面量、只收真正在代码里的
    字符串字面量（模板插值内部也收，那正是词典够不着的位置）。
  - **接进流程**：`update.sh` 第 5/7 步解包两侧 `app.asar` 后对差（只报告不拦脚本——迁移途中本就
    该先发现再补，但结论进小结：`未发现漏翻 ✓` / `⚠ 有疑似漏翻` / `跳过`）；CI 跑
    `tools/test_mainscan.js`（12 组用例：注释、转义引号、模板插值、正则字面量、保留名单、目录解析、
    三桶分类与退出码 0/1/2——这些地方改错都会**静默**误判，只有自测能提前发现）。
  - **实测**：对本次产出的 0.0.113 汉化产物报 **疑似 0 条 / 短标签 0 条 / 约定保留 66 条**（exit 0）；
    对补翻前的产物（`patches/` 还没写那 29 处时）报出 16 条疑似文案 + 8 条短标签，正好覆盖本次
    补的那批。文档侧：`docs/更新维护.md` 的「第六种静默失败」改用本工具作为查法、工具表补两行。
- **`release.sh` 新增「闸门一：主进程英文扫描」，发布时才真的拦。**`update.sh` 那一步只报告
  （迁移途中本就该先发现再补），但「到底补完了没有」只有发布这道口子拦得住：拿英文原版的
  `electron/*.cjs` 与待发布的产物对差（原版取自本机最新 `hanhua-backup-*`，与 `build.sh` 同源），
  有疑似漏翻即 `exit 1`，并打印补翻路径（写进 `patches/electron-*.patch` → 重跑 `build.sh`；
  确认该保留英文就登记进 `mainscan.js` 的 `INTENTIONAL`）。`--allow-english` 现在同时放行两道
  闸门（本来只管回归闸门），报告里写「两道英文闸门都只报告不拦截」。发布机找不到英文原版时
  **响亮地跳过**并说明原因——静态闸门静默失效正是这套流程一直在治的毛病。
  - 实跑验证两条路径：拿英文原版 `app.asar` 冒充「主进程没翻」的产物 → **exit 1、报告停在闸门一、
    没有产出任何包**；加 `--allow-english` → 打印 WARN 后继续跑完回归闸门并打包（验证完已还原
    产物与 `dist/` 包，`sha1` 与发布前一致）。
  - 顺带修掉一个会让闸门「假失败」的坑：临时解包目录 `rm -rf` 在 Windows 上偶尔删不掉
    （解包树里的 vendored `sdk/vendor/ripgrep/*/rg.exe` 被安全软件 / 正在运行的应用占住），
    配合 `set -e` 会让脚本在闸门判定**之前**就 abort——退出码与真拦截一模一样，很容易误判。
    两处（`update.sh` 与 `release.sh`）改为 `mktemp -d` + 清理失败只提醒不中止。

## [0.0.112] · 2026-09-15

**适配 0.0.112：新增「继续被中断的轮次」与消息队列暂停态的一整组文案，BYOK 连接说明与
DeepSeek 限时促销 tooltip 被上游整段重写**——下线 9 条、新增 20 条，替换数 1796 → 1807。

- **适配 Freebuff v0.0.112**：targetVersion / packVersion 升至 0.0.112；渲染 bundle
  `index-DVP89Kth.js` → `index-BGPVyb6x.js`，样式表 `index-DYQ73KeT.css` → `index-YJ7gnGWz.css`。
  本机自动更新是从 0.0.110 直接跳到 0.0.112，没有 0.0.111 的包。
- **模板变量自动重映射 65 条**（`tools/remap.js`），**歧义 2 条人工改名**（锚文本在 bundle 里
  命中多处且插值不一致，工具拒绝猜）：`` `Remove ${$e.configKey}` `` → `` `Remove ${Ae.configKey}` ``；
  `` `Could not select ${he.name}: ${Ye}` `` → `` `Could not select ${de.name}: ${We}` ``。
  另有 2 条落 MISSING，正是上游整段改写的促销 tooltip（见下）。
- **新增「继续被中断的轮次」一条链路**（回合被 orchestrator 崩溃打断后 composer 里出现的按钮）：
  `Continue the interrupted turn` / `Continue the interrupted turn, then run queued messages`
  （`data-tooltip`，队列非空时用后者）、`Continue interrupted turn`（`aria-label`）、
  `Continuing…`（按钮进行态）、以及点下去实际发出的那句
  `Continue the interrupted request from where you left off.`。
- **消息队列暂停态文案重写**（旧的一组「Resume …」整句下线）：
  `Send now to go first, or resume the queue.`（配既有 `Queue paused.` /
  `Queue paused after an error.` 拼成一句）、`Send now, then run queued messages (Enter)`
  （替代 `Send and resume queue (Enter)`）、`Type a message — sent before the queue`
  （替代 `Type a message — sending resumes the queue`）、
  `Add this message to the queue; keep the queue paused`（队列暂停时 Queue 按钮的 tooltip）、
  模板 `` `Send now, steering the running turn (${QO()}Enter)` ``（发送键的接管 tooltip）；
  按钮本体 `Resume queue` / `Resume the queue` / `Send now` / `Add to queue` / `Send message` 都在。
- **BYOK 连接说明改写 3 条 + 运行中提示 1 条**：
  `Existing tasks keep their old connection revision until you select the replacement in the model picker.`、
  `Key replaced. Select this updated connection in the model picker to continue your task.`、
  移除确认句扩写为 `? Tasks using it will stop before their next model request. Select another provider
  or a Freebuff model to continue the same conversation.`；模型选择器在回合运行中的提示
  `Switch providers or Freebuff models here while keeping this conversation. Finish or stop the current
  turn and clear queued messages first.`（它替掉了原来「本任务正在使用你选中的提供商 / 你可以把此任务
  切换到你自己的 API 提供商」那对三元分支，两条旧词条随之下线）。
- **DeepSeek 限时促销 tooltip 整段重写**：旧句 `X drops to N Freebucks on a plan — A a day instead of B.`
  变成 `X: A hours a day on Plan instead of B hours for free.`。旧的两条词条
  （`` `${u} drops` `` 与以 `:"Drops"}` 开头的半截模板尾巴）**留着会卡 MISSED 门禁**，已删除；
  新增三条：`` `${a}: ` ``（三元真分支的嵌套模板）、`` `${u} hour${u===1?"":"s"}` ``（小时数格式化，
  译文按既有复数吸收写法收成 `${u} 小时`）、以及外层尾巴
  `` `:""}${o(r)} a day on ${n.displayName} instead of ${o(i)} for free. …` ``
  （沿用 0.0.110 那套「从内层模板的收尾反引号接着写」的半截模板形态，`lint` 的 E3 骨架校验通过）。
- **其余新增**：`Project threads`（计划反馈输入框的会话选择菜单，与既有
  `Project threads and files` 区分开）、`Worktree`（@ 提及里执行模式的回退标签，与已译的
  `Shared workspace` 成对）、`Customized Freebuff built-in · ${…}`。
- **顺带补翻 1 条历史遗留**：`` `Customized Freebuff built-in · ${t.builtin==="personal"?"all projects":"this project"}` ``
  ——技能徽章的前缀一直是英文（旧词典只收了插值里的 `all projects` / `this project`），
  `blindscan` 的「两个版本都在」列表里躺着，这次补上；补后该条从盲区扫描里消失。
- **下线 9 条**（7 `exact` + 2 `template`）：`Resume`、`Resume it, or send a message to continue.`、
  `Send and resume queue (Enter)`、`Send message and resume queue`、
  `Type a message — sending resumes the queue`、`This task uses your selected provider. …`、
  `You can switch this task to your API provider. …`，以及上一条里那两条促销模板。
- **主进程无需改动**：解包比对确认 0.0.112 的 `electron/*.cjs` 与 0.0.110 产物**逐字节一致**
  （本轮 asar 树里变的只有渲染 bundle 与 `node_modules/@codebuff/sdk` 的
  `byok.ts` / `client.ts` / `run.ts` 与 `package.json` 版本号），7 个补丁仍干净套用，
  `postbuild` 的哨兵与行为取证全过；`tools/ui_patch_status.js` 对 0.0.112 原版给出 **KEEP**
  （3 条锚点各命中 1 处、缺陷仍可复现），UI 行为补丁继续保留。
- **门禁实测**：`lint_dict` 0 错误（exact 1186 / template 272 / code 8 / pattern 75）；词典对主 bundle
  **替换 1807 处 + `all keys matched`（MISSED 0）**；`uipos` 界面属性位置残留 14 条（与 0.0.110 持平，
  均为约定保留的模型名 / `Freebuff` / MCP 配置示例 / `bun install` / CodeMirror 内部标签）、
  `fieldscan` 1 条（`tagline: 0 Freebucks`）；`blindscan` 疑似文案 299 → 283、
  **新增 0 条应用文案**（只剩 React / CodeMirror / shiki 这类库内部英文）；`postbuild` 自检通过
  （纯字面量词条覆盖 1144/1144）；`remap` 对英文原版重跑：272 条模板全 SAME、歧义 0、MISSING 0。
- **回归闸门的一个已知误报**：对比 `pack-v0.0.110.1`，英文片段 242 → 242、差集只有 2 条
  `` ,message:D instanceof Error?D.message: `` 与 `` :D instanceof Error?D.message: ``——**不是界面文案**，
  是新版 `catch(D){… {kind:"error",message:D instanceof Error?D.message:"Could not read this file"}}`
  这种类型守卫写法被提取器跨引号配对出来的代码片段（`regress` 的「自然语言」判据对 `instanceof` 不设防）。
  该版发布后成为新基线，这两条自然消失，无需改工具；首次发布时按闸门惯例用 `--allow-english` 放行。
- **装机已实测**：`ui/index.html` 为 `lang="zh-CN"` + `hanhua-pack` 0.0.112，装机 `app.asar` 与
  `ui/assets/index-BGPVyb6x.js` 与 `output/` **哈希一致**；自 0.0.110 起就没有备份链，本次 `apply.sh`
  先把英文原版存成了 `hanhua-backup-20260915-182128`（今后 `build.sh` / `remap` 有 pristine 可用，
  不必再走「安装目录即英文原版」那条首次构建路径）。

## [0.0.110] · 2026-09-13

**适配 0.0.110：上游把整块「会话退款」面板撤了（合并成 composer 里的一句提示）、重写了推理档位标签，
顺带补翻 24 条历史遗留英文**（连接器面板 / 目录、预览报错、购买时段与高峰定价 tooltip、「编辑一条消息」提示、移动端镜像状态）。
替换数 1785 → 1796；词典 exact 1176→1181 / template 264→269 / code 6→8 / pattern 73→75。

- **适配 Freebuff v0.0.110**：targetVersion / packVersion 升至 0.0.110；渲染 bundle
  `index-WHL57zaM.js` → `index-DVP89Kth.js`，样式表 `index-Bz7qlcod.css` → `index-DYQ73KeT.css`。
- **模板变量自动重映射 15 条**（`tools/remap.js`：`PO()→RO()`、`lv(t,e)→cv(t,e)`、`qAe/6e4→IAe/6e4` 等），
  **歧义 0 条**。另有 4 条落 MISSING，正是上游删掉的那 4 条退款模板（见下）。
- **下线 19 条词条**（15 `exact` + 4 `template`）——上游把「会话退款」面板整体移除，只留一句合成提示：
  `Retrying session end` / `Refund processing` / `Refund unconfirmed` / `Session refunds` /
  `Recent session refunds` / `Final refund confirmed by the server.` /
  `The server did not report a refund amount. No credit is assumed.` /
  `Session ended · refund unconfirmed` / `Session settled · no refund` / `Previous session` /
  `Your conversation is saved. Desktop will retry automatically when connected.`，
  以及 4 条模板 `Retrying ${e} session ends` / `${n} refunds processing` /
  `${t.freebucks} Freebucks refunded` / `` Session started ${new Date(e.admittedAt)…} ``（留着会卡住 MISSED 门禁）。
- **0.0.110 新增/改写的文案**：
  - **推理档位标签重写 4 条**：`Sprint — what was asked, working, with essential proof` /
    `Focused — what was asked, checked through the real surface` /
    `Thorough — proven and pruned on every dimension` /
    `Exhaustive — the most careful version of exactly what was asked`
    （`Crafted — correct, clean, and proven` 一字未动；旧的四条文案随上游改写下线）。
  - **新的退款提示是 JSX 文本节点拼出来的**：`children:["Session", … "from", … "auto-ended after
    inactivity · ", <金额>, " Freebucks returned."]`。uipos 看不见模板插值内部、`pattern` 又只认
    第 0 层字面量，所以分两步钉住：`code` 逐字片段 `children:["Session",` 与 `" ","from"," "`
    （不含压缩变量名，下个版本不会失效），其余两段走 `exact`。
- **顺带补翻 24 条历史遗留英文**（0.0.109 及更早就在，且 `uipos` / `fieldscan` / `regress` 都扫不到——
  它们藏在 `children` 数组的三元分支、模板插值内部或函数默认值里；13 `exact` + 9 `template` + 2 `pattern`）：
  - 连接器 / MCP 面板：`Community setup guide` / `Setup documentation` /
    `Connection states are unavailable.` / `Showing the last known connection states.` /
    `Connector was added. Refresh your connectors to continue setup.` /
    `A custom MCP server that runs on your computer.` /
    `A custom MCP server connected through its own address.`；
  - 连接器目录 3 条：`Dropbox describes this remote server as an open beta.` /
    `Requires a Canva account and a client registration or compatible client metadata.` /
    `Requires a Slack app identity and administrator-approved OAuth scopes.`；
  - 模板 8 条：`Could not launch the preview: ${…}` / `Could not stop the preview: ${…}` /
    `` Peak pricing: +${…} a session while DeepSeek charges double, … `` tooltip /
    购买时段 tooltip（外层嵌套，含 `This purchased hour is in use in another tab`、`Resume your
    purchased hour` 与 ` Use that tab, or choose “Use it here” …`）/「编辑一条消息」一族 4 条
    （`Editing a message — sending will replace it${…}`、` Observed changes in ${…} will remain.`、
    `remove the ${…} after it`、`revert changes to ${…}`）；
  - 移动端镜像状态：`pattern` 收 MCP 开关的 `` `${$e.enabled?"Disable":"Enable"} ${$e.configKey}` ``
    （`禁用` / `启用`），`exact` 收 `On`（已开启，与已译的 `Off` 成对），模板收
    `` On · synced ${…} ``（已开启 · 已同步 …）；
  - 另修两处译文：`` Move ${r.title||"new thread"} to a new window `` 的中文里残留英文回退值
    （`new thread` → `新会话`，与 `Close ${r.title||…}` 那条保持一致）；
    `Error: ${t.detail??"unknown"}` 的译文里 `unknown` 一并译出（→ `未知`）。
- **主进程无需改动**：0.0.110 只动了 `electron/shell-lifetime.cjs`（退出时先 `socket.end('quit\n')`，
  注释说明 Windows 没有 SIGTERM）与 `package.json` 版本号，无用户可见新文案；`patches/` 的 7 个补丁
  仍干净套用，`postbuild` 的 6 个必检哨兵 + `renderer-health.cjs` 可选哨兵全过。
- **修正重发 0.0.110.1**：新增的 `tools/blindscan.js` 第一次跑就扫出连接器目录里漏翻的 setupNote
  （`Google’s server is in Developer Preview and needs a Google Cloud project.`，Gmail / Calendar
  两张卡上各一处）——按「同一 targetVersion 内修正重发」的惯例把 `packVersion` 升到 `0.0.110.1`
  重发，已装 0.0.110 的机器才会自动拉到。`targetVersion` 仍为 0.0.110。
- **修正重发 0.0.110.2**：修掉「**orchestrator 崩溃重启后每个写操作都 403 `forbidden`**」——
  界面只显示「消息未发送: forbidden」。链路：渲染进程把 `preload.cjs` 的 `apiToken()` 读一次就
  **永久缓存**（bundle 里 `hD()` 只认 `og === undefined` 那一次），而 `startOrchestrator` 每次重启
  都 `randomUUID()` 换新令牌、`restartOrchestrator` 又刻意不重载窗口（只让 SSE 重连重同步）→
  此后每个 `POST /api/*` 都被本机 orchestrator 按 launch id 挡下（`orchestrator.js` 的
  `requiresLaunchToken` + `isAuthorizedMutation` → `403 {"error":"forbidden"}`），而只读请求全部
  照常，于是看起来「应用没坏，就是发不出去」，直到窗口重载。改法一行：`const launchId =
  apiLaunchToken ?? randomUUID()`（orchestrator 重启时沿用本次应用会话已发出的 id；安全边界不变——
  令牌依旧只经同步 IPC 交给本窗口、从不进 argv、也不发给上游）。该行随 `patches/electron-main.cjs.patch`
  分发，`postbuild.js` 的 `electron/main.cjs` 哨兵同步加两条断言（中文说明 + 代码行）。
  复现与实测见 `docs/更新维护.md` 的常见问题。
- **修正重发 0.0.110.3**：修掉「**orchestrator 崩溃重启后，被打断的那一轮回复永远不结束**」——
  这是仓库里第一处**不是翻译**的产物改动，也是首次为 UI bundle 引入行为补丁机制
  （`tools/apply_ui_code_patch.js`）。成因：回合内的流式序号 `live.seq` 由 orchestrator 持有、
  **每个新回合从 0 重新计数**（`threadPage` 以 `streamSeq` 回给渲染进程），而渲染进程的流事件守卫
  `if(r.streamSeq!==void 0&&n<=r.streamSeq)return` 序号不增就整条丢弃（`finish` 也在闸前）；
  `boot()` 会把崩溃前未完成的回合重新 `pump()`，但新进程序号从 0 起 —— 本地那条回复带着旧高序号
  （如 42）压住一切，`nY()` 的合并规则又让「本地 `streamSeq` 更大者胜出」，于是此后所有增量与
  `finish` 全被丢弃：回复停在崩溃前的内容、`done` 永远不为真（composer 已解锁，看起来只是「卡住」），
  直到下一条消息新建 `streamSeq:0` 的消息才自愈。**已实测复现**：把装机 bundle 里的 `EG`/`nY`/折叠
  纯函数抽出来跑事故时序（已固化进 `tools/probe_stream_epoch.js`），原始 bundle 是「保留本地部分回复=是、
  seq=4 增量被丢、finish 被丢」，补丁后三项全部为「是」。改法三条协同：重连分支给未 `done` 的消息打
  `streamSeq:-1`（本地序号作废）→ 守卫对 `-1` 放行（`streamSeq>=0&&`，之后自动恢复）→ `nY` 对 `-1`
  一律保留本地内容（硬崩溃时本地那条回复是唯一副本，服务端要等回合结束才落盘），让服务端增量续写在它上面。
  **为什么另起一层工具**：这些改动落在表达式上（守卫条件 / 对象展开 / 三元分支），锚点里全是 minifier
  起的短名字，词典的逐字替换机制无能为力；新工具改用「属性名 + 字面量 + 结构」匹配、短名字经捕获组
  原样带回（改名不失配），并把「必须唯一命中」和「已应用则跳过（哨兵）」做成硬规则，命中 0 处或 2 处以上
  中止构建，`postbuild.js` 另有哨兵自检。三条补丁对 0.0.110 的 `index-DVP89Kth.js` **各命中 1 处**
  （+157 字节），`node --check` 通过，未打标记的消息行为逐字不变。新增自测 `tools/test_ui_code_patch.js`
  （9 组用例：干净 bundle / 幂等 / minifier 改名抗性 / 锚点消失记 MISSED / 锚点重复拒绝 / 括号计数错位拒写 /
  未知 `_hanhua` 前缀拒写 / 注入内容 / CLI 退出码），已接进 CI 的 `lint` 工作流。补丁的验收分三层：
  **锚点唯一命中 → 哨兵（postbuild） → 行为取证（probe，postbuild 硬门禁）**，第三层才是“真的修好了”。
- **补丁验收与退场（工具，与 0.0.110.3 同批）**：新增 `tools/probe_stream_epoch.js` —— **行为取证探针**：
  不从合成片段推断，而是把 bundle 里的相关纯函数**原样抽出来**跑一遍事故时序。`--expect present` 用于原版
  （缺陷必须仍可复现，否则补丁该退场）、`--expect absent` 用于产物（缺陷必须已消除**且未打标记时守卫仍在**
  —— “有效且最小”，防止把守卫整个拆掉那种灵异修法）；三种退出码 0/1/2 分别对应符合预期 / 不符 / 无法取证，
  **抽不到函数一律 rc 2**，绝不据“拿不到证据”去推断“缺陷已消失”。接入三处：
  `tools/update.sh` 新增 **2/6 UI 行为补丁体检**（在花时间构建之前就把「锚点还唯一吗 / 缺陷还在吗」问清楚，
  并在小结里给出判决与退场建议，步骤总数 5 → 6）；`tools/postbuild.js` 在哨兵之后加**硬门禁**——
  哨兵只证明“插进去了”，表达式被改写后变成空操作它照样在，所以产物还要跑一次行为取证，未达标直接中止构建
  （已用「哨兵齐全但行为未修」的假产物实测：3/3 哨兵通过、行为取证未达标、rc 1）；`tools/probe_stream_epoch.js`
  另有自测 `tools/test_probe_stream_epoch.js`（5 组用例，钉住 rc 2 纪律）并进 CI。
- **补丁退场判定（工具）**：新增 `tools/ui_patch_status.js` —— 一条命令回答「上游自己修好了吗、这些补丁能不能删」，
  **不需要参数**（自动找本机英文原版，`hanhua-backup-*` 优先；也可显式传 bundle / `ui` 目录 / `resources` 目录）。
  按**缺陷**分组（一个缺陷可对应多条协同补丁，靠 `PATCHES` 里新增的 `defect` 字段声明），两个维度一起看：
  锚点还能不能套用 × 原版还能不能复现出缺陷，得出 `KEEP` / `REWRITE`（锚点失配但缺陷仍在）/ `RETIRE`
  （上游已复现不出 ⇒ 可安全退场）/ `UNKNOWN`（拿不到证据）”四类结论；退出码 0/1/2/3 分别对应
  全部 KEEP / 有可退场 / 有人工介入项 / 仅无法取证。`RETIRE` 会打印按顺序的删除清单（补丁条目 → 探针与自测
  → `postbuild` 的取证段 → 缺陷登记表 → `update.sh` 的 2/6 步 → CI 步骤 → 本节文档）。
  **护栏**：已打补丁的产物里缺陷必然“复现不出”，拿它判定会得出完全相反的结论，所以看到本次哨兵就
  rc 2 拒绝并告诉你该指哪个文件。`update.sh` 的 2/6 步改用这条命令（删去重复的锚点干跑），
  每次适配新版都会在构建前给出该保留还是该退场的判决；新增自测 `tools/test_ui_patch_status.js`
  （决策表逐行 + 退出码契约 + **清单里点名的文件必须真实存在**，防止清单随文件改名静默腐烂）并进 CI。
- **门禁实测**：`lint_dict` 0 错误（exact 1181 / template 269 / code 8 / pattern 75）；词典对主 bundle
  **替换 1796 处 + `all keys matched`（MISSED 0）**；`uipos` 界面属性位置残留 14 条（与 0.0.109 持平，
  均为约定保留的模型名 / `Freebucks` / `bun install` / CodeMirror 内部标签）、`fieldscan` 1 条
  （`tagline: 0 Freebucks`）；`regress` 对比 `pack-v0.0.109` **262 → 242，新增 0 处**；
  `postbuild` 自检通过（纯字面量 1139/1139）；`test_remap` 15 条样本 + 3 条负面用例全过；
  对英文原版重跑 `remap`：269 条模板全 SAME、歧义 0、MISSING 0（新增的 9 条模板键里包含
  ``  ${$e.enabled?"Disable":"Enable"} ``、`On · synced ${…}`、「编辑一条消息」嵌套族等形态，
  解析器均能正确拆段——不存在“下个版本只能人工拄变量名”的新增特例）。
- **装机已实测**：`ui/index.html` 为 `lang="zh-CN"` + `hanhua-pack` 0.0.110.3，装机主 bundle 与
  `output/ui/assets/index-DVP89Kth.js` 哈希一致。
- **注**：本机装机的 0.0.109 汉化产物已被上游更新覆盖且没有 `hanhua-backup-*`，`build.sh` 走的是
  「安装目录即英文原版」这条首次构建路径；本次是先用 `dist/hanhua-pack-0.0.109.zip` 当旧基线做回归对比。

## [工程] · 2026-09-13

**新增 `tools/blindscan.js`：把 0.0.110 适配时一次性用的「原版 vs 产物」对差脚本固化成正式工具，
并接进 `update.sh` 的残留扫描。**它专治 `uipos` / `fieldscan` / `regress` 都够不着的那批英文——
`children:[cond?"A":"B"]` 三元分支、模板插值内部的字面量、函数默认值与赋值语句里的字符串。

- **工具**：`node tools/blindscan.js <原版 bundle|目录> <产物 bundle|目录>`（目录可以是 `ui/`、
  Freebuff 的 `resources`、或本仓库的 `output/`）。判据只有一条：片段在**原版里与引号相邻**、
  在**产物里原样还在** ⇒ 词典没碰过它（翻过的会变中文；升级时 minifier 改的是插值变量名，
  不动字面量本身）。输出分两桶：「疑似文案」（多词 + 常见小词，判据与 `regress` 的同一套）与
  「其余」（短标签 / 术语 / 库内部 / 品牌词）；每条带原版上下文，`--words 1` 可连单字标签一起找。
- **刻意不写 JS 词法分析器**：2.4 MB 的 minified bundle 里既有正则字面量里的引号、也有 shiki
  那种含反引号的怪模板，朴素扫描会错位配对、把大半个文件当成一个字符串（实测最长一条 38 万字符、
  字面量只抽出 6 千种）；改用「与引号相邻的英文片段」后，2.4 MB 全扫只需 0.2 秒、10094 种片段，
  而 `typeof b` 这类代码片段因不与引号相邻自动排除。
- **接进流程**：`tools/update.sh` 第 3 步在 `fieldscan` 之后新增一段 blindscan（只报告不拦构建：
  列表里本就混着 CodeMirror / shiki / React 这类库内部文案，人工挑出应用自己的），全文进
  `work/update-*.txt`、控制台预览前 40 行；`docs/更新维护.md` 的「第四种静默失败」一节改用它作为
  标准做法（不再是一次性脚本）。
- **自测**：`tools/test_blindscan.js`（合成原版 / 产物片段，钉住两类误判：把已汉化 / 产物新增的
  当成残留、把代码片段当成文案），已接入 GitHub Actions；`--words` 与目录参数解析也一并覆盖。
- **实测**：对 0.0.110 的英文原版 vs 本次产物跑出 **284 条「疑似文案」+ 397 条「其余」**
  （首跑 285 + 433：一条是它第一个找出的漏翻 setupNote，见下；另 36 条是 `act tool-row` 这类
  类名字符串，补上「全标识符形状且带连字符、又没有常见小词」的过滤后消失）。
  其中「Google’s server is in Developer Preview and needs a Google Cloud project.」（连接器目录
  的 setupNote）就是它扫出来的，已随 packVersion 0.0.110.1 补翻（→ 284）。

## [0.0.109] · 2026-09-12

**适配 0.0.109：上游是纯 SDK 改动，界面文案零变化——词典一字未改，只升版本重建。**
这是首次数得清「改了 0 条」的适配：0.0.109 的渲染 bundle 与主进程 electron 文件
与 0.0.108 **逐字节一致**，`dict.json` 无需增删。

- **适配 Freebuff v0.0.109**：targetVersion / packVersion 升至 0.0.109；渲染 bundle
  仍为 `index-WHL57zaM.js`、样式表仍为 `index-Bz7qlcod.css`（与 0.0.108 产物逐字节相同，
  `diff -r` 全量比对无差异）。`tools/remap.js` 迁移 0 条、无歧义条目（变量名没变，符合预期）。
- **上游改了什么**：`node_modules/@codebuff/sdk` 的 `read_files` 新增图片附件读取
  （`tools/read-files.ts` 新增 `getImageFile`、`run.ts` 接线 `requestImageFile`、
  `impl/agent-runtime.ts` 透传该回调，另带一个测试文件），加上 `package.json` 的版本号。
  受影响的 `electron/*.cjs` 一个都没变，所以 `patches/` 无需新增或调整。
- **新增 SDK 文案按惯例不翻**：`[Image is … KB; images over … KB cannot be attached. Save a
  downscaled copy with a terminal command (for example `magick … -resize 1024x1024
  /tmp/preview.png`) and read that instead.]` 是塞给模型的工具错误串（库内部文案，界面看不到），
  与既有 `Freebuff`/模型名等保留类别一致。
- **门禁实测**：`lint_dict` 0 错误；词典对主 bundle **替换 1785 处 + `all keys matched`
  （MISSED 0）**；`uipos` 界面属性位置残留 14 条（全是约定保留的模型名 / `Freebucks` 等）、
  `fieldscan` 1 条（`tagline: 0 Freebucks`）；`regress` 对比 `pack-v0.0.108`
  **262 → 262，新增 0 处**；`postbuild` 自检通过（含 `renderer-health.cjs` 可选哨兵）。
- **已发布**：汉化包 Release `pack-v0.0.109`（`hanhua-pack-0.0.109.zip` + `pack-manifest.json`，
  含 SHA512），发布前闸门对比上一版 `pack-v0.0.108`——262 → 262、新增 0 处。
- **注**：`update.sh` 的回归闸门会跳过与 `manifest.json` 里 `packVersion` 同名的包，
  所以适配时**先在 manifest 里升版本再跑 update.sh**，闸门才会拿上一版包（0.0.108）当基线；
  若先跑 update.sh，它会退回更早的包（本次首跑取到 0.0.105），必要时手动补跑一次
  `node tools/regress.js dist/hanhua-pack-0.0.108.zip output`。

## [0.0.108] · 2026-09-12

**适配 0.0.108：补齐新上线的「对话历史翻页 + 编辑较早消息」文案，并给新增的主进程文件加补丁**，
共 9 条新词条（替换数 1774 → 1785）。本机自动更新是从 0.0.106 直接跳到 0.0.108，
所以 0.0.107 与 0.0.108 一起适配。

- **适配 Freebuff v0.0.108**：targetVersion / packVersion 升至 0.0.108；渲染 bundle
  `index-DcBlltOE.js` → `index-WHL57zaM.js`，样式表 `index-Cb9bL8st.css` → `index-Bz7qlcod.css`。
- **模板变量自动重映射 47 条**（`tools/remap.js`），另 **2 条 remap 歧义条目人工改名**（锚文本在
  bundle 里命中多处且插值不一致，工具拒绝猜）：`Sponsored · ${o}` → `Sponsored · ${a}`；
  `Could not select ${ue.name}: ${Ye}` → `Could not select ${he.name}: ${Ye}`。
- **新增 9 条**（对话历史翻页 / 编辑较早消息，全新功能）：
  - `pattern`（界面属性位置，共 6 条）：`Newer messages` / `Older messages` / `Return to latest` /
    `Return to latest messages` / `Conversation pages` / `Conversation outside the viewport — focus to read`；
  - `exact`（不在界面属性锚点上的整句）：`Could not load history` /
    `This history page changed. Return to latest and try again.` /
    `Editing an earlier message — sending will replace it, remove all later messages and rewind the
    agent’s subsequent file changes.`（编辑横幅的提示句）。
  - 无词条下线、无改写；9 条新词条共命中 10 处（`Return to latest` 在 `children:` 出现两次），
    另 1 处为旧词条在新版 bundle 里多出的一次使用。
- **主进程新增文件需要补丁**：0.0.107 起 asar 里多了 `electron/renderer-health.cjs`（渲染进程
  内存采样 + 崩溃恢复），里面 `dialog.showMessageBox` 的弹窗是用户直接看到的：
  `Freebuff window stopped` / `This window ran out of memory.` / `This window stopped unexpectedly.` /
  `Reload the window to return to your conversation. Reloading does not restart the agent.` /
  `Reload window` / `Close window`。词典的 `exact` 只替换**双引号**字面量（`apply.js` 的实现如此），
  而主进程这些文案用的是单引号，历来靠 `patches/` 手写补丁——故新增
  `patches/electron-renderer-health.cjs.patch`，并在 `tools/postbuild.js` 加**可选哨兵**：
  该文件在老版本 asar 里不存在，缺失只警告，存在则必须通过 `node --check` 且带译文哨兵
  「重新加载窗口」。
- **主进程其余 6 个补丁在 0.0.108 上仍干净套用**：`main.cjs` 的上游改动只是把
  `render-process-gone` 接线到新的 `watchRenderer`（外加 `renderer:history` IPC），无新增文案；
  0.0.105 → 0.0.108 的 asar 差异另有 `node_modules/@codebuff/sdk` 的 `run.ts` 与
  `byok-run.test.ts`（库内部文件，不翻）。
- **门禁实测**：`lint_dict` 0 错误；`uipos` 界面属性位置残留 14 条（全是约定保留的模型名 /
  `Freebucks` 等）、`fieldscan` 1 条（`tagline: 0 Freebucks`）；`regress` 对比 0.0.105 包
  **262 → 262，新增 0 处**；`postbuild` 自检通过（纯字面量词条覆盖 1134/1134）。
- 装机已实测：`ui/index.html` 为 `lang="zh-CN"` + `hanhua-pack` 0.0.108，装机主 bundle 与
  `output/ui/assets/index-WHL57zaM.js` 哈希一致，装机 `app.asar` 里的 `renderer-health.cjs`
  已是「重新加载窗口 / 关闭窗口」。
- **已发布**：汉化包 Release `pack-v0.0.108`（`hanhua-pack-0.0.108.zip` + `pack-manifest.json`），
  `tools/release.sh` 发布前自动对比上一版 `pack-v0.0.105`——262 → 262、新增 0。
  0.0.106 未单独发布，本次直接从 0.0.105 跳到 0.0.108。

## [0.0.106] · 2026-09-11

**适配 0.0.106：BYOK 提供商面板文案改写 + 会话状态标签更新**，共 13 条词条改动
（替换数 1773 → 1774）。这是个小版本：主进程与 0.0.105 逐字节一致，改动集中在渲染进程。

- **适配 Freebuff v0.0.106**：targetVersion / packVersion 升至 0.0.106；渲染 bundle
  `index-B4mEUbmK.js` → `index-DcBlltOE.js`，样式表 `index-DfedPj0M.css` → `index-Cb9bL8st.css`。
  主进程 asar 里 6 个 electron 文件经 `patches/` + 词典处理后与 0.0.105 产物**逐字节一致**
  （只有 `package.json` 的 version 不同），`patches/` 无需改动；`ui/index.html` 也只差版本戳与资源哈希。
- **模板变量自动重映射 12 条**（`tools/remap.js`）：`ve→ie`、`ce→H`、`W→Z`、`X→U`、
  `q.limit→I.limit`、`oS(ie)→oS(ne)`、`ne.name→ie.name` 等，含 2 条「半截模板」
  （Freebucks 钱包 / 付费时长提示）。
- **2 条 remap 歧义条目人工改名**（锚文本在 bundle 命中多处、插值不一致，工具拒绝猜）：
  `` `Remove ${Ae.configKey}` `` → `` `Remove ${$e.configKey}` ``；
  `` `Could not select ${de.name}: ${Ge}` `` → `` `Could not select ${ue.name}: ${Ye}` ``。
- **6 条词条随上游 BYOK 面板改写而下线**：`Another tab is using the hosted model` /
  `OpenRouter or an OpenAI-compatible endpoint` / `Start a new task to change API providers.` /
  `Direct to your provider. Billed to your account.` /
  `To use a connection, select it in the model picker of a new task.` / ` · Unverified`
  ——留着会卡住构建的 MISSED 门禁。
- **改写 1 条**：`Provider added. Select it in the model picker of a new task.` →
  `Provider added. Select it in the model picker of a new or existing Freebuff task.`
- **新增 7 条**：
  - BYOK 面板：`Select a provider in the model picker of a new or existing Freebuff task.
    Once a task uses your API key, start a new task to return to Freebuff models.`
    （0.0.106 把 0.0.105 的两条提示合并成了这一句）、
    `You can switch this task to your API provider. After switching, start a new task to use
    Freebuff models again.`、`Add or manage your API keys`、`Your keys · Your provider’s billing`；
  - 顺带补齐 `This task uses your selected provider. Start a new task to use Freebuff models or
    switch providers.`——0.0.105 就存在于 BYOK 面板同一分支，旧词典没收，本次靠 uipos 扫出；
  - 会话状态标签：`Hosted session slots are in use`（替代下线的 `Another tab is using the hosted model`）；
  - `pattern` 分区收 `Selected`（BYOK 提供商列表的选中标记，只作用于 `children:` 等界面位置）。
- **工具修复：回归闸门会漏报「整句新增英文」**。`tools/regress.js` 原来用「相邻引号两两配对」的
  正则提取字符串字面量，而 minified 产物里短字符串（`"span"` 仅 4 字符，不满足 `{8,600}`）会让
  引擎从它的**右引号**重新开始，整条链从此错位配对——大半个字符串被当成代码丢掉。本次实测：
  `Add or manage your API keys`、`Your keys · Your provider’s billing` 两条新增英文，闸门报
  「0 处新增」，是 `uipos.js` 扫出来的。现改为「每个引号向后读到下一个引号」的**重叠配对**
  （真正的字符串其开引号必然在候选里，不会错位），新旧产物提取到的英文片段 144 → 262 处；
  另加 kebab-case 过滤，把 `agent-trigger has-byok` 这类新类名组合的误报挡掉。
- **门禁全绿**：`lint_dict` 无错误、`test_remap` 13 条样本 + 3 条负面用例全过；构建
  `all keys matched`（1774 处替换）；`postbuild` 自检通过（纯字面量 1131/1131）；
  `regress.js` 对 0.0.105 包比对 **0 处新增英文片段**；`uipos` 界面属性位置残留 14 条
  （与 0.0.105 持平）、`fieldscan` 1 条（`tagline:"0 Freebucks"`），均为约定保留项。

## [0.0.105] · 2026-09-11

**适配 0.0.105：BYOK 面板文案微调 + 新增两条 Freebucks 付费提示**，共 11 条新词条
（替换数 1762 → 1773）。这是个小版本：主进程与 0.0.104 逐字节一致，改动集中在渲染进程。

- **适配 Freebuff v0.0.105**：targetVersion / packVersion 升至 0.0.105；渲染 bundle
  `index-BE7fL8LQ.js` → `index-B4mEUbmK.js`，样式表 `index-CY7Yir-T.css` → `index-DfedPj0M.css`。
  主进程 asar 里 6 个 electron 文件经 `patches/` + 词典处理后与 0.0.104 产物**逐字节一致**，
  `patches/` 无需改动；`ui/index.html` 也只差版本戳与资源哈希。
- **模板变量自动重映射 49 条**（`tools/remap.js`）：`wO()→kO()`、`qi(…)→Ui(…)`、`wn(…)→kn(…)`、
  `er(…)→Bi(…)`、`ge→ve`、`fe→ne`、`de→ce`、`Me→Ae` 等，含 4 条「半截模板」（Freebucks 钱包 /
  付费时长）与译文写法变体（`${r.title||"新会话"}` 这类）的标识符回填。
- **2 条 remap 歧义条目人工改写**（锚文本在 bundle 命中多处、插值不一致，工具拒绝猜）：
  `` `Remove ${Me.configKey}` `` → `` `Remove ${Ae.configKey}` ``；
  `` `Could not select ${oe.name}: ${He}` `` → `` `Could not select ${de.name}: ${Ge}` ``。
- **2 条词条随上游文案下线而删除**：`One key, many models` / `OpenAI-compatible API`——
  0.0.105 的 BYOK 表单不再用这两句宣传语，留着会卡住构建的 MISSED 门禁。
- **新增 11 条**：
  - BYOK 提供商面板：`Provider setup ↗` / `No providers found. Try “Custom”.` /
    `Search providers…` / `Requests go to ` / `Preset only. Your model’s coding support still
    needs testing.`，以及两处 aria-label `App tools` / `Providers`（走 `pattern` 分区）；
  - Freebucks 提示：`Freebucks balance temporarily unavailable.` /
    ` earned Freebucks can be claimed when starting a session.`（含前导空格，与金额前缀拼接）；
  - 两条 paywall 确认分支模板： `` `${a?"Ends your current session. ":""}Your balance is
    unavailable. …` `` 与 `` `Claim earned Freebucks when starting this session, then spend
    ${t.price} Freebucks${a?" and end your current session":""}?` ``（插值内的英文字面量按既有
    约定一并译出，`lint_dict` 的 E3 骨架校验通过）。
- **门禁全绿**：`lint_dict` 无错误；构建 `all keys matched`（1773 处）；`postbuild` 自检通过；
  `regress.js` 对 0.0.104 包比对 **0 处新增英文片段**；`uipos` 界面属性位置残留 14 条
  （与 0.0.104 持平）、`fieldscan` 1 条（`tagline:"0 Freebucks"`），均为约定保留项
  （`Freebuff` 品牌、`mcpServers` / `bun install` 代码片段、8 个模型名、CodeMirror 内部标签）。

## [0.0.104] · 2026-09-11

**适配 0.0.104：新增「自带密钥（BYOK）API 提供商」整块界面中文化**，共 75 条新词条（替换数
1672 → 1762）。

- **适配 Freebuff v0.0.104**：targetVersion / packVersion 升至 0.0.104；渲染 bundle
  `index-D6WDQXYJ.js` → `index-BE7fL8LQ.js`。主进程 asar 里的 6 个 electron 文件与 0.0.103
  **逐字节一致**（本轮变更集中在渲染进程与 SDK：新增 BYOK），`patches/` 与主进程词典无需改动；
  `ui/index.html` 也只差版本戳与资源哈希，无新增文案。
- **模板变量自动重映射 54 条**（`tools/remap.js`）：`bo(…)→qi(…)`、`pc(…)→gc(…)`、
  `Es(…)→Ps(…)`、`kn(…)→wn(…)`、`Ki(…)→er(…)`、`as→us`、`ce→de` 等。
- **新增 BYOK（自带密钥）界面全量中文化**——v0.0.104 的新功能（设置页入口 + 提供商管理弹窗 +
  模型选择器里的分组）：
  - 设置页与弹窗骨架：`Your API providers` / `Connect a provider to use your own API key.
    Available across projects on this computer.` / `Manage providers ` / `THIS COMPUTER` /
    `Connect a provider` / `Close API providers` / `Changes are saved immediately.` /
    `Shared by Desktop and CLI on this computer.` / `Back` / `Save provider` /
    `About privacy and supported features` 及其隐私说明整段；
  - 表单：`Provider` / `One key, many models` / `OpenAI-compatible API` / `Custom endpoint` /
    `Base URL` / `Model ID` / `API key` / `Hide` `Show` / `Advanced settings ` /
    `Name and model limits` / `Connection name` / `Optional` / `For example, Personal` /
    `Context window tokens` / `Maximum output tokens`，以及全部 aria-label
    （`Provider base URL` / `Provider model ID` / `Provider API key` / `Provider connection name` /
    `Configured context window` / `Configured maximum output tokens` / `Hide`·`Show API key`）
    与说明文案（`Use HTTPS, or HTTP for a server on this computer.` /
    `Copy the exact ID from your provider. Coding support is untested.` /
    `Saved in your OS credential store. Never in project files.` /
    `Use limits supported by your model. These are budgets, not detected capabilities.`）；
  - 列表与操作：`CONNECTED PROVIDERS` / `Add provider` / `Connect your first provider` /
    `Bring an OpenRouter key, or connect another OpenAI-compatible service.` / `Coding untested` /
    `Check connection` / `Checking…` / `Replace key` / `Remove provider` / `Removing…` /
    `Keep provider` / `Save replacement key` / `Cancel replacement` / `New API key` / `Loading providers…` /
    `? Tasks using it will stop before its next model request.`；
  - 模型选择器分组：`Your models. Your provider account.` /
    `Model requests go directly to your provider and use its billing. BYOK tasks are ad-free.` /
    `Direct to your provider. Billed to your account.` /
    `OpenRouter or an OpenAI-compatible endpoint` / `Connect a provider…` / `Manage providers…` /
    ` · Unverified` / `Your API key` / `Start a new task to change API providers.`；
  - 反馈与模板：`Credential verified. Coding support is still untested.` /
    `Endpoint reachable. Authentication and coding support still need an inference test.` /
    `Provider added. Select it in the model picker of a new task.` /
    `Key replaced. Select this updated connection in a new task.` /
    `Existing tasks keep their old connection revision. Use the replacement in a new task.` /
    `To use a connection, select it in the model picker of a new task.`；template 分区收
    `` `New API key for ${ie.name}` `` 与 `` `Could not select ${oe.name}: ${He}` ``。
- **补齐三处 0.0.103 就存在的历史漏翻**（本次重映射时暴露）：
  - 额度环 label 的 `` `resets in ${Ps(u.resetAt,o)}` ``——0.0.103 产物里这一处仍是英文（旧词典只有
    `resets in ${m}` / `resets in ${a}` 两条，覆盖不到环 label），本次按新版拆条补上；
  - `` `Dismiss notification: ${g.message}` ``（`${m}` → `${g}`）；
  - `` `Remove ${Me.configKey}` ``（`${Le}` → `${Me}`）。
- **4 条嵌套模板词条按新版逐字重塑**：Freebucks 付费时长 / 钱包提示那四条以 `${fe?` / `${D?` /
  `${d.monthlyBonus>0?` 结尾的「半截模板」键，`remap.js` 的 `parseTemplate` 无法解析
  （花括号不闭合）因而一直报 MISSING，本轮手工按新 bundle 逐字回填（`ve/as→ge/us`、`Ki→er`），
  键与译文同步改写；顺带补上 `` `Could not select that element: ${C5(E)}` ``（同为 0.0.103 存量漏翻）。
- **新增模型名**：`GPT-6-Astra` / `GPT-5.6-Sol` / `GPT-5.6-Terra` / `GPT-5.6-Luna` / `Opus 5` /
  `Opus 4.8` / `Sonnet 5` / `Fable 5.1` 按约定保留英文（模型名不翻），tagline 走既有词典。
- **有意保留**：`tagline:"0 Freebucks"`——0.0.104 起生效的推广价 tagline（promo 表按日期切到
  `2026-09-09T15:49Z` 那条），与已译的兄弟条目 `0 Freebucks · 劳动节周末（至 9 月 7 日 PT）`
  保持一致（`Freebucks` 是品牌词，词典里同样保留英文）。
- **验证**：UI bundle `all keys matched`（1762 处替换，较 0.0.103.2 的 1672 增加 90 处）；
  `lint_dict` 与 postbuild 自检全绿（纯字面量覆盖 1126/1126）；回归闸门（对比已发布的
  `pack-v0.0.103.2`）**新增英文片段 0 处**；界面属性位置英文残留 14 条、`description:` 等字段英文
  0 条，余下均为有意保留（模型名 8 条、`Freebuff` 品牌、MCP 配置 JSON 示例、`bun install`、
  CodeMirror 内部的 ` Action: …`）。
- 词典更新为 exact 1168 / template 262 / code 6 / pattern 64。

## [0.0.103.2] · 2026-09-11

**补齐 connectors / MCP 面板**——0.0.103.1 条目里记的那个「已知未完成」，实际远不止状态标签：
面板各层文案 + 目录里 100 条第三方连接器介绍，共 **217 处替换**（1454 → 1672）。

- **根因不是「词条忘了加」，而是 pattern 分区的匹配形态太窄**，这次一并改掉：
  - `pattern` 改成扫描式匹配，值位置认四种形态：字面量 `children:"Delete"`、
    压缩后的默认参数 `confirmLabel:n="Delete"`、三元分支
    `label:t.status==="idle"?"Ready when needed":"Disconnected"`、以及模板插值内部
    （`` `${s?"Collapse":"Expand"} thinking details…` ``）。只取「锚点值表达式第 0 层」的
    字面量（深层是 class 名/色值/SVG 路径，比较运算符右侧是协议常量，均跳过）；
    `actionLabel:` 纳入锚点。旧实现是「锚点紧跟字面量」的正则，而 connectors 的状态标签
    几乎全在三元分支里——所以整片漏翻。
  - `pattern` 补上 **MISSED 上报**：零命中的词条以前静默放过，实测长期躺着 **31 条死条目**
    （原文已改版，或只剩代码/协议位置）。现在会像 exact/template 一样列进 MISSED 并让构建
    失败——要么修匹配形态，要么删掉过期条目。
- **`Connected` 走 `code` 分区整体一致替换**：它既是状态标签的生成值，又被
  `l.label==="Connected"` 用于过滤「已连接」列表与判断 `sr-only`，只翻生成处会让过滤器失配。
  代价是中文常量会出现在比较位置，因此 `semantic_guard` 新增 `CONSISTENT_LABELS` 白名单，
  只放行「本进程内派生的展示标签、不写盘/不发请求/不跨进程」这一类，其余仍一律拦下。
- **补翻范围**：connectors 各状态标签与动作（`Available` / `Disabled` / `Reconnect required` /
  `Manage` / `Review connection` …）、详情面板（`Connection` / `Add MCP configuration` /
  `Connector views` / `MCP configuration JSON` …）、列表页（`Top connectors` / `Search results` /
  `Your custom connectors` / `Your tools belong here` …）、iOS 镜像说明、`New thread (…T)`
  tooltip、`Couldn’t refresh your connectors.`、目录里 100 条 connector 介绍；顺带扫出并补上
  `Updating…` / `Moving…` / `Exporting…` / `Stopping…`、`ends in ` / `/hr` / `is ready` /
  `in-memory defaults (file absent)`，以及 `今日/本周/本月套餐会话已用完` 一组映射文案。
- **残留口径更新**：`tools/uipos.js` 升级到能看见三元分支 / `actionLabel` / JSX 文本节点后，
  界面属性位置英文 **107 → 14**，剩下 14 条均为有意保留（模型名 8 条、`Freebuff` 品牌、
  MCP 配置 JSON 示例、`bun install`、CodeMirror 内部的 ` Action: …`）；`description:` 字段英文
  归零；`regress.js` 的英文自然语言片段 193 → 145（新增 0）。
- **新增 `tools/fieldscan.js`**：按字段（默认 description / tagline / hint / subtitle / note）
  列出仍是英文的条目。这次 100 条目录介绍正是因为 `description:` 不在 uipos 的锚点里才长期
  无人发现，已接进 `tools/update.sh` 的残留扫描。
- **验证**：`build.sh` `all keys matched`、`lint_dict` 与 postbuild 自检全绿（含代码语义常量
  扫描）、回归闸门 0 命中；装机产物已核对 connectors 各状态标签与目录介绍均为中文。

## [0.0.103.1] · 2026-09-11

- **修复两处被用户回报的短标签漏翻**（「files 和 delete 没汉化」）：
  - **资源管理器标签**：`{id:"files",label:"Files"}` 的「Files」此前根本没有词条，补进 `pattern`
    （`label:"Files"`）→「文件」；
  - **删除确认按钮**：`Delete` 很早就在 `pattern` 里，但它在产物中以两种形态出现而旧匹配够不着——
    技能管理弹窗是三元分支 `children:y==="delete"?"Delete":"Restore"`，删除会话的组件是默认参数
    `confirmLabel:n="Delete"`。为此：`apply.js` 的 `pattern` 值位置改为兼容压缩后的变量赋值形态
    `ident="X"`（与字面量 `label:"X"` 等价），并补 3 条 `code` 逐字片段（`?"Delete":` /
    `?"Files":null` / `?"Threads":`，均不含压缩变量名，因此不会随 minifier 改名失效）。
  - **顺带修掉**同一机制的「@ 提及」菜单分组标题「会话 / 文件」（`sectionLabel` 三元分支）与技能管理
    弹窗的「删除 / 恢复」按钮。
  - **验证**：`build.sh` 替换数 1449 → 1454、`all keys matched`、`lint_dict` 与 postbuild 自检
    全部通过；回归闸门（对比已发布的 pack-v0.0.103）0 命中；装机产物已核对这四处均为中文。
- **packVersion 升为 `0.0.103.1`**（`targetVersion` 仍 `0.0.103`）：控制器按四段比较版本
  （`ParseLooseVersion`，第四段只对 packVersion 有意义），因此已装 0.0.103 的机器会看到
  「汉化：已应用 · 有新包 v0.0.103.1 可应用」并自动拉取——首次实践「同一 Freebuff 版本内修正重发」
  的第四段约定（此前同号重发只能 `--force`，且已装机的机器拿不到修复）。
- **已知未完成**（已在 0.0.103.2 补齐）：connectors / MCP 设置面板仍有一整簇英文（状态标签
  `Available` / `Disabled` / `Reconnect required`、详情面板 `Connection` / `Add MCP configuration`、
  目录里的 connector 描述等）。该功能在词典里已有 9 条中文（属漏翻，非有意保留），且从 0.0.101
  及更早就存在——注意这批字符串大量出现在三元分支与 `actionLabel` 位置上，补齐需要再扩一轮匹配
  机制（0.0.103.2 扩的正是这处，另外目录实际是 100 条而非 20 余条）。

## [工程] · 2026-09-11

- **「半截模板」键不再靠人工发现**（0.0.104 适配暴露的缺口）：词典里有 4 条以未闭合 `${条件?`
  结尾的 template 键（外层模板里内嵌模板三元的写法，`apply.js` 连着后随反引号整段匹配）。
  `remap.js` 的 `parseTemplate` 旧实现遇到花括号不闭合直接判为不可解析 → **永远落 MISSING**，
  变量改名只能人肉抄一遍：
  - `tools/remap.js`：末段未闭合的插值现在记成 partial 表达式，匹配时发成
    `` `${` `` + 到反引号/右花括号为止的宽松捕获（`${` 包进捕获组以便回填），重建 key 与译文
    同样回填——与普通模板一样跟着 minifier 改名自动迁移；
  - `tools/lint_dict.js` 新增 **E5**：半截模板键只有在 template 分区、译文逐字节复现同一尾巴、
    尾巴形态可被 remap 迁移（`${` + 非空 + 不含反引号/右花括号）、且英文骨架登记在
    `TRUNCATED_TEMPLATE_ANCHORS` 时才放行，否则**硬错误**（此前新增这类条目没有任何提示）；
  - 验证（合成「变量改名」bundle + 本机 0.0.104 原版 bundle）：改名后 4/4 条落 RENAMED 且
    译文尾巴同步迁移、迁移后词典过 `lint_dict`；未改名时 4 条落 SAME、MISSING 0；三条负面
    用例（未登记 / 译文尾巴不一致 / 放进 exact 分区）均 exit 1。
- **修掉 remap 一个会写坏词典的隐患**（自查中暴露）：译文允许改写插值内部的字符串常量
  （`${r.title||"new thread"}` → `${r.title||"新会话"}`，`lint_dict` 的 E3 按骨架放行），这类
  「译文自己的写法变体」不在 key 的插值表里——旧实现回退写回原文本时会把 `${` 与 `}` 一起
  丢掉（实测 `关闭“r.title||"新会话"”`）。现按骨架对齐、只换标识符，并补回外壳；另加两道自证：
  重建后译文插值槽数不得变化、每个槽必须能按骨架对应到新 key，否则列为 AMBIGUOUS 拒绝写回。
  当前词典受影响 4 条（其中 2 条确实会被 remap 写回）。
- **词典门禁真正生效**：`tools/lint_dict.js` 以前只在 CI 跑，本地 `build.sh → apply.sh` 与
  `update.sh` / `release.sh` 走的链路里形同虚设（E5 这类硬错误拦不住）。现在 `build.sh` 解包前
  先跑它，不过即中止；`tools/update.sh` 的小结新增「remap 歧义条目：N 条」点名表。
- **新增 `tools/test_remap.js`**（接入 GitHub Actions）：用 `dict.json` 里的真实词条合成一份
  「变量改名」的假 bundle，断言 remap 全部自动迁移（含 4 条半截模板）、译文插值槽数与外壳
  不变、未改名时全部落 SAME、迁移结果过 lint，并覆盖 lint 的三条负面用例（未登记 / 尾巴
  不一致 / 放错分区）。模板迁移逻辑从此有自动化兜底，不再只靠临时验证。
- **新增发布回归闸门 `tools/regress.js`**：0.0.103 适配时踩到一类静默回归——`remap.js` 按
  「去掉 `${...}` 的文字骨架」找对应位置，同一句话若有多种变体，两条词条会被指到同一处
  互相覆盖，剩下那处就变回英文，而 `build.sh` 依旧 `all keys matched`（它只检查词典里的
  词条能否匹配到东西，被吃掉的词条已经不在词典里了）。新工具把新旧两版产物的英文自然
  语言片段对一遍（比对前抹掉 `${...}`，变量改名不误报；模板按相邻反引号逐段取，嵌套模板
  不漏——0.0.103 的 paywall 文案就藏在嵌套模板里），并接进流程：
  - `tools/update.sh` 第 4 步自动跑，基线取 dist/ 里最新的旧包或历史 `output-*/`；
  - `tools/release.sh` 发布前自动跑，基线是 GitHub 上一版 Release 的包（自动下载解包），
    发现新增英文片段即中止发布，`--allow-english` 可放行。
  - 验证：以 pack-v0.0.101 为基线跑本次产物 → 0 命中、exit 0；以 0.0.103 英文原版当新
    产物 → 本次补齐的 8 条自动全部报出（含嵌套模板里的 paywall 文案），exit 1。
- **记录一个已知性质**：pack zip 不是逐字节可复现的（bsdtar 把目录 atime 写进 zip 的 UT
  扩展字段，两次打包差 4 字节），解包后内容逐字节一致；SHA512 只需与同一次发布的
  `pack-manifest.json` 对应（控制器就是这样校验的）。

## [0.0.103] · 2026-09-11

- **适配 Freebuff v0.0.103**（装机从 0.0.101 直升，无 0.0.102 包）：targetVersion / packVersion
  升至 0.0.103；渲染 bundle `index-Cxze7PZU.js` → `index-D6WDQXYJ.js`。
- **模板变量自动重映射 56 条**（`tools/remap.js`）；2 条歧义模板人工核对：
  `Open ${y} in ${b.label}` 与 `Open ${e??"workspace"} in ${b.label}` 的 `${b.label}`
  随 minifier 改名为 `${v.label}`，按新 bundle 逐字回填。
- **补翻新增模型文案 11 条**（0.0.103 的模型选择器从 10 个模型扩到 21 个，新增 9 个）：
  tagline 收 `Smart & Fast` / `Fastest` / `Strong all-around` / `1M context` /
  `Unlock by referring friends` / `Novita route — evaluation only` / `Via CrofAI` /
  `Queues, then falls back`；数据使用与限速提示收 `May use data for AI training` /
  `Anonymous provider retains prompts` / `Rate limited and shared by all users: queues when busy,
  then answers on DeepSeek V4.1 Flash.`。模型名（DeepSeek V4.1 Flash / MiniMax M3 /
  GPT-5.6 Luna / Gemini 3.8 Flash / GLM 5.2 / Muse Spark 1.3 / Ox Alpha / Kimi K3 等）
  按约定保留英文。
- **补翻 Freebucks 钱包 / paywall 文案 8 条**（其中 5 条是本次版本变更引入的）：
  - **回归修复**：`${ve} ${as} an hour, more than the …` 这条付费时长提示被 minifier 改名后
    只剩一条词条，新版把两种变体合到了同一句，`remap.js` 迁移时只覆盖到其中一种（另一种
    后面多了 `${fe?…}` 尾巴），导致该句变回英文——按新版逐字重塑词条后已翻译。
  - **新增文案**：套餐升级文案 `Get ${a}x usage for $…` / `${t.displayName} raises your
    daily ${as} from …` 与模型套餐提示 `${u} drops` / `… on a plan — … a day instead of …`
    （嵌套模板，逐段词条）。
  - **顺带补齐**同一界面历史上就未翻的三条：`${C} costs … for an hour of unlimited messages …`、
    `${ve} ${as} buys one hour of unlimited messages …`、`${Ki(d.balance)} ${as} in your
    wallet. Used after today's pool. …`。
- **残留扫描与 0.0.101 持平**：界面属性位置英文仍为 54 项（语言关键字、主题名、模型名等
  有意保留项），未出现新的漏翻位置；英文自然语言片段比对（剔出 ${...} 变量后）
  确认新版已无新增漏译。
- **验证**：UI bundle `all keys matched`（1449 处替换，较 0.0.101 的 1429 增加 20 处）；
  `lint_dict` 通过；postbuild 自检通过（纯字面量词条覆盖 920/920）。

## [0.0.101] · 2026-09-10

- **适配 Freebuff v0.0.101**：targetVersion / packVersion 升至 0.0.101；渲染 bundle
  `index-CNlYwGfw.js` → `index-Cxze7PZU.js`。
- **模板变量自动重映射 62 条**（`tools/remap.js`）：`vo(O)` → `bo(O)` 等，新版模板全部命中。
- **新增 MCP 连接器界面文案**：`Add connector` / `Connect and choose tools` /
  `Search connectors` 收进 `exact`；`Connected` / `Choose tools` / `Needs approval` /
  `Needs sign-in` 收进 `pattern`。
- **`Connected` 从 exact 挪到 pattern（重要）**：0.0.101 新增了把 `"Connected"` 用作
  `l.label==="Connected"` 比较的代码，全局 exact 会命中代码位置、被语义守卫拦下并直接让构建
  失败（`semantic-blocked`）。pattern 只作用于 `label:`/`children:` 等界面属性位置，界面标签
  照常翻译，代码比较不受影响。
- **移除 19 条原文已不在 0.0.101 的词条**（` — the same file the CLI uses.`、
  `Runs on this computer`、`No servers configured yet. Add one to ` 等）——它们本来就没匹配上，
  产物内容不变；删除后防呆全命中才恢复有效。
- **验证**：UI bundle `all keys matched`（1424 处替换），`lint_dict` 通过，postbuild 自检通过。

## [工程] · 2026-09-10

- **下线服务器自动更新**：删除 `tools/autoupdate.sh`（无人值守流水线）、`docs/服务器自动更新.md`、
  `tools/notify.js` + `.notify.json.example`（失败告警）与 `tools/codex-fix.js`（流水线自修复）。
  版本适配起改走本地手动流程：`tools/update.sh`（重映射 → 构建 → 残留扫描）→ 补 `dict.json`
  → `bash build.sh` → `bash apply.sh`，发布用 `bash tools/release.sh`。
- **精简 `tools/`（44 → 16 个）**：砍掉服务器自动化时代遗留的脚本——
  冒烟闸门（`smoke-gate.sh` / `smoke-test.js` / `smoke-heal.js`，本来也要装 playwright 才真跑）、
  词典审计（`audit-bad-entries.js` / `remove-bad-entries.js` / `audit.js`）、翻译链路
  （`codex-translate.js` / `autotranslate.js` / `codex-proxy.js` / `agent-migrate.js`）
  与一次性排查脚本（`attrs` / `context` / `context2` / `exact` / `count` / `filter` /
  `mainscan` / `menuscan` / `remaining` / `show` / `tctx` / `tpls` 等）。
  只留构建、版本迁移、找漏翻所需的那几个；`semantic_guard.js` 被 `apply.js` 依赖，保留。
  `build.sh` / `release.sh` 不再调用冒烟闸门；`docs/` 两篇合并为 `docs/更新维护.md` 一篇；
  根目录一次性的 `migrate-dict-97.js` 一并删除。
- **词典对齐装机 v0.0.100（36 条失配词条）**：本地 `build.sh` 之前会被自带的全命中防呆拦住
  （36 条 MISSED）。处理结果：
  - 14 条模板词条只是 minifier 变量改名（`${e.paths…}`→`${t.paths…}`、`${Qs(O)}`→`${xs(O)}` 等），
    从产物 bundle 里重新提取真实模板字面量、按位置回填，新 key 逐字自验证通过才写入；
  - 22 条原文已不在该版本产物里（库内部报错如 `Unrecognized key:`、agent 提示词
    `Use when the trace shows…`、已被官方改写的钱包文案等）→ 移除；这些词条本来就没生效，
    产物内容不变，明细留档 `work/missed-0.0.100.json` 以便日后重新翻译。
  - 结果：`bash build.sh` 不再需要 `ALLOW_MISSED=1`，UI bundle `all keys matched`（1436 处替换），
    产物自检通过。

## [0.0.92] · 2026-09-05

- **适配 Freebuff v0.0.92**：targetVersion / packVersion 升至 0.0.92；渲染 bundle
  `index-B1uU0-oL.js` → `index-hMCUOXxW.js`。本轮使用已安装的 v0.0.92 英文原版重新构建。
- **模板变量自动重映射**：迁移 2 条 template 词条（`B` → `z`），其余模板保持兼容；新版扫描未发现缺失模板。
- **复核新版文案**：新增模型 `GLM 5.3 Flash` 为模型名，按约定保留英文；其余用户可见文案沿用现有词典，未发现需要新增的可翻译 UI 文案。
- **验证**：完成 v0.0.92 原版 UI 扫描、词典全命中构建、主进程补丁套用、语法检查与 postbuild 自检。

## [0.0.91] · 2026-09-05

- **适配 Freebuff v0.0.91**：targetVersion / packVersion 升至 0.0.91；渲染 bundle
  `index-B3HBZoIa.js` → `index-B1uU0-oL.js`。本轮从已安装的 v0.0.91 英文原版重新扫描并构建。
- **模板变量自动重映射**：迁移 48 条 template 词条（例如 `xn→kn`、`To→Po`、`co→ho`、
  `_c→wc`、`Cq→eU`、`pw→Tw`、`Jp→nm`、`gy→Ty`、`Bz→h3`、`Ix→Kx` 等），并清理旧 bundle
  中已失效的 7 条模板键；新版模板全部命中。
- **补翻新增界面文案**：
  - 赞助插播：`Sponsored break`、`Close sponsor break`、`Dismiss sponsored message`、
    `Why this ad?`、`You can continue`；
  - 限时模型试用：`Limited-time trial`；
  - 会话/操作界面：`More actions`、新版队列计数、上下文用量、模型价格提示和赞助提案报错。
- **修复动态错误模板译文**：恢复 `Could not update this sponsored proposal` / `Could not switch branch`
  中的 `${...}` 插值，确保错误信息不会把表达式源码直接显示给用户。
- **工具链修复**：`tools/apply.js` 先处理完整 template、再处理 exact 字面量，避免 `unknown error`
  先替换导致模板无法命中；`tools/update.sh` 明确只对指定的 pristine bundle 执行模板迁移。
- **验证**：词典 `lint_dict` 通过（exact 820 / template 148 / code 4 / pattern 50）；
  v0.0.91 原版 UI 词典替换 1189 处并显示 `all keys matched`；主进程补丁全部干净套用，
  `node --check` 通过，postbuild 自检全绿。

## [0.0.88] · 2026-09-05

- **适配 Freebuff v0.0.88**：targetVersion / packVersion 升至 0.0.88。渲染 bundle
  `index-_MSBgH2Z.js` → `index-B3HBZoIa.js`；装机目录无 `hanhua-backup-*`（从未 apply 过），
  走「无备份回退安装目录英文原版」构建路径
- **模板变量自动重映射**：`tools/remap.js` 迁移 43 条（`gc→yc`、`r→l`、`wn→xn`、
  `wv→Tv`、`xo→To`、`nq→vq`、`ly→Jc`、`ow→fw`、`Gn→B`、`oM→vM`、`LQ→ZQ`、`YS→r1`、
  `Wp→Kp`、`J8→mq`、`eq→gq`、`rP→fP`、`ay→my`、`Ec→co`、`xI→Nz`、`P→E` 等）；
  1 条 AMBIGUOUS（`Context ${$s(g)}`）手工改为 `Context ${Qs(g)}`（`$s→Qs` 且两处命中）
- **额度系统全面改版：Freebucks 钱包**（v0.0.88 重大变更，会话购买从「次数」改为
  「每小时单价 + 每日 Freebucks 额度」），补翻新额度/钱包 UI 全套约 40 处：
  - 引导弹窗（`Meet Freebucks` / `Sessions are now bought with Freebucks—…` /
    `Your daily Freebucks refill at midnight Pacific…`）、四个要点卡
    （`A fresh pool every day` / `Spend it how you like` / `No more weekly or monthly session caps` /
    `The only thing that counts is what you spend…`）、`Got it` 按钮
  - 额度环 hint/status：`${po} balance`、`Out of ${po} · more in …`、
    `Running low · today's refill in …`、`…of today's … left. Spent before your wallet…`、
    `…in your wallet. Used after today's pool…`（含月度奖励 / 奖励到账两式）、
    `…of usage left this month…`（成本口径说明）、`Free sessions are used first · today resets in`
  - 模型选单价格文案：`…an hour, more than the … you have left today plus your wallet.`（两处变量）、
    `…buys one hour of unlimited messages…`、`…bought this hour of …`、
    `…costs … for an hour of unlimited messages…`、`Ends your session and starts a new one for …`、
    `Unlimited messages and tool calls until it ends…`、`/hr` 价格后缀
  - 支付/状态按钮与标签：`Get more` / `Use wallet` / `Switch` / `Upgrade` / `Limited access` /
    额度环 label `wallet`/`left`/`daily`/`allowance`；`Lower limits` 说明卡头 + 两段额度降低说明文案
- **其他补翻**：模型 tagline 改写（删除 `Latest frontier agentic coding model`，新增
  `Reliable agentic workhorse for everyday tasks` / `Most capable model for complex, demanding work`；
  `Balanced…` / `Fast and affordable…` 等 4 条沿用旧译）；计划分享（`Copy plan` /
  `Copy plan as Markdown` / `Plan copied`）；`Attaching images needs the desktop app`、
  `Could not open that sponsored run`、`Committed to ${b.branch}…`、`Could not switch branch…`
- **修复词典模板交互**：`Could not update this sponsored proposal` 与 `Could not switch branch`
  两条含 `"unknown error"` 内联字符串的模板，remap 曾误把键/值回写为英文，恢复为
  「exact 先跑、模板键用 `"未知错误"`」的既有约定
- **工具链**：`lint_dict.js` 的 `skeletonOf` 骨架归一化补上反引号模板字面量（此前只抹
  `"…"`/`'…'`，含嵌套反引号模板的 `${…}` 表达式会被 E3 误判——本轮 `…plus … in your wallet`
  条件片段即触发）
- **验证**：`all keys matched`、纯字面量覆盖 796/796（100%）、`lint_dict` 通过；
  主进程补丁逐字节套用、`node --check` 通过，postbuild 自检全绿；uipos 残留 28 条均为
  有意保留项（代码关键字、模型名、shell 命令、内部标识）
- 词典更新为 exact 813 / template 148 / code 4 / pattern 50

## [0.0.87] · 2026-09-04

- **适配 Freebuff v0.0.87**：targetVersion / packVersion 升至 0.0.87。渲染 bundle
  `index-kOlI7uqe.js` → `index-_MSBgH2Z.js`；NSIS 安装器再次清掉 `hanhua-backup-*`，
  走「无备份回退安装目录英文原版」构建路径
- **模板变量自动重映射**：`tools/remap.js` 迁移 41 条（`fc → gc`、`pn → wn`、
  `W1 → ow`、`$8 → nq`、`ey → ly`、`XD → oM`、`So → xo`、`Di → Gn`、`pv → wv` 等），
  0 条 MISSING；1 条 AMBIGUOUS（`Context ${$s(g)}`）手工确认
- **主进程「赞助任务（sponsored proposal）」新流程全面中文化**（v0.0.87 新增）：
  - `mcp-consent-bridge.cjs`：赞助确认对话框（`Run this sponsored task?`、
    「否/是」按钮、`wants to integrate itself into this project…` 一句话征求同意）；
    顺带补翻 v0.0.86 即存在但漏翻的本地/远程连接器两段 explanation
    （`This runs a program with the same permissions as you…` /
    `This sends requests to that address…`）
  - `consent-window.html`：新增赞助布局（who/rest 双 span 拆分广告主名与句子，
    译文保留前导空格）与「无法说明请求方」拒绝文案
  - `main.cjs`：新增「附加图片」（Attach images）文件对话框
- **渲染进程补翻 52 条新词条**（exact 47 / template 5）：
  - 赞助提案 UI 全套：状态标题表（`Sponsored proposal` / `Start sponsored thread` /
    `Sponsored thread running` / `… committed its work` / `… landed a PR` / `… failed` /
    `Sponsored PR merged`）、操作（`Create pull request` / `Watch this run` /
    `View what it did` / `Dismiss sponsored proposal` / `Never show ${t}` /
    `Report this proposal` / `Turn off sponsored proposals` / `Remove worktree`）、
    默认 whyThis 与四种不可用原因（Windows 无 containment / bubblewrap 缺失 /
    不支持的平台 / 需要桌面应用）、标签页徽标与提示模板
  - 预览元素选择/缩放：`Click an element · Esc to cancel`、`Preview zoom`、
    `Zoom preview in/out`、`Reset preview zoom, currently ${o}%`、
    `Remove preview element ${t.selector}` 等
  - 管理员审批：`Administrator approval required` 及标签页 tooltip
  - 其他：`Attach images`（配合主进程新对话框）、`Markdown view`、`Source`、
    `Move to new window`、`Premium session time remaining`、
    `Changed during agent work`（文件变更统计新拆分）
- **结构变更迁移**：文件计数复数 `," file",t.files.length===1?"":"s"` →
  ` file${t===1?"":"s"}`（提取为 LI 辅助函数的内联模板）；`Agent changed ` 拼接 →
  `` `Agent changed ${LI(t)}` `` 模板词条；移除已下线的
  `Drop files, photos, or folders to attach`
- **验证**：`all keys matched`、纯字面量覆盖 771/771（100%）、`lint_dict` 通过；
  主进程补丁逐字节套用、`node --check` 通过，postbuild 自检全绿；
  uipos 残留扫描由 52 → 26 条（剩余均为约定保留英文项：代码关键字、模型名、命令）
- 词典更新为 exact 787 / template 131 / code 4 / pattern 45

## [0.0.86] · 2026-09-03

- **适配 Freebuff v0.0.86**：targetVersion / packVersion 升至 0.0.86。渲染 bundle
  `index-qE9EmCR_.js` → `index-kOlI7uqe.js`；NSIS 安装器再次清掉 `hanhua-backup-*`，
  走「无备份回退安装目录英文原版」构建路径
- **模板变量自动重映射**：`tools/remap.js` 迁移 34 条（`bn → pn`、`wo → So`、`dV → $8`、
  `UP → ey`、`I1 → W1`、`Ni → Di`、`jD(re) → XD(ne)`、`dQ → vQ`、`DS → qS`、
  `Jt → Kt`、`hV → A8`、`pm → Xp`、`cV → P8`、`uV → R8`、`XP → BE`、`uy → Jb`、
  `H → W`、`QT → yb`、`Ec → kc`、`yPe → tRe`、`pz → bz`、`uv → pv` 等），1 条
  AMBIGUOUS（`Context ${$s(g)}`，锚文本命中 2 处插值不一致）手工改为 `Context ${As(g)}`
- **GLM 5.2 推荐活动整体改名**为「高级会话 / 赏金（Bounty）」，删除 8 条旧词条并补翻
  对应新文案：
  - 奖池标题 `${r?"Promo":"GLM 5.2 promo"}` → `` ${r?"Promo":"Bounty promo"} ``，
    翻译由残留的「GLM 5.2 推广」更正为「赏金推广」
  - `GLM 5.2 unlocked` → `Reward session unlocked` / `Earned sessions`；
    `Refer friends to unlock GLM 5.2` → `Refer friends for more free sessions` /
    `Refer friends for an extra premium session`；`Each qualified referral earns…` →
    「+1 次/天」模板与「one more 1-hour premium session」两式；
    `GLM 5.2 — today’s sessions used` → `Today’s premium sessions used`
  - 新增 `Premium sessions`、`Reward session unlocked`、`earned from bounties`、
    `Complete a bounty to unlock` 等 exact 词条
- **标签页关闭交互重写**：旧 `Delete the queued close action to cancel` /
  `Tab close scheduled` 删除，改为状态化 label/tooltip——`Cancel closing this tab` /
  `Close tab when done` / `Closing this tab…` / `This tab will close once the queue finishes. Click to cancel.`
  / `Couldn't cancel the tab close` 等
- **移除已下线文案**：`Time since the agent finished`（→ 现有 `Time since your latest prompt`）、
  `After everything above finishes, close this tab and clean up the thread`
- **验证**：`all keys matched`、纯字面量覆盖 728/728（100%）、`lint_dict` 通过；
  主进程补丁逐字节套用、`node --check` 通过，postbuild 自检 4 项全绿
- 词典更新为 exact 743 / template 123 / code 4 / pattern 45

## [0.0.84] · 2026-09-02

- **适配 Freebuff v0.0.84**：targetVersion / packVersion 升至 0.0.84。本轮渲染 bundle
  内容哈希不变（仍为 `index-qE9EmCR_.js`），**变更全部在主进程 asar**（package.json
  除版本号外无差异）；装机目录无新增备份，构建回退直接用上一轮的
  `hanhua-backup-20260902-110906`（实为 0.0.84 英文原版）作 pristine
- **主进程补丁重新生成**：五份既有补丁与 0.0.83 版逐字节一致（相关区域无实质变更），
  仅 `electron-main.cjs.patch` 随新词条 +9 行；**新增 `electron-open-in.cjs.patch`**
- **补翻两条存量漏翻**（0.0.83 就存在、主进程单引号字符串词典覆盖不到，走补丁分区）：
  - 「打开方式」右键菜单里的 `Copy path` → 复制路径（主进程传 label，渲染端原样显示）
  - 打开失败 toast 兜底 `Could not open that path` → 无法打开该路径
- **补翻渲染端配套两条历史漏翻**（template）：`Open in ${C.label}` → `在 ${C.label} 中打开`、
  `Couldn’t open in ${C.label}.` → `无法在 ${C.label} 中打开。`（主 bundle 替换 1057 → 1060 处）
- **`tools/apply_ui_patch.js` 微修**：`couldn’t`（弯引号）变体提前到 `couldn't` 之前判断，
  消除 0.0.84 index.html 上的误报 MISSED
- **验证**：`all keys matched`、纯字面量覆盖 727/727（100%）、`lint_dict` 通过；
  uipos 残留 26 条不变（均为有意保留项），主进程 UI 位置英文从 15 → 13 条（余下均为
  内部 API 错误与编辑器/终端名）
- 词典更新为 exact 741 / template 123 / code 4 / pattern 45

## [0.0.83] · 2026-09-02

- **适配 Freebuff v0.0.83**：targetVersion / packVersion 升至 0.0.83（渲染 bundle：
  `index-B7Da-BoE.js` → `index-qE9EmCR_.js`）。应用自动更新再次覆盖汉化，且 NSIS 安装器
  清掉了 `hanhua-backup-*`，继续走「无备份回退安装目录英文原版」构建路径
- **模板变量自动重映射**：`tools/remap.js` 迁移 13 条（`LT() → QT()`、`Ku(...) → fc(...)`、
  `Tc(...) → Ec(...)`、`fPe → yPe`、`mz(...) → pz(...)`），0 条 AMBIGUOUS / MISSING
- **补翻 0.0.83 新增文案**（2 条）：应用内更新日志面板标题 `What's new` → 更新内容、
  aria `What changed in Freebuff ${r}` → `Freebuff ${r} 更新内容`；
  模型列表新英文 tagline（Powerful all-round coding model 等）与 0.0.82 译文逐字相同，无需新增
- **验证**：主 bundle 替换 1057 处、`all keys matched`、纯字面量覆盖 727/727（100%）、
  `lint_dict` 通过；uipos 残留回到 26 条，均为有意保留项
- 词典更新为 exact 742 / template 121 / code 4 / pattern 45

## [0.0.82] · 2026-09-02

- **适配 Freebuff v0.0.82**：targetVersion / packVersion 升至 0.0.82（渲染 bundle：
  `index-B-G-js1m.js` → `index-B7Da-BoE.js`）。本轮首次实战「安装目录已是英文原版且无备份」的
  迁移回退（应用自动更新覆盖汉化后未重装汉化包，构建回退直接用安装目录英文原版作 pristine）
- **模板变量自动重映射**：`tools/remap.js` 迁移 30 条（`j → B`、`RT() → LT()`、`av → uv`、
  `Q → $`、`U → H`、`sU → dV`、`IP → UP`、`ib → Tc`、`ly → uy`、`nU → cV`、`iU → uV` 等），
  0 条 MISSING；2 条 AMBIGUOUS 人工核对
  - `Context ${As(g)}`：0.0.82 已被重写为 `Context ${$s(g)}`（同一模型选择器上下文百分比），
    按新原文重建词条
  - `${e.label} ${HEe(e.used)} of ${e.limit}`：0.0.82 用量面板重做后已无对应原文，删除死键
- **补翻 0.0.82 重写的用量面板与限额提示条**（新增 30 条、删除 3 条失效词条）：
  - 额度环 hint 六连：`… of ${…} plan sessions left this week/this billing period`、
    `… free premium sessions left today`、`… free sessions left this week/this month`、
    `… premium sessions left today (${o} free + ${r.dayLimit} from ${i.tierName})`
  - 面板标题与状态行：`Free` / `${i.tierName} plan` / `Free sessions` aria、
    `Free sessions are used first · today resets in …`（已入 exact）、
    `Today's premium sessions are used · resets in …`、
    `Premium sessions reset in … · MiMo and V4 Flash stay unmetered`
  - 限额提示条（limit-nudge）：`You've used all of ${r.label} for now.` / 
    `You're close to the limit on ${r.label} — … of ${r.limit} used.`、CTA `Get more sessions` / 
    `See plans`、关闭按钮 aria `Dismiss` 与 toast aria `Dismiss notification: …`
  - 状态标签：`your free sessions` / `your plan sessions` / `daily/weekly/monthly plan sessions`、
    模型池标签 `${r.poolLabel.toLowerCase()} sessions`、
    `${t.poolLabel.toLowerCase()} ${t.countsAdmissions?"starts":"sessions"}`、
    环 label `week` / `month` / `tokens`（pattern 分区，仅属性位置，不会误伤代码）
- **防呆加固**：`build.sh` 对 UI bundle 构建日志断言 `all keys matched`（此前仅检查替换次数 > 0，
  MISSED 死键不报错——本轮迁移中 `5-day limit reached` 死键正是靠这个新检查暴露的）
- **验证**：主 bundle 替换 1055 处、`all keys matched`、纯字面量覆盖 727/727（100%）、
  `lint_dict` 通过；uipos 残留仅剩代码关键字、模型名（GPT-5.6-*/Opus/Sonnet/Fable 5.1）、
  `mcpServers` 等内部标识与 HTML input type
- 词典更新为 exact 741 / template 120 / code 4 / pattern 44
- **版本号规范调整**：packVersion 不再使用 `x.y.z.1` 修复后缀，直接与 targetVersion
  保持一致（曾短暂发布的 `pack-v0.0.82.1` 已删除，由 `pack-v0.0.82` 取代）

## [0.0.79] · 2026-09-01

- **适配 Freebuff v0.0.79**：targetVersion / packVersion 升至 0.0.79，汉化包 Release `pack-v0.0.79` 已发布
- **新增文案翻译**：0.0.79 新增的 agent 工具按钮 label 21 条（pattern）+ guidance 使用说明 15 条（exact），
  主 bundle 替换 935 处，纯字面量词条覆盖 99.0%（671/678）
- **模板变量自动重映射**：remap 迁移 30 条（$ → j、x → S、jS → j1 等），0 条 MISSING
- **残留核对**：uipos/prose/leftover 扫描确认剩余均为代码标识符、键盘键名、模型名
  （GPT-5.6-*/Opus 4.8/Opus 5/Sonnet 5/Fable 5）与 HTML input type，无需翻译

### 词典修复版 · 2026-09-01（之二）

- **补翻 0.0.79 漏掉的一批用户可见文案**（新增 86 条、清理 9 条失效词条）：
  - 强度选择器（1–5 档悬浮提示）：Sprint/Focused/Crafted/Thorough/Exhaustive —… → 冲刺/专注/精工/彻底/穷尽
  - 空空间/起步页：Start a new thread / Open a project to get started / Choose a project folder…
  - 邀请页脚：Copied! / Copy invite link
  - Claude Code 运行时安装：Step 1 of 2 · Downloading/Verifying… / Connected / Retry download…
  - 应用更改（Apply）流程：Nothing to apply / Could not apply the changes / 各分支冲突原因（模板）
  - 技能编辑器：Edit/Delete/Restore…/Insert skill、删除确认、技能模板说明（含整段 SKILL.md 引导）
  - 会话状态/通知：Merge conflict / The agent sent nothing back
  - 文件浏览器/差异：No matches / Could not load diff / Path copied
  - 登录/提升权限/反馈/更新弹窗：Waiting for sign-in / Deny administrator access / A crash, error… / Development build…
  - 终端无障碍播报 + 拖拽键盘操作提示：Terminal input / Too much output… / dnd-kit 拖拽与空格键说明
- **清理死键**：✓ Copied!、⧉ Copy invite link、Balanced/Lean/Minimal…（强度旧文案）、
  Context ${gs(g)}、${e.label} ${Yye(e.used)} of ${e.limit} 等 9 条原文已被 0.0.79 改写的失效词条
- **验证**：替换 935 → 1030 处、`all keys matched`、纯字面量覆盖 729/729（100%）、`lint_dict` 通过；
  剩留英文均为有意保留（模型名、代码关键字、正则/编辑器内部报错、路径、`month` 用量标签）
- 词典更新为 exact 743 / template 105 / code 4 / pattern 28

## 工具链 · 2026-08-30（之二）

- **release.sh packVersion 防呆**：发布前对比远端最新 pack-manifest 的 packVersion，
  未升版本即拒绝（`--force` 才允许覆盖同版本），避免客户端静默跳过修复版
- **发布渠道启用 + 声明调整**：首个汉化包 Release `pack-v0.0.78` 已发布；免责声明
  从「仅限本机自用、勿公开传播」调整为「面向已合法获取 Freebuff Desktop 的用户
  供个人自用，可经本项目 Release 渠道获取与分发（勿商用、勿移除声明）」，
  同步更新根/子 README 与 release.sh 提示
- **汉化包发布/更新通道**：新增 `tools/release.sh`（打包 `output/` 为 zip + 生成
  pack-manifest.json + 发布 GitHub Release，`--no-upload` 仅打包并打印手工步骤）；
  `build.sh` 给产物注入 `<meta name="hanhua-pack">` 版本戳；`manifest.json` 新增
  `packVersion` 字段（同 targetVersion 的词典修复版可独立递增）
- **多开控制器客户端**：每 30 分钟检查 pack Release（与 Freebuff 更新检查共用
  代理链）；targetVersion 与本机 Freebuff 版本一致且 packVersion 更新时自动下载、
  SHA512 校验、解包（含 zip-slip 防护）到 `output/`，点「应用汉化」生效；
  「应用汉化」按钮在有新包待应用时保持可用，底栏提示「有新包 vX 可应用」

## [0.0.78] · 2026-08-30

- **适配 v0.0.78**：应用自动更新至 0.0.78（渲染 bundle：`index-DOLT0u31.js` →
  `index-B-G-js1m.js`）。装机目录无 `hanhua-backup-*`（备份链已断），本轮首次实战
  「无备份时回退用安装目录英文原版」的构建回退（见「工具链 · 2026-08-29（之二）」）；
  应用后英文原版已重新入库 `hanhua-backup-20260830-130408`。主进程补丁全部干净套用，
  语法校验通过
- **词典迁移**：`tools/remap.js` 自动迁移 6 条 template 词条的 minifier 改名
  （`c_e→u_e`、`gn(M)→gn(D)`、`so(L)→oo(L)`、`Mq(t,e)→Dq(t,e)`、`Dq(t)→Mq(t)`×2）；
  1 条被 remap 判 AMBIGUOUS 拒绝自动迁移（用量汇总行 `${e.label} … of ${e.limit}`，
  锚文本在新 bundle 多义命中），人工核对确认仅为格式化函数改名 `Gye→Yye`，
  同步更新 key 与译文后全命中
- **验证**：词典对主 bundle 替换 911 处、`all keys matched`；postbuild 纯字面量
  覆盖率 663/663（100%）；装机 index.html 带 `lang="zh-CN"` 标记，装机与 output 一致

## 工具链 · 2026-08-29（之二）

- **修复 `tools/remap.js` 内嵌的原始 NUL 字节**：`c.join('\u0000')` 的分隔符此前是
  字面 0x00 字节，导致 GitHub / 文本工具把该文件识别为二进制（不显示内容与 diff、
  无法正常审阅）。改为等价的 `\u0000` 转义序列，语义不变
- **首次构建不再依赖备份**：`build.sh` / `tools/update.sh` 在找不到 `hanhua-backup-*`
  时自动改用安装目录当前的英文原版（`resources/app.asar` + `orchestrator/ui`）作
  pristine，解决「先有 backup 还是先有 output」的鸡生蛋问题；安装目录已是汉化版
  且无备份（备份链已断）时明确报错，避免拿汉化产物当原版
- **`tools/apply_ui_patch.js` 补齐 MISSED 报告**：index.html 直改的每条替换不命中时
  逐条列出（已翻译则不误报），与 `apply.js` 行为对齐；漏翻不再静默，报告随
  build / update 日志留档

## 工具链 · 2026-08-27

- **版本迁移自动化**：新增 `tools/update.sh` 一键流水线（重映射 → 构建 → 残留扫描 → 待办汇总）。
  其中 `tools/remap.js` 按**英文锚文本**在新 bundle 上定位 template 词典条目，自动迁移
  `${...}` 插值表达式的 minifier 改名，RENAMED/AMBIGUOUS/MISSING 分类报告、写回前逐条自证
  逐字节命中。用 0.0.75 词典对 0.0.76 原版 bundle 回归验证：13 条改名全量命中，与当时手工
  核对结果一一对应（`Mq→Dq`、`Nn→On`、`OO→vO`、`Jye→t_e`、`WQ→UQ`…）
- **构建防呆自检**（针对 0.0.70 补丁静默跳过、0.0.72 悬空模板崩溃两类历史事故）：
  - `build.sh` 补丁套用失败即中止；补丁后主进程 `node --check`；
    UI bundle 词典替换次数为 0 即中止
  - 新增 `tools/postbuild.js`：断言 `ui/index.html` 汉化标记、主 bundle 词典覆盖率、
    主进程译文哨兵与语法，任一不过构建即失败（已做三项负向测试验证拦截有效）
- **词典质量门禁**：新增 `tools/lint_dict.js`（结构 / 重复键 / `${...}` 占位符一致性 /
  空译文 / pattern 纯字面量校验；表达式内字符串字面量可翻译，按骨架比较放行），
  接入 GitHub Actions（只跑不依赖专有文件的检查 + 工具脚本语法冒烟，
  顺带抓出并修复 `audit.js` 第 8 行两条语句挤一行的存量语法错误）
- **小工具**：`tools/status.sh`（装机 vs output vs 备份状态一览与建议）、
  `tools/prune_backups.sh`（清理累积备份，默认保留 3 份，`--yes` 才删）
- `tools/apply.js` 新增 `--quiet`（主进程小文件静音 MISSED 明细，突出 UI bundle 待补翻清单）

## [0.0.77] · 2026-08-29

- **适配 v0.0.77**：应用自动更新至 0.0.77（渲染 bundle：`index-C7M7l-Im.js` → `index-DOLT0u31.js`）
  - 主进程补丁全部干净套用，语法校验通过；菜单 / 对话框 / 同意窗口中文化不受影响
- **词典随 minifier 重命名更新**：`tools/remap.js` 自动迁移 29 条 template 词条的变量名
  （如 `${u} session…`→`${f} session…`、`${m} left today`→`${g} left today`、
  `resets in ${f}/${o}`→`resets in ${m}/${a}` 等）；7 条锚文本在新版被改写的词条人工重建
- **补翻 v0.0.77 新增/改写文案**（约 20 条）：
  - 用量窗口体系重做：5 天 / 月度窗口的状态说明（"5-day limit reached"、
    "today's premium sessions are used" 等 5 条）与用量汇总行 `${e.label} … of ${e.limit}`
  - 会话额度句式改写：`${TE(t)} ${cb(t,e)} today. ${n} Resets ${Dq(t)}.`，
    小时说明拆为条件句 "Each start opens up to 1 hour; …" / "Each lasts up to 1 hour."
  - 闲置会话回收提示（context-idle-release）："Nothing has run here for a while…" 长文案
    与 "frees in X"（含模型下拉框里的模板变体）
  - GLM 推广卡标题改为条件模板 `${r?"Promo":"GLM 5.2 promo"} — bounties pay up to …`，
    补翻 "Earned sessions" → 赚取的会话
- 有意保留英文：用量窗口极简 label（"5-day"/"month"，避免子串误伤 `monthly` 等代码标识符）、
  模型名（Opus/Sonnet/GPT-5.6…）、编辑器与技术标识
- 词典更新为 exact 676 / template 78 / code 4 / pattern 7（UI bundle 替换 910 处，**全词典命中**）
- 已使用 v0.0.77 原版 `app.asar` 与 `orchestrator/ui` 资源完成构建验证

## [0.0.76] · 2026-08-27

- **适配 v0.0.76**：应用自动更新至 0.0.76（渲染 bundle：`index-BiJnMND3.js` → `index-C7M7l-Im.js`）
  - 主进程五个补丁重新验证，全部干净套用，菜单 / 对话框 / 同意窗口中文化不受影响；
    主进程扫描复核无新增残留
- **词典随 minifier 重命名更新**：13 条 template 的变量名随新构建重排（如
  `${Mq(t.cost,e)}`→`${Dq(t.cost,e)}`、`${Nn(…)}`→`${On(…)}`、`${OO}`→`${vO}`、`${Jye}`→`${t_e}`、
  `${WQ(re)}`→`${UQ(re)}` 等），已逐一核对 bundle 原文后更新，译文不变
- **补翻 v0.0.76 新增/暴露文案**（4 条 pattern）：空间菜单「定位文件夹…」（Locate folder…）、
  空间卡片按钮「关闭此空间」（Close this space）、状态胶囊 label：disabled → 已禁用、failed → 失败
  （均仅命中 `label:`/`children:` 属性位置，不会影响 `phase==="failed"` 等内部状态比较）
- 有意保留英文的复查结论不变：编辑器名（Terminal/Cursor…）、模型名（Opus/Sonnet/GPT-5.6…）、
  内部 API 报错（cdp/mcp-consent bridge message）、库内部错误与语法高亮语法名
- 词典更新为 exact 666 / template 77 / code 4 / pattern 7（UI bundle 替换 896 处，**全词典命中**）
- 已使用 v0.0.76 原版 `app.asar` 与 `orchestrator/ui` 资源完成构建验证

## [0.0.75] · 2026-08-26

- **适配 v0.0.75**：应用自动更新至 0.0.75（渲染 bundle：`index-CjfQSmUP.js` → `index-BiJnMND3.js`）
  - 主进程五个补丁重新验证，全部干净套用，菜单 / 对话框 / 同意窗口中文化不受影响
- **v0.0.75 产品改动**：归档 / 置顶（archive / pin）、便签（notes）、工作摘要（work summaries）、
  首页线程目录（thread catalog / home）、更新计划设置等一批界面被移除或重写，对应约 87 条
exact、54 条 template 词典条目随之移除（git 历史可找回）
- **补翻 v0.0.75 新增/改写文案**：
  - 新更新弹窗（`Freebuff X is available`、`Install now for the quickest update…`、
    `Checking for updates`、`Downloading Freebuff X`）、登录第二步拆分
    （Claude Pro 套餐 / Codex + API key）、Spaces / None 标签
  - 标签页 aria（`Go to the tab using the … slot`、`premium model`、`needs attention`）、
    会话配额/推荐文案（`left today`、`resets in`、`/day from referrals`、GLM 5.2 promo）
  - 技能搜索（`Search skills to add…`）、连接器搜索、评论（`My comments on specific lines…`）、
    队列（`queued item` 复数）、代码评论复数片段
- **词典随 minifier 重命名更新**：约 30 条 template 的变量名随新构建重排（如
  `${Op(t)}`→`${kp(t)}`、`${je}`→`${Qt}`、`${Xi(t)}`→`${Nn(t)}`、`${no($)}`→`${ro(Q)}` 等），
  已逐一核对 bundle 原文后更新
- 词典更新为 exact 666 / template 77 / code 4 / pattern 3（UI bundle 替换 891 处，**全词典命中**）
- 已使用 v0.0.75 原版 `app.asar` 与 `orchestrator/ui` 资源完成构建验证

## [0.0.74] · 2026-08-25

- **适配 v0.0.74**：应用更新至 0.0.74，安装目录改为 `@codebufffreebuff-desktop`
  - **结构变更**：渲染 bundle 不再打包进 `app.asar`，改由 orchestrator 从 `resources/orchestrator/ui` 提供（`index-CjfQSmUP.js`）；`apply.sh` / `build.sh` 已适配新路径
  - 主进程源码与 v0.0.73 仅注释差异，五个主进程补丁重新生成，内容与 v0.0.73 一致
- **补翻 v0.0.74 新增文案**：
  - 空间菜单 aria-label（Freebuff menu）、新建空间路径拼接（New space in）
  - 已关闭标签页空态与搜索无结果（Threads you close land here. / No closed tabs match…）
  - 关闭空间前未保存文件确认（Discard the unsaved file edit in this space?）
  - 无法打开文件夹、反馈类型描述、队列自动继续、浏览器登录等待提示
- 词典更新为 exact 748 / template 91 / code 4 / pattern 3
- 已使用 v0.0.74 原版 `app.asar` 与 `orchestrator/ui` 资源完成构建验证

## [0.0.73] · 2026-08-25

- **适配 v0.0.73**：应用自动更新至 0.0.73（渲染 bundle 变化：`index-CWvAXWf2.js` → `index-Csh6DJux.js`）
  - 重新生成主进程补丁，适配新增 `splash.cjs` 与菜单结构变化
  - 启动页补丁改为保留每版 bundle/CSS 文件名，避免更新后加载旧资源
- **补翻 v0.0.73 新增文案**：
  - 空间（New space）及空间菜单、已关闭标签页、最近编辑文件
  - 关闭标签页搜索、转到标签页、会话列表宽度调整
  - MCP 工具筛选中的 Safe only、连接器运行/连接提示
- 修复新版恢复英文的主进程退出确认、应用菜单、文件对话框、沙箱失败提示、编排器失败提示和 MCP 同意窗口
- 词典更新为 exact 740 / template 89 / code 4 / pattern 3
- 已使用 v0.0.73 原版 `app.asar` 与 UI 资源完成构建验证

## [0.0.72] · 2026-08-24

- **适配 v0.0.72**：应用自动更新至 0.0.72（渲染 bundle 变化：`index-BcKNsVI9.js` → `index-CWvAXWf2.js`）
  - 重新生成所有主进程补丁，适配 v0.0.72 结构变更
  - 新增 `package.json`（`"type": "commonjs"`）解决 Desktop 目录 `package.json` 的 ESM 冲突
  - `build.sh` 补丁级别从 `-p2` 改为 `-p1`，适配新补丁路径格式
  - `build.sh` UI 补丁改用 `tools/apply_ui_patch.js` 直接替换，解决 `.gitattributes` CRLF 与 `git apply` 的兼容问题
  - 新增 `tools/gen_patches.js`：用 Unicode 转义避免 heredoc 编码问题，从原版自动生成补丁
- **补翻 v0.0.72 新增文案**：
  - v0.0.72 新增 `Open Project…` 菜单项
  - MCP 连接器同意窗口按钮（Cancel/Approve → 取消/批准）
  - consent-window.html 按钮文本
  - orchestrator-failure.cjs 进程忙碌对话框详情
  - mcp-consent-bridge.cjs Run it/Connect 按钮
- 所有主进程文件（main.cjs / consent-window.html / linux-launch.cjs / mcp-consent-bridge.cjs / orchestrator-failure.cjs）补丁重新生成
- **修复启动崩溃**：orchestrator-failure.cjs 补丁的忙碌对话框替换悬空了原模板字符串，主进程抛 `SyntaxError: Unexpected template string` 无法启动；已改为完整替换四行英文、末行保留反引号使 `${monitor}` 正常插值。`tools/gen_patches.js` 同步修正（含行首空格），重新生成的补丁与手修版字节级一致

## [0.0.71] · 2026-08-23

- **适配 v0.0.71**：应用自动更新至 0.0.71（渲染 bundle 变化：`index-CeOhCnWt.js` → `index-BcKNsVI9.js`）
  - 重新生成所有主进程补丁（行尾统一 LF，适配 v0.0.71 结构变更）
  - v0.0.71 变更：移除了标签页右键菜单的「Move to New Window」选项
- **补翻 0.0.71 新增/变更文案**：
  - 标签页上下文菜单适配（仅剩 Rename Tab / Close Tab）
  - 所有主进程补丁重新生成，确保与 v0.0.71 文件结构一致

## [0.0.70] · 2026-08-22

- **适配 v0.0.70**：应用自动更新至 0.0.70（渲染 bundle 变化：`index-CobqI3Sn.js` → `index-CeOhCnWt.js`）
  - 重新生成 `patches/ui-index.html.patch`（新 bundle 名 + 混合行尾），index.html 汉化**首次真正生效**
    （旧版 build.sh 在子目录执行 `git apply` 时补丁被静默跳过，`output/ui/index.html` 一直是英文）
  - 修复 `build.sh`：改为仓库根目录执行 `git apply --directory=output`，去掉吞错误的 `|| true` 与重定向，
    词典未命中（MISSED）现在会正常打印
- **补翻 0.0.70 新增/变更文案**（词典 exact 670→724、template 82→89）：
  - 标签页上限（“That model's tab limit is reached…”）、登录第二步拆分（Claude Pro / Codex）
  - MCP 连接器/同意窗口文案、反馈对话框、文件浏览器提示、技能删除确认、更新弹窗等约 60 处
- 安装时自动备份原版到 `resources/hanhua-backup-<时间戳>/`

## [0.0.68] · 2026-08-21

- **二次排查**：重新扫描渲染 bundle 与主进程，修复 58 处用户可见英文（词典增至 exact 607 / template 82 / code 4）
  - 主页/会话列表右键菜单、配额/邀请、状态条/工作区、消息/评论、对话框/aria 等
  - 复查后 bundle 与主进程均无用户可见英文残留
- **项目重组**：为上传 GitHub 整理仓库
  - 新增 `build.sh`：原版 + 词典 + 补丁的可复现构建（对 v0.0.68 验证，逐字节一致）
  - 新增 `patches/`：词典覆盖不到的人工修改（index.html 与主进程 5 个文件）以补丁形式归档
  - `apply-hanhua.sh` → `apply.sh`、`restore-hanhua.sh` → `restore.sh`，支持自定义产物目录
  - 扫描中间产物移入 `work/`（gitignore）；`README.md`、`LICENSE`、`docs/` 补齐
- **合规调整**：README 补充免责声明，明确汉化产物仅限自用、不公开分发，安装改为本地 `build.sh` 构建

## [0.0.68] · 首次汉化

- 渲染进程约 720 处文案中文化（词典 exact 607 / template 82 / code 4 / pattern 3）
- 主进程：启动页、应用菜单/标签页右键菜单、退出确认、文件对话框、编排器失败对话框、
  MCP 连接器同意窗口、Linux 沙箱失败提示
- `apply.sh` / `restore.sh` 一键安装与还原，自动备份
