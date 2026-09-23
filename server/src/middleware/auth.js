import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'

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
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!token) {
    res.status(401).json({ error: '未登录，请先认证', code: 'NO_TOKEN' })
    return
  }
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
