import { db, now } from '../db.js'

/**
 * orderRepo — 订单台账数据访问层
 *
 * 设计原则：
 *  1. 纯数据访问 / 事务封装，不含 HTTP / 业务策略
 *  2. 所有多步写操作用 db.transaction 包起来，保证原子性
 *  3. 客户画像（spend / orders / last_active）的同步统一在这里做，
 *     避免 routes/orders.js、webhook、seckill 各自复制一份 UPDATE 语句
 */

// —— 客户画像：订单级别的聚合重算（排除已取消/退款订单）——
const SQL_REFRESH_CUSTOMER_PORTRAIT = `
  UPDATE customers SET
    spend = (SELECT COALESCE(SUM(paid_amount),0) FROM orders WHERE orders.customer_id = customers.id AND orders.status NOT IN ('cancelled','refunded')),
    orders = (SELECT COUNT(*) FROM orders WHERE orders.customer_id = customers.id AND orders.status NOT IN ('cancelled','refunded')),
    last_active = ?
    WHERE id = ?
`
const stmtRefreshPortrait = db.prepare(SQL_REFRESH_CUSTOMER_PORTRAIT)

export function refreshCustomerPortrait(customerId, activeAt = now()) {
  if (!customerId) return
  stmtRefreshPortrait.run(activeAt, Number(customerId))
}

// —— 按订单号查询 ——
export function findByOrderNo(orderNo) {
  return db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo)
}

export function findById(id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(id))
}

// —— 简单查询：按客户 ——
export function listByCustomer(customerId) {
  return db.prepare(`
    SELECT orders.*, customers.name AS customerName
    FROM orders LEFT JOIN customers ON customers.id = orders.customer_id
    WHERE orders.customer_id = ?
    ORDER BY orders.order_at DESC
  `).all(Number(customerId))
}

// —— 创建订单（内部录入），自动回填客户画像 ——
const stmtInsert = db.prepare(`
  INSERT INTO orders
    (order_no,customer_id,staff_id,amount,paid_amount,discount,coupon_code,source,status,product_name,product_image,remark,order_at,paid_at,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`)

export function createOrder(payload) {
  const {
    order_no, customer_id, staff_id = null,
    amount, paid_amount, discount = 0, coupon_code = null,
    source = 'manual', status = 'paid',
    product_name = null, product_image = null, remark = null,
    order_at, paid_at
  } = payload

  const paid = paid_amount ?? (Number(amount) - Number(discount || 0))
  const finalOrderAt = order_at || now()
  const finalPaidAt = paid_at ?? (
    ['paid', 'shipped', 'completed'].includes(status) ? finalOrderAt : null
  )

  const tx = db.transaction(() => {
    const info = stmtInsert.run(
      order_no, Number(customer_id), staff_id != null ? Number(staff_id) : null,
      Number(amount), Number(paid), Number(discount || 0),
      coupon_code, source, status,
      product_name, product_image, remark,
      finalOrderAt, finalPaidAt,
      now()
    )
    refreshCustomerPortrait(customer_id)
    return Number(info.lastInsertRowid)
  })

  const id = tx()
  return findById(id)
}

// —— 更新订单状态，必要时回填时间戳 + 同步画像 ——
export function updateOrderStatus(id, { status, remark, paid_at, shipped_at, completed_at }) {
  const row = findById(id)
  if (!row) return null

  const patch = {}
  if (status) patch.status = status
  if (remark !== undefined) patch.remark = remark
  if (paid_at !== undefined) patch.paid_at = paid_at
  if (shipped_at !== undefined) patch.shipped_at = shipped_at
  if (completed_at !== undefined) patch.completed_at = completed_at

  // 自动补时间戳（沿用 routes/orders.js 规则）
  if (status === 'paid' && !row.paid_at && !patch.paid_at) patch.paid_at = now()
  if (status === 'shipped' && !patch.shipped_at) patch.shipped_at = now()
  if (status === 'completed' && !patch.completed_at) patch.completed_at = now()

  const sets = Object.keys(patch)
  if (!sets.length) return row

  const setsSql = sets.map(k => `${k}=?`).join(', ')
  const vals = sets.map(k => patch[k])
  vals.push(Number(id))

  db.prepare(`UPDATE orders SET ${setsSql} WHERE id=?`).run(...vals)

  // 状态变为 cancelled/refunded 需要扣回客户画像
  if (status && ['cancelled', 'refunded'].includes(status)) {
    refreshCustomerPortrait(row.customer_id)
  } else if (status && !['cancelled', 'refunded'].includes(row.status)) {
    // 非取消/退款之间流转，画像不变；只有从取消/退款 -> 正向需要重新累加
    if (['cancelled', 'refunded'].includes(row.status)) refreshCustomerPortrait(row.customer_id)
  }

  return findById(id)
}

export function deleteOrder(id) {
  const row = findById(id)
  if (!row) return false
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM orders WHERE id=?').run(Number(id))
    refreshCustomerPortrait(row.customer_id)
  })
  tx()
  return true
}

// —— Webhook Upsert：视频号小店 / 第三方回调统一入口 ——
// 返回 { id, updated, matched, customer_id }
const stmtWebhookUpsertUpdate = db.prepare(`
  UPDATE orders SET
    customer_id=?, amount=?, paid_amount=?, discount=?, source=?, status=?, product_name=?, remark=?
    WHERE id=?
`)
const stmtWebhookInsert = db.prepare(`
  INSERT INTO orders
    (order_no,customer_id,amount,paid_amount,discount,coupon_code,source,status,product_name,remark,order_at,paid_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
`)

export function upsertFromWebhook({
  order_no, customer_id, amount, paid_amount, discount = 0,
  coupon_code = null, source = 'channels_shop', status = 'paid',
  product_name = null, remark = null,
  order_at, paid_at
}) {
  const finalOrderAt = order_at || now()
  const finalPaidAt = paid_at ?? (status !== 'pending' ? finalOrderAt : null)

  const tx = db.transaction(() => {
    const existing = db.prepare('SELECT id FROM orders WHERE order_no=?').get(order_no)
    if (existing) {
      stmtWebhookUpsertUpdate.run(
        customer_id != null ? Number(customer_id) : null,
        Number(amount), Number(paid_amount), Number(discount),
        source, status, product_name, remark,
        existing.id
      )
      return { id: existing.id, updated: true }
    }
    const info = stmtWebhookInsert.run(
      order_no,
      customer_id != null ? Number(customer_id) : null,
      Number(amount), Number(paid_amount), Number(discount),
      coupon_code, source, status, product_name, remark,
      finalOrderAt, finalPaidAt
    )
    return { id: Number(info.lastInsertRowid), updated: false }
  })

  const r = tx()

  if (customer_id != null) refreshCustomerPortrait(customer_id)
  return { ...r, matched: customer_id != null, customer_id }
}

// —— 客户画像快照查询（用于 SOP 首单触发等场景）——
export function getCustomerSnapshot(customerId) {
  return db.prepare(`
    SELECT customers.id, customers.name, customers.stage, customers.spend, customers.orders, customers.channel,
      (SELECT COUNT(*) FROM orders WHERE orders.customer_id = customers.id AND orders.status NOT IN ('cancelled','refunded')) AS order_count
    FROM customers WHERE customers.id = ?
  `).get(Number(customerId))
}
