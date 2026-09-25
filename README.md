# Freebuff Desktop 汉化包 / Chinese Localization 🇨🇳

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![GitHub last commit](https://img.shields.io/github/last-commit/Ximmmmmmm/freebuff-zh)
![GitHub Repo stars](https://img.shields.io/github/stars/Ximmmmmmm/freebuff-zh?style=social)
![GitHub forks](https://img.shields.io/github/forks/Ximmmmmmm/freebuff-zh?style=social)
[![Target](https://img.shields.io/badge/目标-Freebuff%20Desktop%20v0.0.146-blue)](https://freebuff.com)
[![lint](https://github.com/Ximmmmmmm/freebuff-zh/actions/workflows/ci.yml/badge.svg)](https://github.com/Ximmmmmmm/freebuff-zh/actions/workflows/ci.yml)

**中文关键词 / Keywords**: Freebuff 汉化、Freebuff 中文版、Freebuff Chinese localization、AI coding agent 中文、Freebuff 翻译、Electron 汉化、localization pack

Freebuff Desktop（`@codebuff/freebuff-desktop` v0.0.146）的**简体中文汉化包**，直接修改已打包产物，无需源码、不涉及任何联网改动。

> **English**: A Simplified-Chinese localization pack for Freebuff Desktop — the free AI coding agent. Patches the packaged app directly, no source build required. If you're a Chinese-speaking Freebuff user, this is for you.

## ✨ 特性

- **覆盖全面**：渲染进程约 2073 处文案 + 主进程菜单 / 对话框 / 同意窗口全面中文化
- **词典驱动**：`dict.json` 共 1726 条（exact 1368 / template 253 / code 19 / pattern 86），幂等应用、可审计
- **可复现构建**：`build.sh` 从「原版 + 词典 + 补丁」**逐字节重建**产物，每次适配都过一遍防呆自检
- **漏翻藏不住**：构建后自检、UI 残留扫描、主进程扫描、上游新增文案对差、单词级差集、字面量占用、补丁锚点预检与重生成——每类静默失败都有对应闸门
- **跟着上游走**：Freebuff 出新版后 `bash tools/update.sh` 一条命令跑完迁移（重映射 → 体检 → 构建 → 扫描 → 差集 → 汇总）
- **配套多开控制器**：[freebuff-controller](https://github.com/Ximmmmmmm/freebuff-controller) 会在 Freebuff 更新冲掉汉化后**自动换回中文**，无需动手

> 逐版本的适配记录（上游改了什么、词典增删了多少条、哪些闸门报出来的）见 **[CHANGELOG.md](CHANGELOG.md)**。

## 📦 快速开始（安装）

> ⚠️ 汉化产物（修改后的 `app.asar` / `ui/`）派生自 Freebuff 的专有软件，仅面向已合法获取 Freebuff Desktop 的用户供个人自用（可经本项目的 Release 渠道获取），请勿商用。详见文末免责声明。

先在本机构建产物，再安装：

```bash
bash build.sh     # 自动选原版：优先安装目录里最近的 hanhua-backup-*，没有备份（首次构建）则直接用安装目录的英文原版
bash apply.sh     # 应用汉化（自动备份原文件）
```

> 也可以在[多开控制器](https://github.com/Ximmmmmmm/freebuff-controller)里一键应用，无需命令行。

脚本会先把现有 `app.asar` 和 `ui/` 备份到 `resources/hanhua-backup-<时间戳>/`，再替换，**重启应用生效**。

手动安装：
1. 把 `app.asar` 复制到 `%LOCALAPPDATA%\Programs\@codebufffreebuff-desktop\resources\`
2. 把 `ui/` 整体替换 `resources\orchestrator\ui\`

### 还原英文原版

```bash
bash restore.sh   # 从最近一次备份还原（仓库根目录运行）
```

### 发布汉化包（可选）

汉化包可作为 GitHub Release 分发，多开控制器会像检查 Freebuff 更新一样检查并拉取：

```bash
bash tools/release.sh               # 打包 + 生成 pack-manifest.json + 发布 Release（需 gh CLI 已登录）
bash tools/release.sh --no-upload   # 只打包到 dist/，打印手工上传步骤
```

- Release tag 为 `pack-v<packVersion>`，附件是本版产物 zip、`pack-manifest.json`，以及本版英文原版快照（给别的机器当基线用）
- **packVersion 跟随 targetVersion**：同一 Freebuff 版本内的修正重发追加第四段（如 `0.0.146.2`），控制器按四段比较，已装旧包的机器会自动拉取
- ⚠️ 发布等于公开传播派生自专有软件的产物，与文末「仅限本机自用」的声明冲突，是否发布由你决定

## 🔧 从源码重建（构建）

仓库**不提交**二进制产物（`output/`、`backup/` 已 gitignore）。需要自己构建时：

```bash
bash build.sh                       # 自动选原版
bash build.sh <app.asar> <ui-dir>   # 或显式指定原版文件
```

```
原版 app.asar ──解包──▶ tools/apply.js（dict.json 词典）──▶ patches/（人工补丁）──▶ 重打包 ──▶ output/app.asar
原版 ui/      ──apply_ui_patch.js（index.html 直改）──▶ output/ui/（主 bundle 再套 apply.js 词典）
```

> 首次运行 `build.sh` 需要联网（`npx` 拉取 `@electron/asar`）；asar 容器头部可能因 `@electron/asar` 版本不同存在细微差异（内容一致），不影响运行。

## 🗂️ 目录结构

本仓库（`freebuff-zh`）是独立的汉化项目，配套的多开控制器在 [freebuff-controller](https://github.com/Ximmmmmmm/freebuff-controller)：

```
├── dict.json          # 翻译词典（exact / template / code / pattern 四类）
├── intentional-english.json # 「有意保留英文」登记表（逐条写理由，三道闸门共用）
├── manifest.json      # 词典适配的 Freebuff 版本（多开控制器读取做兼容检查）
├── patches/           # 人工补丁：词典覆盖不到的主进程改动
├── tools/             # 构建 / 版本迁移 / 找漏翻脚本（清单见 docs/更新维护.md）
├── build.sh           # 可复现构建：原版 + 词典 + 补丁 → output/
├── apply.sh           # 安装汉化到应用（自动备份）
├── restore.sh         # 从备份还原英文原版
├── docs/更新维护.md    # 汉化维护说明（日常恢复 / 版本适配 / 发布 / 工具清单）
└── work/              # 扫描中间产物与英文原版快照（gitignore，不入库）
```

## ⚠️ 注意事项

- **自动更新会覆盖汉化**：应用自带 electron-updater。装有多开控制器时会自动换回中文（无开关、无需点按钮）；不用控制器就重新执行 `apply.sh`。
- **有意保留英文的部分**：编程语言名、主题名、键盘键名、模型名、内部枚举与类型名、库内部错误信息、`Freebucks` 品牌词——改动会破坏逻辑或品牌一致性。当前界面属性位置残留英文 **17 条**，均属上述类别。
- **界面汉化 ≠ AI 回复中文**：本包只翻译界面文案。想让 AI 固定用简体中文回复，需要家目录的 `~\.AGENTS.md` 语言规则（配套多开控制器启动时会自动写入，含**抗注入条款**；不依赖汉化包与 Freebuff 版本，仅对新会话生效）。
- 汉化不涉及任何联网、上传或凭据改动。

## 🗺️ 路线图

- [x] **更新后自动恢复汉化**：已由多开控制器实现（打开控制器时 / 检测到装机版本变化 / 启动实例之前自动重应用，本地跑完 `build.sh` 也会自己发现）
- ~~启动时自检自动恢复汉化（主进程注入）~~：方案已放弃——钩子只能住在 `app.asar` 里，而 Freebuff 更新是整套替换 `app.asar`

## 📜 许可证与声明

- **作者**：Ximmmmmmm（本项目为个人维护项目，仅此一位作者）
- 本仓库的**脚本、词典、补丁与文档**以 **MIT License** 发布（见 `LICENSE`）。
- **免责声明**：Freebuff Desktop（`@codebuff/freebuff-desktop`）是 Freebuff, Inc. 的专有商业软件，其安装包内不含任何开源许可（仅 Electron/Chromium 组件有各自的开源许可）。本项目的汉化产物派生自该软件，**仅面向已合法获取 Freebuff Desktop 的用户供个人自用**：可经本项目的 Release 渠道获取与分发，但请勿用于商业用途、请勿移除本声明或声称原创，并请遵守 Freebuff 的服务条款。如 Freebuff 官方提出异议，请立即停止分发并删除相关文件。购买正版是对开发者的支持。
