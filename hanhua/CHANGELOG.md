# 更新日志

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
