import { db } from '../db.js'

/**
 * customerRepo — 客户数据访问层
 *
 * 封装客户档案相关的复用查询 + 画像刷新逻辑，
 * 让 routes/customers.js、routes/orders.js、webhook 共享同一份客户匹配策略。
 */

// —— 详情聚合：客户 + 标签 + 跟进计数 ——
const qTags = db.prepare('SELECT t.id, t.name, t.category FROM customer_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.customer_id = ? ORDER BY t.id')
const qFollowCount = db.prepare('SELECT COUNT(*) AS n FROM follow_ups WHERE customer_id = ?')
const qLastFollow = db.prepare('SELECT created_at FROM follow_ups WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1')
const qCustomer = db.prepare('SELECT customers.*, s.name AS staffName FROM customers LEFT JOIN staff s ON s.id = customers.staff_id WHERE customers.id = ?')

export function enrichCustomer(row) {
  if (!row) return null
  const lf = qLastFollow.get(row.id)
  return {
    ...row,
    tags: qTags.all(row.id),
    followupCount: qFollowCount.get(row.id).n,
    lastFollowupAt: lf ? lf.created_at : null
  }
}

export function getCustomerById(id) {
  const row = qCustomer.get(Number(id))
  return enrichCustomer(row)
}

// —— webhook / 外部回调里的客户匹配（3 级降级）——
// 1) 手机号精确 11 位 / 脱敏号尾段匹配
// 2) openid 模糊匹配 wechat_nick / notes / ext_openid
// 3) 姓名模糊兜底
export function normPhone(p) {
  if (!p) return null
  const digits = String(p).replace(/\D/g, '')
  if (digits.length === 11 || digits.length === 7) return digits
  // 脱敏号 138****0001 → 取前后段
  const masked = String(p).replace(/[^\d*]/g, '')
  const m = masked.match(/(\d{4})\*{1,4}(\d{4})$/)
  if (m) return m[1] + m[2]
  return digits || null
}

export function matchCustomer({ phone, openid, name }) {
  // 1) 手机号
  const phoneNorm = normPhone(phone)
  if (phoneNorm) {
    let c
    if (phoneNorm.length === 11) {
      c = db.prepare('SELECT * FROM customers WHERE phone = ? LIMIT 1').get(phoneNorm)
    } else if (phoneNorm.length >= 7) {
      c = db.prepare('SELECT * FROM customers WHERE phone LIKE ? OR phone LIKE ? LIMIT 1').get(
        `%${phoneNorm}`, phoneNorm + '%'
      )
    }
    if (c) return c
  }

  // 2) openid / 企微外部联系人 id / 视频号 openid
  if (openid) {
    const c = db.prepare(`
      SELECT * FROM customers
      WHERE wechat_nick LIKE ? OR notes LIKE ? OR ext_openid = ? OR wecom_external_userid = ?
      LIMIT 1
    `).get(`%${openid}%`, `%${openid}%`, openid, openid)
    if (c) return c
  }

  // 3) 姓名兜底
  if (name) {
    const c = db.prepare('SELECT * FROM customers WHERE name LIKE ? OR wechat_nick LIKE ? LIMIT 1').get(
      `%${name}%`, `%${name}%`
    )
    if (c) return c
  }

  return null
}

// —— 基本 CRUD（供 routes/customers.js 渐进迁移，暂不强制替换）——
export function findById(id) {
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(id))
}

export function findByCode(code) {
  return db.prepare('SELECT * FROM customers WHERE code = ?').get(code)
}

export function findByPhone(phone) {
  return db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone)
}
