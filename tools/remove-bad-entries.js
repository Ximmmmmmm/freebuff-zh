#!/usr/bin/env node
// remove-bad-entries.js — 从 dict.json 删除危险词条（键在所有 section 中查找）
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const bad = JSON.parse(fs.readFileSync(path.join(ROOT, 'work', 'bad-entries.json'), 'utf8'))
const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'dict.json'), 'utf8'))
let removed = 0
for (const section of ['exact', 'pattern', 'template', 'code']) {
  for (const key of bad) {
    if (dict[section] && dict[section][key] !== undefined) {
      console.log(`删除 [${section}] ${JSON.stringify(key)} = ${JSON.stringify(dict[section][key])}`)
      delete dict[section][key]
      removed++
    }
  }
}
fs.writeFileSync(path.join(ROOT, 'dict.json'), JSON.stringify(dict, null, 2) + '\n')
console.log(`共删除 ${removed} 条`)
