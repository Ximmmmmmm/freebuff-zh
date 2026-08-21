# 更新日志

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
