import express from 'express'
import { db, now, buildSegmentWhere } from '../db.js'

const router = express.Router()

// === B4：分群快照字段（幂等 ALTER TABLE）===
try { db.prepare('ALTER TABLE segments ADD COLUMN snapshot TEXT').run() } catch {}
try { db.prepare('ALTER TABLE segments ADD COLUMN snapshot_count INTEGER DEFAULT 0').run() } catch {}
try { db.prepare('ALTER TABLE segments ADD COLUMN snapshot_at TEXT').run() } catch {}

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

function customerIdsFromSegment(seg) {
  const cond = parseCond(seg.conditions)
  const f = buildSegmentWhere(cond)
  const where = f.clause ? `(${f.clause})` : '1=1'
  return db.prepare(`SELECT id FROM customers WHERE ${where}`).all(...f.params).map((r) => Number(r.id))
}

function summarizeCustomers(ids) {
  if (!ids.length) return { avg_spend: 0, avg_orders: 0, repeat_rate: 0, loyal_count: 0 }
  const ph = ids.map(() => '?').join(',')
  const r = db.prepare(`
    SELECT
      ROUND(AVG(spend), 2) AS avg_spend,
      ROUND(AVG(orders), 2) AS avg_orders,
      ROUND(100.0 * SUM(CASE WHEN orders >= 2 THEN 1 ELSE 0 END) / COUNT(*), 1) AS repeat_rate,
      SUM(CASE WHEN stage = 'loyal' THEN 1 ELSE 0 END) AS loyal_count
    FROM customers WHERE id IN (${ph})
  `).all(...ids)[0] || { avg_spend: 0, avg_orders: 0, repeat_rate: 0, loyal_count: 0 }
  return r
}

function withMeta(row) {
  if (!row) return null
  const cond = parseCond(row.conditions)
  const mode = row.mode === 'service' ? 'service' : 'retail'
  return { ...row, conditions: cond, count: countBy(cond, mode) }
}

// === 基础 CRUD ===
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

// === B4：人群对比（必须在 /:id 之前注册，否则 "compare" 会被当成 id）===
router.get('/compare', (req, res) => {
  const { id1, id2, use_snapshot } = req.query
  const i1 = Number(id1), i2 = Number(id2)
  if (!Number.isInteger(i1) || !Number.isInteger(i2)) return res.status(400).json({ error: 'id1 / id2 必需且为整数' })
  const seg1 = db.prepare('SELECT * FROM segments WHERE id = ?').get(i1)
  const seg2 = db.prepare('SELECT * FROM segments WHERE id = ?').get(i2)
  if (!seg1 || !seg2) return res.status(404).json({ error: '分群不存在' })

  const ids1 = use_snapshot === '1' && seg1.snapshot ? JSON.parse(seg1.snapshot) : customerIdsFromSegment(seg1)
  const ids2 = use_snapshot === '1' && seg2.snapshot ? JSON.parse(seg2.snapshot) : customerIdsFromSegment(seg2)
  const s1 = new Set(ids1), s2 = new Set(ids2)
  const both = [...s1].filter((x) => s2.has(x))
  const only1 = [...s1].filter((x) => !s2.has(x))
  const only2 = [...s2].filter((x) => !s1.has(x))

  const stat = (ids) => summarizeCustomers(ids)

  res.json({
    seg1: { id: seg1.id, name: seg1.name, size: ids1.length, stats: stat(ids1) },
    seg2: { id: seg2.id, name: seg2.name, size: ids2.length, stats: stat(ids2) },
    overlap: both.length,
    union: s1.size + s2.size - both.length,
    only_in_seg1: only1.length,
    only_in_seg2: only2.length,
    delta: {
      count_diff: ids1.length - ids2.length,
      avg_spend_diff: (stat(ids1).avg_spend ?? 0) - (stat(ids2).avg_spend ?? 0),
      repeat_rate_diff: (stat(ids1).repeat_rate ?? 0) - (stat(ids2).repeat_rate ?? 0)
    }
  })
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

// === B4：分群快照（把当前 conditions 圈出来的 customer_id 列表冻结）===
router.post('/:id/snapshot', (req, res) => {
  const id = Number(req.params.id)
  const seg = db.prepare('SELECT * FROM segments WHERE id = ?').get(id)
  if (!seg) return res.status(404).json({ error: '分群不存在' })
  const cond = parseCond(seg.conditions)
  const f = buildSegmentWhere(cond)
  const where = f.clause ? `(${f.clause})` : '1=1'
  const rows = db.prepare(`SELECT id FROM customers WHERE ${where} ORDER BY id`).all(...f.params)
  const ids = rows.map((r) => Number(r.id))
  db.prepare('UPDATE segments SET snapshot = ?, snapshot_count = ?, snapshot_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    JSON.stringify(ids), ids.length, id
  )
  res.json({ ok: true, snapshot_count: ids.length, snapshot_at: new Date().toISOString().replace('T', ' ').slice(0, 19) })
})

export default router
