import express from 'express'
import { db } from '../db.js'

const router = express.Router()

router.get('/', (req, res) => {
  const mode = req.query.mode
  if (mode === 'retail' || mode === 'service') {
    return res.json(db.prepare(`SELECT t.id, t.name, t.category, t.mode, COUNT(c.id) AS count FROM tags t LEFT JOIN customer_tags ct ON ct.tag_id = t.id LEFT JOIN customers c ON c.id = ct.customer_id AND c.customer_type = ? WHERE t.mode = ? GROUP BY t.id ORDER BY t.category, t.name`).all(mode, mode))
  }
  res.json(db.prepare('SELECT t.id, t.name, t.category, t.mode, COUNT(ct.customer_id) AS count FROM tags t LEFT JOIN customer_tags ct ON ct.tag_id = t.id GROUP BY t.id ORDER BY t.category, t.name').all())
})

router.post('/', (req, res) => {
  const b = req.body || {}
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: '标签名称不能为空' })
  const mode = b.mode === 'service' ? 'service' : 'retail'
  try {
    const r = db.prepare('INSERT INTO tags (name, category, mode) VALUES (?, ?, ?)').run(String(b.name).trim(), b.category || '业务标签', mode)
    res.status(201).json({ id: Number(r.lastInsertRowid), name: String(b.name).trim(), category: b.category || '业务标签', mode, count: 0 })
  } catch (e) {
    res.status(400).json({ error: '标签已存在或创建失败' })
  }
})

router.put('/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM tags WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: '标签不存在' })
  const b = req.body || {}
  const name = b.name !== undefined ? String(b.name).trim() : row.name
  const category = b.category !== undefined ? b.category : row.category
  if (!name) return res.status(400).json({ error: '标签名称不能为空' })
  try {
    db.prepare('UPDATE tags SET name = ?, category = ? WHERE id = ?').run(name, category, id)
    res.json({ ...row, name, category })
  } catch (e) {
    res.status(400).json({ error: '标签名称重复' })
  }
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const r = Number.isInteger(id) ? db.prepare('DELETE FROM tags WHERE id = ?').run(id) : null
  if (!r || !r.changes) return res.status(404).json({ error: '标签不存在' })
  res.json({ ok: true })
})

export default router
