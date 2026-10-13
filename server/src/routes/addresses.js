import express from 'express'
import { db, initSchema } from '../db.js'

initSchema()
const router = express.Router()

/** GET /api/addresses?customer_id=X — 列出某客户的所有地址 */
router.get('/', (req, res) => {
  const cid = Number(req.query.customer_id)
  if (!cid) return res.status(400).json({ error: 'customer_id 必填' })
  const rows = db.prepare('SELECT * FROM addresses WHERE customer_id = ? ORDER BY is_default DESC, id DESC').all(cid)
  res.json({ items: rows })
})

/** GET /api/addresses/:id */
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM addresses WHERE id = ?').get(Number(req.params.id))
  if (!row) return res.status(404).json({ error: '地址不存在' })
  res.json(row)
})

/** POST /api/addresses — 新增地址（自动处理 is_default） */
router.post('/', (req, res) => {
  const { customer_id, name, phone, province, city, district, detail, is_default } = req.body || {}
  if (!customer_id) return res.status(400).json({ error: 'customer_id 必填' })
  if (!name || !detail) return res.status(400).json({ error: '收货人姓名 + 详细地址 必填' })
  const cid = Number(customer_id)

  // 如果标记为默认，先清掉该客户其他默认地址
  if (is_default) {
    db.prepare('UPDATE addresses SET is_default = 0 WHERE customer_id = ?').run(cid)
  }
  // 如果是该客户第一个地址，自动标记默认
  const existing = db.prepare('SELECT COUNT(*) as c FROM addresses WHERE customer_id = ?').get(cid).c
  const shouldDefault = is_default || existing === 0

  const r = db.prepare(`INSERT INTO addresses
    (customer_id, name, phone, province, city, district, detail, is_default)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    cid, String(name).trim(), phone || null,
    province || null, city || null, district || null,
    String(detail).trim(), shouldDefault ? 1 : 0
  )
  const row = db.prepare('SELECT * FROM addresses WHERE id = ?').get(Number(r.lastInsertRowid))
  res.status(201).json(row)
})

/** PUT /api/addresses/:id — 更新地址 */
router.put('/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM addresses WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: '地址不存在' })
  const b = req.body || {}

  const sets = []
  const params = []
  for (const k of ['name', 'phone', 'province', 'city', 'district', 'detail']) {
    if (b[k] !== undefined) { sets.push(`${k} = ?`); params.push(b[k] ? String(b[k]) : null) }
  }
  if (b.is_default !== undefined) {
    if (b.is_default) {
      db.prepare('UPDATE addresses SET is_default = 0 WHERE customer_id = ?').run(row.customer_id)
    }
    sets.push('is_default = ?')
    params.push(b.is_default ? 1 : 0)
  }
  if (sets.length === 0) return res.status(400).json({ error: '没有可更新的字段' })
  params.push(id)
  db.prepare(`UPDATE addresses SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  res.json(db.prepare('SELECT * FROM addresses WHERE id = ?').get(id))
})

/** DELETE /api/addresses/:id — 删除地址（删的是默认就再找一个顶上） */
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM addresses WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: '地址不存在' })
  const wasDefault = row.is_default === 1
  const cid = row.customer_id

  db.prepare('DELETE FROM addresses WHERE id = ?').run(id)

  // 如果删的是默认，找下一个顶上
  if (wasDefault) {
    const next = db.prepare('SELECT * FROM addresses WHERE customer_id = ? ORDER BY id DESC LIMIT 1').get(cid)
    if (next) db.prepare('UPDATE addresses SET is_default = 1 WHERE id = ?').run(next.id)
  }
  res.json({ ok: true })
})

export default router
