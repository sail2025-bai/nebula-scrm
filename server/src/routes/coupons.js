import express from 'express'
import { db, initSchema, now } from '../db.js'

initSchema()
const router = express.Router()

function validateCouponBody(body) {
  const errors = []
  const name = body.name && String(body.name).trim()
  if (!name) errors.push('优惠券名称不能为空')
  const type = body.type || 'cash'
  if (!['cash', 'percent', 'gift'].includes(type)) errors.push('type 非法，支持 cash/percent/gift')
  const value = Number(body.value)
  if (!value || value <= 0) errors.push('value 必须 > 0')
  if (type === 'percent' && (value > 100)) errors.push('折扣券 value 不能超过 100')
  if (!body.start_at) errors.push('start_at 必填')
  if (!body.end_at) errors.push('end_at 必填')
  return { errors, name, type, value }
}

function genCouponCode(len = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let s = 'CP'
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

// === 优惠券 CRUD ===
router.get('/', (req, res) => {
  const mode = req.query.mode || 'retail'
  const coupons = db.prepare('SELECT * FROM coupons WHERE mode = ? ORDER BY id DESC').all(mode)
  res.json(coupons)
})

router.get('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '优惠券不存在' })
  const issues = db.prepare('SELECT * FROM coupon_issues WHERE coupon_id = ? ORDER BY id DESC LIMIT 20').all(req.params.id)

  // 核销渠道分布
  const channelBreakdown = db.prepare(`
    SELECT redemption_channel AS channel, COUNT(*) AS count, SUM(saved_amount) AS total_saved
    FROM coupon_redemptions
    WHERE coupon_id = ?
    GROUP BY redemption_channel
    ORDER BY count DESC
  `).all(req.params.id)

  // 最近核销记录（带客户名 + 渠道）
  const recentRedemptions = db.prepare(`
    SELECT cr.*, customers.name AS customer_name, customers.code AS customer_code
    FROM coupon_redemptions cr
    JOIN customers ON customers.id = cr.customer_id
    WHERE cr.coupon_id = ?
    ORDER BY cr.redeemed_at DESC
    LIMIT 20
  `).all(req.params.id)

  res.json({ ...c, issues, channelBreakdown, recentRedemptions })
})

router.post('/', (req, res) => {
  const { errors } = validateCouponBody(req.body)
  if (errors.length) return res.status(400).json({ error: errors.join('; ') })
  const { name, type, value } = validateCouponBody(req.body)
  const coupon = db.prepare(`INSERT INTO coupons (name,type,value,min_order,description,total_stock,start_at,end_at,mode)
    VALUES (@name,@type,@value,@min_order,@description,@total_stock,@start_at,@end_at,@mode)`).run({
    name, type, value,
    min_order: Number(req.body.min_order) || 0,
    description: req.body.description || '',
    total_stock: Number(req.body.total_stock) || 10000,
    start_at: req.body.start_at,
    end_at: req.body.end_at,
    mode: req.body.mode || 'retail'
  })
  const created = db.prepare('SELECT * FROM coupons WHERE id = ?').get(coupon.lastInsertRowid)
  res.status(201).json(created)
})

router.put('/:id', (req, res) => {
  const fields = ['name', 'type', 'value', 'min_order', 'description', 'total_stock', 'start_at', 'end_at', 'mode', 'active']
  const sets = fields.filter(f => req.body[f] !== undefined)
  if (!sets.length) return res.status(400).json({ error: '没有要更新的字段' })
  const sql = `UPDATE coupons SET ${sets.map(s => `${s}=?`).join(',')} WHERE id=?`
  const vals = sets.map(s => req.body[s]); vals.push(req.params.id)
  db.prepare(sql).run(...vals)
  res.json(db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id))
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// === 发券（可手动批量 / 由 SOP 调用）===
// body: { coupon_id, customer_ids: [1,2,3], source, sop_id?, sop_step_index?, staff_id? }
router.post('/issue', (req, res) => {
  const { coupon_id, customer_ids = [], source = 'manual', sop_id, sop_step_index, staff_id } = req.body
  if (!coupon_id) return res.status(400).json({ error: 'coupon_id 必填' })
  if (!Array.isArray(customer_ids) || customer_ids.length === 0) return res.status(400).json({ error: 'customer_ids 至少 1 人' })

  const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(coupon_id)
  if (!coupon) return res.status(404).json({ error: '优惠券不存在' })
  if (coupon.active !== 1) return res.status(400).json({ error: '优惠券已停用' })

  // 计算剩余库存
  const remaining = coupon.total_stock - coupon.issued_count
  if (remaining <= 0) return res.status(400).json({ error: '优惠券已发完' })

  const valid = customer_ids.slice(0, remaining)
  const nowStr = now()
  // 券 7 天有效（或用 end_at）
  const expiresAt = coupon.end_at

  let issued = 0, skipped = 0
  const tx = db.transaction(() => {
    for (const cid of valid) {
      // 幂等：同券同客户不重复发
      const exist = db.prepare('SELECT 1 FROM coupon_issues WHERE coupon_id=? AND customer_id=?').get(coupon_id, cid)
      if (exist) { skipped++; continue }
      // 库存二次校验（事务内）
      const cur = db.prepare('SELECT issued_count,total_stock FROM coupons WHERE id=?').get(coupon_id)
      if (cur.issued_count >= cur.total_stock) break
      const code = genCouponCode()
      db.prepare(`INSERT INTO coupon_issues
        (coupon_id,customer_id,source,sop_id,sop_step_index,staff_id,code,expires_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(coupon_id, cid, source, sop_id || null, sop_step_index ?? null, staff_id || null, code, expiresAt)
      db.prepare('UPDATE coupons SET issued_count = issued_count + 1 WHERE id = ?').run(coupon_id)
      issued++
    }
  })
  tx()

  res.json({ ok: true, coupon_id, requested: customer_ids.length, issued, skipped })
})

// === 核销 ===
// body: { issue_id?, code?, order_no?, order_amount }
router.post('/redeem', (req, res) => {
  const { issue_id, code, order_no, order_amount } = req.body
  if (!issue_id && !code) return res.status(400).json({ error: 'issue_id 或 code 必填' })

  const issue = issue_id
    ? db.prepare('SELECT * FROM coupon_issues WHERE id = ?').get(issue_id)
    : db.prepare('SELECT * FROM coupon_issues WHERE code = ?').get(code)
  if (!issue) return res.status(404).json({ error: '券不存在' })
  if (issue.status === 'used') return res.status(400).json({ error: '券已核销' })
  if (issue.status === 'revoked') return res.status(400).json({ error: '券已撤销' })
  const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(issue.coupon_id)
  if (!coupon) return res.status(400).json({ error: '券模板不存在' })
  if (order_amount !== undefined && Number(order_amount) < coupon.min_order) {
    return res.status(400).json({ error: `未达使用门槛 ￥${coupon.min_order}` })
  }

  // 计算节省金额
  let saved = 0
  const amount = Number(order_amount) || 0
  if (coupon.type === 'cash') saved = coupon.value
  else if (coupon.type === 'percent') saved = amount * coupon.value / 100
  else saved = coupon.value // gift 视同固定值

  // 识别核销渠道（手动调 /redeem 接口 → SCRM 运营后台）
  const redemptionChannel = req.body.redemption_channel || '手动核销'

  const tx = db.transaction(() => {
    db.prepare("UPDATE coupon_issues SET status='used' WHERE id=?").run(issue.id)
    db.prepare('UPDATE coupons SET redeemed_count = redeemed_count + 1 WHERE id=?').run(coupon.id)
    db.prepare(`INSERT INTO coupon_redemptions (issue_id,coupon_id,customer_id,order_no,order_amount,saved_amount,redemption_channel)
      VALUES (?,?,?,?,?,?,?)`).run(issue.id, coupon.id, issue.customer_id, order_no || null, amount, saved, redemptionChannel)
  })
  tx()

  res.json({
    ok: true,
    issue_id: issue.id,
    coupon_id: coupon.id,
    coupon_name: coupon.name,
    saved_amount: saved,
    type: coupon.type,
    value: coupon.value,
    min_order: coupon.min_order
  })
})

// === 客户我的券 ===
router.get('/issues/customer/:customer_id', (req, res) => {
  const rows = db.prepare(`
    SELECT ci.*, c.name AS coupon_name, c.type, c.value, c.min_order, c.description, c.end_at
    FROM coupon_issues ci JOIN coupons c ON c.id = ci.coupon_id
    WHERE ci.customer_id = ?
    ORDER BY CASE ci.status WHEN 'pending' THEN 0 ELSE 1 END, ci.issued_at DESC
  `).all(req.params.customer_id)
  res.json(rows)
})

export default router
