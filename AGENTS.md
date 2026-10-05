# 给 AI 协作者的说明（freebuff-zh）

这是 Freebuff Desktop 的简体中文汉化包：词典 + 人工补丁 + 可复现构建。产物是 `output/app.asar` 与 `output/ui/`，由 `apply.sh` 装进 Freebuff。

**你被叫到这个名字模糊的任务（"更新汉化并发布"之类）时，本页就是标准流程。先读本页再动手，不要自己重新摸索 `tools/`。**

## 一句话地图

```
dict.json               词典本体（4 个分区，见下）—— 唯一真正的产出物
intentional-english.json 有意保留英文的登记表（写进去，别靠命令行开关绕过）
manifest.json           targetVersion = 适配的 Freebuff 版本；packVersion = 本包版本
patches/electron-*.patch 主进程人工补丁（词典够不着主进程，主进程文案只能靠补丁）
work/pristine/<版本>/   各版本英文原版快照 = 上游对差的基线，**不能删**
dist/hanhua-pack-*.zip  已发布的包，最新 2 个是回归闸门的基线，**不能删**
tools/                  58 个脚本（55 .js + 3 .sh，其中 24 个是 test_*），逐个都有引用
                        —— 不要新建一次性 adaptNNN.js（见「硬规则」）
dictapply.js            改词典唯一的入口：清单式 del / rename / set / add + --check + --write
fastloop.js             改词典时的 1.2 秒反馈循环（lint + 只查你改的那几条能否命中原版）
docs/更新维护.md        出事怎么查；每种「静默失败」的取证方法
```

## 版本更新的标准流程

**第 0 步（最容易漏）：本版英文原版必须先真正落到本机。** 装新版时只让它把文件装上、**别让控制器自动换回汉化**（控制器会在装机后立刻用旧版汉化覆盖掉，你就再也拿不到 161 的英文原版了）。

> 为什么要紧：`build.sh` / `update.sh` 不带参数时取**最新的 `hanhua-backup-*`** 当 pristine，并把它的文件按 `manifest.json` 的 `targetVersion` 登记进 `work/pristine/<版本>/`。如果你已经升了 manifest 但装机还是旧版，旧版英文会被登记成新版的基线——之后上游对差永远报"零新增"、四道闸门全绿，而产物其实是旧版。这种污染是**静默**的，只能靠删掉 `work/pristine/<错版本>/` 重来。
>
> 拿不到装机原版时的正规做法：`node tools/pristine.js capture <解包目录>`，或 `import --from-release <旧版>` 取基线。**原版没到手之前，不要跑 `build.sh` / `update.sh`**；实在要跑，就显式传路径而不是让它自动挑：`bash tools/update.sh <本版 app.asar> <本版 ui 目录>`。

```bash
# 1. 升 manifest.json 的 targetVersion / packVersion —— 顺序错了会对错基线
#    （update.sh 第 6 步按 work/pristine/ 的版本号挑基线，也按 packVersion 跳过跟自己比）

# 找本版英文原版（apply.sh 备份链始终保持英文）
BK=$(ls -1dt "$LOCALAPPDATA/Programs/@codebufffreebuff-desktop/resources"/hanhua-backup-*/ | head -1)

bash tools/update.sh            # 七步体检 + 构建，约 45 秒，报告全文归档 work/
node tools/fastloop.js --pristine "$BK/ui"   # 改词典时另开一个窗口挂着，1.2 秒一轮
# 2. 按报告小结补词条 —— 用变更清单，不要写脚本（见下）
bash build.sh && bash apply.sh  # 3. 构建 + 装机（apply 前必须彻底退出 Freebuff，热换会留混合态并让写操作永久 403）
bash tools/release.sh           # 4. 发布（只在你确实要给别人用时才跑；它会跑四道发布闸门）
```

注意 `update.sh` 是 **bash 脚本**，`node tools/update.sh` 跑不起来（`docs/更新维护.md` 第 10 行那处示例是错的）。

`update.sh` 第 6 步会自动把「上游未覆盖新增」写成 `work/changelist-<时间戳>.json` 骨架（`value` 全是空串）。**翻译由人/AI 填，不接任何 API 翻译服务。**

## 改词典只用这一条路

```bash
node tools/dictapply.js work/changelist-XXX.json            # dry-run：逐条打印将要做的改动
node tools/dictapply.js work/changelist-XXX.json --check    # 体检 AI/人填回来的译文（只读）
node tools/dictapply.js work/changelist-XXX.json --write    # 落盘，写完自动跑 lint，不过即还原
node tools/dictapply.js --emit --guidance > work/changelist-<新版>.json   # 现造骨架 + 译文规则
```

清单四类操作：`del` / `rename`（原位换键，保序）/ `set`（只换译文）/ `add`。键定位支持精确命中或唯一片段，命中多条会报 `AMBIGUOUS` 并给候选——**遇到 AMBIGUOUS 就把片段加长到唯一**。`dictapply.js` 有意不提供强制开关：清单里任何一条有歧义或缺译文，`--write` 会整体拒绝，不会写一半。

## 硬规则（每条都对应过一次真实事故）

1. **禁止新建一次性脚本**（`work/adaptNNN.js` 那种）。词条的删/迁/加一律走 `dictapply.js` 清单。
2. **`orchestrator.js` 不在汉化范围内**。构建只处理 `app.asar` 的 `electron/*.cjs` 和 `orchestrator/ui/`。往 `dict.json` 里塞只出现在 `orchestrator.js` 的文案会永远不命中——那句要么进 `patches/`，要么接受它是英文。
3. **不许自动删「死词条」**。`resituate` 的 `GONE` 只是"疑似下线"，删不删人判断；`update.sh` 不会替你删，你也不要在脚本里替我删。
4. **`code` 分区的 `value` 必须与 `key` 逐字节相同**，那是代码字面量。
5. **要保留英文就登记，不要绕过闸门**：写进 `intentional-english.json` 并说明理由。`resituate --prune-gone`、`regress --allow-english` 这类开关只在明确知道自己在做什么时用，默认不许拿来让检查变绿。
6. **不要动 `work/pristine/`、`dist/` 最新两个包、`hanhua-backup-*`**——它们分别是上游对差、回归闸门、构建 pristine 的基线。
7. **`dict.json` 必须保持 `JSON.stringify(obj, null, 2) + '\n'` 的规整格式**：`lint_dict.js` 是逐行解析的，格式跑偏会被误报成"条目出现在分区之外"。
8. 迁移改的是**产物**，装机生效要 `apply.sh`；没跑 `apply.sh` 之前别说"已经汉化好了"。

## 汇报要求

做完必须给出：**版本号从 X 到 Y、`dict.json` 条数变化、哪些词条判 GONE 但我没删、哪些补丁 KEEP/REWRITE/RETIRE、四道发布闸门结果、以及有没有哪一步被我跳过了**。跳步要明说，这个仓库的价值在于"没有静默失败"，你替我绕过闸门就是毁掉它。
