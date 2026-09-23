import express from 'express'
import { db, now, buildSegmentWhere } from '../db.js'

const router = express.Router()

router.get('/', (req, res) => {
  const mode = req.query.mode
  if (mode === 'retail' || mode === 'service') {
    return res.json(db.prepare('SELECT * FROM broadcasts WHERE mode = ? ORDER BY id DESC').all(mode))
  }
  res.json(db.prepare('SELECT * FROM broadcasts ORDER BY id DESC').all())
})

router.post('/', (req, res) => {
  const b = req.body || {}
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: '群发标题不能为空' })
  const mode = b.mode === 'service' ? 'service' : 'retail'
  let target = 0
  if (b.conditions && typeof b.conditions === 'object') {
    const f = buildSegmentWhere(b.conditions)
    const where = f.clause ? `(${f.clause}) AND customer_type = ?` : 'customer_type = ?'
    target = db.prepare(`SELECT COUNT(*) AS n FROM customers WHERE ${where}`).get(...f.params, mode).n
  }
  const r = db.prepare('INSERT INTO broadcasts (title, type, audience_desc, message, target_count, sent_rate, status, created_at, mode) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)').run(
    String(b.title).trim(),
    b.type || '客户群发',
    b.audience_desc ?? null,
    b.message ?? null,
    target,
    '待下发',
    now(),
    mode
  )
  res.status(201).json(db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(Number(r.lastInsertRowid)))
})

export default router

import { sendBroadcast } from '../wecom.js'

router.post('/:id/send', async (req, res) => {
  const id = Number(req.params.id)
  const b = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(id)
  if (!b) return res.status(404).json({ error: '群发任务不存在' })
  if (b.status === '已下发' || b.status === '已下发(模拟)') {
    return res.status(400).json({ error: '该任务已下发' })
  }
  try {
    const r = await sendBroadcast(b)
    return res.json(r)
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message })
  }
})

router.get('/scan-scheduled', (req, res) => {
  const pending = db.prepare(`SELECT * FROM broadcasts WHERE status = '待下发'`).all()
  res.json({ pending: pending.length, items: pending.map((b) => ({ id: b.id, title: b.title, target: b.target_count, status: b.status })) })
})
