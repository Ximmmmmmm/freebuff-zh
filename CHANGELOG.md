# 更新日志

## [0.0.87] · 2026-09-04

- **适配 Freebuff v0.0.87**：targetVersion / packVersion 升至 0.0.87。渲染 bundle
  `index-kOlI7uqe.js` → `index-_MSBgH2Z.js`；NSIS 安装器再次清掉 `hanhua-backup-*`，
  走「无备份回退安装目录英文原版」构建路径
- **模板变量自动重映射**：`tools/remap.js` 迁移 41 条（`fc → gc`、`pn → wn`、
  `W1 → ow`、`$8 → nq`、`ey → ly`、`XD → oM`、`So → xo`、`Di → Gn`、`pv → wv` 等），
  0 条 MISSING；1 条 AMBIGUOUS（`Context ${$s(g)}`）手工确认
- **主进程「赞助任务（sponsored proposal）」新流程全面中文化**（v0.0.87 新增）：
  - `mcp-consent-bridge.cjs`：赞助确认对话框（`Run this sponsored task?`、
    「否/是」按钮、`wants to integrate itself into this project…` 一句话征求同意）；
    顺带补翻 v0.0.86 即存在但漏翻的本地/远程连接器两段 explanation
    （`This runs a program with the same permissions as you…` /
    `This sends requests to that address…`）
  - `consent-window.html`：新增赞助布局（who/rest 双 span 拆分广告主名与句子，
    译文保留前导空格）与「无法说明请求方」拒绝文案
  - `main.cjs`：新增「附加图片」（Attach images）文件对话框
- **渲染进程补翻 52 条新词条**（exact 47 / template 5）：
  - 赞助提案 UI 全套：状态标题表（`Sponsored proposal` / `Start sponsored thread` /
    `Sponsored thread running` / `… committed its work` / `… landed a PR` / `… failed` /
    `Sponsored PR merged`）、操作（`Create pull request` / `Watch this run` /
    `View what it did` / `Dismiss sponsored proposal` / `Never show ${t}` /
    `Report this proposal` / `Turn off sponsored proposals` / `Remove worktree`）、
    默认 whyThis 与四种不可用原因（Windows 无 containment / bubblewrap 缺失 /
    不支持的平台 / 需要桌面应用）、标签页徽标与提示模板
  - 预览元素选择/缩放：`Click an element · Esc to cancel`、`Preview zoom`、
    `Zoom preview in/out`、`Reset preview zoom, currently ${o}%`、
    `Remove preview element ${t.selector}` 等
  - 管理员审批：`Administrator approval required` 及标签页 tooltip
  - 其他：`Attach images`（配合主进程新对话框）、`Markdown view`、`Source`、
    `Move to new window`、`Premium session time remaining`、
    `Changed during agent work`（文件变更统计新拆分）
- **结构变更迁移**：文件计数复数 `," file",t.files.length===1?"":"s"` →
  ` file${t===1?"":"s"}`（提取为 LI 辅助函数的内联模板）；`Agent changed ` 拼接 →
  `` `Agent changed ${LI(t)}` `` 模板词条；移除已下线的
  `Drop files, photos, or folders to attach`
- **验证**：`all keys matched`、纯字面量覆盖 771/771（100%）、`lint_dict` 通过；
  主进程补丁逐字节套用、`node --check` 通过，postbuild 自检全绿；
  uipos 残留扫描由 52 → 26 条（剩余均为约定保留英文项：代码关键字、模型名、命令）
- 词典更新为 exact 787 / template 131 / code 4 / pattern 45

## [0.0.86] · 2026-09-03

- **适配 Freebuff v0.0.86**：targetVersion / packVersion 升至 0.0.86。渲染 bundle
  `index-qE9EmCR_.js` → `index-kOlI7uqe.js`；NSIS 安装器再次清掉 `hanhua-backup-*`，
  走「无备份回退安装目录英文原版」构建路径
- **模板变量自动重映射**：`tools/remap.js` 迁移 34 条（`bn → pn`、`wo → So`、`dV → $8`、
  `UP → ey`、`I1 → W1`、`Ni → Di`、`jD(re) → XD(ne)`、`dQ → vQ`、`DS → qS`、
  `Jt → Kt`、`hV → A8`、`pm → Xp`、`cV → P8`、`uV → R8`、`XP → BE`、`uy → Jb`、
  `H → W`、`QT → yb`、`Ec → kc`、`yPe → tRe`、`pz → bz`、`uv → pv` 等），1 条
  AMBIGUOUS（`Context ${$s(g)}`，锚文本命中 2 处插值不一致）手工改为 `Context ${As(g)}`
- **GLM 5.2 推荐活动整体改名**为「高级会话 / 赏金（Bounty）」，删除 8 条旧词条并补翻
  对应新文案：
  - 奖池标题 `${r?"Promo":"GLM 5.2 promo"}` → `` ${r?"Promo":"Bounty promo"} ``，
    翻译由残留的「GLM 5.2 推广」更正为「赏金推广」
  - `GLM 5.2 unlocked` → `Reward session unlocked` / `Earned sessions`；
    `Refer friends to unlock GLM 5.2` → `Refer friends for more free sessions` /
    `Refer friends for an extra premium session`；`Each qualified referral earns…` →
    「+1 次/天」模板与「one more 1-hour premium session」两式；
    `GLM 5.2 — today’s sessions used` → `Today’s premium sessions used`
  - 新增 `Premium sessions`、`Reward session unlocked`、`earned from bounties`、
    `Complete a bounty to unlock` 等 exact 词条
- **标签页关闭交互重写**：旧 `Delete the queued close action to cancel` /
  `Tab close scheduled` 删除，改为状态化 label/tooltip——`Cancel closing this tab` /
  `Close tab when done` / `Closing this tab…` / `This tab will close once the queue finishes. Click to cancel.`
  / `Couldn't cancel the tab close` 等
- **移除已下线文案**：`Time since the agent finished`（→ 现有 `Time since your latest prompt`）、
  `After everything above finishes, close this tab and clean up the thread`
- **验证**：`all keys matched`、纯字面量覆盖 728/728（100%）、`lint_dict` 通过；
  主进程补丁逐字节套用、`node --check` 通过，postbuild 自检 4 项全绿
- 词典更新为 exact 743 / template 123 / code 4 / pattern 45

## [0.0.84] · 2026-09-02

- **适配 Freebuff v0.0.84**：targetVersion / packVersion 升至 0.0.84。本轮渲染 bundle
  内容哈希不变（仍为 `index-qE9EmCR_.js`），**变更全部在主进程 asar**（package.json
  除版本号外无差异）；装机目录无新增备份，构建回退直接用上一轮的
  `hanhua-backup-20260902-110906`（实为 0.0.84 英文原版）作 pristine
- **主进程补丁重新生成**：五份既有补丁与 0.0.83 版逐字节一致（相关区域无实质变更），
  仅 `electron-main.cjs.patch` 随新词条 +9 行；**新增 `electron-open-in.cjs.patch`**
- **补翻两条存量漏翻**（0.0.83 就存在、主进程单引号字符串词典覆盖不到，走补丁分区）：
  - 「打开方式」右键菜单里的 `Copy path` → 复制路径（主进程传 label，渲染端原样显示）
  - 打开失败 toast 兜底 `Could not open that path` → 无法打开该路径
- **补翻渲染端配套两条历史漏翻**（template）：`Open in ${C.label}` → `在 ${C.label} 中打开`、
  `Couldn’t open in ${C.label}.` → `无法在 ${C.label} 中打开。`（主 bundle 替换 1057 → 1060 处）
- **`tools/apply_ui_patch.js` 微修**：`couldn’t`（弯引号）变体提前到 `couldn't` 之前判断，
  消除 0.0.84 index.html 上的误报 MISSED
- **验证**：`all keys matched`、纯字面量覆盖 727/727（100%）、`lint_dict` 通过；
  uipos 残留 26 条不变（均为有意保留项），主进程 UI 位置英文从 15 → 13 条（余下均为
  内部 API 错误与编辑器/终端名）
- 词典更新为 exact 741 / template 123 / code 4 / pattern 45

## [0.0.83] · 2026-09-02

- **适配 Freebuff v0.0.83**：targetVersion / packVersion 升至 0.0.83（渲染 bundle：
  `index-B7Da-BoE.js` → `index-qE9EmCR_.js`）。应用自动更新再次覆盖汉化，且 NSIS 安装器
  清掉了 `hanhua-backup-*`，继续走「无备份回退安装目录英文原版」构建路径
- **模板变量自动重映射**：`tools/remap.js` 迁移 13 条（`LT() → QT()`、`Ku(...) → fc(...)`、
  `Tc(...) → Ec(...)`、`fPe → yPe`、`mz(...) → pz(...)`），0 条 AMBIGUOUS / MISSING
- **补翻 0.0.83 新增文案**（2 条）：应用内更新日志面板标题 `What's new` → 更新内容、
  aria `What changed in Freebuff ${r}` → `Freebuff ${r} 更新内容`；
  模型列表新英文 tagline（Powerful all-round coding model 等）与 0.0.82 译文逐字相同，无需新增
- **验证**：主 bundle 替换 1057 处、`all keys matched`、纯字面量覆盖 727/727（100%）、
  `lint_dict` 通过；uipos 残留回到 26 条，均为有意保留项
- 词典更新为 exact 742 / template 121 / code 4 / pattern 45

## [0.0.82] · 2026-09-02

- **适配 Freebuff v0.0.82**：targetVersion / packVersion 升至 0.0.82（渲染 bundle：
  `index-B-G-js1m.js` → `index-B7Da-BoE.js`）。本轮首次实战「安装目录已是英文原版且无备份」的
  迁移回退（应用自动更新覆盖汉化后未重装汉化包，构建回退直接用安装目录英文原版作 pristine）
- **模板变量自动重映射**：`tools/remap.js` 迁移 30 条（`j → B`、`RT() → LT()`、`av → uv`、
  `Q → $`、`U → H`、`sU → dV`、`IP → UP`、`ib → Tc`、`ly → uy`、`nU → cV`、`iU → uV` 等），
  0 条 MISSING；2 条 AMBIGUOUS 人工核对
  - `Context ${As(g)}`：0.0.82 已被重写为 `Context ${$s(g)}`（同一模型选择器上下文百分比），
    按新原文重建词条
  - `${e.label} ${HEe(e.used)} of ${e.limit}`：0.0.82 用量面板重做后已无对应原文，删除死键
- **补翻 0.0.82 重写的用量面板与限额提示条**（新增 30 条、删除 3 条失效词条）：
  - 额度环 hint 六连：`… of ${…} plan sessions left this week/this billing period`、
    `… free premium sessions left today`、`… free sessions left this week/this month`、
    `… premium sessions left today (${o} free + ${r.dayLimit} from ${i.tierName})`
  - 面板标题与状态行：`Free` / `${i.tierName} plan` / `Free sessions` aria、
    `Free sessions are used first · today resets in …`（已入 exact）、
    `Today's premium sessions are used · resets in …`、
    `Premium sessions reset in … · MiMo and V4 Flash stay unmetered`
  - 限额提示条（limit-nudge）：`You've used all of ${r.label} for now.` / 
    `You're close to the limit on ${r.label} — … of ${r.limit} used.`、CTA `Get more sessions` / 
    `See plans`、关闭按钮 aria `Dismiss` 与 toast aria `Dismiss notification: …`
  - 状态标签：`your free sessions` / `your plan sessions` / `daily/weekly/monthly plan sessions`、
    模型池标签 `${r.poolLabel.toLowerCase()} sessions`、
    `${t.poolLabel.toLowerCase()} ${t.countsAdmissions?"starts":"sessions"}`、
    环 label `week` / `month` / `tokens`（pattern 分区，仅属性位置，不会误伤代码）
- **防呆加固**：`build.sh` 对 UI bundle 构建日志断言 `all keys matched`（此前仅检查替换次数 > 0，
  MISSED 死键不报错——本轮迁移中 `5-day limit reached` 死键正是靠这个新检查暴露的）
- **验证**：主 bundle 替换 1055 处、`all keys matched`、纯字面量覆盖 727/727（100%）、
  `lint_dict` 通过；uipos 残留仅剩代码关键字、模型名（GPT-5.6-*/Opus/Sonnet/Fable 5.1）、
  `mcpServers` 等内部标识与 HTML input type
- 词典更新为 exact 741 / template 120 / code 4 / pattern 44
- **版本号规范调整**：packVersion 不再使用 `x.y.z.1` 修复后缀，直接与 targetVersion
  保持一致（曾短暂发布的 `pack-v0.0.82.1` 已删除，由 `pack-v0.0.82` 取代）

## [0.0.79] · 2026-09-01

- **适配 Freebuff v0.0.79**：targetVersion / packVersion 升至 0.0.79，汉化包 Release `pack-v0.0.79` 已发布
- **新增文案翻译**：0.0.79 新增的 agent 工具按钮 label 21 条（pattern）+ guidance 使用说明 15 条（exact），
  主 bundle 替换 935 处，纯字面量词条覆盖 99.0%（671/678）
- **模板变量自动重映射**：remap 迁移 30 条（$ → j、x → S、jS → j1 等），0 条 MISSING
- **残留核对**：uipos/prose/leftover 扫描确认剩余均为代码标识符、键盘键名、模型名
  （GPT-5.6-*/Opus 4.8/Opus 5/Sonnet 5/Fable 5）与 HTML input type，无需翻译

### 词典修复版 · 2026-09-01（之二）

- **补翻 0.0.79 漏掉的一批用户可见文案**（新增 86 条、清理 9 条失效词条）：
  - 强度选择器（1–5 档悬浮提示）：Sprint/Focused/Crafted/Thorough/Exhaustive —… → 冲刺/专注/精工/彻底/穷尽
  - 空空间/起步页：Start a new thread / Open a project to get started / Choose a project folder…
  - 邀请页脚：Copied! / Copy invite link
  - Claude Code 运行时安装：Step 1 of 2 · Downloading/Verifying… / Connected / Retry download…
  - 应用更改（Apply）流程：Nothing to apply / Could not apply the changes / 各分支冲突原因（模板）
  - 技能编辑器：Edit/Delete/Restore…/Insert skill、删除确认、技能模板说明（含整段 SKILL.md 引导）
  - 会话状态/通知：Merge conflict / The agent sent nothing back
  - 文件浏览器/差异：No matches / Could not load diff / Path copied
  - 登录/提升权限/反馈/更新弹窗：Waiting for sign-in / Deny administrator access / A crash, error… / Development build…
  - 终端无障碍播报 + 拖拽键盘操作提示：Terminal input / Too much output… / dnd-kit 拖拽与空格键说明
- **清理死键**：✓ Copied!、⧉ Copy invite link、Balanced/Lean/Minimal…（强度旧文案）、
  Context ${gs(g)}、${e.label} ${Yye(e.used)} of ${e.limit} 等 9 条原文已被 0.0.79 改写的失效词条
- **验证**：替换 935 → 1030 处、`all keys matched`、纯字面量覆盖 729/729（100%）、`lint_dict` 通过；
  剩留英文均为有意保留（模型名、代码关键字、正则/编辑器内部报错、路径、`month` 用量标签）
- 词典更新为 exact 743 / template 105 / code 4 / pattern 28

## 工具链 · 2026-08-30（之二）

- **release.sh packVersion 防呆**：发布前对比远端最新 pack-manifest 的 packVersion，
  未升版本即拒绝（`--force` 才允许覆盖同版本），避免客户端静默跳过修复版
- **发布渠道启用 + 声明调整**：首个汉化包 Release `pack-v0.0.78` 已发布；免责声明
  从「仅限本机自用、勿公开传播」调整为「面向已合法获取 Freebuff Desktop 的用户
  供个人自用，可经本项目 Release 渠道获取与分发（勿商用、勿移除声明）」，
  同步更新根/子 README 与 release.sh 提示
- **汉化包发布/更新通道**：新增 `tools/release.sh`（打包 `output/` 为 zip + 生成
  pack-manifest.json + 发布 GitHub Release，`--no-upload` 仅打包并打印手工步骤）；
  `build.sh` 给产物注入 `<meta name="hanhua-pack">` 版本戳；`manifest.json` 新增
  `packVersion` 字段（同 targetVersion 的词典修复版可独立递增）
- **多开控制器客户端**：每 30 分钟检查 pack Release（与 Freebuff 更新检查共用
  代理链）；targetVersion 与本机 Freebuff 版本一致且 packVersion 更新时自动下载、
  SHA512 校验、解包（含 zip-slip 防护）到 `output/`，点「应用汉化」生效；
  「应用汉化」按钮在有新包待应用时保持可用，底栏提示「有新包 vX 可应用」

## [0.0.78] · 2026-08-30

- **适配 v0.0.78**：应用自动更新至 0.0.78（渲染 bundle：`index-DOLT0u31.js` →
  `index-B-G-js1m.js`）。装机目录无 `hanhua-backup-*`（备份链已断），本轮首次实战
  「无备份时回退用安装目录英文原版」的构建回退（见「工具链 · 2026-08-29（之二）」）；
  应用后英文原版已重新入库 `hanhua-backup-20260830-130408`。主进程补丁全部干净套用，
  语法校验通过
- **词典迁移**：`tools/remap.js` 自动迁移 6 条 template 词条的 minifier 改名
  （`c_e→u_e`、`gn(M)→gn(D)`、`so(L)→oo(L)`、`Mq(t,e)→Dq(t,e)`、`Dq(t)→Mq(t)`×2）；
  1 条被 remap 判 AMBIGUOUS 拒绝自动迁移（用量汇总行 `${e.label} … of ${e.limit}`，
  锚文本在新 bundle 多义命中），人工核对确认仅为格式化函数改名 `Gye→Yye`，
  同步更新 key 与译文后全命中
- **验证**：词典对主 bundle 替换 911 处、`all keys matched`；postbuild 纯字面量
  覆盖率 663/663（100%）；装机 index.html 带 `lang="zh-CN"` 标记，装机与 output 一致

## 工具链 · 2026-08-29（之二）

- **修复 `tools/remap.js` 内嵌的原始 NUL 字节**：`c.join('\u0000')` 的分隔符此前是
  字面 0x00 字节，导致 GitHub / 文本工具把该文件识别为二进制（不显示内容与 diff、
  无法正常审阅）。改为等价的 `\u0000` 转义序列，语义不变
- **首次构建不再依赖备份**：`build.sh` / `tools/update.sh` 在找不到 `hanhua-backup-*`
  时自动改用安装目录当前的英文原版（`resources/app.asar` + `orchestrator/ui`）作
  pristine，解决「先有 backup 还是先有 output」的鸡生蛋问题；安装目录已是汉化版
  且无备份（备份链已断）时明确报错，避免拿汉化产物当原版
- **`tools/apply_ui_patch.js` 补齐 MISSED 报告**：index.html 直改的每条替换不命中时
  逐条列出（已翻译则不误报），与 `apply.js` 行为对齐；漏翻不再静默，报告随
  build / update 日志留档

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
