#!/usr/bin/env node
// Scan main-process (app.asar) files for remaining user-facing English strings.
// Usage: node tools/mainscan.js <dir>
const fs = require('fs')
const path = require('path')

const dir = process.argv[2]
const files = []
;(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(cjs|html|js|mjs)$/.test(e.name)) files.push(p)
  }
})(dir)

const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g
const out = new Map()
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  let m
  while ((m = re.exec(src)) !== null) {
    const raw = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]
    let s
    try { s = JSON.parse('"' + raw.replace(/\\/g, '\\\\') + '"') } catch { s = raw }
    const t = s.trim()
    if (!t || t.length < 4 || /[\u4e00-\u9fff]/.test(t)) continue
    if (!/[A-Za-z]/.test(t)) continue
    if (!/\s/.test(t) && !/[A-Z]/.test(t)) continue
    // code-ish
    if (/^[a-z0-9_./\\-]+$/.test(t)) continue
    if (/^(electron|app|main|renderer|preload|desktop|freebuff|codebuff|node|process|window|document|browser|shell|ipc|menu|label|role|type|click|quit|close|open|save|cancel|ok|yes|no|file|folder|path|url|http|https|localhost|dev|prod|test|build|dist|src|lib|bin|out|tmp|temp|home|user|data|config|log|error|warn|info|debug|msg|send|recv|request|response|action|event|handler|callback|promise|async|await|return|export|import|require|module|exports|default|const|let|var|function|class|extends|super|new|delete|void|typeof|instanceof|in|of|true|false|null|undefined|string|number|boolean|object|array|date|regexp|map|set|get|has|add|remove|clear|size|length|index|key|value|name|id|type|style|class|title|alt|src|href|rel|target|method|action|accept|multiple|checked|selected|disabled|hidden|required|readonly|placeholder|autofocus|autoFocus|tabIndex|aria|data|role|status|ready|done|running|idle|active|pending|queued|failed|success|error|unknown|loading|saving|deleting|renaming|moving|copying|updating|downloading|installing|upgrading|uninstalling|starting|stopping|pausing|resuming|retrying|canceling|cancelling|skipping|waiting|connecting|disconnecting|reconnecting|syncing|uploading|downloading|importing|exporting|reading|writing|parsing|serializing|deserializing|validating|verifying|authenticating|authorizing|signing|encrypting|decrypting|compressing|decompressing|zipping|unzipping|archiving|extracting|packaging|unpacking|bundling|minifying|transpiling|compiling|linting|formatting|prettifying|debugging|profiling|monitoring|observing|tracking|recording|playing|pausing|stopping|seeking|muting|unmuting|brightness|contrast|saturation|hue|opacity|transparency|shadow|blur|filter|transform|transition|animation|duration|delay|timing|easing|iteration|direction|fill|play|pause|stop|seek|mute|unmute|volume|brightness|contrast|saturation|hue|opacity|transparency|shadow|blur|filter|transform|transition|animation|duration|delay|timing|easing|iteration|direction|fill|play|pause|stop|seek|mute|unmute|volume).*$/i.test(t)) continue
    const k = f.replace(/\\/g, '/')
    if (!out.has(t)) out.set(t, { n: 0, files: new Set() })
    out.get(t).n++
    out.get(t).files.add(k)
  }
}
const arr = [...out.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
for (const [t, { n, files }] of arr) {
  console.log(`${n}\t${[...files].join(',')}\t${t}`)
}
console.log(`total distinct: ${arr.length}`)
