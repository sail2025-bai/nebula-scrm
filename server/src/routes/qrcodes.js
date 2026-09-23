import express from 'express'
import { db, now } from '../db.js'

const router = express.Router()

const SURNAME = ['林', '沈', '顾', '温', '贺', '黎']
const GIVEN = ['晓', '然', '子', '墨', '清', '和', '安', '宁', '之', '遥', '言', '岁', '禾', '一', '南', '溪', '竹', '星']

function randomName() {
  const pick = () => GIVEN[Math.floor(Math.random() * GIVEN.length)]
  return SURNAME[Math.floor(Math.random() * SURNAME.length)] + pick() + pick()
}

function parseTags(v) {
  try {
    const arr = JSON.parse(v || '[]')
    return Array.isArray(arr) ? arr : []
  } catch (e) {
    return []
  }
}

function qrWithStaff(id) {
  const row = db.prepare('SELECT q.*, s.name AS staffName FROM qr_codes q LEFT JOIN staff s ON s.id = q.staff_id WHERE q.id = ?').get(id)
  return row ? { ...row, auto_tags: parseTags(row.auto_tags) } : null
}

function insertCustomer({ name, wechatNick, channel, staffId, customerType }) {
  const type = customerType === 'service' ? 'service' : 'retail'
  const r = db.prepare(`INSERT INTO customers (code, name, wechat_nick, avatar, gender, phone, stage, channel, spend, orders, last_active, staff_id, rfm_score, health, notes, customer_type, company, position, intent_level, created_at) VALUES (NULL, ?, ?, NULL, '女', NULL, 'new', ?, 0, 0, ?, ?, '511', '新人活跃', NULL, ?, NULL, NULL, NULL, ?)`).run(
    name,
    wechatNick ?? null,
    channel ?? null,
    now(),
    staffId ?? null,
    type,
    now()
  )
  const id = Number(r.lastInsertRowid)
  db.prepare('UPDATE customers SET code = ? WHERE id = ?').run((type === 'service' ? 'S' : 'C') + (1000 + id), id)
  return id
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

router.get('/', (req, res) => {
  const mode = req.query.mode
  const rows = mode === 'retail' || mode === 'service'
    ? db.prepare('SELECT q.*, s.name AS staffName FROM qr_codes q LEFT JOIN staff s ON s.id = q.staff_id WHERE q.mode = ? ORDER BY q.id DESC').all(mode)
    : db.prepare('SELECT q.*, s.name AS staffName FROM qr_codes q LEFT JOIN staff s ON s.id = q.staff_id ORDER BY q.id DESC').all()
  res.json(rows.map((r) => ({ ...r, auto_tags: parseTags(r.auto_tags) })))
})

router.post('/', (req, res) => {
  const b = req.body || {}
  const name = b.name !== undefined && b.name !== null ? String(b.name).trim() : ''
  if (!name) return res.status(400).json({ error: '活码名称不能为空' })
  const mode = b.mode === 'service' ? 'service' : 'retail'
  const tags = Array.isArray(b.auto_tags) ? b.auto_tags.filter(Boolean) : []
  try {
    const r = db.prepare('INSERT INTO qr_codes (name, channel, staff_id, auto_tags, scan_count, active, mode, created_at) VALUES (?, ?, ?, ?, 0, 1, ?, ?)').run(name, b.channel ?? null, b.staff_id ?? null, JSON.stringify(tags), mode, now())
    res.status(201).json(qrWithStaff(Number(r.lastInsertRowid)))
  } catch (e) {
    res.status(400).json({ error: '创建活码失败' })
  }
})

router.put('/:id', (req, res) => {
  const id = Number(req.params.id)
  const qr = Number.isInteger(id) ? db.prepare('SELECT * FROM qr_codes WHERE id = ?').get(id) : null
  if (!qr) return res.status(404).json({ error: '活码不存在' })
  const b = req.body || {}
  const sets = []
  const params = []
  if (b.name !== undefined) {
    const name = String(b.name).trim()
    if (!name) return res.status(400).json({ error: '活码名称不能为空' })
    sets.push('name = ?')
    params.push(name)
  }
  if (b.channel !== undefined) {
    sets.push('channel = ?')
    params.push(b.channel)
  }
  if (b.staff_id !== undefined) {
    sets.push('staff_id = ?')
    params.push(b.staff_id === null ? null : Number(b.staff_id))
  }
  if (b.auto_tags !== undefined) {
    sets.push('auto_tags = ?')
    params.push(JSON.stringify(Array.isArray(b.auto_tags) ? b.auto_tags.filter(Boolean) : []))
  }
  if (b.active !== undefined) {
    sets.push('active = ?')
    params.push(b.active ? 1 : 0)
  }
  // 活码关联活动/券模板（公开参与入口）
  if (b.target_type !== undefined) {
    sets.push('target_type = ?')
    params.push(b.target_type ? String(b.target_type) : null)
  }
  if (b.target_id !== undefined) {
    sets.push('target_id = ?')
    params.push(b.target_id ? Number(b.target_id) : null)
  }
  if (sets.length) {
    params.push(id)
    db.prepare(`UPDATE qr_codes SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }
  res.json(qrWithStaff(id))
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const r = Number.isInteger(id) ? db.prepare('DELETE FROM qr_codes WHERE id = ?').run(id) : null
  if (!r || !r.changes) return res.status(404).json({ error: '活码不存在' })
  res.json({ ok: true })
})

router.post('/:id/scan', (req, res) => {
  const id = Number(req.params.id)
  const qr = Number.isInteger(id) ? db.prepare('SELECT * FROM qr_codes WHERE id = ?').get(id) : null
  if (!qr) return res.status(404).json({ error: '活码不存在' })
  const b = req.body || {}
  const name = b.name !== undefined && b.name !== null && String(b.name).trim() !== '' ? String(b.name).trim() : randomName()
  const type = qr.mode === 'service' ? 'service' : 'retail'
  const tags = parseTags(qr.auto_tags)
  let customerId = null
  const tx = db.transaction(() => {
    customerId = insertCustomer({ name, wechatNick: name, channel: qr.channel, staffId: qr.staff_id, customerType: type })
    applyTags(customerId, tags, type)
    db.prepare('UPDATE qr_codes SET scan_count = scan_count + 1 WHERE id = ?').run(id)
    let staffName = null
    if (qr.staff_id) {
      const owner = db.prepare('SELECT name FROM staff WHERE id = ?').get(qr.staff_id)
      if (owner) staffName = owner.name
    }
    db.prepare('INSERT INTO wecom_events (event_type, change_type, external_userid, userid, payload) VALUES (?, ?, ?, ?, ?)').run(
      'simulate_scan',
      'scan',
      'wmSIM' + String(Math.floor(100000 + Math.random() * 900000)),
      staffName,
      JSON.stringify({ qrCodeId: id, qrCodeName: qr.name, customerName: name, customerId, tags })
    )
  })
  tx()
  res.json({ ok: true, message: `客户「${name}」已自动入库并打上${tags.length}个标签`, customerId })
})

import { createQrTicket, wecomConfig } from '../wecom.js'

router.get('/:id/qrcode_url', async (req, res) => {
  const id = Number(req.params.id)
  const q = db.prepare('SELECT * FROM qr_codes WHERE id = ?').get(id)
  if (!q) return res.status(404).json({ error: '活码不存在' })
  try {
    let ticket = q.qr_ticket
    if (!ticket) {
      ticket = await createQrTicket(q)
    }
    const url = `https://open.weixin.qq.com/showqrcode?ticket=${encodeURIComponent(ticket)}`
    const cfg = wecomConfig()
    res.json({ ok: true, mode: cfg && cfg.status === 'connected' ? 'connected' : 'simulated', ticket, qrcode_url: url, qrcode_type: 'QR_SCENE', scene_id: id })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

export default router
