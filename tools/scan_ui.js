#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dict.json'), 'utf8'));
const allKeys = new Set();
for (const cat of Object.values(dict)) for (const k of Object.keys(cat)) allKeys.add(k);

const bundlePath = process.argv[2];
if (!bundlePath) { console.error('Usage: node scan_ui.js <bundle.js>'); process.exit(1); }
const src = fs.readFileSync(bundlePath, 'utf8');

// Extract double-quoted strings
const re = /"((?:[^"\\]|\\.)*)"/g;
const counts = new Map();
let m;
while ((m = re.exec(src)) !== null) {
  let s;
  try { s = JSON.parse('"' + m[1].replace(/\\/g, '\\\\') + '"') } catch { s = m[1] }
  if (!s || s.length < 4) continue;
  counts.set(s, (counts.get(s) || 0) + 1);
}

// Must look like UI prose: at least one space, capital-letter start, no code patterns
const isUI = (s) => {
  if (/[\u4e00-\u9fff]/.test(s)) return false;
  if (!/\s/.test(s)) return false;
  if (!/^[A-Z]/.test(s)) return false;
  // Filter out code-heavy strings
  if (/[{}()\[\]<>]/.test(s)) return false;
  if (/[,;=+*/\\|&]/.test(s)) return false;
  return true;
};

// Skip known technical/brand names that should stay English
const skipWords = new Set([
  'ASCII', 'Apostrophe', 'Block', 'Document', 'Emphasis', 'Identifier',
  'Literal', 'Module', 'Quote', 'Suspense', 'Element', 'Activity',
  'Not supported!',
  'Must invoke loadWasm first.',
  'String expected as pattern',
  'This method should only be called if the source is a string',
  'Shiki instance has been disposed',
  'takes an object of state variables to update or a function which returns an object of state variables.',
  'Unexpected match for standard token type!',
  'write to private field',
  'Value expected',
  'Tilde', 'Turtle',
]);

const results = [];
for (const [s, n] of counts) {
  if (!isUI(s)) continue;
  if (allKeys.has(s)) continue;
  if (skipWords.has(s)) continue;
  results.push([n, s]);
}
results.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
console.log('=== 渲染进程中可能可翻译的英文 UI 文本 ===');
console.log('（已排除词典中已有的翻译和不需翻译的技术术语）\n');
for (const [n, s] of results) {
  console.log(n + '\t' + s);
}
console.log('\n总计: ' + results.length + ' 处');
