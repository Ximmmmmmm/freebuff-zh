#!/usr/bin/env node
// codex-proxy: 净化代理。剥掉 deepseek-v4-flash 渠道不认的 Codex 协议字段后转发。
// 处理: 非 function 工具(web_search/namespace 等)、reasoning 对象、include、store。
const http = require('http');
const https = require('https');
const fs = require('fs');

const UP = 'router.flatkey.ai';
const PORT = Number(process.env.CODEX_PROXY_PORT || 3128);
const LOG = process.env.CODEX_PROXY_LOG || '/tmp/codex-proxy.log';

function log(line) {
  fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`);
}

// 白名单：只放行 deepseek Responses 兼容层认识的标准字段
const TOP_WHITELIST = new Set([
  'model', 'input', 'instructions', 'tools', 'tool_choice',
  'parallel_tool_calls', 'stream', 'temperature', 'top_p',
  'max_output_tokens', 'metadata',
]);

function sanitize(j) {
  const removed = [];
  for (const k of Object.keys(j)) {
    if (!TOP_WHITELIST.has(k)) {
      delete j[k];
      removed.push(k);
    }
  }
  if (Array.isArray(j.tools)) {
    const before = j.tools.length;
    j.tools = j.tools.filter((t) => t && t.type === 'function');
    if (j.tools.length !== before) removed.push(`tools ${before}-> ${j.tools.length}`);
  }
  // 多轮请求的 input item：deepseek 兼容层要求 status 字段，codex 不发
  if (Array.isArray(j.input)) {
    let patched = 0;
    for (const item of j.input) {
      if (item && typeof item === 'object' && !('status' in item)) {
        item.status = 'completed';
        patched++;
      }
    }
    if (patched) removed.push(`input.status x${patched}`);
  }
  if (removed.length) log(`sanitized ${j.model || '?'}: ${removed.join(', ')}`);
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('error', () => {});
  req.on('end', () => {
    if (req.method === 'POST' && req.url.includes('/responses') && body) {
      try {
        const j = JSON.parse(body);
        sanitize(j);
        body = JSON.stringify(j);
      } catch (e) {
        log(`parse fail: ${e.message}`);
      }
    }
    const headers = { ...req.headers, host: UP };
    delete headers['content-length'];
    headers['content-length'] = Buffer.byteLength(body);
    const upReq = https.request(
      { hostname: UP, path: req.url, method: req.method, headers },
      (upRes) => {
        log(`-> ${req.method} ${req.url} ${upRes.statusCode}`);
        res.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(res);
      },
    );
    upReq.on('error', (e) => {
      log(`upstream error: ${e.message}`);
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`codex-proxy upstream error: ${e.message}`);
    });
    upReq.end(body);
  });
});

server.listen(PORT, '127.0.0.1', () => log(`proxy listening on ${PORT}`));
process.on('SIGTERM', () => {
  log('shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000);
});
