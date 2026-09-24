/**
 * MCP HTTP Router — StreamableHTTP + SSE 双入口
 *
 * 让远程 AI 助手（豆包 / 火山方舟 Agent / Dify Coze Bot / 任何 HTTP MCP 客户端）
 * 通过 HTTP 调用星云企微 SCRM 的 16 个 tools。
 *
 * 路由：
 *   POST /api/mcp          ← Streamable HTTP (2025-11-25)  豆包/火山方舟首选
 *   GET  /api/mcp          ← 返回 405 或 SSE 协商
 *   GET  /api/mcp/sse      ← 老版 SSE (2024-11-05) 建立流
 *   POST /api/mcp/messages ← 老版 SSE 发送消息
 *
 * 鉴权：
 *   所有 MCP 请求通过 Authorization: Bearer <token> 保护
 *   Token 在 SCRM 前端 "开放平台" 页生成，对应 api_tokens 表
 *   只读 token (scope=read) 会自动切换 readOnly 模式
 */

import { Router } from 'express'
import crypto from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { createScrmMcpServer, MCP_TOOL_NAMES } from './mcp-tools.js'
import { db } from './db.js'

const router = Router()

// =====================================================================
// 鉴权中间件：Bearer Token → api_tokens 表
// =====================================================================

function verifyBearerToken(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!auth || !auth.startsWith('Bearer ')) return { ok: false, reason: 'Missing Authorization Bearer' }
  const token = auth.slice(7).trim()
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  const row = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').get(hash)
  if (!row) return { ok: false, reason: 'Token not found' }
  if (row.revoked_at) return { ok: false, reason: 'Token revoked' }
  if (row.expires_at && new Date(row.expires_at) < new Date()) return { ok: false, reason: 'Token expired' }
  // 更新 last_used_at
  db.prepare('UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id)
  return { ok: true, token: row }
}

// =====================================================================
// Streamable HTTP (2025-11-25) — 豆包 / 火山方舟 / Trae 远程 都支持
// =====================================================================

router.all('/', async (req, res) => {
  // 鉴权（GET 不带 body 也要鉴权）
  const auth = verifyBearerToken(req)
  if (!auth.ok) {
    return res.status(401).json({
      jsonrpc: '2.0', error: { code: -32001, message: auth.reason }, id: null
    })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      jsonrpc: '2.0', error: { code: -32000, message: 'Use POST /api/mcp' }, id: null
    })
  }

  const readOnly = auth.token.scopes === 'read'
  const server = createScrmMcpServer({ readOnly })
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })

  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
    res.on('close', () => {
      try { transport.close() } catch {}
      try { server.close() } catch {}
    })
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0', error: { code: -32603, message: e.message }, id: null
      })
    }
  }
})

// =====================================================================
// 老版 SSE (2024-11-05) — 兼容 Claude Desktop / Dify 旧客户端
// =====================================================================

// 有状态：维护 sessionId → { transport, server } 映射
const sseSessions = new Map()

router.get('/sse', async (req, res) => {
  const auth = verifyBearerToken(req)
  if (!auth.ok) return res.status(401).end(auth.reason)

  const readOnly = auth.token.scopes === 'read'
  const server = createScrmMcpServer({ readOnly })
  const transport = new SSEServerTransport('/api/mcp/messages', res)

  try {
    await server.connect(transport)
    const sessionId = crypto.randomUUID()
    sseSessions.set(sessionId, { transport, server })

    // 告诉客户端 session id
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()
    res.write(`event: endpoint\ndata: /api/mcp/messages?sessionId=${sessionId}\n\n`)
    res.write(`event: session_created\ndata: ${sessionId}\n\n`)

    req.on('close', () => {
      const s = sseSessions.get(sessionId)
      if (s) {
        try { s.transport.close() } catch {}
        try { s.server.close() } catch {}
        sseSessions.delete(sessionId)
      }
    })
  } catch (e) {
    try { res.end(e.message) } catch {}
  }
})

router.post('/messages', async (req, res) => {
  const auth = verifyBearerToken(req)
  if (!auth.ok) return res.status(401).json({ error: auth.reason })

  const sessionId = req.query.sessionId
  const s = sseSessions.get(sessionId)
  if (!s) return res.status(404).json({ error: 'Session not found' })

  try {
    await s.transport.handleMessage(req.body)
    res.status(202).send('Accepted')
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// =====================================================================
// 健康检查 + tool 清单（公开，便于 AI 客户端探测）
// =====================================================================

router.get('/info', (req, res) => {
  res.json({
    name: '星云企微 SCRM',
    version: '1.0.0',
    tools: MCP_TOOL_NAMES.length,
    tool_names: MCP_TOOL_NAMES,
    transports: ['streamable-http', 'sse'],
    endpoints: {
      streamable_http: 'POST /api/mcp',
      sse: 'GET /api/mcp/sse',
      messages: 'POST /api/mcp/messages?sessionId=...'
    }
  })
})

export default router
