import { db } from '../db.js'

// === IP 白名单中间件 ===
// - 从 wecom_config 读取允许的 IP 列表（逗号分隔）
// - 支持企微回调 IP / 视频号小店回调 IP 分别配置
// - 未配置白名单时 **默认全部放行**（开发模式安全；生产必须配置）

export function ipWhitelist(fieldName, { allowIfEmpty = true } = {}) {
  return (req, res, next) => {
    const cfg = db.prepare('SELECT * FROM wecom_config WHERE id = 1').get() || {}
    const raw = cfg[fieldName] || ''
    const allowed = String(raw).split(',').map((s) => s.trim()).filter(Boolean)

    if (!allowed.length) {
      if (allowIfEmpty) return next()
      return res.status(403).json({ error: 'IP 白名单未配置' })
    }

    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      (req.headers['x-real-ip'] || '').trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      ''

    // 支持 CIDR（如 10.0.0.0/8）和精确匹配
    const ok = allowed.some((rule) => matchIp(rule, ip))
    if (!ok) {
      res.status(403).json({ error: 'IP 不在白名单', ip, allowed: allowed.join(',') })
      return
    }
    next()
  }
}

function matchIp(rule, ip) {
  if (!rule || !ip) return false
  if (!rule.includes('/')) return rule === ip || rule === '*'

  // CIDR 匹配（IPv4）
  const [net, bitsStr] = rule.split('/')
  const bits = parseInt(bitsStr, 10)
  if (isNaN(bits) || bits < 0 || bits > 32) return false
  const netInt = ipToInt(net)
  const ipInt = ipToInt(ip)
  if (netInt === null || ipInt === null) return false
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (netInt & mask) === (ipInt & mask)
}

function ipToInt(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return null
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}
