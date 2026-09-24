import express from 'express'
import { db, initSchema, now, daysSince } from '../db.js'
import { validateConditions, conditionsToHuman, CONDITION_FIELDS, CONDITION_OPERATORS } from '../utils/sop-conditions.js'
import { runSopBatch } from '../utils/sop-engine.js'

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
  let created_by_name = null
  if (row.created_by) {
    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(row.created_by)
    if (u) created_by_name = u.name
  }
  return {
    id: row.id,
    name: row.name,
    trigger_desc: row.trigger_desc,
    trigger_type: row.trigger_type || 'days_inactive',
    trigger_days: row.trigger_days || 0,
    trigger_min_spend: row.trigger_min_spend || 0,
    trigger_channel: row.trigger_channel || null,
    steps: parseSteps(row.steps),
    conditions,
    conditions_human: conditions ? conditionsToHuman(conditions) : null,
    run_count: row.run_count || 0,
    conversion: row.conversion || 0,
    active: row.active ? 1 : 0,
    mode: row.mode || 'retail',
    scope: row.scope || 'all',        // all=全局对全部客户生效, mine=仅创建者名下客户
    created_by: row.created_by || null,
    created_by_name,
    is_template: row.is_template ? 1 : 0,
    created_at: row.created_at || null
  }
}

/** 从 req.user 派生 staff.id（后端强约束，不信任前端） */
function deriveStaffId(user) {
  if (!user) return null
  // 优先 wecom_userid 精确匹配
  if (user.wecomUserid) {
    const s = db.prepare('SELECT id FROM staff WHERE wecom_userid = ?').get(user.wecomUserid)
    if (s) return Number(s.id)
  }
  if (user.account && user.account.startsWith('SIM_')) {
    const s = db.prepare('SELECT id FROM staff WHERE wecom_userid = ?').get(user.account)
    if (s) return Number(s.id)
  }
  if (user.id) {
    const u = db.prepare('SELECT wecom_userid FROM users WHERE id = ?').get(user.id)
    if (u?.wecom_userid) {
      const s = db.prepare('SELECT id FROM staff WHERE wecom_userid = ?').get(u.wecom_userid)
      if (s) return Number(s.id)
    }
  }
  return null
}

/** admin 判定：users.account='admin'（单一可信源，同时支持 JWT 和 API Token） */
function isAdmin(user) {
  if (!user) return false
  if (user.account === 'admin') return true
  if (user.id) {
    const u = db.prepare('SELECT account FROM users WHERE id = ?').get(user.id)
    if (u?.account === 'admin') return true
  }
  return false
}

router.get('/', (req, res) => {
  const mode = req.query.mode
  const includeTemplates = req.query.include_templates === '1'
  let sql = 'SELECT * FROM sops'
  const where = []
  const params = []
  if (mode === 'retail' || mode === 'service') { where.push('mode = ?'); params.push(mode) }
  if (!includeTemplates) { where.push('(is_template IS NULL OR is_template = 0)') }
  if (where.length) sql += ' WHERE ' + where.join(' AND ')
  sql += ' ORDER BY is_template ASC, run_count DESC, id ASC'
  const rows = db.prepare(sql).all(...params)
  const list = rows.map(serializeSop)
  // 附加 _meta：前端据此决定是否显示 scope 下拉、是否过滤列表
  const userAcc = req.user?.id ? (db.prepare('SELECT account, name FROM users WHERE id = ?').get(req.user.id)?.account || null) : null
  res.json({
    items: list,
    _meta: {
      is_admin: isAdmin(req.user),
      me: req.user ? {
        id: req.user.id,
        account: userAcc || req.user.account,
        name: db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id)?.name || null,
        wecom_userid: req.user.wecomUserid || null
      } : null
    }
  })
})

router.get('/meta/conditions', (req, res) => {
  // 动态把 tags 表的数据注入到 CONDITION_FIELDS 的 tags 字段 options 里
  let tagsList = []
  try {
    tagsList = db.prepare('SELECT DISTINCT name FROM tags ORDER BY name').all().map(r => r.name)
  } catch (_) { /* tags 表不存在时忽略 */ }

  const fields = CONDITION_FIELDS.map(f => {
    if (f.value === 'tags') {
      // 把 tags 从 string 升级成 enum，带所有已存在标签作选项
      return {
        ...f,
        type: 'enum',
        hint: null,
        options: tagsList.map(n => ({ value: n, label: n }))
      }
    }
    return { ...f }
  })

  res.json({ fields, operators: CONDITION_OPERATORS })
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
  let staffId = null
  if ((row.scope || 'all') === 'mine') {
    staffId = deriveStaffId(req.user)
    if (!staffId) return res.status(400).json({ error: '无法识别您名下的客户归属，请先绑定企微账号' })
  }
  const customers = matchSopCustomers(row, 50, staffId)
  res.json({ total: customers.length, customers })
})

router.post('/', (req, res) => {
  const b = req.body || {}
  const { errors, triggerType, steps, name, mode, raw } = validateSopDSL(b)
  if (errors.length) return res.status(400).json({ error: errors.join('；') })

  // === scope 强约束 ===
  // all = 系统级对全部客户生效（仅 admin 能建）
  // mine = 仅创建者名下客户（所有登录用户都能建）
  const admin = isAdmin(req.user)
  let scope = b.scope === 'mine' ? 'mine' : 'all'
  if (scope === 'all' && !admin) {
    // 非 admin 请求 scope=all → 自动降级 mine，不直接拒绝（前端可能传了默认值）
    scope = 'mine'
  }
  if (scope === 'mine' && !admin) {
    const staffId = deriveStaffId(req.user)
    if (!staffId) return res.status(400).json({ error: '无法识别您名下的客户归属，请先绑定企微账号' })
  }

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
      `INSERT INTO sops (name, trigger_desc, trigger_type, trigger_days, trigger_min_spend, trigger_channel, steps, conditions, run_count, conversion, active, mode, created_at, scope, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?, ?, ?)`
    ).run(
      name, triggerDesc, triggerType, triggerDays, triggerMinSpend,
      raw.trigger_channel || null, JSON.stringify(steps), conditionsJson, mode, now(),
      scope, req.user?.id || null
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
  if (row.is_template) return res.status(403).json({ error: '系统模板只读，不可编辑。请先克隆到「我的 SOP」再修改。' })

  // === 编辑权限 ===
  const admin = isAdmin(req.user)
  // scope=all 的系统级 SOP：仅 admin 能改
  if ((row.scope || 'all') === 'all' && !admin) {
    return res.status(403).json({ error: '系统级 SOP（scope=全局）仅管理员可编辑' })
  }
  // scope=mine 的私人 SOP：创建者本人可改
  if ((row.scope || 'all') === 'mine' && row.created_by && row.created_by !== req.user?.id && !admin) {
    return res.status(403).json({ error: '这是他人创建的私人 SOP，无权限编辑' })
  }

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
  // scope 字段：仅 admin 能改（all↔mine）
  if (b.scope !== undefined) {
    if (!admin) return res.status(403).json({ error: 'scope（作用域）仅管理员可修改' })
    if (b.scope !== 'all' && b.scope !== 'mine') return res.status(400).json({ error: 'scope 必须是 all 或 mine' })
    sets.push('scope = ?'); params.push(b.scope)
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
  if (row.is_template) return res.status(403).json({ error: '系统模板只读，不可激活。请先克隆到「我的 SOP」。' })
  const active = row.active ? 0 : 1
  db.prepare('UPDATE sops SET active = ? WHERE id = ?').run(active, id)
  res.json(serializeSop({ ...row, active }))
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM sops WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: 'SOP 不存在' })
  if (row.is_template) return res.status(403).json({ error: '系统模板不可删除。' })

  // === 删除权限 ===
  const admin = isAdmin(req.user)
  if ((row.scope || 'all') === 'all' && !admin) {
    return res.status(403).json({ error: '系统级 SOP（scope=全局）仅管理员可删除' })
  }
  if ((row.scope || 'all') === 'mine' && row.created_by && row.created_by !== req.user?.id && !admin) {
    return res.status(403).json({ error: '这是他人创建的私人 SOP，无权限删除' })
  }

  const r = db.prepare('DELETE FROM sops WHERE id = ?').run(id)
  res.json({ ok: true })
})

router.post('/:id/clone', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM sops WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: 'SOP 不存在' })
  // 克隆出来的副本：scope 降为 mine（除非 admin），created_by 换成当前用户
  const admin = isAdmin(req.user)
  const targetScope = admin ? (row.scope || 'all') : 'mine'
  try {
    const r = db.prepare(
      `INSERT INTO sops (name, trigger_desc, trigger_type, trigger_days, trigger_min_spend, trigger_channel, steps, conditions, run_count, conversion, active, mode, created_at, is_template, scope, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, 0, ?, ?)`
    ).run(
      row.name + (row.is_template ? '' : '（副本）'),
      row.trigger_desc, row.trigger_type, row.trigger_days, row.trigger_min_spend,
      row.trigger_channel, row.steps, row.conditions, row.mode, now(),
      targetScope, req.user?.id || null
    )
    const cloned = db.prepare('SELECT * FROM sops WHERE id = ?').get(Number(r.lastInsertRowid))
    res.status(201).json(serializeSop(cloned))
  } catch (e) {
    res.status(400).json({ error: '克隆失败：' + e.message })
  }
})

// 手动触发执行 SOP → 统一走 sop-engine（与事件驱动 / 调度器同一入口，分层逻辑一致）
router.post('/:id/run', async (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM sops WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: 'SOP 不存在' })
  if (row.is_template) return res.status(403).json({ error: '系统模板不可执行。请先克隆到「我的 SOP」后激活执行。' })
  if (!row.active) return res.status(400).json({ error: 'SOP 未激活，无法执行' })

  const b = req.body || {}
  const limit = Math.min(500, Math.max(1, Number(b.limit) || 20))

  // === scope 过滤：mine 类型 → 只匹配创建者名下客户 ===
  let staffId = null
  if ((row.scope || 'all') === 'mine') {
    staffId = deriveStaffId(req.user)
    if (!staffId) return res.status(400).json({ error: '无法识别您名下的客户归属，请先绑定企微账号' })
  }
  const customers = matchSopCustomers(row, limit, staffId)
  if (!customers.length) {
    return res.json({ ok: true, run_id: null, sop_id: id, target_count: 0, success_count: 0, note: staffId ? '您名下暂无可匹配客户' : '无匹配客户' })
  }

  const triggeredBy = b.triggered_by || '手动触发'
  const customerIds = customers.map(c => c.id)
  const result = await runSopBatch(row, customerIds, triggeredBy)

  // sop-engine 内部已写 sop_runs（批量时还会额外写一条聚合记录），拿最新一条给前端
  const lastRun = db.prepare('SELECT id FROM sop_runs WHERE sop_id = ? ORDER BY id DESC LIMIT 1').get(id)

  res.json({
    ok: true,
    run_id: lastRun?.id || null,
    sop_id: id,
    target_count: result.total,
    success_count: result.success,
    coupon_issued: result.couponIssued,
    staff_assigned: result.staffAssigned,
    tag_applied: result.tagApplied,
    intent_logged: result.intentLogged,
    failed: result.failed.length,
    triggered_by: triggeredBy
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
// staffId 非 null 时追加 AND customers.staff_id = ?（scope=mine 过滤）
function matchSopCustomers(sop, limit = 50, staffId = null) {
  const triggerType = sop.trigger_type || 'days_inactive'
  const mode = sop.mode || 'retail'
  const params = [mode]
  let where = 'customer_type = ?'

  switch (triggerType) {
    case 'add_friend': {
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
  // scope=mine → 只取该顾问名下客户
  if (staffId != null) {
    where += ' AND staff_id = ?'
    params.push(staffId)
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
