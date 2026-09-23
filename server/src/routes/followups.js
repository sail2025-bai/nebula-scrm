import express from 'express'
import { db, now } from '../db.js'

const router = express.Router()

const baseSql = 'SELECT f.*, s.name AS staffName, c.name AS customerName, c.wechat_nick AS customerNick FROM follow_ups f LEFT JOIN staff s ON s.id = f.staff_id LEFT JOIN customers c ON c.id = f.customer_id'

router.get('/', (req, res) => {
  const { customer_id } = req.query
  if (customer_id) {
    res.json(db.prepare(`${baseSql} WHERE f.customer_id = ? ORDER BY f.created_at DESC, f.id DESC`).all(Number(customer_id)))
  } else {
    res.json(db.prepare(`${baseSql} ORDER BY f.created_at DESC, f.id DESC`).all())
  }
})

router.post('/', (req, res) => {
  const b = req.body || {}
  const cid = Number(b.customer_id)
  if (!Number.isInteger(cid) || !db.prepare('SELECT id FROM customers WHERE id = ?').get(cid)) return res.status(400).json({ error: '客户不存在' })
  if (!b.content || !String(b.content).trim()) return res.status(400).json({ error: '跟进内容不能为空' })
  const r = db.prepare('INSERT INTO follow_ups (customer_id, staff_id, type, content, outcome, next_followup_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(cid, b.staff_id ?? null, b.type || 'wechat', String(b.content).trim(), b.outcome ?? null, b.next_followup_at ?? null, now())
  db.prepare('UPDATE customers SET last_active = ? WHERE id = ?').run(now(), cid)
  res.status(201).json(db.prepare(`${baseSql} WHERE f.id = ?`).get(Number(r.lastInsertRowid)))
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const r = Number.isInteger(id) ? db.prepare('DELETE FROM follow_ups WHERE id = ?').run(id) : null
  if (!r || !r.changes) return res.status(404).json({ error: '跟进记录不存在' })
  res.json({ ok: true })
})

export default router
