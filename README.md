# Freebuff Desktop 汉化包 / Chinese Localization 🇨🇳

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![GitHub last commit](https://img.shields.io/github/last-commit/Ximmmmmmm/freebuff-zh)
![GitHub Repo stars](https://img.shields.io/github/stars/Ximmmmmmm/freebuff-zh?style=social)
![GitHub forks](https://img.shields.io/github/forks/Ximmmmmmm/freebuff-zh?style=social)
[![Target](https://img.shields.io/badge/目标-Freebuff%20Desktop%20v0.0.86-blue)](https://freebuff.com)
[![lint](https://github.com/Ximmmmmmm/freebuff-zh/actions/workflows/ci.yml/badge.svg)](https://github.com/Ximmmmmmm/freebuff-zh/actions/workflows/ci.yml)

**中文关键词 / Keywords**: Freebuff 汉化、Freebuff 中文版、Freebuff Chinese localization、AI coding agent 中文、Freebuff 翻译、Electron 汉化、localization pack

Freebuff Desktop（`@codebuff/freebuff-desktop` v0.0.86）的**简体中文汉化包**，直接修改已打包产物，无需源码、不涉及任何联网改动。

> **English**: A Simplified-Chinese localization pack for Freebuff Desktop — the free AI coding agent. Patches the packaged app directly, no source build required. If you're a Chinese-speaking Freebuff user, this is for you.

## ✨ 特性

- **AI 回复也中文化**：`apply.sh` 顺带把回复语言偏好写进 `~/.AGENTS.md`（Freebuff 无条件读取的
  用户级指令入口，无需改动专有 bundle），界面与 AI 语言一次搞定；不想动这个文件用
  `FREEBUFF_ZH_NO_LANG=1 bash apply.sh` 跳过
- **覆盖全面**：渲染进程约 920 处文案 + 主进程菜单 / 对话框 / 同意窗口全面中文化
- **词典驱动**：`dict.json`（exact 743 / template 123 / code 4 / pattern 45），幂等应用、可审计
- **可复现构建**：`build.sh` 从原版 + 词典 + 补丁**逐字节重建**汉化产物（v0.0.77 曾对照 Release 产物验证；v0.0.83 / v0.0.86 适配经防呆自检通过）
- **一键安装/还原**：`apply.sh` / `restore.sh`，自动备份，随时回退英文原版
- **工具链完整**：`tools/` 提供提取、翻译、核查、残留扫描等脚本，便于随版本更新补翻
- **版本迁移自动化**：`tools/update.sh` 一键串起重映射 → 构建 → 残留扫描。其中
  `tools/remap.js` 自动把 template 词典条目的 `${...}` 变量名迁移到新 bundle
  （对 v0.0.75→v0.0.76 的 13 条改名全量命中验证），不再逐条手工核对
- **构建防呆自检**：`build.sh` 会对补丁后的主进程做 `node --check`、词典替换次数为 0 即中止，
  构建后由 `tools/postbuild.js` 断言 `ui/index.html` 汉化标记与译文哨兵——杜绝历史上出现过的
  「补丁静默跳过」「悬空模板启动崩溃」两类事故
- **词典质量门禁**：`tools/lint_dict.js` 校验结构与 `${...}` 占位符一致性、查重复键，
  已接入 GitHub Actions（只跑不依赖专有文件的检查）

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
- **packVersion**：跟随 targetVersion，与所适配的 Freebuff 版本保持一致（不带第四段修复后缀）；同版本只改词典的重发用 `release.sh --force`
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
├── tools/             # 提取/翻译/核查脚本（见 docs/汉化流程.md）
│   ├── update.sh      # 一键版本迁移：重映射 → 构建 → 残留扫描 → 待办汇总
│   ├── remap.js       # template 词典条目随 minifier 改名自动迁移
│   ├── postbuild.js   # 构建产物自检（index.html 标记 / 主进程语法与译文哨兵）
│   ├── lint_dict.js   # 词典质量门禁（结构 / 重复键 / 占位符一致性）
│   ├── status.sh      # 装机 vs 构建 vs 备份状态一览
│   ├── prune_backups.sh # 清理累积的 hanhua-backup-*（保留最近 N 份）
│   ├── gen_patches.js # 从原版自动生成主进程补丁（Unicode 转义避免编码问题）
│   ├── lang_pref.sh   # AI 回复语言偏好：写 / 删 ~/.AGENTS.md 标记段（被 apply.sh、restore.sh source）
│   ├── test_lang_pref.sh # 上者的沙箱 HOME 回归测试（只依赖 bash，CI ubuntu + windows 双跑）
│   └── apply_ui_patch.js # 直接替换 UI index.html 翻译（替代 git apply）
├── build.sh           # 可复现构建：原版 + 词典 + 补丁 → output/（含防呆自检）
├── apply.sh           # 安装汉化到应用（自动备份 + 写入 AI 语言偏好）
├── restore.sh         # 从备份还原英文原版（并移除 AI 语言偏好段）
├── docs/              # 汉化流程 / 更新维护说明
└── work/              # 扫描中间产物（gitignore，不入库）
```

## ⚠️ 注意事项

- **自动更新会覆盖汉化**：应用自带 electron-updater，更新后汉化文件会被替换。更新后重新执行
  `apply.sh`（或用 `build.sh` 对新版本重新构建；也可直接在多开控制器里点「应用汉化」）。
  详见 `docs/更新维护.md`。
- **会写入一个用户级配置文件**：`apply.sh` 会在 `~/.AGENTS.md` 末尾追加一段 AI 回复语言指令，
  用 `# >>> freebuff-zh:lang-pref >>>` 与 `# <<< freebuff-zh:lang-pref <<<` 两个标记包住。
  **只增删这一段**，你文件里的自有内容按字节原样保留；重复运行不会堆叠（先剥旧段再追加）。
  `restore.sh` 会精确移除这一段，移除后若文件只剩空白则连文件一起删除。
  原理：Freebuff 的 orchestrator 每次新建会话都无条件读取 `~/.AGENTS.md` 并注入系统提示词，
  而界面上「包含 AGENTS.md」那个勾选只管**项目根目录**那份（且默认关闭），两者互不相干。
  段落被手工改坏（只剩起始标记）时脚本一律不改动文件，只提示手动处理，以免误删你的内容。
- **多开控制器不写这个文件**：控制器的「应用汉化」是直接复制 `app.asar` 与 `ui/`，不经过
  `apply.sh`，所以只汉化界面（多开实例的 AI 语言由控制器各自管理）。要 AI 也说中文，
  在本仓库根目录跑一次 `bash apply.sh` 或单独执行 `bash tools/lang_pref.sh install`。
- **有意保留英文的部分**：编程语言名（Python、TypeScript…）、主题名（Ayu Dark…）、键盘键名
  （Enter、Delete…）、内部枚举/类型名、库内部错误信息——改动会破坏逻辑，故不翻译。
- 汉化不涉及任何联网、上传或凭据改动。

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
