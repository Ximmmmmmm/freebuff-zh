# Freebuff Desktop 汉化包（中文汉化）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![GitHub last commit](https://img.shields.io/github/last-commit/Ximmmmmmm/Freebuff-Hanhua)

Freebuff Desktop（`@codebuff/freebuff-desktop` v0.0.68）的中文汉化项目，**直接修改已打包产物**，无需源码、不涉及任何联网改动。

> **English**: A Simplified-Chinese localization pack for Freebuff Desktop. It patches the packaged app directly — no source build required.

## ✨ 特性

- **覆盖全面**：渲染进程约 720 处文案 + 主进程菜单 / 对话框 / 同意窗口全面中文化
- **词典驱动**：`dict.json`（exact 607 / template 82 / code 4 / pattern 3），幂等应用、可审计
- **可复现构建**：`build.sh` 从原版 + 词典 + 补丁**逐字节重建**汉化产物（已对 v0.0.68 验证）
- **一键安装/还原**：`apply.sh` / `restore.sh`，自动备份，随时回退英文原版
- **工具链完整**：`tools/` 提供提取、翻译、核查、残留扫描等脚本，便于随版本更新补翻

## 📦 快速开始（安装）

> ⚠️ 汉化产物（修改后的 `app.asar` / `ui/`）派生自 Freebuff 的专有软件，**请仅在本机自用，勿公开传播**。详见文末免责声明。

先在本机构建产物，再安装：

```bash
bash build.sh            # 用安装目录里最近的 hanhua-backup-* 作为原版，生成 output/
bash apply.sh            # 应用汉化（自动备份原文件）
```

脚本会先把现有 `app.asar` 和 `ui/` 备份到 `resources/hanbuff-backup-<时间戳>/`，再替换，**重启应用生效**。

如果你已经拿到一份产物目录（自行构建的），也可以：

```bash
bash apply.sh /path/to/unpacked   # 传入产物所在目录
```

手动安装：
1. 把 `app.asar` 复制到 `%LOCALAPPDATA%\Programs\@codebufffreebuff-desktop\resources\`
2. 把 `ui/` 整体替换 `resources\orchestrator\ui\`

### 还原英文原版

```bash
bash restore.sh          # 从最近一次备份还原
```

## 🔧 从源码重建（构建）

仓库**不提交**二进制产物（`output/`、`backup/` 已 gitignore）。需要自己构建时：

```bash
bash build.sh                       # 自动使用安装目录里最近的 hanhua-backup-* 作为原版
bash build.sh <app.asar> <ui-dir>   # 或显式指定原版文件
```

构建管线（已对 v0.0.68 验证，`ui` 与主进程内容与 Release 产物逐字节一致）：

```
原版 app.asar ──解包──▶ tools/apply.js（dict.json 词典）──▶ patches/（人工补丁）──▶ 重打包 ──▶ output/app.asar
原版 ui/      ──apply.js──▶ patches/ui-index.html.patch ──────────────────────────▶ output/ui/
```

> 注意：asar 容器头部可能因 `@electron/asar` 版本不同存在细微差异（内容一致），不影响运行。首次运行 `build.sh` 需要联网（`npx` 拉取 `@electron/asar`）。

## 🗂️ 仓库结构

```
├── dict.json          # 翻译词典（exact / template / code / pattern 四类）
├── patches/           # 人工补丁：词典覆盖不到的手工修改（index.html、主进程 5 个文件）
├── tools/             # 提取/翻译/核查脚本（见 docs/汉化流程.md）
├── build.sh           # 可复现构建：原版 + 词典 + 补丁 → output/
├── apply.sh           # 安装汉化到应用（自动备份）
├── restore.sh         # 从备份还原英文原版
├── docs/              # 汉化流程 / 更新维护说明
└── work/              # 扫描中间产物（gitignore，不入库）
```

## ⚠️ 注意事项

- **自动更新会覆盖汉化**：应用自带 electron-updater，更新后汉化文件会被替换。更新后重新执行
  `apply.sh`（或用 `build.sh` 对新版本重新构建）。详见 `docs/更新维护.md`。
- **有意保留英文的部分**：编程语言名（Python、TypeScript…）、主题名（Ayu Dark…）、键盘键名
  （Enter、Delete…）、内部枚举/类型名、库内部错误信息——改动会破坏逻辑，故不翻译。
- 汉化不涉及任何联网、上传或凭据改动。

## 🗺️ 路线图

- [ ] **启动时自检自动恢复汉化**：主进程注入逻辑，检测 `ui/index.html` 缺失汉化标记时自动从内置副本恢复，更新后首次启动即回到中文（受自动更新整体替换 `app.asar` 的限制，需结合外部触发机制）

## 📜 许可证与声明

- 本仓库的**脚本、词典、补丁与文档**以 **MIT License** 发布（见 `LICENSE`），属于你的原创内容。
- **免责声明**：Freebuff Desktop（`@codebuff/freebuff-desktop`）是 Freebuff, Inc. 的专有商业软件，
  其安装包内不含任何开源许可（仅 Electron/Chromium 组件有各自的开源许可）。
  本项目的汉化产物（修改后的 `app.asar` / `ui/`）派生自该软件，**仅限你本人在已合法获取的
  设备上自用**；请勿公开传播、再分发或用于商业用途，并请遵守 Freebuff 的服务条款。
  如 Freebuff 官方提出异议，请立即停止使用并删除相关文件。购买正版是对开发者的支持。
