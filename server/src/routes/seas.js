import express from 'express'
import { db, now } from '../db.js'

const router = express.Router()

function insertCustomer({ name, wechatNick, phone, channel, staffId, customerType, company }) {
  const type = customerType === 'service' ? 'service' : 'retail'
  const r = db.prepare(`INSERT INTO customers (code, name, wechat_nick, avatar, gender, phone, stage, channel, spend, orders, last_active, staff_id, rfm_score, health, notes, customer_type, company, position, intent_level, created_at) VALUES (NULL, ?, ?, NULL, '女', ?, 'new', ?, 0, 0, ?, ?, '511', '新人活跃', NULL, ?, ?, NULL, NULL, ?)`).run(
    name,
    wechatNick ?? null,
    phone ?? null,
    channel ?? null,
    now(),
    staffId ?? null,
    type,
    company ?? null,
    now()
  )
  const id = Number(r.lastInsertRowid)
  db.prepare('UPDATE customers SET code = ? WHERE id = ?').run((type === 'service' ? 'S' : 'C') + (1000 + id), id)
  return id
}

function getLead(id) {
  return Number.isInteger(id) ? db.prepare('SELECT * FROM seas_leads WHERE id = ?').get(id) : null
}

function leadWithOwner(id) {
  return db.prepare('SELECT l.*, s.name AS ownerName FROM seas_leads l LEFT JOIN staff s ON s.id = l.owner_staff_id WHERE l.id = ?').get(id) || null
}

router.get('/', (req, res) => {
  const mode = req.query.mode
  const rows = mode === 'retail' || mode === 'service'
    ? db.prepare('SELECT l.*, s.name AS ownerName FROM seas_leads l LEFT JOIN staff s ON s.id = l.owner_staff_id WHERE l.mode = ? ORDER BY l.id DESC').all(mode)
    : db.prepare('SELECT l.*, s.name AS ownerName FROM seas_leads l LEFT JOIN staff s ON s.id = l.owner_staff_id ORDER BY l.id DESC').all()
  res.json(rows)
})

router.post('/import', (req, res) => {
  const b = req.body || {}
  const lines = Array.isArray(b.lines) ? b.lines : []
  const mode = b.mode === 'service' ? 'service' : 'retail'
  let imported = 0
  let failed = 0
  const ins = db.prepare('INSERT INTO seas_leads (name, company, phone, channel, status, mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const tx = db.transaction(() => {
    for (const line of lines) {
      const parts = String(line ?? '').split(/[\t,，]/).map((s) => s.trim())
      if (!parts[0]) {
        failed++
        continue
      }
      ins.run(parts[0], parts[1] || null, parts[2] || null, parts[3] || null, 'pending', mode, now())
      imported++
    }
  })
  tx()
  res.json({ imported, failed })
})

router.put('/:id/claim', (req, res) => {
  const id = Number(req.params.id)
  const lead = getLead(id)
  if (!lead) return res.status(404).json({ error: '线索不存在' })
  const b = req.body || {}
  const staffId = b.staff_id !== undefined && b.staff_id !== null ? Number(b.staff_id) : null
  if (!Number.isInteger(staffId) || !db.prepare('SELECT id FROM staff WHERE id = ?').get(staffId)) {
    return res.status(400).json({ error: '负责人不存在，请先选择有效员工' })
  }
  db.prepare("UPDATE seas_leads SET status = 'claimed', owner_staff_id = ?, claimed_at = ? WHERE id = ?").run(staffId, now(), id)
  res.json(leadWithOwner(id))
})

router.post('/:id/convert', (req, res) => {
  const id = Number(req.params.id)
  const lead = getLead(id)
  if (!lead) return res.status(404).json({ error: '线索不存在' })
  if (lead.status === 'converted') return res.status(400).json({ error: '该线索已转化，请勿重复转化' })
  const type = lead.mode === 'service' ? 'service' : 'retail'
  let customerId = null
  const tx = db.transaction(() => {
    customerId = insertCustomer({ name: lead.name, wechatNick: lead.name, phone: lead.phone, channel: lead.channel, staffId: lead.owner_staff_id, customerType: type, company: lead.company })
    db.prepare("UPDATE seas_leads SET status = 'converted' WHERE id = ?").run(id)
    let ownerName = null
    if (lead.owner_staff_id) {
      const owner = db.prepare('SELECT name FROM staff WHERE id = ?').get(lead.owner_staff_id)
      if (owner) ownerName = owner.name
    }
    db.prepare('INSERT INTO wecom_events (event_type, external_userid, userid, payload) VALUES (?, NULL, ?, ?)').run('seas_convert', ownerName, JSON.stringify({ leadId: lead.id, leadName: lead.name, customerName: lead.name, customerId, mode: type, owner: ownerName }))
  })
  tx()
  const customer = db.prepare('SELECT c.*, s.name AS staffName FROM customers c LEFT JOIN staff s ON s.id = c.staff_id WHERE c.id = ?').get(customerId)
  res.json({ customer: { ...customer, tags: [], followupCount: 0, lastFollowupAt: null, followUps: [] } })
})

router.put('/:id/return', (req, res) => {
  const id = Number(req.params.id)
  const lead = getLead(id)
  if (!lead) return res.status(404).json({ error: '线索不存在' })
  db.prepare("UPDATE seas_leads SET status = 'pending', owner_staff_id = NULL, claimed_at = NULL WHERE id = ?").run(id)
  res.json(leadWithOwner(id))
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const r = Number.isInteger(id) ? db.prepare('DELETE FROM seas_leads WHERE id = ?').run(id) : null
  if (!r || !r.changes) return res.status(404).json({ error: '线索不存在' })
  res.json({ ok: true })
})

export default router
