// Apply UI index.html translations directly (replaces git apply for this file).
// Usage: node apply_ui_patch.js <index.html>
const fs = require('fs');
const f = process.argv[2];
if (!f) { console.error('usage: node apply_ui_patch.js <index.html>'); process.exit(1); }
let s = fs.readFileSync(f, 'utf8');
const before = s;
s = s.replace('<html lang="en">', '<html lang="zh-CN">');
s = s.replace('<title>Freebuff Desktop</title>', '<title>Freebuff 桌面版</title>');
s = s.replace('<h1>Freebuff couldn\'t load</h1>', '<h1>Freebuff 无法加载</h1>');
s = s.replace(
  /Part of the interface did not start\. Reload once; if this screen returns, reinstall the\r?\n\s+latest version\. Your projects and conversations are safe\./,
  '部分界面未能启动。请重新加载一次；如果此界面再次出现，请重新安装最新版本。你的项目和对话都是安全的。'
);
s = s.replace('Reload Freebuff', '重新加载 Freebuff');
s = s.replace('Get latest installer', '获取最新安装程序');
if (s === before) {
  console.log('apply_ui_patch: no changes (already translated?)');
} else {
  fs.writeFileSync(f, s);
  console.log('apply_ui_patch: patched ' + f);
}
