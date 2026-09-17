# Freebuff Desktop 汉化包 / Chinese Localization 🇨🇳

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![GitHub last commit](https://img.shields.io/github/last-commit/Ximmmmmmm/freebuff-zh)
![GitHub Repo stars](https://img.shields.io/github/stars/Ximmmmmmm/freebuff-zh?style=social)
![GitHub forks](https://img.shields.io/github/forks/Ximmmmmmm/freebuff-zh?style=social)
[![Target](https://img.shields.io/badge/目标-Freebuff%20Desktop%20v0.0.120-blue)](https://freebuff.com)
[![lint](https://github.com/Ximmmmmmm/freebuff-zh/actions/workflows/ci.yml/badge.svg)](https://github.com/Ximmmmmmm/freebuff-zh/actions/workflows/ci.yml)

**中文关键词 / Keywords**: Freebuff 汉化、Freebuff 中文版、Freebuff Chinese localization、AI coding agent 中文、Freebuff 翻译、Electron 汉化、localization pack

Freebuff Desktop（`@codebuff/freebuff-desktop` v0.0.120）的**简体中文汉化包**，直接修改已打包产物，无需源码、不涉及任何联网改动。

> **English**: A Simplified-Chinese localization pack for Freebuff Desktop — the free AI coding agent. Patches the packaged app directly, no source build required. If you're a Chinese-speaking Freebuff user, this is for you.

## ✨ 特性

- **覆盖全面**：渲染进程约 1870 处文案 + 主进程菜单 / 对话框 / 同意窗口全面中文化；connectors / MCP 面板（状态标签、详情面板与目录里 100 条连接器介绍）与 v0.0.104 新增的 BYOK（自带密钥）API 提供商界面已全量中文化
- **词典驱动**：`dict.json`（exact 1235 / template 279 / code 8 / pattern 75），幂等应用、可审计
- **可复现构建**：`build.sh` 从原版 + 词典 + 补丁**逐字节重建**汉化产物  （v0.0.77 曾对照 Release 产物验证；v0.0.83 / v0.0.87 / v0.0.88 / v0.0.90 / v0.0.91 / v0.0.92 / v0.0.103 / v0.0.104 / v0.0.105 / v0.0.106 / v0.0.107 / v0.0.108 / v0.0.109 / v0.0.110 / v0.0.112 / v0.0.113 / v0.0.114 适配经防呆自检通过）
- **v0.0.120 适配**：上游新增「赞助式 Supabase 配置邀请」（schemaVersion 1）整套界面、文件预览的磁盘/未保存状态说明、以及额度说明里的「为什么有这个限制？」与「Verify your country ↗」国家/地区验证流程（含 30 天锁定那段长说明）——新增 42 条、下线 1 条，替换数 1817 → 1870；模板变量自动重映射 67 条、歧义 2 条人工改名（`Remove ${…}` 那一族与 `resets in ${…}`）。本轮把上游对差工具漏掉的 6 条短句逐条补了出来（`Recheck setup` / `Check compatibility` / `Rechecking…` / ` Country & allowance` / `Supabase invitation`，以及被整句包含的 `This Git repository needs a committed checkpoint.`——两三个词或与已翻长句重叠的片段按设计不单列），并修掉 `tools/probe_stream_epoch.js` 的两处取证缺陷（消息 id 生成器的压缩名 0.0.120 从 `Ec` 变 `Pc`，写死名字会让行为取证退化成「仅凭哨兵放行」；CLI 入口的 `let verdict` 与模块函数 `verdict()` 同名触发 TDZ）。主进程 `mainscan` 零漏翻，`patches/` 无需改动，行为补丁体检 KEEP
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
- **上游新增文案清单**：`tools/upstreamdiff.js` 拿**两版英文原版**对差（不依赖上一版汉化包），列出本版上游新写 / 改写 / 下线的文案，并把「词典未覆盖」的那批单独拎出来当待翻清单——`build.sh` 每次把本版英文原版登记成快照 `work/pristine/<版本>/`，`update.sh` 第 6 步自动取最新两版比一次；只有一版基线时它会打印补齐办法，不当静默跳过
- **英文原版快照可跨机器搬**：`tools/pristine.js` 管快照仓库（`capture` 从备份 / 装机原版 / NSIS 安装包采集，`export` / `import` 单文件搬运，`publish` / `--from-release` 走自己的 Release，`list` 逐文件 sha1 校验并顺带探官方发布源上还有哪些版本的安装包）。上一版原版在本机是会被抹掉的（自动更新覆盖装机原版，更新缓存装完即删）：换机器或清过 `work/` 之后，`node tools/pristine.js import --from-release latest` 一条命令就能把基线拿回来
- **版本迁移自动化**：`tools/update.sh` 一键串起重映射 → 构建 → UI 残留扫描 → 主进程英文扫描 → 上游新增文案 + 回归闸门。其中
  `tools/remap.js` 自动把 template 词典条目的 `${...}` 变量名迁移到新 bundle，也包括以未闭合
  `${条件?` 结尾的「半截模板」嵌套词条（对 v0.0.75→v0.0.76 的 13 条改名全量命中验证），
  不再逐条手工核对
- **发布回归闸门**：`tools/regress.js` 把新构建与上一版已发布包对一遍——比对前抹掉 `${...}`
  插值（变量改名不误报）、模板逐段取（嵌套模板不漏），只要出现新增英文自然语言片段就中止
  发布，拦住「词典全命中但某句变回英文」这类静默回归（`update.sh` / `release.sh` 自动调用）；
  `release.sh` 发布前还有一道**主进程闸门**（`tools/mainscan.js`），`electron/*.cjs` 里还有
  没译的界面文案就中止发布（确认有意保留时 `--allow-english` 放行）
- **构建防呆自检**：`build.sh` 在解包前先跑 `tools/lint_dict.js`（词典结构 / 半截模板键，
  此前只在 CI 跑、本地流程形同虚设），之后对补丁后的主进程做 `node --check`、词典替换次数为 0 即中止，
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
bash tools/release.sh               # 打包 + 生成 pack-manifest.json + 发布 Release（需 gh CLI 已登录）
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
├── manifest.json      # 词典适配的 Freebuff 版本（多开控制器读取做兼容检查）
├── patches/           # 人工补丁：词典覆盖不到的手工修改（主进程 7 个文件；index.html 由 tools/apply_ui_patch.js 直改）
├── tools/             # 构建 / 版本迁移 / 找漏翻脚本（见 docs/更新维护.md）
│   ├── update.sh      # 一键版本迁移（7 步）：重映射 → 补丁体检 → 构建 → UI 残留扫描 → 主进程扫描 → 上游新增文案 + 回归闸门 → 汇总
│   ├── remap.js       # template 词典条目随 minifier 改名自动迁移
│   ├── postbuild.js   # 构建产物自检（index.html 标记 / 主进程语法与译文哨兵）
│   ├── lint_dict.js   # 词典质量门禁（结构 / 重复键 / 占位符一致性）
│   ├── test_remap.js  # remap / lint 自测（合成「变量改名」bundle，CI 跑）
│   ├── regress.js     # 发布回归闸门（新旧产物英文片段比对，release/update 调用）
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
  品牌一致性，故不翻译。当前界面属性位置残留英文为 **14 条**，均属上述类别
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
