// Generate patches for the current extracted Freebuff main process.
// Usage: node tools/gen_patches.js <pristine-asar-extracted-dir> [patch-output-dir]
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const sourceDir = process.argv[2]
const outDir = process.argv[3] || path.join(__dirname, '..', 'patches')
if (!sourceDir) {
  console.error('usage: node tools/gen_patches.js <pristine-asar-extracted-dir> [patch-output-dir]')
  process.exit(1)
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freebuff-patches-'))
fs.mkdirSync(outDir, { recursive: true })

function applyEdits(file, edits) {
  let text = fs.readFileSync(file, 'utf8')
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  for (const [from, to] of edits) {
    const source = from.replace(/\n/g, newline)
    const replacement = to.replace(/\n/g, newline)
    if (!text.includes(source)) console.warn(`  missing in ${path.basename(file)}: ${from.slice(0, 80)}`)
    text = text.split(source).join(replacement)
  }
  fs.writeFileSync(file, text)
}

function patchFor(relative, edits) {
  const source = path.join(sourceDir, relative)
  const baseline = path.join(tempDir, `base-${path.basename(relative)}`)
  const temp = path.join(tempDir, relative)
  fs.mkdirSync(path.dirname(temp), { recursive: true })
  fs.copyFileSync(source, temp)

  const apply = spawnSync(process.execPath, [path.join(__dirname, 'apply.js'), temp, '--write'], {
    encoding: 'utf8',
  })
  if (apply.status !== 0) {
    process.stderr.write(apply.stderr || '')
    process.exit(apply.status || 1)
  }
  fs.copyFileSync(temp, baseline)
  applyEdits(temp, edits)

  const diff = spawnSync('diff', [
    '-u',
    '--label', `a/${relative}`,
    '--label', `b/${relative}`,
    baseline,
    temp,
  ], { encoding: 'utf8' })
  if (diff.status !== 0 && diff.status !== 1) {
    process.stderr.write(diff.stderr || '')
    process.exit(diff.status || 1)
  }
  fs.writeFileSync(
    path.join(outDir, `electron-${path.basename(relative)}.patch`),
    diff.stdout.replace(/\r\n/g, '\n'),
  )
  console.log(`  wrote ${relative}`)
}

patchFor('electron/main.cjs', [
  ["buttons.push('Show Log')", "buttons.push('查看日志')"],
  ["buttons.push('Quit')", "buttons.push('退出')"],
  ["title: 'Quit Freebuff?'", "title: '退出 Freebuff？'"],
  ["message: 'Freebuff is still working.'", "message: 'Freebuff 仍在工作中。'"],
  ["'Quitting stops the agents now. The next time you open Freebuff, interrupted turns ' +\n        'continue automatically from their latest saved step. Completed steps, conversation ' +\n        'context, and changes already written to your files are kept.',", "'退出将立即停止智能体。下次打开 Freebuff 时，中断的轮次将从最近保存的步骤自动继续。已完成的步骤、对话上下文以及已写入你文件的更改都会保留。',"],
  ["buttons: ['Cancel', 'Quit anyway']", "buttons: ['取消', '仍要退出']"],
  ["title: 'Attach files or folders'", "title: '附加文件或文件夹'"],
  ["buttonLabel: 'Attach'", "buttonLabel: '附加'"],
  ["title: 'Open a project folder'", "title: '打开项目文件夹'"],
  ["buttonLabel: 'Open'", "buttonLabel: '打开'"],
  ["{ label: 'Rename Tab', click: () => done('rename') }", "{ label: '重命名标签页', click: () => done('rename') }"],
  ["{ label: 'Close Tab', click: () => done('close') }", "{ label: '关闭标签页', click: () => done('close') }"],
  ["{ label: 'Check for Updates…', click: () => checkForUpdatesInteractive() }", "{ label: '检查更新…', click: () => checkForUpdatesInteractive() }"],
  ["label: `Quit ${app.name}`", "label: `退出 ${app.name}`"],
  ["label: 'File'", "label: '文件'"],
  ["label: 'New Tab'", "label: '新建标签页'"],
  ["label: 'Reopen Closed Tab'", "label: '重新打开已关闭的标签页'"],
  ["label: 'Open Project…'", "label: '打开项目…'"],
  ["{ label: 'Close Tab', accelerator: 'CmdOrCtrl+W'", "{ label: '关闭标签页', accelerator: 'CmdOrCtrl+W'"],
  ["label: 'Close Window'", "label: '关闭窗口'"],
  ["label: 'Quit', accelerator: 'CmdOrCtrl+Q'", "label: '退出', accelerator: 'CmdOrCtrl+Q'"],
  ["label: 'View'", "label: '视图'"],
  ["label: 'Reload App'", "label: '重新加载应用'"],
  ["label: 'Window'", "label: '窗口'"],
  ["label: 'Help'", "label: '帮助'"],
  ["dialog.showErrorBox('Freebuff failed to start'", "dialog.showErrorBox('Freebuff 启动失败'"],
  ["title: 'Freebuff failed to start'", "title: 'Freebuff 启动失败'"],
  ["['Relaunch Without Sandbox', 'Quit']", "['不使用沙箱重启', '退出']"],
  ["['Show Log', 'Quit']", "['查看日志', '退出']"],
])

patchFor('electron/consent-window.html', [
  ['<span id="title">Approve this connector?</span>', '<span id="title">批准此连接器？</span>'],
  ['<button id="no" type="button">Cancel</button>', '<button id="no" type="button">取消</button>'],
  ['<button id="yes" type="button" class="go">Approve</button>', '<button id="yes" type="button" class="go">批准</button>'],
  ["options.buttons || ['Cancel', 'Approve']", "options.buttons || ['取消', '批准']"],
  ["options.title || 'Approve this connector?'", "options.title || '批准此连接器？'"],
  ['(this dialog could not describe what would run — do not approve)', '(此对话框无法描述将要运行的内容——请勿批准)'],
])

patchFor('electron/linux-launch.cjs', [
  ['This system restricts unprivileged user namespaces for unpackaged apps ', '此系统限制了未打包应用的非特权用户命名空间 '],
  ['(kernel.apparmor_restrict_unprivileged_userns=1), which the Chromium sandbox requires.', '（kernel.apparmor_restrict_unprivileged_userns=1），而 Chromium 沙箱需要该功能。'],
  ['This system disables unprivileged user namespaces ', '此系统禁用了非特权用户命名空间 '],
  ['(kernel.unprivileged_userns_clone=0), which the Chromium sandbox requires.', '（kernel.unprivileged_userns_clone=0），而 Chromium 沙箱需要该功能。'],
  ['This system allows no user namespaces (user.max_user_namespaces=0), ', '此系统不允许创建用户命名空间（user.max_user_namespaces=0），'],
  ['which the Chromium sandbox requires.', '而 Chromium 沙箱需要该功能。'],
  ["message: 'Freebuff could not start a required subprocess.'", "message: 'Freebuff 无法启动所需的子进程。'"],
  ['Freebuff is already running without the Chromium sandbox, so this is likely a graphics ', 'Freebuff 已在无 Chromium 沙箱的情况下运行，因此这更可能是图形或系统库问题，而非沙箱问题。'],
  ['or system library problem rather than the sandbox.', ''],
  ['Launch from a terminal to see the underlying error:', '从终端启动以查看底层错误：'],
  ['A required Chromium subprocess failed to launch. The Chromium sandbox is available on ', '所需的 Chromium 子进程启动失败。此系统上可以使用 Chromium 沙箱，因此原因更可能是图形栈或缺少系统库。'],
  ['this system, so the cause is more likely the graphics stack or a missing system library.', ''],
  ["The Chromium sandbox could not start on this system.", '此系统上的 Chromium 沙箱无法启动。'],
  ['Freebuff would normally restart itself without the sandbox, but the application file ', 'Freebuff 通常会在无沙箱的情况下自行重启，但用来重启的应用程序文件'],
  ['it needs to restart from is missing — it may have been moved or deleted, or an update ', '已缺失——可能已被移动或删除，或者更新'],
  ['may have been interrupted.', '可能已被中断。'],
  ['Re-download Freebuff, or start it yourself with:', '请重新下载 Freebuff，或自行通过以下命令启动：'],
  ['Freebuff can restart with the sandbox disabled. That weakens isolation for web content ', 'Freebuff 可以在禁用沙箱的情况下重启。这会削弱预览面板中网页内容的隔离性，因此请仅在受信任的机器上执行此操作。'],
  ['shown in preview panes, so only do it on a machine you trust.', ''],
  ['To fix this system-wide and keep the sandbox:', '要在系统范围内修复并保留沙箱：'],
])

patchFor('electron/mcp-consent-bridge.cjs', [
  ['`Command:  ${clamp(spec.command)}`', '`命令：  ${clamp(spec.command)}`'],
  ['`Arguments:  ', '`参数：  '],
  [": '(none)'", ": '（无）'"],
  ['`Directory:  ', '`目录：  '],
  [": '(your home folder)'", ": '（你的主文件夹）'"],
  ['`Environment:  ', '`环境变量：  '],
  ['`Address:  ', '`地址：  '],
  ["'(this connector has no runnable command — refusing)'", "'(此连接器没有可运行的命令——已拒绝)'"],
  ["buttons: ['Cancel', local ? 'Run it' : 'Connect']", "buttons: ['取消', local ? '运行' : '连接']"],
  ["title: local ? 'Run this connector?' : 'Connect to this server?'", "title: local ? '运行此连接器？' : '连接到此服务器？'"],
  ['`Run "${clamp(name)}" on this computer?`', '`在此计算机上运行“${clamp(name)}”？`'],
  ['`Let Freebuff connect to "${clamp(name)}"?`', '`允许 Freebuff 连接到“${clamp(name)}”？`'],
])

patchFor('electron/orchestrator-failure.cjs', [
  ["'your system monitor'", "'你的系统监视器'"],
  ["message: 'Freebuff is already open'", "message: 'Freebuff 已在运行'"],
  ["'Another copy of Freebuff has your workspace open, so this one stopped instead of '", "'另一个 Freebuff 实例已打开你的工作区，因此本实例已停止，而不是'"],
  ["'competing with it for your threads.\\n\\n' +", "'与它争夺你的会话。\\n\\n' +"],
  ["'If you can see a Freebuff window, use that one. If you cannot, a leftover background '", "'如果你能看到某个 Freebuff 窗口，请直接使用那个窗口。如果看不到，说明有一个残留的后台'"],
  ['`process is still holding the workspace: quit "bun" in ${monitor}, then open Freebuff again.`', '`进程仍在占用工作区：请在 ${monitor} 中退出 "bun"，然后重新打开 Freebuff。`'],
  ["'The orchestrator did not become ready in time.'", "'编排器未能在规定时间内就绪。'"],
  ["`Process ended (code ${failure.code ?? 'none'}, signal ${failure.signal ?? 'none'}).`", "`进程已结束（代码 ${failure.code ?? '无'}，信号 ${failure.signal ?? '无'}）。`"],
  ["`\\nRecent log output:\\n${failure.stderrTail.trim()}`", "`\\n最近的日志输出：\\n${failure.stderrTail.trim()}`"],
  ["title: 'Freebuff failed to start'", "title: 'Freebuff 启动失败'"],
  ["message: 'The Freebuff orchestrator failed to start or stopped unexpectedly.'", "message: 'Freebuff 编排器启动失败或意外停止。'"],
])

console.log(`Patches written to ${outDir}`)
