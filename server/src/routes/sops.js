import express from 'express'
import { db, initSchema, now, daysSince } from '../db.js'
import { validateConditions, conditionsToHuman, CONDITION_FIELDS, CONDITION_OPERATORS } from '../utils/sop-conditions.js'

// 确保 schema 已补齐（新库无 ALTER，老库有 ALTER）
initSchema()

const router = express.Router()

// === DSL 契约：单一入口解析 ===
// 经验 100019713：所有条件分支必须在同一个判定入口完成解析；未知字段显式失败
const TRIGGER_TYPES = new Set([
  'add_friend',      // 加好友
  'first_purchase',  // 首购后
  'days_inactive',   // N 天未互动
  'high_value',      // 高消费客户
  'chat_join',       // 入群
  'churn_warning',    // 流失预警
  'custom'           // 自定义
])

const ACTION_TYPES = new Set([
  'send_wechat',     // 发送企微消息
  'push_coupon',     // 推送优惠券
  'invite_group',    // 拉入群
  'assign_staff',    // 分配顾问
  'send_sms',        // 短信
  'phone_call',      // 电话
  'gift_send',       // 寄礼
  'note_mark'        // 打标签备注
])

function parseSteps(s) {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch (e) {
    return []
  }
}

/** 校验 DSL —— 未知字段显式失败（不静默忽略） */
function validateSopDSL(body) {
  const errors = []
  const name = body.name && String(body.name).trim()
  if (!name) errors.push('SOP 名称不能为空')

  const triggerType = body.trigger_type || body.triggerType || 'days_inactive'
  if (!TRIGGER_TYPES.has(triggerType)) {
    errors.push(`trigger_type 非法：${triggerType}，支持 ${[...TRIGGER_TYPES].join(',')}`)
  }

  const steps = Array.isArray(body.steps) ? body.steps : []
  if (steps.length === 0) errors.push('至少需要 1 个执行步骤')
  steps.forEach((step, i) => {
    if (!step || typeof step !== 'object') {
      errors.push(`第 ${i + 1} 步格式非法`)
      return
    }
    if (!step.title) errors.push(`第 ${i + 1} 步缺少 title`)
    if (step.action && !ACTION_TYPES.has(step.action)) {
      errors.push(`第 ${i + 1} 步 action 非法：${step.action}，支持 ${[...ACTION_TYPES].join(',')}`)
    }
  })

  const mode = body.mode === 'service' ? 'service' : 'retail'
  return { errors, triggerType, steps, name, mode, raw: body }
}

function serializeSop(row) {
  if (!row) return row
  let conditions = null
  try { conditions = row.conditions ? JSON.parse(row.conditions) : null } catch {}
  return {
    id: row.id,
    name: row.name,
    trigger_desc: row.trigger_desc,
    trigger_type: row.trigger_type || 'days_inactive',
    trigger_days: row.trigger_days || 0,
    trigger_min_spend: row.trigger_min_spend || 0,
    trigger_channel: row.trigger_channel || null,
    steps: parseSteps(row.steps),
    conditions,                              // ← 可视化条件（null 表示无条件）
    conditions_human: conditions ? conditionsToHuman(conditions) : null,  // ← 人类可读描述
    run_count: row.run_count || 0,
    conversion: row.conversion || 0,
    active: row.active ? 1 : 0,
    mode: row.mode || 'retail',
    created_at: row.created_at || null
  }
}

router.get('/', (req, res) => {
  const mode = req.query.mode
  const sql = 'SELECT * FROM sops ORDER BY id'
  const rows = (mode === 'retail' || mode === 'service')
    ? db.prepare('SELECT * FROM sops WHERE mode = ? ORDER BY id').all(mode)
    : db.prepare(sql).all()
  res.json(rows.map(serializeSop))
})

router.get('/meta/conditions', (req, res) => {
  res.json({ fields: CONDITION_FIELDS, operators: CONDITION_OPERATORS })
})

router.get('/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM sops WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: 'SOP 不存在' })
  res.json(serializeSop(row))
})

// 匹配 SOP 触发条件的客户预览（给前端新建规则时做预估覆盖人数）
router.get('/:id/customers', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM sops WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: 'SOP 不存在' })
  const customers = matchSopCustomers(row, 50)
  res.json({ total: customers.length, customers })
})

router.post('/', (req, res) => {
  const b = req.body || {}
  const { errors, triggerType, steps, name, mode, raw } = validateSopDSL(b)
  if (errors.length) return res.status(400).json({ error: errors.join('；') })

  // 自动生成可读 trigger_desc（可被调用方覆盖）
  const triggerDesc = b.trigger_desc?.trim() || buildTriggerDesc(triggerType, raw)
  const triggerDays = triggerType === 'days_inactive' ? Math.max(1, Number(raw.trigger_days) || 30) : 0
  const triggerMinSpend = triggerType === 'high_value' ? Math.max(0, Number(raw.trigger_min_spend) || 500) : 0

  // 自定义条件校验
  let conditionsJson = null
  if (b.conditions && typeof b.conditions === 'object') {
    const condErrors = validateConditions(b.conditions)
    if (condErrors.length) return res.status(400).json({ error: '条件校验失败：' + condErrors.join('；') })
    conditionsJson = JSON.stringify(b.conditions)
  }

  try {
    const r = db.prepare(
      `INSERT INTO sops (name, trigger_desc, trigger_type, trigger_days, trigger_min_spend, trigger_channel, steps, conditions, run_count, conversion, active, mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?)`
    ).run(
      name, triggerDesc, triggerType, triggerDays, triggerMinSpend,
      raw.trigger_channel || null, JSON.stringify(steps), conditionsJson, mode, now()
    )
    const row = db.prepare('SELECT * FROM sops WHERE id = ?').get(Number(r.lastInsertRowid))
    res.status(201).json(serializeSop(row))
  } catch (e) {
    res.status(400).json({ error: '新建 SOP 失败：' + e.message })
  }
})

router.put('/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM sops WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: 'SOP 不存在' })
  const b = req.body || {}

  // 校验（若传了 trigger_type/steps 则校验）
  if (b.trigger_type || Array.isArray(b.steps)) {
    const merged = { ...row, ...b }
    const { errors } = validateSopDSL(merged)
    if (errors.length) return res.status(400).json({ error: errors.join('；') })
  }

  const sets = []
  const params = []
  for (const k of ['name', 'trigger_desc', 'trigger_type', 'trigger_days', 'trigger_min_spend', 'trigger_channel', 'mode']) {
    if (b[k] !== undefined) { sets.push(`${k} = ?`); params.push(b[k]) }
  }
  if (Array.isArray(b.steps)) { sets.push('steps = ?'); params.push(JSON.stringify(b.steps)) }
  if (b.active !== undefined) { sets.push('active = ?'); params.push(b.active ? 1 : 0) }
  // conditions 更新（允许传 null 清空）
  if (b.conditions !== undefined) {
    if (b.conditions && typeof b.conditions === 'object') {
      const condErrors = validateConditions(b.conditions)
      if (condErrors.length) return res.status(400).json({ error: '条件校验失败：' + condErrors.join('；') })
      sets.push('conditions = ?'); params.push(JSON.stringify(b.conditions))
    } else {
      sets.push('conditions = NULL');
    }
  }
  if (!sets.length) return res.status(400).json({ error: '没有可更新的字段' })
  params.push(id)
  db.prepare(`UPDATE sops SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const updated = db.prepare('SELECT * FROM sops WHERE id = ?').get(id)
  res.json(serializeSop(updated))
})

router.put('/:id/toggle', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM sops WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: 'SOP不存在' })
  const active = row.active ? 0 : 1
  db.prepare('UPDATE sops SET active = ? WHERE id = ?').run(active, id)
  res.json(serializeSop({ ...row, active }))
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const r = Number.isInteger(id) ? db.prepare('DELETE FROM sops WHERE id = ?').run(id) : null
  if (!r || !r.changes) return res.status(404).json({ error: 'SOP 不存在' })
  res.json({ ok: true })
})

router.post('/:id/clone', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM sops WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: 'SOP 不存在' })
  try {
    const r = db.prepare(
      `INSERT INTO sops (name, trigger_desc, trigger_type, trigger_days, trigger_min_spend, trigger_channel, steps, conditions, run_count, conversion, active, mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`
    ).run(
      row.name + '（克隆）', row.trigger_desc, row.trigger_type, row.trigger_days, row.trigger_min_spend,
      row.trigger_channel, row.steps, row.conditions, row.mode, now()
    )
    const cloned = db.prepare('SELECT * FROM sops WHERE id = ?').get(Number(r.lastInsertRowid))
    res.status(201).json(serializeSop(cloned))
  } catch (e) {
    res.status(400).json({ error: '克隆失败：' + e.message })
  }
})

// 手动触发执行 SOP → 匹配客户 → 真发券/写跟进 → 执行日志
router.post('/:id/run', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM sops WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: 'SOP 不存在' })
  if (!row.active) return res.status(400).json({ error: 'SOP 未激活，无法执行' })

  const b = req.body || {}
  const limit = Math.min(500, Math.max(1, Number(b.limit) || 20))
  const customers = matchSopCustomers(row, limit)
  const steps = parseSteps(row.steps)

  // 预加载 push_coupon 用到的券模板，避免事务内反复查
  const couponIds = steps.filter(s => s.action === 'push_coupon' && s.coupon_id).map(s => Number(s.coupon_id))
  const couponsMap = {}
  for (const cid of couponIds) {
    couponsMap[cid] = db.prepare('SELECT * FROM coupons WHERE id = ?').get(cid)
  }

  const r = db.prepare(
    'INSERT INTO sop_runs (sop_id, triggered_by, target_count, created_at) VALUES (?, ?, ?, ?)'
  ).run(id, b.triggered_by || '手动触发', customers.length, now())
  const runId = Number(r.lastInsertRowid)

  let successCount = 0
  let couponIssuedTotal = 0
  let couponSkippedTotal = 0

  const insFollowup = db.prepare(
    `INSERT INTO follow_ups (customer_id, staff_id, type, content, outcome, next_followup_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const insIssue = db.prepare(
    `INSERT INTO coupon_issues (coupon_id,customer_id,source,sop_id,sop_step_index,staff_id,code,expires_at)
     VALUES (?,?,?,?,?,?,?,?)`
  )
  const checkIssue = db.prepare('SELECT 1 FROM coupon_issues WHERE coupon_id=? AND customer_id=?')
  const updCouponIssued = db.prepare('UPDATE coupons SET issued_count = issued_count + 1 WHERE id=?')

  const updRun = db.prepare(
    'UPDATE sop_runs SET success_count = ?, outcome = ? WHERE id = ?'
  )
  const updRunCount = db.prepare('UPDATE sops SET run_count = run_count + ?, created_at = ? WHERE id = ?')

  const typeMap = {
    send_wechat: 'wechat',
    push_coupon: 'wechat',
    invite_group: 'wechat',
    assign_staff: 'note',
    send_sms: 'wechat',
    phone_call: 'call',
    gift_send: 'gift',
    note_mark: 'note'
  }

  const tx = db.transaction(() => {
    for (const c of customers) {
      for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
        const step = steps[stepIdx]
        const type = typeMap[step.action || 'send_wechat'] || 'wechat'
        let content = `${row.name} · ${step.phase || ''} ${step.title} ${step.detail || ''}`.trim()
        let outcome = 'SOP 自动下发'

        // === push_coupon 真发券 ===
        if (step.action === 'push_coupon' && step.coupon_id) {
          const couponId = Number(step.coupon_id)
          const coupon = couponsMap[couponId]
          if (coupon && coupon.active === 1 && coupon.issued_count < coupon.total_stock) {
            const dup = checkIssue.get(couponId, c.id)
            if (!dup) {
              // 券码
              const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
              let code = 'CP'
              for (let i = 0; i < 10; i++) code += chars[Math.floor(Math.random() * chars.length)]
              insIssue.run(couponId, c.id, `sop:${id}`, id, stepIdx, c.staff_id, code, coupon.end_at)
              updCouponIssued.run(couponId)
              couponIssuedTotal++
              outcome = `已发券 CP**${code.slice(-4)}`
              content += ` [券:${coupon.name} 码:${code}]`
            } else {
              couponSkippedTotal++
              outcome = '客户已有该券，跳过'
            }
          } else {
            outcome = coupon ? `券已发完/停用` : `券模板不存在 #${couponId}`
          }
        }

        // === gift_send 预留：写业务实体 ===
        if (step.action === 'gift_send') {
          outcome = outcome === 'SOP 自动下发' ? '礼品寄送单已生成（待企微对接物流）' : outcome
        }

        const delayDays = Number(step.delay_days || 0)
        const nextAt = delayDays > 0
          ? fmt(new Date(Date.now() + delayDays * 86400000))
          : null
        insFollowup.run(c.id, c.staff_id, type, content, outcome, nextAt, now())
      }
      successCount++
    }
    updRun.run(successCount, JSON.stringify({
      steps: steps.length,
      sop: row.name,
      coupon_issued: couponIssuedTotal,
      coupon_skipped: couponSkippedTotal
    }), runId)
    updRunCount.run(successCount, now(), id)
  })
  tx()

  res.json({
    ok: true,
    run_id: runId,
    sop_id: id,
    target_count: customers.length,
    success_count: successCount,
    steps_per_customer: steps.length,
    coupon_issued: couponIssuedTotal,
    coupon_skipped: couponSkippedTotal,
    triggered_by: b.triggered_by || '手动触发'
  })
})

router.get('/runs/all', (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 30))
  const rows = db.prepare(
    `SELECT r.*, s.name AS sop_name FROM sop_runs r LEFT JOIN sops s ON s.id = r.sop_id ORDER BY r.id DESC LIMIT ?`
  ).all(limit)
  res.json(rows)
})

// === 辅助：构建可读 trigger_desc ===
function buildTriggerDesc(triggerType, b) {
  switch (triggerType) {
    case 'add_friend': return '企微好友通过验证后自动激活'
    case 'first_purchase': return '客户完成首购后自动激活'
    case 'days_inactive': return `${b.trigger_days || 30} 天未互动自动触发`
    case 'high_value': return `单笔消费 ≥ ${b.trigger_min_spend || 500} 元自动触发`
    case 'chat_join': return '客户加入社群后自动触发'
    case 'churn_warning': return '客户进入流失预警阶段自动触发'
    case 'custom': return b.trigger_desc || '自定义触发条件'
    default: return '自定义触发条件'
  }
}

// === 辅助：匹配 SOP 触发条件的客户（单一入口，可解释）===
function matchSopCustomers(sop, limit = 50) {
  const triggerType = sop.trigger_type || 'days_inactive'
  const mode = sop.mode || 'retail'
  const params = [mode]
  let where = 'customer_type = ?'

  switch (triggerType) {
    case 'add_friend': {
      // 最近 7 天内的新客
      where += " AND stage = ? AND created_at >= datetime('now', '-7 days')"
      params.push('new')
      break
    }
    case 'first_purchase': {
      where += " AND orders = 1 AND stage IN ('new', 'mature')"
      break
    }
    case 'days_inactive': {
      const days = Math.max(1, Number(sop.trigger_days) || 30)
      const threshold = fmt(new Date(Date.now() - days * 86400000))
      where += ' AND (last_active IS NULL OR last_active < ?)'
      params.push(threshold)
      break
    }
    case 'high_value': {
      const min = Number(sop.trigger_min_spend) || 500
      where += ' AND spend >= ?'
      params.push(min)
      break
    }
    case 'chat_join': {
      // 有关联企微 chat_id 的客户
      where += ' AND wecom_external_userid IS NOT NULL AND wecom_external_userid != ""'
      break
    }
    case 'churn_warning': {
      where += ' AND stage = ?'
      params.push('churn')
      break
    }
    case 'custom': {
      // 自定义：默认跑所有客户
      break
    }
  }
  params.push(limit)
  return db.prepare(
    `SELECT id, name, stage, spend, orders, last_active, staff_id, channel FROM customers WHERE ${where} ORDER BY id DESC LIMIT ?`
  ).all(...params)
}

function fmt(dt) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`
}

export default router
