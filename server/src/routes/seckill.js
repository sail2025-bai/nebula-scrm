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
    return { ok: true, price: act.price, customer_id: customerId, activity_id: id, title: act.title, grab_at: nowStr }
  })()

  if (!ok.ok) return res.status(409).json({ error: ok.reason })
  res.json(ok)
})

export default router
