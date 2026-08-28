# Freebuff 多开控制器 / Freebuff Multi-Instance Controller

一个 Windows 桌面小工具：让 [Freebuff](https://www.freebuff.com) 桌面版支持**多开**，并且**每个窗口可以登录不同的账号**。

A small Windows utility that lets the Freebuff desktop app run multiple instances simultaneously — each with its own independent account.

> 纯第三方工具，不修改 Freebuff 本体，与 Freebuff 官方无关。
> A third-party tool. It does not modify the Freebuff app itself.

## 功能 / Features

- **多开**：主实例 + 实例 1~9，互不干扰
- **多账号**：每个实例独立 Chromium 配置和登录态，可分别登录不同账号
- **状态一览**：实时显示每个实例的运行状态和当前登录的账号邮箱
- **额度显示**：每个账号每日高级会话剩余额度（调用官方会话接口，启动时与手动刷新时更新，另有 5 分钟自动刷新）
- **版本检测**：显示本机 Freebuff 版本，自动对比官方更新源；发现新版本可一键下载官方安装包（SHA512 校验通过后自动运行），下载失败时退回浏览器下载页
- **一键操作**：启动 / 停止 / 重置账号 / 停止全部；双击表格行直接启动
- **两种初始化方式**：启动未初始化的实例时弹窗选择——全新登录（每个窗口用不同账号），或复制其他已登录实例的账号（下拉框只列出真正登录过的实例，并显示其邮箱），免重复登录
- **重置换号**：清空某个实例即可换登录另一个账号
- 暗色主题 UI，单文件 exe（约 22 KB，无运行时依赖）；最小化进任务栏，关闭即完全退出

## 使用 / Usage

1. 双击 `Freebuff多开控制器.exe`（或按下面步骤自行编译）
2. 双击（或选中后点「启动」）一个未初始化的实例，在弹窗里选「全新登录」
3. 在弹出的 Freebuff 窗口里登录该窗口要用的账号 —— 登录态会固定在这个实例
4. 想换某个实例的账号：选中 → 「重置账号」→ 再启动登录新账号

## 原理 / How it works

Freebuff 是 Electron 应用，用 `requestSingleInstanceLock()` 限制单开。本工具**不修改任何应用文件**，而是给每个实例分配独立的数据目录：

- `--user-data-dir=<APPDATA>\Freebuff-slot-N` — 独立 Chromium 配置文件与单实例锁
- `FREEBUFF_DESKTOP_STATE_PATH=<user>\.config\freebuff-desktop\slots\slot-N\state.json` — 独立后端 orchestrator 状态（避开其 SQLite 文件锁）

因此 Freebuff 应用升级不会使本工具失效。

The app is an Electron app that enforces a single-instance lock. This tool gives each instance its own `--user-data-dir` and its own orchestrator state file via an environment variable, so instances don't share locks — no app files are touched, and app updates don't break it.

## 编译 / Build

不需要安装任何 SDK，Windows 自带的 .NET Framework C# 编译器即可：

```
build.bat
```

或手动：

```
%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe -nologo -target:winexe ^
  -optimize+ -codepage:65001 ^
  -r:System.dll -r:System.Core.dll -r:System.Drawing.dll -r:System.Windows.Forms.dll -r:System.Management.dll ^
  -win32icon:app.ico -out:FreebuffController.exe FreebuffController.cs
```

> 源码需兼容 C# 5（系统自带编译器的语言版本）。

## 项目结构 / Structure

```
├── FreebuffController.cs   # 全部源码（UI + 逻辑）
├── build.bat               # 一键编译脚本
├── make-icon.ps1           # 图标生成脚本（多尺寸 PNG-in-ICO）
└── app.ico                 # 应用图标
```

## License

MIT
