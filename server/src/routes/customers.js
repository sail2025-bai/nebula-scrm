import express from 'express'
import { db, now, fmt, buildSegmentWhere } from '../db.js'
import * as orderRepo from '../repositories/orderRepo.js'

const router = express.Router()

const stageMeta = {
  loyal: ['555', '极度健康'],
  mature: ['423', '良好'],
  new: ['511', '新人活跃'],
  churn: ['211', '高危预警']
}

const qTags = db.prepare('SELECT t.id, t.name, t.category FROM customer_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.customer_id = ? ORDER BY t.id')
const qFollowCount = db.prepare('SELECT COUNT(*) AS n FROM follow_ups WHERE customer_id = ?')
const qLastFollow = db.prepare('SELECT created_at FROM follow_ups WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1')
const qCustomer = db.prepare('SELECT customers.*, s.name AS staffName FROM customers LEFT JOIN staff s ON s.id = customers.staff_id WHERE customers.id = ?')
const qFollows = db.prepare('SELECT f.*, s.name AS staffName FROM follow_ups f LEFT JOIN staff s ON s.id = f.staff_id WHERE f.customer_id = ? ORDER BY f.created_at DESC, f.id DESC')

function enrich(row) {
  const lf = qLastFollow.get(row.id)
  return {
    ...row,
    tags: qTags.all(row.id),
    followupCount: qFollowCount.get(row.id).n,
    lastFollowupAt: lf ? lf.created_at : null
  }
}

function detail(id) {
  const row = qCustomer.get(id)
  if (!row) return null
  return { ...enrich(row), followUps: qFollows.all(id) }
}

function ensureTag(name) {
  let row = db.prepare('SELECT id FROM tags WHERE name = ?').get(name)
  if (!row) {
    const r = db.prepare('INSERT INTO tags (name, category) VALUES (?, ?)').run(name, '业务标签')
    row = { id: Number(r.lastInsertRowid) }
  }
  return row.id
}

function applyTags(customerId, names) {
  const ins = db.prepare('INSERT OR IGNORE INTO customer_tags (customer_id, tag_id) VALUES (?, ?)')
  for (const name of names) {
    if (!name) continue
    ins.run(customerId, ensureTag(name))
  }
}

router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 8))
  const clauses = []
  const params = []
  const { stage, channel, staff_id, tag, search, segment, mode } = req.query
  if (mode === 'retail' || mode === 'service') {
    clauses.push('customers.customer_type = ?')
    params.push(mode)
  }
  if (stage) {
    clauses.push('customers.stage = ?')
    params.push(stage)
  }
  if (channel) {
    clauses.push('customers.channel = ?')
    params.push(channel)
  }
  if (staff_id) {
    clauses.push('customers.staff_id = ?')
    params.push(Number(staff_id))
  }
  if (tag) {
    clauses.push('EXISTS (SELECT 1 FROM customer_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.customer_id = customers.id AND t.name = ?)')
    params.push(tag)
  }
  if (search) {
    clauses.push('(customers.name LIKE ? OR customers.wechat_nick LIKE ? OR customers.phone LIKE ? OR customers.code LIKE ? OR customers.company LIKE ?)')
    const like = `%${search}%`
    params.push(like, like, like, like, like)
  }
  if (segment) {
    const seg = db.prepare('SELECT conditions FROM segments WHERE id = ?').get(Number(segment))
    if (seg) {
      let cond = {}
      try {
        cond = JSON.parse(seg.conditions) || {}
      } catch (e) {
        cond = {}
      }
      const f = buildSegmentWhere(cond)
      if (f.clause) {
        clauses.push(f.clause)
        params.push(...f.params)
      }
    }
  }
  const whereSql = clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''
  const total = db.prepare(`SELECT COUNT(*) AS n FROM customers${whereSql}`).get(...params).n
  const rows = db.prepare(`SELECT customers.*, s.name AS staffName FROM customers LEFT JOIN staff s ON s.id = customers.staff_id${whereSql} ORDER BY customers.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize)
  res.json({ items: rows.map(enrich), total, page, pageSize })
})

router.post('/batch-tags', (req, res) => {
  const b = req.body || {}
  if (!Array.isArray(b.ids) || !b.ids.length || !b.tagName) return res.status(400).json({ error: '参数不完整' })
  try {
    const tagId = ensureTag(b.tagName)
    const ins = db.prepare('INSERT OR IGNORE INTO customer_tags (customer_id, tag_id) VALUES (?, ?)')
    const exists = db.prepare('SELECT id FROM customers WHERE id = ?')
    let affected = 0
    const tx = db.transaction(() => {
      for (const id of b.ids) {
        if (!exists.get(id)) continue
        affected += ins.run(id, tagId).changes
      }
    })
    tx()
    res.json({ ok: true, affected })
  } catch (e) {
    res.status(400).json({ error: '批量打标签失败' })
  }
})

router.post('/', (req, res) => {
  const b = req.body || {}
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: '客户姓名不能为空' })
  const stage = stageMeta[b.stage] ? b.stage : 'new'
  const meta = stageMeta[stage]
  const customerType = b.customer_type === 'service' ? 'service' : 'retail'
  try {
    const r = db.prepare(`INSERT INTO customers (code, name, wechat_nick, avatar, gender, phone, stage, channel, spend, orders, last_active, staff_id, rfm_score, health, notes, customer_type, company, position, intent_level, created_at) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      String(b.name).trim(),
      b.wechat_nick ?? null,
      b.avatar ?? null,
      b.gender || '女',
      b.phone ?? null,
      stage,
      b.channel ?? null,
      Number(b.spend) || 0,
      Number(b.orders) || 0,
      now(),
      b.staff_id ?? null,
      meta[0],
      meta[1],
      b.notes ?? null,
      customerType,
      b.company ?? null,
      b.position ?? null,
      b.intent_level ?? null,
      now()
    )
    const id = Number(r.lastInsertRowid)
    db.prepare('UPDATE customers SET code = ? WHERE id = ?').run((customerType === 'service' ? 'S' : 'C') + (1000 + id), id)
    if (Array.isArray(b.tags)) applyTags(id, b.tags)
    res.status(201).json(detail(id))
  } catch (e) {
    res.status(400).json({ error: '创建客户失败' })
  }
})

router.get('/:id', (req, res) => {
  const id = Number(req.params.id)
  const d = Number.isInteger(id) ? detail(id) : null
  if (!d) return res.status(404).json({ error: '客户不存在' })
  res.json(d)
})

router.put('/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || !db.prepare('SELECT id FROM customers WHERE id = ?').get(id)) return res.status(404).json({ error: '客户不存在' })
  const b = req.body || {}
  const sets = []
  const params = []
  for (const k of ['name', 'wechat_nick', 'avatar', 'gender', 'phone', 'stage', 'channel', 'spend', 'orders', 'staff_id', 'notes', 'customer_type', 'company', 'position', 'intent_level']) {
    if (b[k] !== undefined) {
      sets.push(`${k} = ?`)
      params.push(b[k])
    }
  }
  if (b.stage !== undefined && stageMeta[b.stage]) {
    sets.push('rfm_score = ?', 'health = ?')
    params.push(stageMeta[b.stage][0], stageMeta[b.stage][1])
  }
  sets.push('last_active = ?')
  params.push(now())
  params.push(id)
  db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  if (Array.isArray(b.tags)) {
    const current = qTags.all(id).map((t) => t.name)
    const next = b.tags.filter(Boolean)
    const del = db.prepare('DELETE FROM customer_tags WHERE customer_id = ? AND tag_id IN (SELECT id FROM tags WHERE name = ?)')
    for (const name of current.filter((n) => !next.includes(n))) del.run(id, name)
    applyTags(id, next.filter((n) => !current.includes(n)))
  }
  res.json(detail(id))
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const r = Number.isInteger(id) ? db.prepare('DELETE FROM customers WHERE id = ?').run(id) : null
  if (!r || !r.changes) return res.status(404).json({ error: '客户不存在' })
  res.json({ ok: true })
})

// === 外部订单系统对接：模拟客户下单 ===
// body: { order_no, amount, channel?, coupon_code? }
// 自动更新 customers.orders/spend/last_active，
// 如果是首购（orders 之前是 0）自动触发 first_purchase SOP 引擎
router.post('/:id/purchase', (req, res) => {
  const id = Number(req.params.id)
  const c = Number.isInteger(id) ? db.prepare('SELECT * FROM customers WHERE id = ?').get(id) : null
  if (!c) return res.status(404).json({ error: '客户不存在' })

  const amount = Number(req.body.amount)
  if (!amount || amount <= 0) return res.status(400).json({ error: 'order amount 非法' })

  const wasFirst = c.orders === 0
  const newOrders = c.orders + 1
  const newSpend = (c.spend || 0) + amount
  const nextStage = c.stage === 'new' ? 'mature' : c.stage

  // 核销传入的券码（如果有）
  let couponResult = null
  const couponCode = req.body.coupon_code
  if (couponCode) {
    const issue = db.prepare("SELECT * FROM coupon_issues WHERE code = ? AND status = 'pending'").get(couponCode)
    if (issue) {
      const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(issue.coupon_id)
      if (coupon && amount >= coupon.min_order) {
        let saved = 0
        if (coupon.type === 'cash') saved = coupon.value
        else if (coupon.type === 'percent') saved = amount * coupon.value / 100
        else saved = coupon.value
        db.prepare("UPDATE coupon_issues SET status = 'used' WHERE id = ?").run(issue.id)
        db.prepare('UPDATE coupons SET redeemed_count = redeemed_count + 1 WHERE id = ?').run(coupon.id)
        db.prepare(`INSERT INTO coupon_redemptions
          (issue_id,coupon_id,customer_id,order_no,order_amount,saved_amount,redemption_channel)
          VALUES (?,?,?,?,?,?,?)`).run(issue.id, coupon.id, c.id, req.body.order_no || null, amount, saved, '订单对接')
        couponResult = { saved, coupon_id: coupon.id, coupon_name: coupon.name }
      }
    }
  }

  // 更新客户画像
  db.prepare(`UPDATE customers
    SET orders = ?, spend = ?, stage = ?, last_active = ?, updated_at = ?
    WHERE id = ?`).run(newOrders, newSpend, nextStage, now(), now(), c.id)

  // 同步写入 orders 台账（幂等：同 order_no 不重复）
  if (req.body.order_no) {
    if (!orderRepo.findByOrderNo(req.body.order_no)) {
      const saved = couponResult?.saved || 0
      const effectivePaid = amount - saved
      orderRepo.createOrder({
        order_no: req.body.order_no,
        customer_id: c.id,
        staff_id: c.staff_id,
        amount,
        paid_amount: effectivePaid,
        discount: saved,
        coupon_code: couponCode || null,
        source: req.body.source || 'manual',
        status: 'paid',
        product_name: req.body.product_name || null,
        remark: req.body.remark || null
      })
    }
  }

  // 首购触发 first_purchase SOP 引擎
  let sopTriggered = null
  if (wasFirst) {
    const mode = c.customer_type || 'retail'
    const activeSops = db.prepare(
      'SELECT * FROM sops WHERE trigger_type = ? AND active = 1 AND mode = ?'
    ).all('first_purchase', mode)
    for (const sop of activeSops) {
      // 单客户立即执行（limit=1）
      const steps = JSON.parse(sop.steps || '[]')
      let couponIssued = 0
      const insFollowup = db.prepare(`INSERT INTO follow_ups
        (customer_id,staff_id,type,content,outcome,next_followup_at,created_at)
        VALUES (?,?,?,?,?,?,?)`)
      const tx = db.transaction(() => {
        for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
          const s = steps[stepIdx]
          const delayDays = Number(s.delay_days || 0)
          const nextAt = delayDays > 0 ? fmt(new Date(Date.now() + delayDays * 86400000)) : null
          let outcome = 'SOP 自动触发（首购后）'
          // 真发券
          if (s.action === 'push_coupon' && s.coupon_id) {
            const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(s.coupon_id)
            if (coupon && coupon.active === 1 && coupon.issued_count < coupon.total_stock) {
              const dup = db.prepare('SELECT 1 FROM coupon_issues WHERE coupon_id=? AND customer_id=?').get(s.coupon_id, c.id)
              if (!dup) {
                const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
                let code = 'CP'; for (let i = 0; i < 10; i++) code += chars[Math.floor(Math.random() * chars.length)]
                db.prepare(`INSERT INTO coupon_issues
                  (coupon_id,customer_id,source,sop_id,sop_step_index,staff_id,code,expires_at)
                  VALUES (?,?,?,?,?,?,?,?)`).run(s.coupon_id, c.id, `sop:first_purchase:${sop.id}`, sop.id, stepIdx, c.staff_id, code, null)
                db.prepare('UPDATE coupons SET issued_count = issued_count + 1 WHERE id = ?').run(s.coupon_id)
                couponIssued++
                outcome = `已发券 CP**${code.slice(-4)}`
              }
            }
          }
          insFollowup.run(c.id, c.staff_id, 'wechat',
            `${sop.name} · ${s.phase || ''} ${s.title} ${s.detail || ''}`.trim(),
            outcome, nextAt, now())
        }
        db.prepare('UPDATE sops SET run_count = run_count + 1, conversion = 100 WHERE id = ?').run(sop.id)
      })
      tx()
      sopTriggered = { sop_id: sop.id, name: sop.name, coupon_issued: couponIssued }
      break // 命中第一个 first_purchase SOP 即触发
    }
  }

  res.json({
    ok: true,
    order_no: req.body.order_no,
    amount,
    new_orders: newOrders,
    new_spend: newSpend,
    stage: nextStage,
    was_first_purchase: wasFirst,
    coupon: couponResult,
    sop_triggered: sopTriggered
  })
})

export default router
