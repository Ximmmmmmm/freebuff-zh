const fs = require('fs');
const path = require('path');
const a = fs.readFileSync(process.argv[2], 'utf8');
const b = fs.readFileSync(process.argv[3], 'utf8');

// 1) className changes
const classRe = /\bclassName:\s*"([^"]+)"/g;
const oldClasses = new Set();
let mm;
while ((mm = classRe.exec(a))) oldClasses.add(mm[1]);
const newClasses = new Set();
while ((mm = classRe.exec(b))) newClasses.add(mm[1]);
const removed = [...oldClasses].filter((c) => !newClasses.has(c));
const added = [...newClasses].filter((c) => !oldClasses.has(c));
console.log('removed className:', JSON.stringify(removed));
console.log('added className:', JSON.stringify(added));

// 2) style attribute-ish changes (className-like in other props)
for (const prop of ['title', 'aria-label', 'placeholder', 'data-testid', 'id']) {
  const re = new RegExp('\\b' + prop + ':\\s*"([^"]+)"', 'g');
  const O = new Set();
  let m;
  while ((m = re.exec(a))) O.add(m[1]);
  const N = new Set();
  while ((m = re.exec(b))) N.add(m[1]);
  const rm = [...O].filter((c) => !N.has(c));
  const ad = [...N].filter((c) => !O.has(c));
  if (rm.length || ad.length) {
    console.log('prop', prop, 'removed:', JSON.stringify(rm.slice(0, 20)));
    console.log('prop', prop, 'added:', JSON.stringify(ad.slice(0, 20)));
  }
}
