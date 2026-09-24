import express from 'express'
import { db, now } from '../db.js'
import { sendInternalWecomMessage } from '../wecom.js'

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

// 一键指派给对应顾问：发企微内部消息 + 更新 outcome
router.post('/:id/assign', async (req, res) => {
  const id = Number(req.params.id)
  const fu = Number.isInteger(id)
    ? db.prepare(`${baseSql} WHERE f.id = ?`).get(id)
    : null
  if (!fu) return res.status(404).json({ error: '待办不存在' })
  if (!fu.staff_id) return res.status(400).json({ error: '该待办未指派顾问，无法推送' })
  if (fu.outcome !== '待处理' && fu.outcome !== null) {
    return res.status(400).json({ error: '该待办已处理，不可重复指派' })
  }

  // 更新状态为"已指派"
  db.prepare('UPDATE follow_ups SET outcome = ?, created_at = ? WHERE id = ?').run('已指派', now(), id)

  // 异步推企微（主链路不等，失败不阻断 outcome 落库）
  const customerName = fu.customerName || '该客户'
  const title = fu.type?.includes('phone_call') ? '📞 SOP 电话待办'
    : fu.type?.includes('send_wechat') ? '💬 SOP 企微消息待办'
    : fu.type?.includes('gift_send') ? '🎁 SOP 寄礼待办'
    : fu.type?.includes('invite_group') ? '👥 SOP 拉群待办'
    : '🔔 SOP 待办提醒'
  const due = fu.next_followup_at ? `（应于 ${fu.next_followup_at.slice(5, 16)} 完成）` : ''
  const desc = `${fu.content || ''}\n客户：${customerName}${due}\n请尽快处理`

  let wecomResult = { ok: false, simulated: false, reason: '未推送' }
  try {
    wecomResult = await sendInternalWecomMessage({
      staffId: fu.staff_id,
      content: desc,
      title,
      source: 'dashboard_assign'
    })
  } catch (e) {
    wecomResult = { ok: false, simulated: true, reason: String(e.message || e) }
  }

  // 企微推送也写一条 wecom_events 日志（已在 sendInternalWecomMessage 内部写了 simulated/sent 类型）
  res.json({
    ok: true,
    followup: { id: fu.id, outcome: '已指派', customer: customerName },
    wecom: wecomResult
  })
})

// 顾问执行完待办 → 标记 outcome
router.post('/:id/complete', (req, res) => {
  const id = Number(req.params.id)
  const b = req.body || {}
  const outcome = String(b.outcome || '已处理').slice(0, 200)
  const fu = Number.isInteger(id) ? db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(id) : null
  if (!fu) return res.status(404).json({ error: '待办不存在' })
  db.prepare('UPDATE follow_ups SET outcome = ? WHERE id = ?').run(outcome, id)
  res.json({ ok: true, id, outcome })
})

export default router
