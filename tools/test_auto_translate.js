#!/usr/bin/env node
// auto_translate.js 单元测试
const assert = require('assert')
const { translateText, extractPlaceholders } = require('./auto_translate.js')

console.log('auto_translate 自测\n')

const mockDict = {
  exact: { 'Save': '保存', 'Cancel': '取消' },
  template: {},
  code: {},
  pattern: {},
}

// 1. 基础 UI 词汇翻译
assert.strictEqual(translateText('Save', 'exact', mockDict), '保存', '精确匹配已有词典')
assert.strictEqual(translateText('Export', 'exact', mockDict), '导出', '基础 UI 动词')
assert.strictEqual(translateText('Check for updates', 'exact', mockDict), '检查更新', '长短语命中')

// 2. 核心术语对齐（thread 绝不能翻成线程）
const threadRes = translateText('Close thread', 'exact', mockDict)
assert.ok(threadRes.includes('会话'), 'thread 必须翻译为「会话」')
assert.ok(!threadRes.includes('线程'), 'thread 绝不能包含「线程」')

const agentRes = translateText('Agent settings', 'exact', mockDict)
assert.ok(agentRes.includes('智能体'), 'agent 必须翻译为「智能体」')
assert.ok(agentRes.includes('设置'), 'settings 必须翻译为「设置」')

// 3. 代码分区保持不动 (G1 规则)
assert.strictEqual(translateText('some_internal_code', 'code', mockDict), 'some_internal_code', 'code 分区必须严格保持原样')

// 4. 模板插值严格保护
const tplKey = 'Connecting to ${e.server}...'
const tplRes = translateText(tplKey, 'template', mockDict)
assert.ok(tplRes.includes('${e.server}'), '模板插值必须完整保留')
assert.ok(tplRes.includes('正在连接'), '模板前缀应当被翻译')

// 5. 占位符提取测试
const phs = extractPlaceholders('Hello ${name}, you have ${count} items')
assert.deepStrictEqual(phs, ['${name}', '${count}'], '正确提取两个模板占位符')

console.log('✓ auto_translate 全部 5 组测试通过！')
process.exit(0)
