import express from 'express'
import { db, initSchema, now } from '../db.js'

initSchema()
const router = express.Router()

// === 工具 ===
function parseImages(images) {
  if (!images) return []
  try {
    const arr = typeof images === 'string' ? JSON.parse(images) : images
    return Array.isArray(arr) ? arr.filter(Boolean) : []
  } catch { return [] }
}

function serializeProduct(row) {
  if (!row) return null
  let category_name = null
  if (row.category_id) {
    const c = db.prepare('SELECT name FROM categories WHERE id = ?').get(row.category_id)
    category_name = c?.name || null
  }
  return {
    id: row.id,
    name: row.name,
    category_id: row.category_id || null,
    category_name,
    price: Number(row.price || 0),
    original_price: row.original_price ? Number(row.original_price) : null,
    stock: Number(row.stock || 0),
    sold: Number(row.sold || 0),
    description: row.description || '',
    image_url: row.image_url || null,
    images: parseImages(row.images),
    tag: row.tag || '',
    sku: row.sku || null,
    active: row.active ? 1 : 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  }
}

// ============ 公开接口（给 H5/PC/小程序用，返回上架商品）============

/** GET /api/products — 列表（支持分类筛选、关键词） */
router.get('/', (req, res) => {
  const includeInactive = req.query.all === '1'   // 运营后台可拿到全量
  const categoryId = req.query.category ? Number(req.query.category) : null
  const keyword = req.query.q ? String(req.query.q).trim() : ''
  // 分页参数
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 12))
  const needPaging = req.query.page !== undefined || req.query.pageSize !== undefined

  const where = []
  const params = []
  if (!includeInactive) { where.push('active = 1') }
  if (categoryId) { where.push('category_id = ?'); params.push(categoryId) }
  if (keyword) { where.push('(name LIKE ? OR description LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''
  const orderSql = ' ORDER BY sold DESC, id DESC'

  if (!needPaging) {
    // 不传分页参数时返回全量（兼容旧 H5/小程序）
    const rows = db.prepare(`SELECT * FROM products${whereSql}${orderSql}`).all(...params)
    return res.json({ items: rows.map(serializeProduct) })
  }
  // 服务端分页
  const total = db.prepare(`SELECT COUNT(*) FROM products${whereSql}`).get(...params)['COUNT(*)']
  const rows = db.prepare(
    `SELECT * FROM products${whereSql}${orderSql} LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize)
  res.json({
    items: rows.map(serializeProduct),
    total, page, pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  })
})

/** GET /api/products/categories — 所有分类 */
router.post('/', (req, res) => {
  const b = req.body || {}
  const name = b.name && String(b.name).trim()
  const price = Number(b.price)
  if (!name) return res.status(400).json({ error: '商品名称不能为空' })
  if (!price || price <= 0) return res.status(400).json({ error: '价格必须 > 0' })

  const imagesJson = Array.isArray(b.images) ? JSON.stringify(b.images) : null
  const r = db.prepare(`INSERT INTO products
    (name, category_id, price, original_price, stock, description, image_url, images, tag, sku, active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(
    name,
    b.category_id ? Number(b.category_id) : null,
    price,
    b.original_price ? Number(b.original_price) : null,
    b.stock ? Number(b.stock) : 0,
    b.description ? String(b.description) : '',
    b.image_url ? String(b.image_url) : null,
    imagesJson,
    b.tag ? String(b.tag) : null,
    b.sku ? String(b.sku) : null,
    now()
  )
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(r.lastInsertRowid))
  res.status(201).json(serializeProduct(row))
})

/** PUT /api/products/:id — 编辑商品 */
router.get('/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order ASC, id ASC').all()
  res.json({ items: rows })
})

/** GET /api/products/:id — 商品详情 */
router.post('/categories', (req, res) => {
  const b = req.body || {}
  const name = b.name && String(b.name).trim()
  if (!name) return res.status(400).json({ error: '分类名称不能为空' })
  try {
    const r = db.prepare(`INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, ?)`).run(
      name, b.icon || null, b.sort_order ? Number(b.sort_order) : 0
    )
    res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(r.lastInsertRowid)))
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) return res.status(400).json({ error: '分类已存在' })
    res.status(400).json({ error: e.message })
  }
})

router.get('/cart', (req, res) => {
  const cid = Number(req.query.customer_id)
  if (!cid) return res.status(400).json({ error: 'customer_id 必填' })
  const rows = db.prepare(`
    SELECT ci.id, ci.quantity, p.* FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    WHERE ci.customer_id = ? AND p.active = 1
    ORDER BY ci.created_at DESC
  `).all(cid)
  const items = rows.map(r => ({
    cart_id: r.id,
    quantity: r.quantity,
    product: serializeProduct(r)
  }))
  const total = items.reduce((s, it) => s + (it.product.price * it.quantity), 0)
  res.json({ items, total, count: items.length })
})

/** POST /api/products/cart — 加购（customer_id + product_id + quantity） */
router.post('/cart', (req, res) => {
  const { customer_id, product_id, quantity } = req.body || {}
  const cid = Number(customer_id), pid = Number(product_id), qty = Math.max(1, Number(quantity) || 1)
  if (!cid || !pid) return res.status(400).json({ error: 'customer_id / product_id 必填' })
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(pid)
  if (!product) return res.status(404).json({ error: '商品不存在或已下架' })

  const existing = db.prepare('SELECT * FROM cart_items WHERE customer_id = ? AND product_id = ?').get(cid, pid)
  if (existing) {
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(existing.quantity + qty, existing.id)
  } else {
    db.prepare('INSERT INTO cart_items (customer_id, product_id, quantity) VALUES (?, ?, ?)').run(cid, pid, qty)
  }
  res.json({ ok: true })
})

/** PUT /api/products/cart/:cart_id — 更新数量 */
router.put('/cart/:cart_id', (req, res) => {
  const id = Number(req.params.cart_id)
  const qty = Math.max(0, Number(req.body?.quantity) || 0)
  if (qty === 0) {
    db.prepare('DELETE FROM cart_items WHERE id = ?').run(id)
  } else {
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(qty, id)
  }
  res.json({ ok: true })
})

/** DELETE /api/products/cart/:cart_id — 移除 */
router.delete('/cart/:cart_id', (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE id = ?').run(Number(req.params.cart_id))
  res.json({ ok: true })
})

/** DELETE /api/products/cart/clear — 清空（按 customer_id） */
router.delete('/cart/clear', (req, res) => {
  const cid = Number(req.body?.customer_id)
  if (!cid) return res.status(400).json({ error: 'customer_id 必填' })
  db.prepare('DELETE FROM cart_items WHERE customer_id = ?').run(cid)
  res.json({ ok: true })
})

export default router

router.delete('/categories/:id', (req, res) => {
  const id = Number(req.params.id)
  // 先把该分类下商品的 category_id 清掉（不删商品）
  db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(id)
  db.prepare('DELETE FROM categories WHERE id = ?').run(id)
  res.json({ ok: true })
})

// ============ 购物车（按 customer） ============

/** GET /api/products/cart?customer_id=X */
router.get('/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM products WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: '商品不存在' })
  res.json(serializeProduct(row))
})

// ============ 运营后台 CRUD ============

/** POST /api/products — 新建商品 */
router.put('/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM products WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: '商品不存在' })
  const b = req.body || {}

  const sets = []
  const params = []
  const allowed = ['name', 'category_id', 'price', 'original_price', 'stock', 'description', 'image_url', 'tag', 'sku']
  for (const k of allowed) {
    if (b[k] !== undefined) {
      if (k === 'category_id') { sets.push('category_id = ?'); params.push(b.category_id ? Number(b.category_id) : null) }
      else if (['price', 'original_price', 'stock'].includes(k)) { sets.push(`${k} = ?`); params.push(b[k] != null ? Number(b[k]) : null) }
      else { sets.push(`${k} = ?`); params.push(String(b[k])) }
    }
  }
  if (Array.isArray(b.images)) { sets.push('images = ?'); params.push(JSON.stringify(b.images)) }
  if (b.active !== undefined) { sets.push('active = ?'); params.push(b.active ? 1 : 0) }
  if (sets.length === 0) return res.status(400).json({ error: '没有可更新的字段' })
  sets.push('updated_at = ?'); params.push(now())

  params.push(id)
  db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id)
  res.json(serializeProduct(updated))
})

/** DELETE /api/products/:id — 删除商品 */
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM products WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: '商品不存在' })
  db.prepare('DELETE FROM products WHERE id = ?').run(id)
  res.json({ ok: true })
})

/** PUT /api/products/:id/toggle — 上下架 */
router.put('/:id/toggle', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM products WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: '商品不存在' })
  const next = row.active ? 0 : 1
  db.prepare('UPDATE products SET active = ?, updated_at = ? WHERE id = ?').run(next, now(), id)
  res.json({ ...serializeProduct(row), active: next })
})

// ============ 分类管理 ============

