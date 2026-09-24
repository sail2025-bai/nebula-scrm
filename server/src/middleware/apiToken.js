import crypto from 'node:crypto'
import { db } from '../db.js'

/**
 * C3: API Token 工具 + 鉴权中间件
 *
 * 设计：
 * - token 格式：neb_<32字节随机base62>，比如 neb_a8Z9k2mN4pQ7xR1tY5v
 * - 数据库只存 SHA-256 哈希 + 前 8 位前缀（用于列表展示）
 * - scopes 逗号分隔：read,write,admin
 * - 与用户 JWT 完全独立（外部系统对接用 API Token，内部后台用 JWT）
 */

export const SCOPE_READ = 'read'
export const SCOPE_WRITE = 'write'
export const SCOPE_ADMIN = 'admin'

// 全 scope 的排序（scope 字符串比较时用）
function scopeLevel(s) {
  const m = { read: 1, write: 2, admin: 3 }
  return m[s] || 0
}

export function parseScopes(str) {
  return String(str || 'read').split(',').map((s) => s.trim()).filter((s) => scopeLevel(s) > 0)
}

export function hasScope(tokenScopes, required) {
  if (tokenScopes.includes(SCOPE_ADMIN)) return true
  return tokenScopes.includes(required)
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function generateToken() {
  const raw = crypto.randomBytes(32).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
  return `neb_${raw}`
}

export function createApiToken({ name, scopes = 'read', rate_limit = 60, expires_days = 365, created_by = null }) {
  const plain = generateToken()
  const hash = hashToken(plain)
  const prefix = plain.slice(0, 12) // neb_a8Z9k2m
  const expiresAt = expires_days
    ? new Date(Date.now() + Number(expires_days) * 86400000).toISOString().replace('T', ' ').slice(0, 19)
    : null
  const r = db.prepare(`
    INSERT INTO api_tokens (name, token_hash, token_prefix, scopes, rate_limit, expires_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, hash, prefix, scopes, Number(rate_limit) || 60, expiresAt, created_by)
  return { id: r.lastInsertRowid, plain, prefix, expires_at: expiresAt }
}

/**
 * API Token 鉴权中间件：
 * - Authorization: Bearer neb_xxx
 * - X-API-Key: neb_xxx
 */
export function requireApiToken(req, res, next) {
  const header = (req.header('Authorization') || '').startsWith('Bearer ')
    ? req.header('Authorization').slice(7).trim()
    : (req.header('X-API-Key') || '').trim()

  if (!header) {
    res.status(401).json({ error: 'API Token 缺失，请在 Authorization: Bearer <token> 或 X-API-Key 头里提供', code: 'NO_API_TOKEN' })
    return
  }

  const hash = hashToken(header)
  const row = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').get(hash)
  if (!row) {
    res.status(401).json({ error: '无效的 API Token', code: 'TOKEN_INVALID' })
    return
  }
  if (row.revoked_at) {
    res.status(403).json({ error: `此 API Token 已被撤销：${row.revoked_reason || '无原因'}`, code: 'TOKEN_REVOKED' })
    return
  }
  if (row.expires_at && row.expires_at < new Date().toISOString().slice(0, 19)) {
    res.status(403).json({ error: 'API Token 已过期，请联系管理员续期', code: 'TOKEN_EXPIRED' })
    return
  }

  // 更新 last_used_at
  db.prepare('UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id)

  // 可选 scope 检查（通过 res.locals.scopeMiddleware 或 route handler 里用）
  req.apiToken = {
    id: row.id,
    name: row.name,
    scopes: parseScopes(row.scopes),
    rate_limit: row.rate_limit,
    created_by: row.created_by
  }
  next()
}

/**
 * scope 守卫：放在 requireApiToken 之后，检查是否有足够权限
 * 用法：router.get('/customers', requireApiToken, requireScope('read'), ...)
 */
export function requireScope(required) {
  return (req, res, next) => {
    if (!req.apiToken) return res.status(401).json({ error: '未认证', code: 'NO_API_TOKEN' })
    if (!hasScope(req.apiToken.scopes, required)) {
      res.status(403).json({ error: `API Token 缺少 scope: ${required}（当前: ${req.apiToken.scopes.join(',')}）`, code: 'SCOPE_DENIED' })
      return
    }
    next()
  }
}
