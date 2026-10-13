import express from 'express'
import { db, now } from '../db.js'
import { wrapAsync } from '../utils/wrap.js'

const router = express.Router()

router.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM customers WHERE staff_id = s.id) AS customer_count,
      (SELECT COUNT(*) FROM follow_ups WHERE staff_id = s.id AND (outcome IS NULL OR outcome = '' OR outcome IN ('待处理','已指派'))) AS pending_followups
    FROM staff s ORDER BY s.id
  `).all())
})

router.post('/', (req, res) => {
  const b = req.body || {}
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: '姓名不能为空' })
  const r = db.prepare('INSERT INTO staff (name, role, wecom_userid, avatar_url, created_at) VALUES (?, ?, ?, ?, ?)').run(
    String(b.name).trim(),
    String(b.role || '顾问').slice(0, 50),
    b.wecom_userid ? String(b.wecom_userid).slice(0, 100) : null,
    b.avatar_url ? String(b.avatar_url).slice(0, 200) : null,
    now()
  )
  res.status(201).json(db.prepare('SELECT * FROM staff WHERE id = ?').get(Number(r.lastInsertRowid)))
})

router.put('/:id', (req, res) => {
  const id = Number(req.params.id)
  const r = db.prepare('SELECT * FROM staff WHERE id = ?').get(id)
  if (!r) return res.status(404).json({ error: '员工不存在' })
  const b = req.body || {}
  const sets = []
  const params = []
  for (const [k, v] of Object.entries({ name: b.name, role: b.role, wecom_userid: b.wecom_userid, avatar_url: b.avatar_url })) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(String(v).slice(0, 200)) }
  }
  if (!sets.length) return res.json(r)
  params.push(id)
  db.prepare(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  res.json(db.prepare('SELECT * FROM staff WHERE id = ?').get(id))
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const r = db.prepare('SELECT * FROM staff WHERE id = ?').get(id)
  if (!r) return res.status(404).json({ error: '员工不存在' })
  const customerCount = db.prepare('SELECT COUNT(*) as n FROM customers WHERE staff_id = ?').get(id).n
  if (customerCount > 0) return res.status(400).json({ error: `该顾问仍负责 ${customerCount} 位客户，请先重新分配` })
  const pendingFu = db.prepare("SELECT COUNT(*) as n FROM follow_ups WHERE staff_id = ? AND (outcome IS NULL OR outcome = '' OR outcome IN ('待处理','已指派'))").get(id).n
  if (pendingFu > 0) return res.status(400).json({ error: `该顾问有 ${pendingFu} 项未完成待办` })
  db.prepare('DELETE FROM staff WHERE id = ?').run(id)
  res.json({ ok: true })
})

export default router
