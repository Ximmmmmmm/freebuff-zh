# Freebuff Desktop 简体中文汉化包

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![lint](https://github.com/Ximmmmmmm/freebuff-zh/actions/workflows/ci.yml/badge.svg)](https://github.com/Ximmmmmmm/freebuff-zh/actions/workflows/ci.yml)
![GitHub last commit](https://img.shields.io/github/last-commit/Ximmmmmmm/freebuff-zh)
![GitHub Repo stars](https://img.shields.io/github/stars/Ximmmmmmm/freebuff-zh?style=social)
[![Target](https://img.shields.io/badge/目标-Freebuff%20Desktop%20v0.0.169-blue)](https://freebuff.com)

把已安装的 **Freebuff Desktop**（`@codebuff/freebuff-desktop`，当前适配 **v0.0.169**）界面整体换成简体中文：
词典驱动、可复现构建、四道发布闸门把关。

> **English**: A Simplified-Chinese localization pack for Freebuff Desktop. It patches the installed
> app's packaged artifacts (`app.asar` + `orchestrator/ui/`) — no source build, no network hooks, no
> touching your account or credentials. Dictionary-driven, byte-reproducible, gated.

---

## 一、它做什么，不做什么

**做**：

- 改写**已打包产物**里给人看的文案——渲染进程的主 bundle，加上主进程的菜单、原生对话框、
  `shell:openIn` 报错、MCP 同意窗口。
- 全部译文来自仓库里的 `dict.json` 与 `patches/`，逐条可审、幂等可重放。
- 把「上游又改了什么、我漏翻了什么」变成可执行的差集判据，而不是靠眼睛。

**不做**：

- 不改官方源码、不重打包、不放行任何被校验过的安装包；不注入、不代理、不上传任何东西。
- 不碰登录态、凭据、计费与本地数据（唯一写入的两个路径是 `app.asar` 与 `orchestrator/ui/`）。
- **界面汉化 ≠ AI 回复中文**。想让 AI 固定用简体中文回答，需要家目录的 `~\.AGENTS.md` 语言规则
  （配套的多开控制器会在启动时写好，与汉化包无关、也不受 Freebuff 版本影响）。

## 二、安装 / 还原

```bash
bash build.sh     # 从「本机英文原版 + 词典 + 补丁」构建产物到 output/
bash apply.sh     # 装机（自动把原文件备份到 resources/hanhua-backup-<时间戳>/）
bash restore.sh   # 从最近一次备份还原英文
```

`build.sh` 不带参数时自动挑原版：优先安装目录里最新的 `hanhua-backup-*`，没有（首次构建）就用
安装目录当前那份英文原版。首次运行需要联网：构建用 `npx -y @electron/asar` 解包 / 重打包
（之后有 npx 缓存，就不再需要）——汉化本身不联网，也不改应用的任何网络行为。

> **装机前请完全退出 Freebuff（含多开实例）。** 换文件时应用在跑会留下「界面是新的、主进程还是旧的」
> 混合态：旧主进程不含 launch id 复用补丁，orchestrator 崩一次重启就会让此后每个写操作
> `403 forbidden`（表现为「无法打开标签页」「消息未发送」）。`apply.sh` 检测到进程在跑会直接拒绝，
> 只想看一眼效果可以 `--force` 热换，但**之后必须彻底退出再启动**，重载窗口不够。

不想碰命令行的话，用配套的[多开控制器](https://github.com/Ximmmmmmm/freebuff-controller)：
Freebuff 自动更新冲掉汉化后它会自动换回中文（装机版本变化 / 打开控制器 / 拉起实例前 / 本地
`build.sh` 跑完 / 拉到适配本机版本的新包，五个时机，无开关无按钮）。

## 三、构建管线

```
原版 app.asar ──解包──▶ tools/apply.js（dict.json 四分区）──▶ patches/（13 个人工补丁）
             ──▶ 语法校验 ──▶ 重打包 ──▶ output/app.asar
原版 ui/      ──整份镜像──▶ index.html 改写（lang=zh-CN + 版本戳）──▶ 主 bundle 套词典
             ──▶ output/ui/
```

- 主进程文案**只能靠 `patches/`**：词典只替换双引号字面量，而菜单 / 对话框 / 报错多是单引号与模板，
  够不着。13 个补丁的锚点每次迁移都过一遍预检（行号漂移一条命令重锚定，上游改写才人工重维护）。
- `ui/` 是**整份镜像**原版后再覆盖要汉化的两个文件——只拷 `index.html` + `assets/` 会把 `fonts/`
  与 `logos/` 丢掉，界面会缺字体重空图标。
- 产物先落在临时目录，**自检通过才整份换位进 `output/`**：任何一步失败，`output/` 一个字节不变，
  控制器也就装不到坏产物。
- 构建末尾的 `tools/postbuild.js` 会验：布局 / `index.html` 的汉化标记 / 主进程语法与译文哨兵。
  不过即中止。
- **构建复用**：`build.sh` 先算「输入指纹」（`build.sh` / `dict.json` / 登记表 / `manifest.json` / `patches/` /
  `tools/` 的逐字节哈希 + 原版 `app.asar` 与 `ui/`），再与上次成功构建记下的 `output/` 产物哈希核对——
  两边都对得上就直接复用（实测 **0.63s** vs 重建 **18s**），任一处变了自动重建，`--rebuild` 可强制重建。
  于是「手改了 `output/`」「改了 `apply.js` 却忘了重建」这两类都不会被当成可复用。

## 四、仓库里有什么

| 路径 | 是什么 |
| --- | --- |
| `dict.json` | 词典本体，**唯一真正的产出物**：2086 条（`exact` 1662 / `template` 289 / `code` 37 / `pattern` 98） |
| `intentional-english.json` | 「有意保留英文」登记表，逐条写理由：`fragments` 758 条 + `uiStrings` 48 条 |
| `manifest.json` | `targetVersion`（适配的 Freebuff 版本）与 `packVersion`（本包版本） |
| `patches/electron-*.patch` | 13 个主进程人工补丁（词典够不着的那一层） |
| `tools/` | 66 个脚本（63 `.js` + 3 `.sh`，其中 28 个 `test_*`），构建 / 迁移 / 找漏翻 / 自测 |
| `build.sh` `apply.sh` `restore.sh` | 构建（输入没变自动复用）、装机、还原 |
| `docs/更新维护.md` | 出事怎么查：每种「静默失败」的取证方法 |
| `.github/workflows/ci.yml` | CI：词典门禁 + **28 个自测一个不落**（另有接线守卫盯「新加自测忘了接」）+ 一个 job 专跑发布闸门；两个 job 都在 ubuntu 与 windows 上各跑一遍 |
| `CHANGELOG.md` | 逐版本：上游改了什么、汉化跟着做了什么、对装机什么影响 |

不入库（`.gitignore`）：`output/`、`work/`、`dist/`、`downloads/`、`node_modules/`、`.translator.json`。
其中 `work/` 放扫描中间产物与各版本英文原版快照，`dist/` 放已发布的包，两者都是基线，**不要手删**。

## 五、词典的四个分区

| 分区 | 匹配方式 | 什么时候用 |
| --- | --- | --- |
| `exact` | 双引号字符串字面量，全局替换（带语义守卫） | 绝大多数界面文案、按钮、报错 |
| `pattern` | **只**改界面属性位置（`children:` / `label:` / `title:` …） | 同一个词在代码里也当值用（如 `Image`），只能翻界面那一处 |
| `template` | 反引号模板字面量，固定段逐字节匹配 | 带 `${…}` 的句子，插值随压缩变量名同步 |
| `code` | 代码里嵌着的片段，逐字节替换（不受界面语义守卫约束） | 半截骨架、复数吸收、状态表这类结构；**改它等于改行为**，新词条按 G1 必须 `value` 与 `key` 逐字节相同 |

改词典**只有一条路**：

```bash
node tools/dictapply.js work/changelist-<版本>.json            # 试跑，逐条打印将做的改动
node tools/dictapply.js work/changelist-<版本>.json --check    # 体检（G1 code 必须逐字相同 / G2 要有中文 / G3 不能等于原文 / G5 键末尾的未闭合插值）
node tools/dictapply.js work/changelist-<版本>.json --write    # 落盘，写完自动跑 lint，不过即整体还原
```

清单四类操作 `del` / `rename`（原位换键、保序）/ `set` / `add`；键定位支持精确命中或唯一片段，
命中多条报 `AMBIGUOUS` 并给候选——**遇到就把片段加长到唯一**。任何一条有歧义或缺译文，`--write`
整体拒绝，不会写一半。`tools/fastloop.js` 提供改词条时的秒级反馈循环（lint + 只验你改的那几条）。

硬规则（每条都对应过一次真实事故）：**禁止新建一次性脚本**改词典；`code` 分区的 `value` 必须与
`key` 逐字节相同；**不许自动删死词条**（疑似下线的要人判断）；要保留英文就登记，不要拿
`--allow-english` / `--prune-gone` 让闸门变绿；`dict.json` 必须保持
`JSON.stringify(obj, null, 2) + "\n"` 的规整格式。

## 六、跟着上游走

```bash
# 1) 先把本版英文原版拿到手（别让控制器先换回汉化，否则再也拿不到这一版的英文）
BK=$(ls -1dt "$LOCALAPPDATA/Programs/@codebufffreebuff-desktop/resources"/hanhua-backup-*/ | head -1)

# 2) 升 manifest.json 的 targetVersion / packVersion
bash tools/update.sh           # 七步体检 + 构建，约 40 秒，报告全文归档 work/
node tools/fastloop.js --pristine "$BK/ui"   # 改词条时另开一个窗口挂着

# 3) 按报告小结补词条（走上面的 dictapply 清单）
bash build.sh && bash apply.sh # 4) 重建 + 装机
bash tools/release.sh          # 5) 发布（跑四道发布闸门；只在你确实要给别人用时才跑）
```

`update.sh` 的七步：① 模板变量重映射 → ①ᵇ 旧词条重新定位（remap 够不着的，能在新版原版里
唯一找回的自动写回，其余列 `CONFIRM`/`GONE` 交人工）→ ② 主进程补丁锚点预检 → ③ 构建 → ④ UI 残留
扫描 → ⑤ 主进程英文扫描 → ⑥ 上游新增文案对差 + 回归闸门 + ⑥ᵇ 单词级差集与字面量占用 → ⑦ 汇总，
并把「上游未覆盖的新增文案」直接写成变更清单骨架（`value` 全空，翻译由人/AI 填）。

报告里带 ⚠ 时怎么读：`MISSED` 是词典锚文本在新版失效；「上游新增文案」是上游本版新写的英文
（与有无汉化包无关）；「短标签」是词数太少、三条对差通道都看不见的；`GONE` 只是「疑似下线」，
删不删由人定。`tools/auto_translate.js` 可按内置术语表 + 历史词典智能预填清单骨架（可选接
LLM API，需自配 `.translator.json`；不配就是纯规则）。

## 七、为什么值得信：闸门

**静态**：`lint_dict` E0 结构形态 / E1 分区与类型 / E2 重复键 / E3 占位符 / E4 pattern 纯字面量 /
E5 半截模板 / E6 模板残骸（译文剔掉 `${…}` 后仍残留 `?\"` `\":` `??` `===` `!==` `=>` `||` `.length` 即硬错误）。
**语义**：`semantic_guard` 拦住代码语义位置（Lezer 节点名、枚举自映射、CSS 关键字、协议标识符），
只翻给人看的地方。
**找漏翻**：`missed_diagnose`（词条够不着本版 bundle 时归到「命中 / 只在主进程 / 只在上一版 /
哪都没有」四类）、`uipos`（界面属性位置）、`fieldscan`（`description`/`tagline` 字段）、
`blindscan`（三元分支、插值内部、默认值这些盲区）、`prose`、`leftover`、`mainscan`（主进程对差）、
`upstreamdiff`（两版英文原版对差）、`regress`（本版产物 vs 上一版已发布包）、
`uipos_gap`（单词级界面文案差集）、`lint_collisions`（词条会不会在 `electron/*.cjs` 里当
路径 / 比较值 / IPC 通道名用——翻掉会静默改行为）。

**四道发布闸门**（`tools/release.sh`，发布前必须全过）：主进程漏翻 → 回归 → 单词级界面文案 →
字面量占用。CI 里同名同判据跑一遍，其中「版本刚 bump、本版原版还没发布」时会退到**近似模式**：
拿上一版快照当替身、只列差异清单不作判定（闸四与镜像重建仍硬拦），并且**不许近似模式放绿**——
新英文由发布前的真实产物闸门兜住。

CI 的两个 job 都在 `ubuntu-latest` 与 `windows-latest` 上各跑一遍（`fail-fast: false`）：本仓库对
行尾敏感、工具又直接读写路径与临时目录，只在 Linux 上验证等于把这些差异留到「本地跑一次」才暴露。
Windows 上默认 shell 是 pwsh，含 bash 语法的步骤都显式写了 `shell: bash`；另有一道只在 Windows 上跑
的行尾守卫，checkout 若把脚本 / 补丁 / 词典换成 CRLF 会直接报错。

CI 跑的自测是在 workflow 里逐个点名的，所以「新加了自测忘了加步骤」是**静默**失败：本地绿、CI 也绿，
而那个自测从没在 CI 上跑过。`tools/ci_wiring.js` 就是为这一类存在的——它拿 `tools/test_*.js` 与
workflow 里真的跑到的集合比对，漏接线（文件在、没人跑）与悬空引用（步骤在、文件没了）直接拦下，
重复接线 / 步骤带 `if:` / 触发 `paths` 漏了 `tools/**` 只警告；判据只扫 `run:` 块，注释里提到的
文件名不算接线。

## 八、当前状态（适配 v0.0.169）

| 指标 | 实测 |
| --- | --- |
| 词典 / 替换 | 3116 条、3907 处替换全命中 |
| 纯字面量词条覆盖 | 2250/2250（100.0%） |
| 界面属性位置残留英文 | 77 处，扣除登记表后本版**无新增未登记项** |
| 主进程 | 53 个文件的英文扫描 0 条疑似漏翻、0 条短标签，108 条属约定保留（品牌 / 协议 / 路径 / 命令 / 日志） |
| 补丁 | 16 个主进程补丁（全部锚点唯一命中、干净套用；UI 行为补丁已退场，见下） |
| 发布闸门 | 四道全绿 |

**有意保留英文的类别**：品牌与产品名、模型名与套餐名、编程语言与主题名、键盘键名、内部枚举与
类型名、CSS 类名与 DOM 选择器、命令行、第三方库内部诊断与多语言错误表、广告位里模拟的代码
截图与地址栏内容、存储单位（`MiB`）。这些改掉会破坏逻辑、样式或品牌一致性。

**已知局限**：模型选择器的高峰/非高峰价格 tooltip（`Off-peak: 10 Freebucks/hr …, <reason>.
15 otherwise.`）是一句含**嵌套模板字面量**的代码合成句，只翻了上游新增的降价理由，句子骨架仍是
英文——理由与取证写在 `CHANGELOG.md` 对应版本那节。

## 九、常见问题

**更新 Freebuff 之后界面变回英文了？** Freebuff 自带 electron-updater，更新会整份替换
`app.asar`。装着多开控制器的话它会在你关掉实例后自动换回中文；没装就重跑 `bash apply.sh`。

**`apply.sh` 说检测到 Freebuff 正在运行？** 请完全退出（含多开实例）再跑。热换的后果见第二节。

**界面是中文，但打开标签页 / 发消息提示 forbidden？** 那是热换留下的混合态，主进程还跑着旧代码。
彻底退出 Freebuff 再启动即可。

**我改了 `dict.json` 怎么没生效？** 迁移改的是**产物**：必须 `bash build.sh` 再 `bash apply.sh`。
只跑 apply 装的是上一次的构建。

**某个文案我想保留英文？** 登进 `intentional-english.json`（`fragments` 或 `uiStrings`）并写清理由，
别用命令行开关绕过闸门——换机器 / CI 发布时开关忘了敲就白放了。

## 十、许可证与声明

- **作者**：Ximmmmmmm（个人维护项目）。
- 本仓库的**脚本、词典、补丁与文档**以 **MIT License** 发布，见 [LICENSE](LICENSE)。
- **免责声明**：Freebuff Desktop（`@codebuff/freebuff-desktop`）是 Freebuff, Inc. 的专有商业软件，
  其安装包内不含任何开源许可（仅 Electron / Chromium 组件各有其开源许可）。本仓库的**汉化产物**
  派生自该软件，**仅面向已合法获取 Freebuff Desktop 的用户供个人自用**：可经本项目的 Release
  渠道获取，但请勿商用、请勿移除本声明或声称原创，并请遵守 Freebuff 的服务条款。如官方提出异议，
  请立即停止分发并删除相关文件。购买正版是对开发者的支持。
