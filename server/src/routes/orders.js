import express from 'express'
import { db, now } from '../db.js'
import { ipWhitelist } from '../middleware/ipWhitelist.js'
import * as orderRepo from '../repositories/orderRepo.js'
import * as customerRepo from '../repositories/customerRepo.js'
import { decryptEncryptedCallback, handleEcho } from '../utils/webhooks.js'

const router = express.Router()

const SOURCE_LABELS = {
  manual: '手动录入',
  seckill: '限时秒杀',
  coupon: '优惠券核销',
  channels_shop: '视频号小店',
  youzan: '有赞商城',
  weimeng: '微盟小程序',
  wecom_mini: '企微小程序',
  sop: 'SOP 自动触达',
  ext_api: '外部 API 同步'
}

const STATUS_META = {
  pending: { label: '待支付', color: 'bg-amber-100 text-amber-700' },
  paid: { label: '已支付', color: 'bg-blue-100 text-blue-700' },
  shipped: { label: '已发货', color: 'bg-indigo-100 text-indigo-700' },
  completed: { label: '已完成', color: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: '已取消', color: 'bg-slate-100 text-slate-500' },
  refunded: { label: '已退款', color: 'bg-rose-100 text-rose-700' }
}

function enrichOrder(row) {
  if (!row) return null
  return {
    ...row,
    source_label: SOURCE_LABELS[row.source] || row.source,
    status_label: STATUS_META[row.status]?.label || row.status,
    status_color: STATUS_META[row.status]?.color || 'bg-slate-100 text-slate-500'
  }
}

// === 全量列表 ===
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 20))
  const clauses = []
  const params = []
  const { status, source, customer_id, min_amount, start, end, search } = req.query
  if (status) { clauses.push('orders.status = ?'); params.push(status) }
  if (source) { clauses.push('orders.source = ?'); params.push(source) }
  if (customer_id) { clauses.push('orders.customer_id = ?'); params.push(Number(customer_id)) }
  if (min_amount) { clauses.push('orders.paid_amount >= ?'); params.push(Number(min_amount)) }
  if (start) { clauses.push('orders.order_at >= ?'); params.push(String(start)) }
  if (end) { clauses.push('orders.order_at <= ?'); params.push(String(end)) }
  if (search) {
    clauses.push('(orders.order_no LIKE ? OR orders.product_name LIKE ? OR customers.name LIKE ?)')
    const like = `%${search}%`
    params.push(like, like, like)
  }
  const join = ' LEFT JOIN customers ON customers.id = orders.customer_id'
  const whereSql = clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''
  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders${join}${whereSql}`).get(...params).n
  const rows = db.prepare(`
    SELECT orders.*, customers.name AS customerName, customers.wechat_nick AS customerWechat
    FROM orders${join}${whereSql}
    ORDER BY orders.order_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize)
  res.json({
    total,
    page,
    pageSize,
    list: rows.map(enrichOrder)
  })
})

// === 按客户查订单 ===
router.get('/customer/:id', (req, res) => {
  const customerId = Number(req.params.id)
  if (!Number.isInteger(customerId)) return res.status(400).json({ error: 'customer id 非法' })
  const rows = db.prepare(`
    SELECT orders.*, customers.name AS customerName
    FROM orders LEFT JOIN customers ON customers.id = orders.customer_id
    WHERE orders.customer_id = ?
    ORDER BY orders.order_at DESC
  `).all(customerId)
  res.json(rows.map(enrichOrder))
})

// === 按订单号查询（外部系统对账用）===
router.get('/by-no/:orderNo', (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo)
  if (!row) return res.status(404).json({ error: '订单不存在' })
  res.json(enrichOrder(row))
})

// === 单订单详情 ===
router.get('/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare(`
    SELECT orders.*, customers.name AS customerName, customers.code AS customerCode
    FROM orders LEFT JOIN customers ON customers.id = orders.customer_id
    WHERE orders.id = ?
  `).get(id)
  if (!row) return res.status(404).json({ error: '订单不存在' })
  res.json(enrichOrder(row))
})

// === 创建订单（内部）===
router.post('/', (req, res) => {
  const { order_no, customer_id, staff_id, amount, paid_amount, discount = 0, coupon_code = null, source = 'manual', status = 'paid', product_name, product_image, remark, order_at } = req.body
  if (!customer_id) return res.status(400).json({ error: 'customer_id 必填' })
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'amount 必填且 > 0' })

  // 订单号生成 / 唯一性校验
  let no = order_no
  if (!no) {
    no = (source || 'OD').toUpperCase().slice(0, 2) + new Date().toISOString().replace(/\D/g, '').slice(0, 14) + String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  }
  if (orderRepo.findByOrderNo(no)) return res.status(409).json({ error: '订单号已存在' })

  // 客户必须存在才能落单（内部 API 严格；webhook 允许 customer_id NULL 走 upsertFromWebhook）
  if (!customerRepo.findById(customer_id)) return res.status(404).json({ error: '客户不存在' })

  const row = orderRepo.createOrder({
    order_no: no, customer_id, staff_id, amount, paid_amount, discount,
    coupon_code, source, status,
    product_name, product_image, remark, order_at
  })
  res.json(enrichOrder(row))
})

// === 更新订单状态（发货/完成/退款）===
router.put('/:id/status', (req, res) => {
  const id = Number(req.params.id)
  const { status, remark } = req.body
  const allowed = ['pending', 'paid', 'shipped', 'completed', 'cancelled', 'refunded']
  if (!allowed.includes(status)) return res.status(400).json({ error: 'status 不合法' })
  if (!orderRepo.findById(id)) return res.status(404).json({ error: '订单不存在' })
  const row = orderRepo.updateOrderStatus(id, { status, remark })
  res.json(enrichOrder(row))
})

// === 删除订单 ===
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!orderRepo.deleteOrder(id)) return res.status(404).json({ error: '订单不存在' })
  res.json({ ok: true })
})

// === 视频号小店 / 第三方 webhook（完整实现）===
// 参考 https://developers.weixin.qq.com/doc/channels/API/order/notify.html
//
// 两种请求形态：
// A) 真实微信加密回调  → Header: X-WX-Signature + X-WX-Timestamp + X-WX-Nonce
//                       Body JSON: { Encrypt, MsgSignature, Timestamp, Nonce, ToUserName }
//                       流程: 验签 → AES 解密 → 拿明文 JSON
// B) 裸 JSON（第三方 SaaS / 手动测试）→ 直接解析
//
// 统一解析完交给 handleShopOrder() 做订单 upsert + 客户画像同步

function handleShopOrder(body) {
  const orderNo = body.out_order_id || body.order_no || body.order_id
  if (!orderNo) return { ok: false, status: 400, error: '缺少 order_id/out_order_id' }

  // 客户匹配（三级降级封装在 customerRepo.matchCustomer 中）
  const phoneRaw = body.phone || body.receiver_phone || body.mobile
  const customer = customerRepo.matchCustomer({
    phone: phoneRaw,
    openid: body.openid,
    name: body.customer_name || body.receiver_name
  })

  const statusMap = { 10: 'paid', 20: 'shipped', 30: 'completed', 40: 'cancelled', 50: 'refunded',
                      paid: 'paid', shipped: 'shipped', completed: 'completed', cancelled: 'cancelled', refunded: 'refunded' }
  const rawStatus = body.status
  let newStatus = statusMap[rawStatus]
  if (!newStatus && typeof rawStatus === 'string') newStatus = statusMap[rawStatus.toLowerCase()]
  if (!newStatus) newStatus = 'paid'

  const items = body.items || body.products || []
  const productName = items.length
    ? items.map(i => `${i.title || i.name || i.product_name || ''}${i.num || i.count ? ' x' + i.num : ''}`).filter(Boolean).join(', ')
    : body.product_name || null

  const amount = Number(body.total_amount || body.amount || items.reduce((s, i) => s + Number(i.num || i.count || 1) * Number(i.price || 0), 0) || 0)
  const paidAmount = Number(body.pay_amount || body.paid_amount || body.amount || amount)
  const discount = Math.max(0, amount - paidAmount)

  const remark = body.remark || (customer
    ? null
    : `未匹配客户，phone=${phoneRaw || '-'}，openid=${body.openid || '-'}，name=${body.customer_name || body.receiver_name || '-'}`)

  const r = orderRepo.upsertFromWebhook({
    order_no: orderNo,
    customer_id: customer ? customer.id : null,
    amount, paid_amount: paidAmount, discount,
    coupon_code: body.coupon_code || null,
    source: 'channels_shop',
    status: newStatus,
    product_name: productName,
    remark,
    order_at: body.create_time || body.order_at || now(),
    paid_at: newStatus !== 'pending' ? (body.create_time || body.order_at || now()) : null
  })

  return { ok: true, order_id: r.id, matched: !!customer, customer_id: customer?.id || null, updated: r.updated }
}

router.post('/webhook/channels-shop', ipWhitelist('video_shop_webhook_ips'), (req, res) => {
  const cfg = db.prepare('SELECT * FROM wecom_config WHERE id = 1').get() || {}

  // 加密 / 裸 JSON 统一处理：从 header/body 读签名三元组 → 验签 → 解密
  let parsed, decryptedAppid
  try {
    ({ parsed, decryptedAppid } = decryptEncryptedCallback(
      { body: req.body || {}, headers: req.headers, query: req.query },
      { token: cfg.video_shop_token, aesKey: cfg.video_shop_encoding_aes_key, appid: cfg.video_shop_appid }
    ))
  } catch (e) {
    if (String(e.message || '').includes('签名校验')) return res.status(401).json({ error: e.message })
    return res.status(400).json({ error: e.message })
  }

  const result = handleShopOrder(parsed)
  if (!result.ok) {
    return res.status(result.status || 400).json({ error: result.error })
  }

  res.json({
    errcode: 0, errmsg: 'success', ...result,
    _decrypted_appid: decryptedAppid ? decryptedAppid.replace(/[\x00-\x1f]+$/, '') : null
  })
})

// GET 用于微信后台的"服务器配置验证"URL
router.get('/webhook/channels-shop', ipWhitelist('video_shop_webhook_ips'), (req, res) => {
  const cfg = db.prepare('SELECT * FROM wecom_config WHERE id = 1').get() || {}
  const { body, status } = handleEcho(
    { query: req.query, headers: req.headers },
    { token: cfg.video_shop_token, aesKey: cfg.video_shop_encoding_aes_key }
  )
  res.status(status).type('text/plain').send(body)
})

export default router
