#!/usr/bin/env node
/**
 * 星云企微 SCRM · MCP Server — stdio 模式
 *
 * 被本地 AI 助手（Trae / Claude Desktop / Copilot）直接拉起。
 *
 * 启动方式：
 *   node src/mcp-server.js
 *   SCRM_MCP_READONLY=true node src/mcp-server.js   # 只读模式
 *
 * 配置给 AI 助手：
 *   { "mcpServers": { "scrm": { "command": "node", "args": ["/path/to/server/src/mcp-server.js"] } } }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createScrmMcpServer, MCP_TOOL_NAMES } from './mcp-tools.js'

const readOnly = process.env.SCRM_MCP_READONLY === 'true'
const server = createScrmMcpServer({ readOnly })

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[scrm-mcp] ✅ 星云企微 SCRM MCP Server 已启动 (stdio)\n')
  process.stderr.write(`[scrm-mcp]   模式: ${readOnly ? '只读（SCRM_MCP_READONLY=true）' : '读写（无限制）'}\n`)
  process.stderr.write(`[scrm-mcp]   Tools (${MCP_TOOL_NAMES.length}): ${MCP_TOOL_NAMES.join(', ')}\n`)
}

main().catch((e) => {
  process.stderr.write(`[scrm-mcp] fatal: ${e.message}\n`)
  process.exit(1)
})
