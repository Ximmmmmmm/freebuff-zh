# Freebuff Desktop 汉化包 / Chinese Localization 🇨🇳

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![GitHub last commit](https://img.shields.io/github/last-commit/Ximmmmmmm/freebuff-zh)
![GitHub Repo stars](https://img.shields.io/github/stars/Ximmmmmmm/freebuff-zh?style=social)
![GitHub forks](https://img.shields.io/github/forks/Ximmmmmmm/freebuff-zh?style=social)
[![Target](https://img.shields.io/badge/目标-Freebuff%20Desktop%20v0.0.105-blue)](https://freebuff.com)
[![lint](https://github.com/Ximmmmmmm/freebuff-zh/actions/workflows/ci.yml/badge.svg)](https://github.com/Ximmmmmmm/freebuff-zh/actions/workflows/ci.yml)

**中文关键词 / Keywords**: Freebuff 汉化、Freebuff 中文版、Freebuff Chinese localization、AI coding agent 中文、Freebuff 翻译、Electron 汉化、localization pack

Freebuff Desktop（`@codebuff/freebuff-desktop` v0.0.105）的**简体中文汉化包**，直接修改已打包产物，无需源码、不涉及任何联网改动。

> **English**: A Simplified-Chinese localization pack for Freebuff Desktop — the free AI coding agent. Patches the packaged app directly, no source build required. If you're a Chinese-speaking Freebuff user, this is for you.

## ✨ 特性

- **覆盖全面**：渲染进程约 1773 处文案 + 主进程菜单 / 对话框 / 同意窗口全面中文化；connectors / MCP 面板（状态标签、详情面板与目录里 100 条连接器介绍）与 v0.0.104 新增的 BYOK（自带密钥）API 提供商界面已全量中文化
- **词典驱动**：`dict.json`（exact 1173 / template 264 / code 6 / pattern 66），幂等应用、可审计
- **可复现构建**：`build.sh` 从原版 + 词典 + 补丁**逐字节重建**汉化产物  （v0.0.77 曾对照 Release 产物验证；v0.0.83 / v0.0.87 / v0.0.88 / v0.0.90 / v0.0.91 / v0.0.92 / v0.0.103 / v0.0.104 / v0.0.105 适配经防呆自检通过）
- **v0.0.105 适配**：BYOK 提供商面板文案微调（`Provider setup ↗` / `No providers found. Try “Custom”.` / `Search providers…` / `Requests go to ` / `Preset only. … still needs testing.` 与 aria-label `App tools`、`Providers`），并收起上游下线的两句宣传语（`One key, many models` / `OpenAI-compatible API`）；新增两条 Freebucks 付费确认分支与两处余额提示（共 11 条，替换数 1762 → 1773）。主进程 6 个 electron 文件经补丁后与 0.0.104 逐字节一致，`patches/` 未改动；49 条模板变量自动重映射，2 条 remap 歧义条目（`Remove ${…}`、`Could not select ${…}: ${…}`）人工改名
- **v0.0.104 适配**：新增「自带密钥（BYOK）API 提供商」整块界面中文化（设置页入口、提供商管理弹窗、模型选择器分组、表单与全部 aria-label 共 75 条），并补齐 3 处 0.0.103 就存在的历史漏翻（额度环 `resets in …` 标签、`Dismiss notification: …`、`Remove ${…}`）；v0.0.104 的主进程文件与 0.0.103 逐字节一致，补丁无需改动
- **v0.0.103 适配**：自动重映射 56 条模板变量；补齐模型选择器新增 9 个模型的标签与数据使用 / 限速提示，以及 Freebucks 钱包 / paywall 的套餐升级与付费时长文案（模型名按约定保留英文）；v0.0.88 起 Freebucks 钱包额度系统（每日额度 + 钱包 + 按小时计价的会话购买）全新界面全套中文化
- **一键安装/还原**：`apply.sh` / `restore.sh`，自动备份，随时回退英文原版
- **工具链完整**：`tools/` 提供提取、翻译、核查、残留扫描等脚本，便于随版本更新补翻。
  残留扫描分两层：`uipos.js` 扫界面属性位置（含三元分支、`actionLabel`、JSX 文本节点），
  `fieldscan.js` 扫 `description:` / `tagline:` / `hint:` 这类属性锚点之外的字段
- **版本迁移自动化**：`tools/update.sh` 一键串起重映射 → 构建 → 残留扫描。其中
  `tools/remap.js` 自动把 template 词典条目的 `${...}` 变量名迁移到新 bundle，也包括以未闭合
  `${条件?` 结尾的「半截模板」嵌套词条（对 v0.0.75→v0.0.76 的 13 条改名全量命中验证），
  不再逐条手工核对
- **发布回归闸门**：`tools/regress.js` 把新构建与上一版已发布包对一遍——比对前抹掉 `${...}`
  插值（变量改名不误报）、模板逐段取（嵌套模板不漏），只要出现新增英文自然语言片段就中止
  发布，拦住「词典全命中但某句变回英文」这类静默回归（`update.sh` / `release.sh` 自动调用）
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

- **发布端**：Release tag `pack-v<packVersion>`，附件为 `hanhua-pack-<版本>.zip`（= `output/` 打包）和 `pack-manifest.json`（packVersion / targetVersion / asset / sha512）
- **客户端**：控制器每 30 分钟检查一次（与 Freebuff 更新检查共用同一条代理链）。仅当 manifest 的 targetVersion 与本机 Freebuff 版本**完全一致**且 packVersion 更新时才下载，SHA512 校验、解包后落到 `output/`，点「应用汉化」生效
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
├── patches/           # 人工补丁：词典覆盖不到的手工修改（主进程 6 个文件；index.html 由 tools/apply_ui_patch.js 直改）
├── tools/             # 构建 / 版本迁移 / 找漏翻脚本（见 docs/更新维护.md）
│   ├── update.sh      # 一键版本迁移：重映射 → 构建 → 残留扫描 → 待办汇总
│   ├── remap.js       # template 词典条目随 minifier 改名自动迁移
│   ├── postbuild.js   # 构建产物自检（index.html 标记 / 主进程语法与译文哨兵）
│   ├── lint_dict.js   # 词典质量门禁（结构 / 重复键 / 占位符一致性）
│   ├── test_remap.js  # remap / lint 自测（合成「变量改名」bundle，CI 跑）
│   ├── regress.js     # 发布回归闸门（新旧产物英文片段比对，release/update 调用）
│   ├── status.sh      # 装机 vs 构建 vs 备份状态一览
│   ├── prune_backups.sh # 清理累积的 hanhua-backup-*（保留最近 N 份）
│   ├── gen_patches.js # 从原版自动生成主进程补丁（Unicode 转义避免编码问题）
│   └── apply_ui_patch.js # 直接替换 UI index.html 翻译（替代 git apply）
├── build.sh           # 可复现构建：原版 + 词典 + 补丁 → output/（含防呆自检）
├── apply.sh           # 安装汉化到应用（自动备份）
├── restore.sh         # 从备份还原英文原版
├── docs/              # 汉化维护说明（日常恢复 / 版本适配 / 发布）
└── work/              # 扫描中间产物（gitignore，不入库）
```

## ⚠️ 注意事项

- **自动更新会覆盖汉化**：应用自带 electron-updater，更新后汉化文件会被替换。更新后重新执行
  `apply.sh`（或用 `build.sh` 对新版本重新构建；也可直接在多开控制器里点「应用汉化」）。
  详见 `docs/更新维护.md`。
- **修正重发要升第四段**：控制器只在 packVersion 变新时才下载。同一 Freebuff 版本内又改了词典，
  请把 `packVersion` 升到 `0.0.103.1` 这样再发布，已装机的机器才会自动拿到修复；若用
  `release.sh --force` 同号覆盖，已装过旧资产的机器版本号相同、不会自动更新，需清掉包版本戳后
  重新点「应用汉化」手动重应用。
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
- [ ] **启动时自检自动恢复汉化**：主进程注入逻辑，检测 `ui/index.html` 缺失汉化标记时自动从内置副本恢复，更新后首次启动即回到中文

## 📜 许可证与声明

- **作者**：Ximmmmmmm（本项目为个人维护项目，仅此一位作者）
- 本仓库的**脚本、词典、补丁与文档**以 **MIT License** 发布（见 `LICENSE`），属于你的原创内容。
- **免责声明**：Freebuff Desktop（`@codebuff/freebuff-desktop`）是 Freebuff, Inc. 的专有商业软件，
  其安装包内不含任何开源许可（仅 Electron/Chromium 组件有各自的开源许可）。
  本项目的汉化产物（修改后的 `app.asar` / `ui/`）派生自该软件，**仅面向已合法获取
  Freebuff Desktop 的用户供个人自用**：可经本项目的 Release 渠道获取与分发，但请勿
  用于商业用途、请勿移除本声明或声称原创，并请遵守 Freebuff 的服务条款。
  如 Freebuff 官方提出异议，请立即停止分发并删除相关文件。购买正版是对开发者的支持。
