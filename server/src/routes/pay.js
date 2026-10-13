import express from 'express'
import { db, initSchema } from '../db.js'
import { createPaymentProvider, PaymentError } from '../utils/payment/provider.js'
import { emit as emitEvent } from '../utils/events.js'

initSchema()
const router = express.Router()


// 拿 provider（每次请求都读最新配置，运营后台改商户号后秒生效）
function getProvider() {
  const wc = db.prepare('SELECT * FROM wecom_config LIMIT 1').get()
  return createPaymentProvider(wc)
}

/**
 * POST /api/pay/wechat/jsapi —— JSAPI 统一下单
 * body: { order_no, customer_code, client_ip? }
 * 前置条件：order_no 必须是一个 status='pending' 的订单
 */
router.post('/wechat/jsapi', (req, res) => {
  
  const { order_no, customer_code } = req.body || {}
  if (!order_no) return res.status(400).json({ error: 'order_no 必填' })

  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(order_no)
  if (!order) return res.status(404).json({ error: '订单不存在' })
  if (order.status !== 'pending') {
    return res.status(400).json({ error: `订单状态是 ${order.status}，无法发起支付` })
  }
  if (order.paid_amount <= 0) {
    // 0 元订单直接落 paid，不用调微信
    finalizeOrderPaid(order.id, null)
    return res.json({ ok: true, freePaid: true })
  }

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id)
  const openid = customer?.ext_openid || customer?.wecom_external_userid || `CUST_${order.customer_id}`
  // 没有真实 openid 也能跑（MockWechatPay 不需要），但 RealWechatPay 需要

  const provider = getProvider()
  provider.jsapiPrepay({
    orderNo: order_no,
    amount: Number(order.paid_amount),
    openid,
    description: order.product_name || '逸云企微商城订单'
  }).then((result) => {
    // 把 prepay_id 存进订单，幂等回调时用来对照
    db.prepare('UPDATE orders SET prepay_id = ?, pay_method = ? WHERE id = ?')
      .run(result.prepay_id, 'wechat', order.id)
    res.json({ ok: true, jsapi: result })
  }).catch((e) => {
    console.error('[pay/jsapi]', e)
    res.status(500).json({ error: e.message || '统一下单失败' })
  })
})

/**
 * POST /api/pay/wechat/notify —— 微信支付结果回调
 * 真实环境：微信主动 POST 过来，body 是 XML 或 JSON（APIv3 是 JSON）
 * mock 环境：前端调 mock-success 也走这里
 */
router.post('/wechat/notify', express.text({ type: '*/*' }), (req, res) => {
  const provider = getProvider()
  let parsed
  try {
    parsed = provider.parseNotify(req.body, req.headers['wechatpay-signature'])
  } catch (e) {
    console.error('[pay/notify] 解析失败:', e.message)
    return res.status(400).send('FAIL')
  }

  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(parsed.orderNo)
  if (!order) {
    console.error('[pay/notify] 订单不存在:', parsed.orderNo)
    return res.status(404).send('FAIL')
  }

  // 幂等：已经 paid 了直接返回成功
  if (order.status === 'paid' || order.status === 'shipped' || order.status === 'completed') {
    return res.send('SUCCESS')
  }

  try {
    finalizeOrderPaid(order.id, parsed.transactionId)
    res.send('SUCCESS')
  } catch (e) {
    console.error('[pay/notify] finalize 失败:', e)
    res.status(500).send('FAIL')
  }
})

/**
 * POST /api/pay/wechat/mock-success —— 手动模拟支付成功（开发/测试用）
 * 生产环境可以禁用（加 ipWhitelist 或 status=mock 检查）
 * body: { order_no }
 */
router.post('/wechat/mock-success', (req, res) => {
  const { order_no } = req.body || {}
  if (!order_no) return res.status(400).json({ error: 'order_no 必填' })

  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(order_no)
  if (!order) return res.status(404).json({ error: '订单不存在' })
  if (order.status !== 'pending') {
    return res.status(400).json({ error: `订单状态是 ${order.status}，无法 mock 支付` })
  }

  const notifyBody = getProvider().buildMockNotify(order_no, Number(order.paid_amount))
  // 内部转发给 notify 处理器（直接调函数，不是 HTTP 调自己）
  const provider = getProvider()
  const parsed = provider.parseNotify(notifyBody)
  finalizeOrderPaid(order.id, parsed.transactionId)
  res.json({ ok: true, order_no, transaction_id: parsed.transactionId })
})

/**
 * GET /api/pay/wechat/status?order_no=X —— 轮询支付状态
 * 前端拉起微信支付后，每 2s 轮询一次，30s 超时
 */
router.get('/wechat/status', (req, res) => {
  const { order_no } = req.query
  if (!order_no) return res.status(400).json({ error: 'order_no 必填' })
  const o = db.prepare('SELECT id, order_no, status, paid_at, paid_amount, pay_method FROM orders WHERE order_no = ?').get(order_no)
  if (!o) return res.status(404).json({ error: '订单不存在' })
  res.json(o)
})

// =====================================================
// 订单支付成功的核心事务：扣库存 + 核销券 + 更新状态 + 写 paid_at
// order-place 现在只负责落 pending，这是"两阶段下单"的第二阶段
// =====================================================
function finalizeOrderPaid(orderId, transactionId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
  if (!order) throw new PaymentError('订单不存在')
  if (order.status !== 'pending') return // 幂等

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id)

  const tx = db.transaction(() => {
    // 1. 扣库存 + 增加销量（从 items_json 解析商品明细）
    let items = []
    try { items = order.items_json ? JSON.parse(order.items_json) : [] } catch {}
    for (const it of items) {
      if (it.p) {
        db.prepare('UPDATE products SET stock = stock - ?, sold = sold + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
          it.q || 1, it.q || 1, it.p
        )
      }
    }

    // 2. 核销优惠券（如果用了）
    let redemptionId = null
    if (order.coupon_code) {
      const issue = db.prepare(`
        SELECT ci.*, c.min_order FROM coupon_issues ci
        LEFT JOIN coupons c ON c.id = ci.coupon_id
        WHERE ci.code = ? AND ci.status = 'active'
      `).get(order.coupon_code)
      if (issue) {
        db.prepare('UPDATE coupon_issues SET status = ?, used_at = CURRENT_TIMESTAMP WHERE id = ?').run('used', issue.id)
        const r = db.prepare(`INSERT INTO coupon_redemptions (issue_id, order_id, order_no, customer_id, staff_id, amount)
          VALUES (?,?,?,?,?,?)`).run(issue.id, order.id, order.order_no, order.customer_id, order.staff_id, order.paid_amount)
        redemptionId = Number(r.lastInsertRowid)
      }
    }

    // 3. 更新订单状态 + paid_at + 交易号
    db.prepare(`UPDATE orders SET
      status = 'paid',
      paid_at = CURRENT_TIMESTAMP,
      transaction_id = ?
    WHERE id = ?`).run(transactionId, orderId)

    // 4. 更新客户画像
    db.prepare(`UPDATE customers SET
      orders = COALESCE(orders, 0) + 1,
      spend = COALESCE(spend, 0) + ?,
      last_active = CURRENT_TIMESTAMP
    WHERE id = ?`).run(Number(order.paid_amount), order.customer_id)

    // 5. 清购物车（如果 ext.js 没清）
    db.prepare('DELETE FROM cart_items WHERE customer_id = ?').run(order.customer_id)
  })

  tx()

  // 6. 事件（事务外，避免失败回滚已提交的支付）
  emitEvent('order_paid', {
    customer_id: order.customer_id, staff_id: order.staff_id,
    payload: JSON.stringify({ order_no: order.order_no, amount: order.paid_amount })
  })
}

export default router
