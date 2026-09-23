import express from 'express'
import { db, initSchema, now, fmt } from '../db.js'

initSchema()
const router = express.Router()

// === 外部系统对接接口（/api/ext/*）===
// 给微商城、外卖平台、POS 收银等第三方系统调用的接口
// API Key 校验：从 wecom_config.ext_api_key 读取；如果未配置，允许空 key 调用（开发模式）

function extAuth(req, res, next) {
  const cfg = db.prepare('SELECT ext_api_key FROM wecom_config WHERE id = 1').get()
  const serverKey = cfg?.ext_api_key
  // 没配 key 则开发模式放行
  if (!serverKey) return next()
  const clientKey = req.header('X-API-Key') || req.query.api_key
  if (!clientKey || clientKey !== serverKey) {
    return res.status(401).json({ ok: false, error: 'API Key 无效' })
  }
  next()
}
router.use(extAuth)

// === 1. 查询客户可用券 ===
// 第三方商城在客户结算页调这个，展示"你有 N 张可用券"
// GET /api/ext/customer/:customerCode/coupons?amount=199
router.get('/customer/:code/coupons', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE code = ?').get(req.params.code)
  if (!customer) return res.status(404).json({ error: '客户不存在' })

  const amount = Number(req.query.amount) || 0

  const rows = db.prepare(`
    SELECT ci.id, ci.code, ci.status, ci.source,
      c.name AS coupon_name, c.type, c.value, c.min_order, c.description,
      c.total_stock, c.issued_count, c.redeemed_count, c.end_at,
      ci.expires_at
    FROM coupon_issues ci
    JOIN coupons c ON c.id = ci.coupon_id
    WHERE ci.customer_id = ?
      AND ci.status = 'pending'
      AND c.active = 1
      AND c.issued_count < c.total_stock
      AND (ci.expires_at IS NULL OR ci.expires_at >= ?)
    ORDER BY c.min_order ASC, c.value DESC
  `).all(customer.id, now())

  // 过滤掉不满足门槛的券（如果传了 amount）
  const valid = rows.map(r => {
    let effective = true
    let reason = ''
    if (amount && amount < r.min_order) {
      effective = false
      reason = `需满￥${r.min_order}可用`
    }
    let saved = 0
    if (effective) {
      if (r.type === 'cash') saved = r.value
      else if (r.type === 'percent') saved = amount * r.value / 100
      else saved = r.value
    }
    return {
      issue_id: r.id,
      code: r.code,
      coupon_name: r.coupon_name,
      type: r.type,
      value: r.value,
      min_order: r.min_order,
      description: r.description,
      effective,
      reason,
      saved_amount: Number(saved.toFixed(2)),
      expires_at: r.expires_at,
      source: r.source
    }
  })

  res.json({
    ok: true,
    customer: { code: customer.code, name: customer.name },
    order_amount: amount,
    coupons: valid,
    available_count: valid.filter((c) => c.effective).length
  })
})

// === 2. 校验券码有效性（收银员/外部系统扫券码时用）===
// GET /api/ext/coupon-validity/:code?amount=199
router.get('/coupon-validity/:code', (req, res) => {
  const issue = db.prepare('SELECT * FROM coupon_issues WHERE code = ?').get(req.params.code)
  if (!issue) return res.status(404).json({ ok: false, error: '券码不存在' })
  if (issue.status !== 'pending') return res.json({ ok: false, error: `券已${issue.status === 'used' ? '核销' : '失效'}`, status: issue.status })

  const coupon = db.prepare('SELECT * FROM coupons WHERE id = ? AND active = 1').get(issue.coupon_id)
  if (!coupon) return res.status(400).json({ ok: false, error: '券模板已下架' })

  const amount = Number(req.query.amount) || 0
  if (amount && amount < coupon.min_order) {
    return res.json({ ok: false, error: `未达使用门槛￥${coupon.min_order}`, min_order: coupon.min_order })
  }

  let saved = 0
  if (coupon.type === 'cash') saved = coupon.value
  else if (coupon.type === 'percent') saved = amount * coupon.value / 100
  else saved = coupon.value

  const customer = db.prepare('SELECT id, code, name FROM customers WHERE id = ?').get(issue.customer_id)

  res.json({
    ok: true,
    coupon: {
      id: coupon.id,
      name: coupon.name,
      type: coupon.type,
      value: coupon.value,
      min_order: coupon.min_order
    },
    issue: { id: issue.id, code: issue.code, expires_at: issue.expires_at, source: issue.source },
    customer: customer || null,
    saved_amount: Number(saved.toFixed(2)),
    order_amount: amount
  })
})

// === 3. 商城下单带券核销（外部商城系统调用）===
// body: { customer_code, order_no, order_amount, issue_id? OR code?, channel?, items: [{name, price, qty}] }
router.post('/order-place', (req, res) => {
  const { customer_code, order_no, order_amount, issue_id, code, channel, items } = req.body
  if (!customer_code) return res.status(400).json({ error: 'customer_code 必填' })
  if (!order_no) return res.status(400).json({ error: 'order_no 必填' })
  if (!order_amount || Number(order_amount) <= 0) return res.status(400).json({ error: 'order_amount 非法' })

  const customer = db.prepare('SELECT * FROM customers WHERE code = ?').get(customer_code)
  if (!customer) return res.status(404).json({ error: '客户不存在' })

  // 幂等：同订单号重复调用返回首次结果
  const existed = db.prepare('SELECT * FROM coupon_redemptions WHERE order_no = ?').get(order_no)
  if (existed) {
    return res.json({ ok: true, idempotent: true, redemption: existed })
  }

  let usedIssue = null
  let usedCoupon = null
  let saved = 0

  // 如果带了券：校验 + 核销
  if (issue_id || code) {
    usedIssue = issue_id
      ? db.prepare("SELECT * FROM coupon_issues WHERE id = ? AND status = 'pending'").get(issue_id)
      : db.prepare("SELECT * FROM coupon_issues WHERE code = ? AND status = 'pending'").get(code)

    if (!usedIssue) {
      return res.status(400).json({ error: '券不存在、已核销或已失效' })
    }
    if (usedIssue.customer_id !== customer.id) {
      return res.status(400).json({ error: '券不属于该客户' })
    }

    usedCoupon = db.prepare('SELECT * FROM coupons WHERE id = ? AND active = 1').get(usedIssue.coupon_id)
    if (!usedCoupon) return res.status(400).json({ error: '券模板已下架' })
    if (Number(order_amount) < usedCoupon.min_order) {
      return res.status(400).json({ error: `未达使用门槛￥${usedCoupon.min_order}` })
    }

    // 计算节省
    if (usedCoupon.type === 'cash') saved = usedCoupon.value
    else if (usedCoupon.type === 'percent') saved = Number(order_amount) * usedCoupon.value / 100
    else saved = usedCoupon.value
    saved = Number(saved.toFixed(2))
  }

  // 原子事务：核销券 + 更新客户 + 记录订单
  const finalAmount = Number(order_amount) - saved
  let redemptionId = null
  const finalChannel = channel || '外部商城'

  const tx = db.transaction(() => {
    if (usedIssue) {
      db.prepare("UPDATE coupon_issues SET status = 'used', source = ? WHERE id = ?").run(
        `ext:${finalChannel}`,
        usedIssue.id
      )
      db.prepare('UPDATE coupons SET redeemed_count = redeemed_count + 1 WHERE id = ?').run(usedCoupon.id)
      const r = db.prepare(`INSERT INTO coupon_redemptions
        (issue_id, coupon_id, customer_id, order_no, order_amount, saved_amount, redemption_channel)
        VALUES (?,?,?,?,?,?,?)`).run(usedIssue.id, usedCoupon.id, customer.id, order_no, Number(order_amount), saved, finalChannel)
      redemptionId = r.lastInsertRowid
    }

    // 更新客户消费画像（积分、消费额、订单数）
    const wasFirst = customer.orders === 0
    db.prepare(`UPDATE customers
      SET orders = orders + 1, spend = spend + ?, last_active = ?, updated_at = ?
      WHERE id = ?`).run(finalAmount, now(), now(), customer.id)

    return { wasFirst }
  })()

  res.json({
    ok: true,
    order_no,
    order_amount: Number(order_amount),
    saved_amount: saved,
    final_pay_amount: Number(finalAmount.toFixed(2)),
    coupon_used: usedIssue ? {
      issue_id: usedIssue.id,
      code: usedIssue.code,
      coupon_name: usedCoupon.name
    } : null,
    redemption_id: redemptionId,
    was_first_purchase: tx.wasFirst ? true : undefined,
    channel: channel || 'api'
  })
})

// === 4. 查客户消费 + 券核销历史 ===
// GET /api/ext/customer/:code/history?limit=20
router.get('/customer/:code/history', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE code = ?').get(req.params.code)
  if (!customer) return res.status(404).json({ error: '客户不存在' })

  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))

  const redemptions = db.prepare(`
    SELECT cr.*, c.name AS coupon_name, ci.code AS coupon_code, ci.source AS coupon_source
    FROM coupon_redemptions cr
    JOIN coupons c ON c.id = cr.coupon_id
    JOIN coupon_issues ci ON ci.id = cr.issue_id
    WHERE cr.customer_id = ?
    ORDER BY cr.redeemed_at DESC
    LIMIT ?
  `).all(customer.id, limit)

  res.json({
    ok: true,
    customer: { code: customer.code, name: customer.name, total_orders: customer.orders, total_spend: customer.spend },
    redemptions
  })
})

export default router
