// Generate patches for v0.0.72 main process files.
// Run from the extracted asar directory (where electron/ exists).
// Applies hand-written translations on top of dictionary-applied state,
// then outputs patches to the specified output directory.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const outDir = process.argv[2] || '.';

function handEdit(filePath, replacements) {
  let s = fs.readFileSync(filePath, 'utf8');
  for (const [from, to] of replacements) {
    s = s.split(from).join(to);
  }
  fs.writeFileSync(filePath, s);
  console.log('  edited: ' + path.basename(filePath));
}

// --- main.cjs ---
handEdit('electron/main.cjs', [
  // Splash screen (HTML template)
  ['\u003eStarting Freebuff orchestrator\u2026\u003c', '\u003e\u6b63\u5728\u542f\u52a8 Freebuff \u7f16\u6392\u5668\u2026\u003c'],
  // Quit dialog
  ["title: 'Quit Freebuff?'", "title: '\u9000\u51fa Freebuff\uff1f'"],
  ["message: 'Freebuff is still working.'", "message: 'Freebuff \u4ecd\u5728\u5de5\u4f5c\u4e2d\u3002'"],
  // Quit dialog detail (CRLF)
  ["'Quitting stops the agents now. The next time you open Freebuff, interrupted turns ' +\r\n        'continue automatically from their latest saved step. Completed steps, conversation ' +\r\n        'context, and changes already written to your files are kept.',",
   "'\u9000\u51fa\u5c06\u7acb\u5373\u505c\u6b62\u667a\u80fd\u4f53\u3002\u4e0b\u6b21\u6253\u5f00 Freebuff \u65f6\uff0c\u4e2d\u65ad\u7684\u8f6e\u6b21\u5c06\u4ece\u6700\u8fd1\u4fdd\u5b58\u7684\u6b65\u9aa4\u81ea\u52a8\u7ee7\u7eed\u3002\u5df2\u5b8c\u6210\u7684\u6b65\u9aa4\u3001\u5bf9\u8bdd\u4e0a\u4e0b\u6587\u4ee5\u53ca\u5df2\u5199\u5165\u4f60\u6587\u4ef6\u7684\u66f4\u6539\u90fd\u4f1a\u4fdd\u7559\u3002',"],
  // Quit dialog detail (LF)
  ["'Quitting stops the agents now. The next time you open Freebuff, interrupted turns ' +\n        'continue automatically from their latest saved step. Completed steps, conversation ' +\n        'context, and changes already written to your files are kept.',",
   "'\u9000\u51fa\u5c06\u7acb\u5373\u505c\u6b62\u667a\u80fd\u4f53\u3002\u4e0b\u6b21\u6253\u5f00 Freebuff \u65f6\uff0c\u4e2d\u65ad\u7684\u8f6e\u6b21\u5c06\u4ece\u6700\u8fd1\u4fdd\u5b58\u7684\u6b65\u9aa4\u81ea\u52a8\u7ee7\u7eed\u3002\u5df2\u5b8c\u6210\u7684\u6b65\u9aa4\u3001\u5bf9\u8bdd\u4e0a\u4e0b\u6587\u4ee5\u53ca\u5df2\u5199\u5165\u4f60\u6587\u4ef6\u7684\u66f4\u6539\u90fd\u4f1a\u4fdd\u7559\u3002',"],
  // Quit buttons
  ["buttons: ['Cancel', 'Quit anyway']", "buttons: ['\u53d6\u6d88', '\u4ecd\u8981\u9000\u51fa']"],
  // File dialogs
  ["title: 'Attach files or folders'", "title: '\u9644\u52a0\u6587\u4ef6\u6216\u6587\u4ef6\u5939'"],
  ["buttonLabel: 'Attach'", "buttonLabel: '\u9644\u52a0'"],
  ["title: 'Open a project folder'", "title: '\u6253\u5f00\u9879\u76ee\u6587\u4ef6\u5939'"],
  ["buttonLabel: 'Open'", "buttonLabel: '\u6253\u5f00'"],
  // Tab context menu
  ["{ label: 'Close Tab', click: () => done('close') }", "{ label: '\u5173\u95ed\u6807\u7b7e\u9875', click: () => done('close') }"],
  // File menu Close Tab
  ["{ label: 'Close Tab', accelerator: 'CmdOrCtrl+W'", "{ label: '\u5173\u95ed\u6807\u7b7e\u9875', accelerator: 'CmdOrCtrl+W'"],
  // Check for Updates
  ["{ label: 'Check for Updates\u2026', click: () => checkForUpdatesInteractive() }",
   "{ label: '\u68c0\u67e5\u66f4\u65b0\u2026', click: () => checkForUpdatesInteractive() }"],
  // Error dialogs
  ["dialog.showErrorBox('Freebuff failed to start'", "dialog.showErrorBox('Freebuff \u542f\u52a8\u5931\u8d25'"],
  ["title: 'Freebuff failed to start'", "title: 'Freebuff \u542f\u52a8\u5931\u8d25'"],
  // Orchestrator failure buttons
  ["['Relaunch Without Sandbox', 'Quit']", "['\u4e0d\u4f7f\u7528\u6c99\u7bb1\u91cd\u542f', '\u9000\u51fa']"],
  ["['Show Log', 'Quit']", "['\u67e5\u770b\u65e5\u5fd7', '\u9000\u51fa']"],
  ["message: 'Freebuff is already open'", "message: 'Freebuff \u5df2\u5728\u8fd0\u884c'"],
  // Show Log in failure dialog
  ["buttons.push('Show Log')", "buttons.push('\u67e5\u770b\u65e5\u5fd7')"],
]);

// --- consent-window.html ---
handEdit('electron/consent-window.html', [
  ['<span id="title">Approve this connector?</span>', '<span id="title">\u6279\u51c6\u6b64\u8fde\u63a5\u5668\uff1f</span>'],
  ["options.buttons || ['Cancel', 'Approve']", "options.buttons || ['\u53d6\u6d88', '\u6279\u51c6']"],
  ["options.title || 'Approve this connector?'", "options.title || '\u6279\u51c6\u6b64\u8fde\u63a5\u5668\uff1f'"],
  ["(this dialog could not describe what would run \u2014 do not approve)", "(\u6b64\u5bf9\u8bdd\u6846\u65e0\u6cd5\u63cf\u8ff0\u5c06\u8981\u8fd0\u884c\u7684\u5185\u5bb9\u2014\u2014\u8bf7\u52ff\u6279\u51c6)"],
]);

// --- linux-launch.cjs ---
handEdit('electron/linux-launch.cjs', [
  ["message: 'Freebuff could not start a required subprocess.'", "message: 'Freebuff \u65e0\u6cd5\u542f\u52a8\u6240\u9700\u7684\u5b50\u8fdb\u7a0b\u3002'"],
  ["To fix this system-wide and keep the sandbox:", "\u8981\u5728\u7cfb\u7edf\u8303\u56f4\u5185\u4fee\u590d\u5e76\u4fdd\u7559\u6c99\u7bb1\uff1a"],
]);

// --- mcp-consent-bridge.cjs ---
handEdit('electron/mcp-consent-bridge.cjs', [
  ['`Command:  ${clamp(spec.command)}`', '`\u547d\u4ee4\uff1a  ${clamp(spec.command)}`'],
  ['(none)', '\uff08\u65e0\uff09'],
  ['(your home folder)', '\uff08\u4f60\u7684\u4e3b\u6587\u4ef6\u5939\uff09'],
  ['`Arguments:  ', '`\u53c2\u6570\uff1a  '],
  ['`Directory:  ', '`\u76ee\u5f55\uff1a  '],
  ['`Environment:  ', '`\u73af\u5883\u53d8\u91cf\uff1a  '],
  ['`Address:  ', '`\u5730\u5740\uff1a  '],
  ["'(this connector has no runnable command \u2014 refusing)'", "'(\u6b64\u8fde\u63a5\u5668\u6ca1\u6709\u53ef\u8fd0\u884c\u7684\u547d\u4ee4\u2014\u2014\u5df2\u62d2\u7edd)'"],
]);

// --- orchestrator-failure.cjs ---
handEdit('electron/orchestrator-failure.cjs', [
  ["'your system monitor'", "'\u4f60\u7684\u7cfb\u7edf\u76d1\u89c6\u5668'"],
  ["'Another copy of Freebuff has your workspace open, so this one stopped instead of ' +",
   "'\u53e6\u4e00\u4e2a Freebuff \u5b9e\u4f8b\u5df2\u6253\u5f00\u4f60\u7684\u5de5\u4f5c\u533a\uff0c\u56e0\u6b64\u672c\u5b9e\u4f8b\u5df2\u505c\u6b62\uff0c\u800c\u4e0d\u662f\u4e0e\u5b83\u4e89\u593a\u4f60\u7684\u4f1a\u8bdd\u3002\\n\\n' +"],
  ["'competing with it for your threads.\\n\\n' +",
   "'\u5982\u679c\u4f60\u80fd\u770b\u5230\u67d0\u4e2a Freebuff \u7a97\u53e3\uff0c\u8bf7\u76f4\u63a5\u4f7f\u7528\u90a3\u4e2a\u7a97\u53e3\u3002\u5982\u679c\u770b\u4e0d\u5230\uff0c\u8bf4\u660e\u6709\u4e00\u4e2a\u6b8b\u7559\u7684\u540e\u53f0' +"],
  // \u672b\u884c\u5fc5\u987b\u7528\u53cd\u5f15\u53f7\u6a21\u677f\u5b57\u7b26\u4e32\uff0c\u5426\u5219 ${monitor} \u4e0d\u4f1a\u63d2\u503c\uff1b\u4e14\u4e0d\u80fd\u7559\u4e0b\u60ac\u7a7a\u7684\u539f\u59cb\u6a21\u677f\u5b57\u7b26\u4e32\uff08\u4f1a\u5bfc\u81f4 SyntaxError\uff09
  ["'If you can see a Freebuff window, use that one. If you cannot, a leftover background ' +",
   '`\u8fdb\u7a0b\u4ecd\u5728\u5360\u7528\u5de5\u4f5c\u533a\uff1a\u8bf7\u5728 ${monitor} \u4e2d\u9000\u51fa "bun"\uff0c\u7136\u540e\u91cd\u65b0\u6253\u5f00 Freebuff\u3002`,'],
  ["      `process is still holding the workspace: quit \"bun\" in ${monitor}, then open Freebuff again.`,\r\n", ""],
  ["      `process is still holding the workspace: quit \"bun\" in ${monitor}, then open Freebuff again.`,\n", ""],
  ["if (failure.kind === 'timeout') detailParts.push('The orchestrator did not become ready in time.')",
   "if (failure.kind === 'timeout') detailParts.push('\u7f16\u6392\u5668\u672a\u80fd\u5728\u89c4\u5b9a\u65f6\u95f4\u5185\u5c31\u7eea\u3002')"],
  ["Process ended (code ${failure.code ?? 'none'}, signal ${failure.signal ?? 'none'})",
   "\u8fdb\u7a0b\u5df2\u7ed3\u675f\uff08\u4ee3\u7801 ${failure.code ?? '\u65e0'}, \u4fe1\u53f7 ${failure.signal ?? '\u65e0'}\uff09"],
  ["Recent log output:", "\u6700\u8fd1\u7684\u65e5\u5fd7\u8f93\u51fa\uff1a"],
  ["message: 'The Freebuff orchestrator failed to start or stopped unexpectedly.'",
   "message: 'Freebuff \u7f16\u6392\u5668\u542f\u52a8\u5931\u8d25\u6216\u610f\u5916\u505c\u6b62\u3002'"],
]);

// Generate patches
console.log('\nGenerating patches...');
for (const f of ['electron/main.cjs', 'electron/consent-window.html', 'electron/linux-launch.cjs',
                  'electron/mcp-consent-bridge.cjs', 'electron/orchestrator-failure.cjs']) {
  const base = path.basename(f);
  const patchFile = path.join(outDir, base + '.patch');
  const diff = execSync(`git diff --no-color -- "${f}"`, { encoding: 'utf8' });
  fs.writeFileSync(patchFile, diff);
  console.log(`  ${base}.patch: ${diff.split('\n').length} lines`);
}

console.log('\nDone!');
