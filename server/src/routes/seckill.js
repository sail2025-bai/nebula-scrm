import express from 'express'
import { db, initSchema, now, fmt } from '../db.js'

initSchema()
const router = express.Router()

// === CRUD ===
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM seckill_activities ORDER BY id DESC').all()
  res.json(rows)
})

router.get('/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM seckill_activities WHERE id = ?').get(req.params.id)
  if (!r) return res.status(404).json({ error: '秒杀活动不存在' })
  res.json(r)
})

router.post('/', (req, res) => {
  const { title, description, stock, price, original_price, start_at, end_at, staff_id, product_name, product_image } = req.body
  if (!title || !stock || !price || !start_at || !end_at) {
    return res.status(400).json({ error: 'title/stock/price/start_at/end_at 必填' })
  }
  const r = db.prepare(`INSERT INTO seckill_activities
    (title,description,stock,price,original_price,start_at,end_at,staff_id,product_name,product_image,active)
    VALUES (?,?,?,?,?,?,?,?,?,?,1)`).run(
    String(title).trim(), description || '',
    Math.max(1, Number(stock)), Number(price),
    original_price ? Number(original_price) : null,
    start_at, end_at,
    staff_id ? Number(staff_id) : null,
    product_name ? String(product_name) : null,
    product_image ? String(product_image) : null
  )
  res.status(201).json(db.prepare('SELECT * FROM seckill_activities WHERE id = ?').get(r.lastInsertRowid))
})

router.put('/:id/toggle', (req, res) => {
  const act = db.prepare('SELECT * FROM seckill_activities WHERE id = ?').get(req.params.id)
  if (!act) return res.status(404).json({ error: '秒杀活动不存在' })
  const next = act.active === 1 ? 0 : 1
  db.prepare('UPDATE seckill_activities SET active = ? WHERE id = ?').run(next, act.id)
  res.json({ ...act, active: next })
})

// === 原子抢（事务防超卖）===
// 客户端传入 customer_id（抢单客户），后端原子扣减 sold++
// 返回 success=true/false + 订单占位信息
router.post('/:id/grab', (req, res) => {
  const id = Number(req.params.id)
  const customerId = Number(req.body.customer_id)
  if (!customerId) return res.status(400).json({ error: 'customer_id 必填' })

  const act = db.prepare('SELECT * FROM seckill_activities WHERE id = ?').get(id)
  if (!act) return res.status(404).json({ error: '秒杀活动不存在' })
  if (act.active !== 1) return res.status(400).json({ error: '秒杀活动未启用' })

  const ok = db.transaction(() => {
    const cur = db.prepare('SELECT stock, sold, active FROM seckill_activities WHERE id = ?').get(id)
    if (cur.active !== 1) return { ok: false, reason: '秒杀活动已停止' }
    if (cur.sold >= cur.stock) return { ok: false, reason: '已抢光' }
    const nowStr = now()
    if (nowStr < act.start_at) return { ok: false, reason: '尚未开始' }
    if (nowStr > act.end_at) return { ok: false, reason: '已结束' }
    db.prepare('UPDATE seckill_activities SET sold = sold + 1 WHERE id = ?').run(id)
    db.prepare('INSERT OR IGNORE INTO seckill_grab_orders (activity_id, customer_id, price, grab_at, status) VALUES (?, ?, ?, ?, ?)').run(id, customerId, act.price, nowStr, 'pending')
    return { ok: true, price: act.price, customer_id: customerId, activity_id: id, title: act.title, grab_at: nowStr }
  })()

  if (!ok.ok) return res.status(409).json({ error: ok.reason })
  res.json(ok)
})

// 抢单订单列表（支持按活动/客户/状态过滤）
router.get('/:id/orders', (req, res) => {
  const id = Number(req.params.id)
  const act = Number.isInteger(id) ? db.prepare('SELECT * FROM seckill_activities WHERE id = ?').get(id) : null
  if (!act) return res.status(404).json({ error: '秒杀活动不存在' })
  const status = req.query.status
  let sql = `SELECT o.*, c.name AS customerName, c.phone, c.wechat_nick FROM seckill_grab_orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.activity_id = ?`
  const params = [id]
  if (status) { sql += ' AND o.status = ?'; params.push(String(status)) }
  sql += ' ORDER BY o.grab_at DESC LIMIT 500'
  const orders = db.prepare(sql).all(...params)
  const total = db.prepare('SELECT COUNT(*) as n FROM seckill_grab_orders WHERE activity_id = ?').get(id).n
  res.json({ activity: act, orders, total })
})

// 抢单全量（不限活动，支持状态过滤 + 时间范围）
router.get('/orders/all', (req, res) => {
  const { status, customer_id } = req.query
  let sql = `SELECT o.*, a.title AS activityTitle, a.price AS activityPrice, c.name AS customerName, c.phone FROM seckill_grab_orders o
    JOIN seckill_activities a ON a.id = o.activity_id
    JOIN customers c ON c.id = o.customer_id
    WHERE 1=1`
  const params = []
  if (status) { sql += ' AND o.status = ?'; params.push(String(status)) }
  if (customer_id) { sql += ' AND o.customer_id = ?'; params.push(Number(customer_id)) }
  sql += ' ORDER BY o.grab_at DESC LIMIT 500'
  res.json(db.prepare(sql).all(...params))
})

// 更新订单状态
router.post('/orders/:id/status', (req, res) => {
  const id = Number(req.params.id)
  const b = req.body || {}
  const status = String(b.status || 'pending')
  if (!['pending', 'paid', 'refunded', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: '状态非法，支持 pending/paid/refunded/cancelled' })
  }
  const r = db.prepare('UPDATE seckill_grab_orders SET status = ? WHERE id = ?').run(status, id)
  if (!r.changes) return res.status(404).json({ error: '订单不存在' })
  res.json({ ok: true, id, status })
})

export default router
