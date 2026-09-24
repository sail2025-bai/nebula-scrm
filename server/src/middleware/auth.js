import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { db } from '../db.js'

const API_TOKEN_PREFIX = 'neb_'
const API_TOKEN_SCOPE_LEVELS = { read: 1, write: 2, admin: 3 }

function hashApiToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// === JWT 工具 & 鉴权中间件 ===
// - 生产环境通过环境变量 JWT_SECRET 注入
// - 开发环境自动生成一个随机 secret（每次重启失效）
// - 所有 /api/auth 和 /api/public 路由放行，由 index.js 挂载顺序控制

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex')
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET)
}

/**
 * 鉴权中间件：从 Authorization: Bearer xxx 提取 token 并校验
 * 放行条件：无 token 或 token 无效 → 401
 */
export function requireAuth(req, res, next) {
  const header = req.header('Authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : (req.header('X-API-Key') || '').trim()
  if (!token) {
    res.status(401).json({ error: '未登录，请先认证', code: 'NO_TOKEN' })
    return
  }

  // === 双模式鉴权：neb_ 前缀 = API Token（外部 ERP/CRM 对接）；否则 = JWT ===
  if (token.startsWith(API_TOKEN_PREFIX)) {
    // API Token 分支
    const row = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').get(hashApiToken(token))
    if (!row) {
      res.status(401).json({ error: '无效的 API Token', code: 'TOKEN_INVALID' })
      return
    }
    if (row.revoked_at) {
      res.status(403).json({ error: `此 API Token 已被撤销：${row.revoked_reason || '无原因'}`, code: 'TOKEN_REVOKED' })
      return
    }
    if (row.expires_at && row.expires_at < new Date().toISOString().slice(0, 19)) {
      res.status(403).json({ error: 'API Token 已过期', code: 'TOKEN_EXPIRED' })
      return
    }
    db.prepare('UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id)
    const scopes = (row.scopes || 'read').split(',').map((s) => s.trim())
    req.apiToken = { id: row.id, name: row.name, scopes }
    req.user = { id: row.created_by, account: `api:${row.name}`, role: 'api', businessMode: null }
    next()
    return
  }

  // JWT 分支（原有逻辑）
  try {
    const payload = verifyToken(token)
    req.user = {
      id: payload.id,
      account: payload.account,
      name: payload.name,
      businessMode: payload.businessMode,
      wecomUserid: payload.wecomUserid || null,
      role: payload.role || 'user'
    }
    next()
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      res.status(401).json({ error: '登录已过期，请重新登录', code: 'TOKEN_EXPIRED' })
    } else {
      res.status(401).json({ error: '无效的登录凭证', code: 'TOKEN_INVALID' })
    }
  }
}

/**
 * 可选鉴权：有 token 就解析挂 req.user，没有也放行（公开接口用）
 */
export function optionalAuth(req, res, next) {
  const header = req.header('Authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (token) {
    try {
      const payload = verifyToken(token)
      req.user = { id: payload.id, account: payload.account }
    } catch {
      // 忽略
    }
  }
  next()
}
