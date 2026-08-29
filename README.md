# Freebuff Toolkit 🧰

[Freebuff Desktop](https://www.freebuff.com) 的第三方工具合集：把**简体中文汉化包**和**多开控制器**放进同一个仓库维护。

| 目录 | 项目 | 一句话简介 |
| --- | --- | --- |
| [`hanhua/`](hanhua/) | **简体中文汉化包** | 词典驱动，直接补丁打包产物，让 Freebuff 桌面版全面中文化 |
| [`controller/`](controller/) | **多开控制器** | 单文件 exe，多开 Freebuff 且每个窗口可登录不同账号 |

> 纯第三方工具，与 Freebuff 官方无关。两个子项目各有更详细的独立 README（见上表链接）。

## 为什么要放在一起

两个工具瞄准同一个应用，但工作在互不冲突的层面，而且天然互补：

- **汉化**改的是安装目录里的共享文件（`resources/app.asar` + `orchestrator/ui/`），对所有实例生效；
- **多开**不修改任何应用文件，只给每个实例分配独立的数据目录。

所以两者可以叠加使用：多开的每个窗口都是中文界面。更重要的是，**多开控制器内置了汉化感知**，
正好解决了汉化包最大的痛点——**Freebuff 自动更新会用原版文件覆盖汉化**。

## 集成点（1 + 1 > 2）

多开控制器对汉化包有一等公民支持：

- **状态一览**：读取 `resources/orchestrator/ui/index.html` 的 `zh-CN` 标记，窗口底部显示汉化是否生效；
- **一键应用 / 还原**：直接把 `hanhua/output/` 构建产物应用上去（首次应用自动备份英文原版到
  `hanhua-backup-*`），或随时还原英文——Freebuff 更新后不用碰命令行即可恢复中文界面；
- **版本兼容检查**：对比本机 Freebuff 版本与 [`hanhua/manifest.json`](hanhua/manifest.json) 的
  `targetVersion`，词典落后时提醒先更新词典再构建，避免把过时产物打上去；
- **更新流程提醒**：用控制器下载官方安装包后，提示安装完成点「应用汉化」恢复中文。

## 快速开始

**多开**：双击 `controller/FreebuffController.exe`（或 `cd controller && build.bat` 自行编译）。

**汉化**（二选一）：

```bash
# 命令行方式：先构建，再应用
bash hanhua/build.sh
bash hanhua/apply.sh
```

或打开多开控制器，点窗口下方的「应用汉化」（前提：`hanhua/output/` 已有构建产物）。

## 仓库结构

```
freebuff-toolkit/
├── hanhua/                        # 汉化包（词典 + 构建/安装脚本 + 工具链）
│   └── manifest.json              # 词典适配的 Freebuff 版本（控制器读取做兼容检查）
├── controller/                    # 多开控制器（C# WinForms 单文件源码）
└── .github/workflows/ci.yml       # 词典 lint 门禁（GitHub Actions）
```

## License 与声明

- 两个子项目均以 **MIT License** 发布（[`hanhua/LICENSE`](hanhua/LICENSE) /
  [`controller/LICENSE`](controller/LICENSE)）。
- **免责声明**：汉化产物派生自 Freebuff 的专有软件，仅限本人在已合法获取的设备上自用，
  请勿公开传播；详见 [`hanhua/README.md`](hanhua/README.md) 文末说明。
