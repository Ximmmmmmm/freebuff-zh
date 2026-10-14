# Freebuff 桌面版 汉化包 · Windows 一键安装

> 适用：Windows 10 / 11，已安装 **Freebuff 桌面版**（Electron 应用）。
> 全程**不需要管理员权限**、不需要 Git Bash、不需要 Node.js——只用系统自带的 Windows PowerShell。
> 脚本只写两个位置，装之前自动备份原版，随时可一键还原。

这里是仓库自带的 Windows 安装器：给不想碰 `bash build.sh` / `bash apply.sh` 的人用。
它做的是**装一个已发布包**（`hanhua-pack-<版本>.zip`），不是从源码构建——构建仍然走仓库根的
`build.sh`（见[根 README](../README.md)）。

---

## 0. 先搞清楚三件事

| 问题 | 答案 |
| --- | --- |
| 汉化包从哪来？ | [Releases](https://github.com/Ximmmmmmm/freebuff-zh/releases) 页下载 `hanhua-pack-<版本>.zip`（约 20 MB），或让脚本自己下：`-Download`。 |
| 会动什么？ | 只写 `<安装目录>\resources\app.asar` 与 `<安装目录>\resources\orchestrator\ui\`；原版先备份到 `<安装目录>\resources\hanhua-backup-<时间戳>\`。 |
| 汉化的是什么？ | **界面文案**（菜单、按钮、提示、设置项）。AI 回复用什么语言由 `~\.AGENTS.md` 之类的指令决定，跟汉化包无关。 |

⚠️ **最关键的一条**：装之前必须**彻底退出 Freebuff**（含多开实例、托盘图标）。
应用在跑的时候热替换，会留下「界面已经是中文、主进程还是英文」的混合态，之后**每个写操作都返回 403 `forbidden`**（表现为打不开标签页、消息发不出去），只能彻底重启应用才恢复。

⚠️ **包和版本要对上**：包里是**整个已汉化的 `app.asar`（含应用全部代码）**，装到别的版本上等于把应用代码一起换回旧版。
脚本会比对「已装 Freebuff 版本」与「包里的 `targetVersion`」，不一致直接中止（要冒险才加 `-Force`）。

---

## 1. 一键安装（推荐）

1. 把 `install-freebuff-zh.ps1`、`一键安装汉化.cmd` 和 `hanhua-pack-<版本>.zip` 放进**同一个目录**
   （`还原英文原版.cmd`、`查看汉化状态.cmd` 可选，一起放更顺手）；
2. **彻底退出 Freebuff**（右键托盘图标退出，任务管理器里确认没有 `Freebuff.exe`）；
3. 双击 **`一键安装汉化.cmd`**；
4. 窗口里会逐条打印：安装目录 → 已装版本 → 汉化包版本 → 备份路径 → 安装结果 → 校验结果；
5. 看到绿色的 `校验通过：汉化已生效` 就完成了，启动 Freebuff 即是中文界面。

脚本会自动在**脚本所在目录**、`脚本目录\dist\`、`上级目录\dist\`、**当前目录**、**桌面**、**用户下载目录**里找最新的 `hanhua-pack-*.zip`；找不到时会把找过的目录逐个列出来，让你用 `-Pack <路径>` 指定。

### 三个双击入口

| 双击 | 等价命令 | 用途 |
| --- | --- | --- |
| `一键安装汉化.cmd` | `install-freebuff-zh.ps1` | 装汉化（自动找包、自动备份、装完自校验） |
| `还原英文原版.cmd` | `install-freebuff-zh.ps1 -Restore` | 用最近一次备份还原英文原版 |
| `查看汉化状态.cmd` | `install-freebuff-zh.ps1 -List` | 只看状态与备份清单，不写任何文件 |

> `.cmd` 内容全是 ASCII，中文提示由 PowerShell 打印（批处理文件用 UTF-8 存中文会被 cmd 按 ANSI 解析而报错）。
> 想在真装之前先看一遍流程：`一键安装汉化.cmd -DryRun` —— 退出码 `0` 表示「可以装」，`1` 表示「真装时会被中止」（版本不匹配、应用还在跑等）。

---

## 2. 用 PowerShell 跑（可带参数）

在脚本目录打开 PowerShell：

```powershell
# 最简：自动找包、自动找安装目录
.\install-freebuff-zh.ps1

# 指定汉化包（路径按你自己的实际情况写）
.\install-freebuff-zh.ps1 -Pack "$env:USERPROFILE\Downloads\hanhua-pack-0.0.173.1.zip"

# 只看状态（不动任何文件）
.\install-freebuff-zh.ps1 -List

# 先体检：把每一步会做什么打印出来，不写盘
.\install-freebuff-zh.ps1 -DryRun

# 本地没有包，直接从 GitHub Releases 下载最新包（约 20 MB）
.\install-freebuff-zh.ps1 -Download

# 应用还开着、确认要强制结束它（不推荐）
.\install-freebuff-zh.ps1 -Force

# 一键还原英文原版（用最近一次备份）
.\install-freebuff-zh.ps1 -Restore

# 还原到指定的某一次备份
.\install-freebuff-zh.ps1 -Restore -Backup hanhua-backup-20261014-154932

# 指定安装目录（装到非默认位置时才需要，把 X:\你的目录 换成实际路径）
.\install-freebuff-zh.ps1 -InstallDir "X:\你的目录\@codebufffreebuff-desktop"
```

> 如果提示「禁止运行脚本」（执行策略），用 `.cmd` 双击方式（它内部已经带了 `-ExecutionPolicy Bypass`），或先执行：
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

### 参数速查

| 参数 | 作用 |
| --- | --- |
| `-Pack <路径>` | 汉化包 zip，或含 `app.asar` + `ui\` 的目录 |
| `-InstallDir <路径>` | Freebuff 安装目录（默认 `%LOCALAPPDATA%\Programs\@codebufffreebuff-desktop`） |
| `-List` | 只看状态：安装目录、版本、是否已汉化、备份清单 |
| `-DryRun` | 只体检不写盘 |
| `-Download` | 本地没包时从 GitHub Releases 下载最新包 |
| `-Force` | ① 应用在跑时强制结束它；② 版本不匹配时继续装 |
| `-Restore` / `-Backup` | 还原最近一次 / 指定的备份 |
| `-KeepTemp` | 保留解包临时目录，便于排查 |

---

## 3. 纯手工安装（不用脚本，7 步）

> 适合想自己看清每一步、或脚本被安全软件拦住的场合。下面 `%LOCALAPPDATA%` 一般展开成 `C:\Users\<你>\AppData\Local`。

**第 1 步 · 彻底退出 Freebuff**
任务管理器 → 详细信息 → 结束所有 `Freebuff.exe`。命令行也可以：

```powershell
Get-Process Freebuff -ErrorAction SilentlyContinue | Stop-Process -Force
```

**第 2 步 · 确认安装目录**（应能看到 `Freebuff.exe` 和 `resources`）：

```
%LOCALAPPDATA%\Programs\@codebufffreebuff-desktop
```

**第 3 步 · 记下已装版本**（右键 `Freebuff.exe` → 属性 → 详细信息 → 文件版本，或）：

```powershell
(Get-Item "$env:LOCALAPPDATA\Programs\@codebufffreebuff-desktop\Freebuff.exe").VersionInfo.FileVersion
```

**第 4 步 · 备份原版**（时间戳自己填）：

```powershell
$D = "$env:LOCALAPPDATA\Programs\@codebufffreebuff-desktop"
$B = "$D\resources\hanhua-backup-20261014-160000"
New-Item -ItemType Directory -Path $B -Force | Out-Null
Copy-Item "$D\resources\app.asar" "$B\app.asar" -Force
Copy-Item "$D\resources\orchestrator\ui" "$B\ui" -Recurse -Force
```

**第 5 步 · 解包汉化包**（zip 里就是 `app.asar` 和 `ui\`）：

```powershell
# 把 <你放包的目录> 换成实际路径（例如 "$env:USERPROFILE\Downloads"）
Expand-Archive "<你放包的目录>\hanhua-pack-0.0.173.1.zip" -DestinationPath "$env:TEMP\hanhua" -Force
```

**第 6 步 · 覆盖安装**

```powershell
Copy-Item "$env:TEMP\hanhua\app.asar" "$D\resources\app.asar" -Force
Copy-Item "$env:TEMP\hanhua\ui\*" "$D\resources\orchestrator\ui" -Recurse -Force
```

**第 7 步 · 校验 + 启动**
`$D\resources\orchestrator\ui\index.html` 开头应该是：

```html
<html lang="zh-CN">
...
<meta name="hanhua-pack" content="0.0.173.1">
```

然后启动 Freebuff，界面应为中文。

**手工还原**：把第 4 步备份里的 `app.asar` 和 `ui\` 原样复制回去即可（同样要先退出应用）。

---

## 4. 怎么确认汉化生效了

| 检查点 | 期望 |
| --- | --- |
| `ui\index.html` | `<html lang="zh-CN">`，且有 `<meta name="hanhua-pack" content="…">` |
| 主 bundle `ui\assets\index-*.js` | 含大量中文字符（脚本会报数，正常 2 万以上） |
| 界面 | 菜单 / 按钮 / 设置项为中文 |
| AI 回复 | **可能仍是英文**——这属于另一层（`~\.AGENTS.md` 里的语言规则），不是汉化没成功 |

---

## 5. 还原 / 卸载

```powershell
# 一键还原（脚本会挑最近的备份）
.\install-freebuff-zh.ps1 -Restore

# 或者手工：先退出应用，再把备份复制回去
Copy-Item "$D\resources\hanhua-backup-<时间戳>\app.asar" "$D\resources\app.asar" -Force
Copy-Item "$D\resources\hanhua-backup-<时间戳>\ui\*" "$D\resources\orchestrator\ui" -Recurse -Force
```

**彻底卸载**：还原原版后，删掉 `resources\hanhua-backup-*` 目录即可（脚本从不自动删备份，删之前确认应用已恢复正常）。

---

## 6. 常见问题

**Q1. 装完打不开标签页 / 消息发不出去，报 403 `forbidden`？**
热替换留下的混合态。**彻底退出 Freebuff 再启动**即可（不是汉化包的问题，是「渲染进程已换、主进程没换」）。下次装之前先确认应用完全退出。

**Q2. 双击脚本后窗口一闪而过 / 从脚本、IDE、Agent 里启动 Freebuff 秒退、没窗口？**
先看环境变量 `ELECTRON_RUN_AS_NODE`：它只要是 `1`，Electron 就退化成**纯 Node 跑主进程**——不建窗口、退出码 0、`userData` 一个字节不写，带 `--enable-logging=stderr` 还会报 Node 自己的 `bad option: --enable-logging=stderr`。

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE    # 启动前清掉
```

排查时先用**原版**跑一次对照：两边同样秒退就与本包无关。

**Q3. 脚本报「版本不一致」并中止？**
汉化包里是**整个已汉化的 `app.asar`（含应用全部代码）**，装到别的版本上等于把应用代码回退。必须用 `targetVersion` 与已装 Freebuff 版本一致的包（在包的 `ui\index.html` 的 `hanhua-pack` 版本戳 / 仓库 `manifest.json` 里看）。确认要冒险装才加 `-Force`。

**Q4. Freebuff 自动更新后界面变回英文？**
正常——更新会把 `app.asar` 换回官方原版。重新跑一次本脚本即可。装了 [freebuff-controller](https://github.com/Ximmmmmmm/freebuff-controller) 的话它会在更新后自动重打汉化。

**Q5. 汉化后 AI 回复还是英文？**
汉化包只管界面文案。AI 回复语言要在 `~\.AGENTS.md` 里写语言规则（例如「始终用简体中文回答」）。

**Q6. 需要管理员权限吗？会动用户数据吗？**
都不需要、都不会。脚本只写安装目录下的那两个位置 + 自己的备份目录，不碰注册表、不碰 `%APPDATA%` 里的对话数据。

**Q7. 想看当前状态 / 有哪些备份？**

```powershell
.\install-freebuff-zh.ps1 -List
```

---

## 7. 自测（`test_installer.ps1`）

不想在真机上试错的话，先跑自测：它自己造一套**假安装目录 + 假汉化包**（假 `Freebuff.exe`、1 MB 假原版
`app.asar`、英文 `ui\`；再把 ui 改成 `lang="zh-CN"` + 版本戳 + 中文 bundle 打成 zip），断言 10 组用例
（状态查看 / 体检 / 版本不匹配中止 / 安装落地 / 装后状态 / 还原体检 / 还原 / 指定不存在的包 /
读不到版本时中止 / 应用在跑时拒绝），全程只写自己的临时目录，**不碰真实安装目录、不碰注册表、不联网**。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\test_installer.ps1
# 通过 31 · 失败 0 · 跳过 0  → 退出码 0；任用例失败 → 退出码 1
```

CI 里也在 `windows-latest` 上跑这一份（见 `.github/workflows/ci.yml`）。
脚本本身在 Windows PowerShell **5.1** 与 **pwsh 7** 下都验证过；`.ps1` 存为 **UTF-8 with BOM**
（PS 5.1 读中文必需），行尾 LF（与仓库其余脚本一致）。

---

## 8. 从源码构建汉化包（进阶）

汉化包本体的构建链是 **bash + node**（Windows 上用 Git Bash）：

```bash
bash build.sh <原版 app.asar> <原版 ui 目录>   # 产出 output/app.asar + output/ui
bash apply.sh                                  # 装进本机 Freebuff（同样要求应用已退出）
bash restore.sh                                # 还原
```

首次构建需要联网一次（`npx -y @electron/asar`），之后离线可构建。打包成发布用的 zip 走
`bash tools/release.sh`（四道闸门 + 打 `dist/hanhua-pack-<版本>.zip`）。详细维护流程见仓库
[README](../README.md) 与 [AGENTS.md](../AGENTS.md)。
