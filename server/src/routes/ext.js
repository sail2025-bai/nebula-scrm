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

// === 3. 商城下单（端到端事务：库存 + 订单 + 券 + 清购物车）===
// body: { customer_code, order_no, order_amount, issue_id? / code?, channel?,
//         items: [{ product_id, quantity, price }]  — 商品明细（不传则只走券核销） }
router.post('/order-place', (req, res) => {
  const { customer_code, order_no, order_amount, issue_id, code, channel, items, clear_cart = true, address_id } = req.body
  if (!customer_code) return res.status(400).json({ error: 'customer_code 必填' })
  if (!order_no) return res.status(400).json({ error: 'order_no 必填' })
  if (!order_amount || Number(order_amount) <= 0) return res.status(400).json({ error: 'order_amount 非法' })

  const customer = db.prepare('SELECT * FROM customers WHERE code = ?').get(customer_code)
  if (!customer) return res.status(404).json({ error: '客户不存在' })

  // 地址解析（可传 address_id，后端查快照；也可以不传，订单就没地址）
  let addressSnapshot = null
  let finalAddressId = null
  if (address_id) {
    const addr = db.prepare('SELECT * FROM addresses WHERE id = ? AND customer_id = ?').get(Number(address_id), customer.id)
    if (!addr) return res.status(400).json({ error: '地址不存在或不属于该客户' })
    finalAddressId = addr.id
    addressSnapshot = JSON.stringify(addr)
  }

  // 幂等：同订单号重复调用返回首次结果
  const existedOrder = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(order_no)
  if (existedOrder) {
    return res.json({ ok: true, idempotent: true, order_id: existedOrder.id })
  }

  // === 商品明细校验（不传 items 则走老的纯券核销路径）===
  let validatedItems = []
  let cartItemIds = []

  if (Array.isArray(items) && items.length > 0) {
    for (const it of items) {
      const productId = Number(it.product_id)
      const qty = Number(it.quantity)
      if (!productId || !qty || qty <= 0) {
        return res.status(400).json({ error: `商品参数非法: product_id=${productId}, quantity=${qty}` })
      }
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(productId)
      if (!p) return res.status(400).json({ error: `商品不存在或已下架 (id=${productId})` })
      if (p.stock < qty) return res.status(409).json({ error: `「${p.name}」库存不足，仅剩 ${p.stock}` })
      // item 里如果传了 price 且合法就用，否则用商品当前 price（前端可以传秒杀价）
      const price = it.price && Number(it.price) > 0 ? Number(it.price) : Number(p.price)
      validatedItems.push({ product_id: p.id, quantity: qty, price, name: p.name, image: p.image_url })
    }

    // 查出对应 cart_items id（清购物车用）
    cartItemIds = db.prepare(
      `SELECT ci.id FROM cart_items ci WHERE ci.customer_id = ? AND ci.product_id IN (${validatedItems.map(() => '?').join(',')})`
    ).all(customer.id, ...validatedItems.map((it) => it.product_id)).map((r) => r.id)
  }

  let usedIssue = null
  let usedCoupon = null
  let saved = 0

  // === 券校验 ===
  if (issue_id || code) {
    usedIssue = issue_id
      ? db.prepare("SELECT * FROM coupon_issues WHERE id = ? AND status = 'pending'").get(issue_id)
      : db.prepare("SELECT * FROM coupon_issues WHERE code = ? AND status = 'pending'").get(code)
    if (!usedIssue) return res.status(400).json({ error: '券不存在、已核销或已失效' })
    if (usedIssue.customer_id !== customer.id) return res.status(400).json({ error: '券不属于该客户' })
    usedCoupon = db.prepare('SELECT * FROM coupons WHERE id = ? AND active = 1').get(usedIssue.coupon_id)
    if (!usedCoupon) return res.status(400).json({ error: '券模板已下架' })
    if (Number(order_amount) < usedCoupon.min_order) {
      return res.status(400).json({ error: `未达使用门槛￥${usedCoupon.min_order}` })
    }
    if (usedCoupon.type === 'cash') saved = usedCoupon.value
    else if (usedCoupon.type === 'percent') saved = Number(order_amount) * usedCoupon.value / 100
    else saved = usedCoupon.value
    saved = Number(saved.toFixed(2))
  }

  // === 原子事务 ===
  const finalAmount = Number(order_amount) - saved
  const finalChannel = channel || '微商城'
  let orderId = null
  let redemptionId = null

  const tx = db.transaction(() => {
    // 1. 扣库存 + 增加销量

    // 2. 写订单主表（商品多则拼接 product_name 做快照，运营后台兼容）
    let productNameSnapshot = null
    let productImageSnapshot = null
    if (validatedItems.length > 0) {
      productNameSnapshot = validatedItems.slice(0, 3).map((it) => `${it.name}×${it.quantity}`).join('、')
      if (validatedItems.length > 3) productNameSnapshot += ` 等${validatedItems.length}件`
      productImageSnapshot = validatedItems[0].image
    }

    const r = db.prepare(`INSERT INTO orders
      (order_no, customer_id, staff_id, amount, paid_amount, discount, coupon_code,
       source, status, product_name, product_image, item_count, items_json, remark, order_at, paid_at,
       address_id, address_snapshot)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      order_no, customer.id, null,
      Number(order_amount), Number(finalAmount.toFixed(2)), saved,
      usedIssue ? usedCoupon.name : null,
      finalChannel, 'pending',
      productNameSnapshot, productImageSnapshot,
      validatedItems.length,
      validatedItems.length > 0 ? JSON.stringify(validatedItems.map(it => ({ p: it.product_id, n: it.name, q: it.quantity, pr: it.price }))) : null,
      null, now(), null,      // remark=null, order_at=now(), paid_at=null (等支付成功回调写)
      finalAddressId, addressSnapshot
    )
    orderId = Number(r.lastInsertRowid)

    // 3. 写订单明细
    for (const it of validatedItems) {
      db.prepare(`INSERT INTO order_items
        (order_id, product_id, product_name, product_image, price, quantity, subtotal)
        VALUES (?,?,?,?,?,?,?)`).run(
        orderId, it.product_id, it.name, it.image, it.price, it.quantity,
        Number((it.price * it.quantity).toFixed(2))
      )
    }

    // 4. 核销券移到支付成功后（pay.js finalizeOrderPaid），pending 不落券核销

    // 5. 清对应购物车项
    if (clear_cart && cartItemIds.length > 0) {
      const placeholders = cartItemIds.map(() => '?').join(',')
      db.prepare(`DELETE FROM cart_items WHERE id IN (${placeholders})`).run(...cartItemIds)
    }

    // 6. 更新客户画像移到支付成功后
    return {}
  })()

  // 7. 发 SOP 事件（首单触发新客 SOP、消费达标触发复购 SOP——sop-engine 那边订阅 orders）
  // 这里只做事务内的落库，事件派发交给 scheduler 统一处理

  res.json({
    ok: true,
    order_id: orderId,
    order_no,
    order_amount: Number(order_amount),
    saved_amount: saved,
    final_pay_amount: Number(finalAmount.toFixed(2)),
    item_count: validatedItems.length,
    items: validatedItems.map((it) => ({ product_id: it.product_id, name: it.name, quantity: it.quantity, price: it.price })),
    coupon_used: usedIssue ? { issue_id: usedIssue.id, code: usedIssue.code, coupon_name: usedCoupon.name } : null,
    pay_required: true,           // 需要调微信支付（0 元订单除外，pay.js 会自动 finalize）
    channel: finalChannel
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
