import express from 'express'
import { db, now, buildSegmentWhere } from '../db.js'

const router = express.Router()

function parseCond(s) {
  if (!s) return {}
  try {
    return JSON.parse(s) || {}
  } catch (e) {
    return {}
  }
}

function countBy(cond, mode) {
  const f = buildSegmentWhere(cond)
  const where = f.clause ? `(${f.clause}) AND customer_type = ?` : 'customer_type = ?'
  return db.prepare(`SELECT COUNT(*) AS n FROM customers WHERE ${where}`).get(...f.params, mode).n
}

function withMeta(row) {
  if (!row) return null
  const cond = parseCond(row.conditions)
  const mode = row.mode === 'service' ? 'service' : 'retail'
  return { ...row, conditions: cond, count: countBy(cond, mode) }
}

router.get('/', (req, res) => {
  const mode = req.query.mode
  if (mode === 'retail' || mode === 'service') {
    return res.json(db.prepare('SELECT * FROM segments WHERE mode = ? ORDER BY id DESC').all(mode).map(withMeta))
  }
  res.json(db.prepare('SELECT * FROM segments ORDER BY id DESC').all().map(withMeta))
})

router.post('/', (req, res) => {
  const b = req.body || {}
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: '分群名称不能为空' })
  if (!b.conditions || typeof b.conditions !== 'object') return res.status(400).json({ error: '分群条件不能为空' })
  const mode = b.mode === 'service' ? 'service' : 'retail'
  const r = db.prepare('INSERT INTO segments (name, description, conditions, created_at, mode) VALUES (?, ?, ?, ?, ?)').run(String(b.name).trim(), b.description ?? null, JSON.stringify(b.conditions), now(), mode)
  const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(Number(r.lastInsertRowid))
  res.status(201).json(withMeta(row))
})

router.get('/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM segments WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: '分群不存在' })
  res.json(withMeta(row))
})

router.put('/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM segments WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: '分群不存在' })
  const b = req.body || {}
  const name = b.name !== undefined && b.name !== null ? String(b.name).trim() : row.name
  const description = b.description !== undefined ? b.description : row.description
  const conditions = b.conditions !== undefined && b.conditions !== null ? JSON.stringify(b.conditions) : row.conditions
  const mode = b.mode !== undefined ? (b.mode === 'service' ? 'service' : 'retail') : (row.mode === 'service' ? 'service' : 'retail')
  if (!name) return res.status(400).json({ error: '分群名称不能为空' })
  db.prepare('UPDATE segments SET name = ?, description = ?, conditions = ?, mode = ? WHERE id = ?').run(name, description, conditions, mode, id)
  res.json(withMeta(db.prepare('SELECT * FROM segments WHERE id = ?').get(id)))
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const r = Number.isInteger(id) ? db.prepare('DELETE FROM segments WHERE id = ?').run(id) : null
  if (!r || !r.changes) return res.status(404).json({ error: '分群不存在' })
  res.json({ ok: true })
})

export default router
