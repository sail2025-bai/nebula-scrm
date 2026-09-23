import express from 'express'
import { db, initSchema, now, fmt } from '../db.js'

initSchema()
const router = express.Router()

function randomName() {
  const SURNAME = ['林', '沈', '顾', '温', '贺', '黎', '唐', '程', '纪', '周']
  const GIVEN = ['晓', '然', '子', '墨', '清', '和', '安', '宁', '之', '遥', '言', '岁', '禾', '一', '南', '溪']
  const pick = () => GIVEN[Math.floor(Math.random() * GIVEN.length)]
  return SURNAME[Math.floor(Math.random() * SURNAME.length)] + pick() + pick()
}

function genCouponCode(len = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let s = 'CP'
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

function ensureTag(name, mode) {
  let row = db.prepare('SELECT id FROM tags WHERE name = ?').get(name)
  if (!row) {
    const r = db.prepare('INSERT INTO tags (name, category, mode) VALUES (?, ?, ?)').run(name, '业务标签', mode === 'service' ? 'service' : 'retail')
    row = { id: Number(r.lastInsertRowid) }
  }
  return row.id
}

function applyTags(customerId, names, mode) {
  const ins = db.prepare('INSERT OR IGNORE INTO customer_tags (customer_id, tag_id) VALUES (?, ?)')
  for (const name of names || []) {
    if (name) ins.run(customerId, ensureTag(String(name), mode))
  }
}

// === 公开扫活码入客户 ===
// 客户扫活码（包裹卡/海报/社群分享），自动入库 + 打标签 + 返回关联的活动信息
router.post('/scan', (req, res) => {
  const { qr_code_id, name, phone, wechat_nick } = req.body
  if (!qr_code_id) return res.status(400).json({ error: '活码ID必填' })

  const qr = db.prepare('SELECT * FROM qr_codes WHERE id = ? AND active = 1').get(qr_code_id)
  if (!qr) return res.status(404).json({ error: '活码无效或已停用' })

  const autoTags = JSON.parse(qr.auto_tags || '[]')
  const customerType = qr.mode === 'service' ? 'service' : 'retail'
  const finalName = (name && String(name).trim()) || randomName()
  const finalNick = (wechat_nick && String(wechat_nick).trim()) || finalName

  let customer = null
  const tx = db.transaction(() => {
    // 幂等：同手机号优先识别已有客户
    if (phone) {
      customer = db.prepare('SELECT * FROM customers WHERE phone = ? AND customer_type = ?').get(phone, customerType)
    }
    if (!customer) {
      const r = db.prepare(`INSERT INTO customers (code, name, wechat_nick, gender, phone, stage, channel, spend, orders, last_active, staff_id, rfm_score, health, customer_type, created_at)
        VALUES (NULL, ?, ?, '女', ?, 'new', ?, 0, 0, ?, ?, '511', '新人活跃', ?, ?)`).run(
        finalName, finalNick, phone || null, qr.channel || '活码扫描', now(), qr.staff_id || null, customerType, now()
      )
      const id = Number(r.lastInsertRowid)
      db.prepare('UPDATE customers SET code = ? WHERE id = ?').run((customerType === 'service' ? 'S' : 'C') + (1000 + id), id)
      customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id)
    }
    applyTags(customer.id, autoTags, customerType)
    db.prepare('UPDATE qr_codes SET scan_count = scan_count + 1 WHERE id = ?').run(qr_code_id)
  })()

  // === add_friend SOP 触发：新客户首次扫码 → 跑 trigger_type='add_friend' 的 SOP ===
  if (customer.created_at === customer.updated_at || !customer.updated_at) {
    // 简化判断：刚创建的客户（created_at = updated_at）视为新扫码
    try {
      const addFriendSOPs = db.prepare(`SELECT * FROM sops WHERE active = 1 AND trigger_type = 'add_friend'`).all()
      for (const sop of addFriendSOPs) {
        const steps = JSON.parse(sop.steps || '[]')
        let couponIssued = 0, tagApplied = 0
        for (const step of steps) {
          const stepType = step.type || step.action  // 兼容 type / action 两种字段
          if (stepType === 'push_coupon' && step.coupon_id) {
            const code = 'CF' + Math.random().toString(36).slice(2, 10).toUpperCase()
            db.prepare(`INSERT INTO coupon_issues (coupon_id,customer_id,source,sop_id,sop_step_index,code,status)
              VALUES (?,?,?,?,?,?, 'pending')`).run(
              step.coupon_id, customer.id, `sop:add_friend:${sop.id}`, sop.id, steps.indexOf(step), code
            )
            couponIssued++
          } else if (stepType === 'add_tag' && step.tag_name) {
            // SOP 自动打的 tag 默认 30 天过期
            const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)
            let tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(step.tag_name)
            if (!tag) {
              const r = db.prepare('INSERT INTO tags (name, category, mode, expires_at) VALUES (?, "SOP自动", ?, ?)').run(step.tag_name, customer.customer_type === 'service' ? 'service' : 'retail', expires)
              tag = { id: Number(r.lastInsertRowid) }
            }
            db.prepare('INSERT OR IGNORE INTO customer_tags (customer_id, tag_id) VALUES (?, ?)').run(customer.id, tag.id)
            tagApplied++
          }
        }
        db.prepare('UPDATE sops SET run_count = run_count + 1 WHERE id = ?').run(sop.id)
        db.prepare(`INSERT INTO sop_runs (sop_id, triggered_by, target_count, success_count, outcome, created_at)
          VALUES (?, 'public:add_friend', 1, 1, ?, CURRENT_TIMESTAMP)`).run(
          sop.id, JSON.stringify({ couponIssued, tagApplied })
        )
      }
    } catch (e) { /* SOP 触发失败不阻塞主流程 */ }
  }

  // 返回活码关联的活动信息（让前端知道接下来要做什么）
  let targetInfo = null
  if (qr.target_type === 'coupon' && qr.target_id) {
    const coupon = db.prepare('SELECT id, name, type, value, min_order, description, total_stock, issued_count, start_at, end_at FROM coupons WHERE id = ? AND active = 1').get(qr.target_id)
    if (coupon) targetInfo = { type: 'coupon', data: coupon }
  } else if (qr.target_type === 'seckill' && qr.target_id) {
    const seckill = db.prepare('SELECT id, title, description, stock, sold, price, original_price, start_at, end_at FROM seckill_activities WHERE id = ? AND active = 1').get(qr.target_id)
    if (seckill) targetInfo = { type: 'seckill', data: seckill }
  }

  res.json({
    ok: true,
    customer: {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      wechat_nick: customer.wechat_nick
    },
    target: targetInfo
  })
})

// === 公开领券 ===
// 输入：qr_code_id（活码，需关联 coupon target） + customer_code 或 customer_id
router.post('/coupons/claim', (req, res) => {
  const { qr_code_id, customer_code, customer_id } = req.body
  if (!qr_code_id) return res.status(400).json({ error: '活码ID必填' })
  if (!customer_code && !customer_id) return res.status(400).json({ error: '客户标识必填' })

  const qr = db.prepare('SELECT * FROM qr_codes WHERE id = ? AND active = 1').get(qr_code_id)
  if (!qr) return res.status(404).json({ error: '活码无效' })
  if (qr.target_type !== 'coupon' || !qr.target_id) {
    return res.status(400).json({ error: '该活码未关联优惠券' })
  }

  const customer = customer_code
    ? db.prepare('SELECT * FROM customers WHERE code = ?').get(customer_code)
    : db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(customer_id))
  if (!customer) return res.status(404).json({ error: '客户不存在' })

  const coupon = db.prepare('SELECT * FROM coupons WHERE id = ? AND active = 1').get(qr.target_id)
  if (!coupon) return res.status(400).json({ error: '优惠券已下架' })
  if (coupon.issued_count >= coupon.total_stock) return res.status(400).json({ error: '优惠券已发完' })

  // 幂等校验
  const dup = db.prepare('SELECT 1 FROM coupon_issues WHERE coupon_id = ? AND customer_id = ?').get(coupon.id, customer.id)
  if (dup) return res.status(409).json({ ok: false, error: '您已领过这张券了' })

  // 限流：同客户 1 小时内最多领 5 张（防刷）
  const cutoff1h = new Date(Date.now() - 3600000).toISOString().replace('T', ' ').slice(0, 19)
  const recentCount = db.prepare(
    `SELECT COUNT(*) AS n FROM coupon_issues WHERE customer_id = ? AND source LIKE 'public:%' AND issued_at > ?`
  ).get(customer.id, cutoff1h).n
  if (recentCount >= 5) return res.status(429).json({ ok: false, error: '领券太频繁，请稍后再试' })

  const code = genCouponCode()
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO coupon_issues (coupon_id,customer_id,source,staff_id,code,expires_at)
      VALUES (?,?,?,?,?,?)`).run(
      coupon.id, customer.id, `public:qr_${qr.id}`,
      qr.staff_id || null, code, coupon.end_at
    )
    db.prepare('UPDATE coupons SET issued_count = issued_count + 1 WHERE id = ?').run(coupon.id)
  })()

  res.json({
    ok: true,
    issue: {
      id: db.prepare('SELECT last_insert_rowid() AS id').get().id,
      code,
      coupon_name: coupon.name,
      coupon_type: coupon.type,
      value: coupon.value,
      min_order: coupon.min_order,
      expires_at: coupon.end_at
    }
  })
})

// === 公开秒杀抢单 ===
// 输入：customer_code 或 customer_id，复用后端原子抢单逻辑
router.post('/seckill/:id/grab', (req, res) => {
  const id = Number(req.params.id)
  const { customer_code, customer_id } = req.body
  if (!customer_code && !customer_id) return res.status(400).json({ error: '客户标识必填' })

  const customer = customer_code
    ? db.prepare('SELECT * FROM customers WHERE code = ?').get(customer_code)
    : db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(customer_id))
  if (!customer) return res.status(404).json({ error: '客户不存在' })

  const act = db.prepare('SELECT * FROM seckill_activities WHERE id = ?').get(id)
  if (!act) return res.status(404).json({ error: '秒杀活动不存在' })
  if (act.active !== 1) return res.status(400).json({ error: '秒杀活动已停止' })

  const ok = db.transaction(() => {
    const cur = db.prepare('SELECT stock, sold, active FROM seckill_activities WHERE id = ?').get(id)
    if (cur.active !== 1) return { ok: false, reason: '活动已停止' }
    if (cur.sold >= cur.stock) return { ok: false, reason: '已抢光' }
    const nowStr = now()
    if (nowStr < act.start_at) return { ok: false, reason: '尚未开始' }
    if (nowStr > act.end_at) return { ok: false, reason: '已结束' }
    // 幂等：同一客户不能重复抢同一秒杀
    const dup = db.prepare('SELECT 1 FROM follow_ups WHERE customer_id = ? AND content LIKE ? AND created_at > ?').get(
      customer.id, `%秒杀:${act.title}%`, fmt(new Date(Date.now() - 3600000)) // 1小时内幂等
    )
    if (dup) return { ok: false, reason: '您已抢过本次秒杀' }

    db.prepare('UPDATE seckill_activities SET sold = sold + 1 WHERE id = ?').run(id)
    // 自动生成跟进记录（给运营看）
    db.prepare(`INSERT INTO follow_ups (customer_id, staff_id, type, content, outcome, next_followup_at, created_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      customer.id, act.staff_id || customer.staff_id, 'wechat',
      `秒杀:${act.title}`,
      `抢单成功 ￥${act.price}`,
      null, now()
    )
    return { ok: true, price: act.price, title: act.title, customer_code: customer.code }
  })()

  if (!ok.ok) return res.status(409).json({ error: ok.reason })
  res.json({ ok: true, ...ok })
})

// === 公开查客户券包（用客户 code 查询，无需鉴权）===
router.get('/customer/:code/coupons', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE code = ?').get(req.params.code)
  if (!customer) return res.status(404).json({ error: '客户不存在' })

  const rows = db.prepare(`
    SELECT ci.*, c.name AS coupon_name, c.type, c.value, c.min_order, c.description, c.end_at AS coupon_end_at
    FROM coupon_issues ci JOIN coupons c ON c.id = ci.coupon_id
    WHERE ci.customer_id = ?
    ORDER BY CASE ci.status WHEN 'pending' THEN 0 ELSE 1 END, ci.issued_at DESC
  `).all(customer.id)

  res.json({
    ok: true,
    customer: { id: customer.id, code: customer.code, name: customer.name },
    coupons: rows
  })
})

export default router
