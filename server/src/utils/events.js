import { db, now, fmt } from '../db.js'
import { runSopForCustomer } from './sop-engine.js'
import { matchConditions } from './sop-conditions.js'

/**
 * utils/events.js — 轻量事件总线
 *
 * 设计原则：
 *  1) emit 只写 events 表，不阻塞业务请求。调度器统一消费。
 *  2) 触发 SOP 的时机：事件被 processPendingEvents 消费时，匹配 active=1 且 trigger_type=event.type 的 SOP。
 *  3) SOP 的延迟触发（days_inactive / 首购后 N 小时）在 trigger_delay_hours 上做，消费方计算 created_at + delay
 *     足够久才执行，否则保留事件给下一轮（避免刚 emit 就跑）。
 *  4) 消费完事件后顺手做 A3 客户自动分级（stage 更新不阻塞、异常吞掉打 log）。
 */

/** 事件类型枚举（与 routes/sops.js 的 TRIGGER_TYPES 对齐 + 订单生命周期 + chat） */
export const EVENT_TYPES = new Set([
  // —— 订单生命周期（A1）——
  'order_created',   // 任何订单创建（含 webhook / seckill）
  'order_paid',      // 订单进入 paid（含退款前被误取消再恢复的场景，以最新 paid 事件为准）
  'order_shipped',
  'order_completed',
  'order_cancelled',
  'order_refunded',

  // —— 客户关系（add_friend / customer_created）——
  'add_friend',          // 新好友扫码
  'customer_created',    // 新客户建档（可能不是扫码，是手动建）
  'customer_stage_changed', // A3 客户分级自动变更事件（dashboard 可消费）

  // —— 群聊（chat_join）——
  'chat_join',           // 群成员变动，外部联系人入群
  'chat_keyword',        // 聊到关键词（chat_messages 消费侧 emit）
  'chat_need_reply',     // N 条客户消息未回复，提醒销售

  // —— 秒杀 / 券 ——
  'seckill_grab',
  'coupon_issued',
  'coupon_redeemed',

  // —— 画像驱动 ——
  'high_value',          // 客户 spend 跨阈值
  'churn_warning'        // 客户 last_active 超阈值
])

/** SOP trigger_type → 对应的事件类型映射（消费侧用） */
const SOP_TRIGGER_TO_EVENT = {
  add_friend: 'add_friend',
  first_purchase: 'order_paid',       // 首购后 48h 的 SOP 挂在 order_paid + trigger_days
  days_inactive: 'churn_warning',     // 调度器仍保留 days_inactive 直扫兜底
  high_value: 'high_value',
  chat_join: 'chat_join',
  churn_warning: 'churn_warning',
  custom: null                         // custom 匹配任意事件（见 runMatchingSOPs）
}

const sqlInsertEvent = `INSERT INTO events (type, customer_id, staff_id, payload) VALUES (?, ?, ?, ?)`
const sqlUpdateEventStatus = `UPDATE events SET status=?, consumed_at=?, error=? WHERE id=?`

/**
 * 业务路径 emit 一个事件（只写不处理，同步返回事件 id）
 *
 * @param {string} type   - EVENT_TYPES 里的值
 * @param {object} opts   - { customer_id, staff_id, payload }
 * @returns {number}       events.id
 */
export function emit(type, { customer_id = null, staff_id = null, payload = null } = {}) {
  if (!EVENT_TYPES.has(type)) {
    console.warn(`[events] emit 未知类型: ${type}`)
    return null
  }
  const stmt = db.prepare(sqlInsertEvent)
  const info = stmt.run(
    type,
    customer_id != null ? Number(customer_id) : null,
    staff_id != null ? Number(staff_id) : null,
    payload != null ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : null
  )
  return Number(info.lastInsertRowid)
}

/**
 * 消费一批 pending events → 匹配 SOP → 执行 → 顺手做客户自动分级
 *
 * @param {number} batchSize - 每轮处理上限，避免 scheduler 单轮阻塞
 * @returns {{ processed: number, sopRuns: number, errors: number, autoStaged: number }}
 */
export function processPendingEvents(batchSize = 50) {
  const events = db.prepare(`
    SELECT * FROM events
    WHERE status = 'pending'
    ORDER BY id ASC
    LIMIT ?
  `).all(batchSize)

  let sopRuns = 0
  let errors = 0
  let autoStaged = 0

  for (const e of events) {
    // 1. 先标 processing，防止并发调度器重复消费
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run('processing', e.id)

    try {
      // 2. 匹配 SOP
      sopRuns += runMatchingSOPs(e)

      // 3. 客户自动分级（仅对 customer_id 有值的事件）
      if (e.customer_id) {
        autoStaged += autoStageCustomer(e.customer_id, e.type)
      }

      // 4. 标记 done
      db.prepare('UPDATE events SET status=?, consumed_at=? WHERE id=?').run('done', now(), e.id)
    } catch (err) {
      errors++
      db.prepare('UPDATE events SET status=?, consumed_at=?, error=? WHERE id=?').run(
        'failed', now(), String(err?.message || err).slice(0, 500), e.id
      )
    }
  }

  // 5. 顺手处理 delayed：有些 SOP 有 trigger_days 延时条件，事件已消费但 SOP 没达到 delay，
  //    调度器每 1 分钟还会有一次 runDelayedSOPs 扫 "事件 created_at + delay < now" 才执行
  runDelayedSOPs()

  return { processed: events.length, sopRuns, errors, autoStaged }
}

/** 解析 event payload 中的 spend（high_value 阈值校验用） */
function extractSpendFromPayload(e) {
  try {
    const p = e.payload ? JSON.parse(e.payload) : null
    return Number(p?.spend ?? p?.amount ?? 0) || 0
  } catch { return 0 }
}

/** 对一条 event 找所有触发条件满足的 active SOP → 执行 steps */
function runMatchingSOPs(e) {
  if (!e.customer_id) return 0   // 没有客户 ID 的事件不触发 SOP

  // 1. 先按事件类型映射找 trigger_type
  let matchedTriggerTypes = []
  for (const [sopType, evt] of Object.entries(SOP_TRIGGER_TO_EVENT)) {
    if (evt === e.type) matchedTriggerTypes.push(sopType)
  }

  // 2. custom 类型：任何事件都可匹配（custom 是最灵活的"手动/任意事件触发"型 SOP）
  matchedTriggerTypes.push('custom')

  const hoursSinceCreated = e.created_at
    ? (Date.now() - new Date(e.created_at + 'Z').getTime()) / 3600000
    : 0
  const channel = extractChannelFromPayload(e)
  const spend = extractSpendFromPayload(e)

  let executed = 0
  for (const triggerType of matchedTriggerTypes) {
    let sql = `
      SELECT * FROM sops
      WHERE active = 1 AND trigger_type = ?
        AND (trigger_days IS NULL OR trigger_days = 0 OR ? >= trigger_days * 24)
        AND (trigger_channel IS NULL OR trigger_channel = ?)
    `
    const params = [triggerType, Math.floor(hoursSinceCreated), channel]

    // high_value: 必须 event payload 里 spend >= sop.trigger_min_spend
    if (triggerType === 'high_value') {
      sql += ` AND (trigger_min_spend IS NULL OR trigger_min_spend <= ?)`
      params.push(spend)
    }

    const sopList = db.prepare(sql).all(...params)
    for (const sop of sopList) {
      try {
        // 条件过滤（所有 trigger_type 都支持额外条件，custom 类型尤其依赖）
        const conds = tryParse(sop.conditions)
        if (conds && Array.isArray(conds.rules) && conds.rules.length > 0) {
          const hit = matchConditions(conds, e.customer_id, { type: e.type, payload: e.payload })
          if (!hit) continue
        }
        runSopForCustomer(sop, e.customer_id, `event:${e.type}`, e)
        executed++
      } catch (err) {
        console.error(`[events] SOP #${sop.id} 执行失败: ${err.message}`)
      }
    }
  }
  return executed
}

/** delayed SOP：事件 created_at + trigger_days 已到期但之前没跑过的 */
function runDelayedSOPs() {
  const SOP_TYPES_WITH_DELAY = ['first_purchase', 'days_inactive', 'chat_join', 'custom']
  for (const triggerType of SOP_TYPES_WITH_DELAY) {
    const eventType = SOP_TRIGGER_TO_EVENT[triggerType] || 'customer_stage_changed'
    const delayedSops = db.prepare(`
      SELECT s.*, e.id AS event_id, e.customer_id AS customer_id
      FROM sops s
      JOIN events e ON e.type = ?
      WHERE s.active = 1 AND s.trigger_type = ?
        AND s.trigger_days > 0
        AND e.status = 'done'
        AND datetime(e.created_at, '+' || s.trigger_days || ' days') < datetime('now')
        AND e.created_at >= datetime('now', '-30 days')
    `).all(eventType, triggerType)

    for (const d of delayedSops) {
      const already = db.prepare(`
        SELECT id FROM sop_runs WHERE sop_id = ? AND triggered_by LIKE ? LIMIT 1
      `).get(d.id, `%event_id=${d.event_id}%`)
      if (already) continue
      try {
        runSopForCustomer(d, d.customer_id, `event:${eventType}:delay`, { id: d.event_id, type: eventType })
      } catch { /* 吞 */ }
    }
  }
}

function extractChannelFromPayload(e) {
  try {
    const p = e.payload ? JSON.parse(e.payload) : null
    return p?.channel || null
  } catch { return null }
}

// ========= A3 客户自动分级 =========
/**
 * 事件驱动的客户 stage 自动更新。
 *
 * 规则（可配置：写死在这，未来可移到配置表）：
 *  loyal : orders >= 3 AND spend >= 2000 AND last_active 30d 内
 *  mature: orders >= 2 AND NOT churn AND last_active 60d 内
 *  churn : last_active 超 90d AND orders >= 1
 *  new   : default（所有新客户）
 *
 *  @returns {number} 1 表示本次 stage 有变化，0 无变化
 */
export function autoStageCustomer(customerId, reason = 'event') {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(customerId))
  if (!c) return 0

  const lastActive = c.last_active ? new Date(c.last_active + 'Z') : new Date(c.created_at + 'Z')
  const daysSinceActive = (Date.now() - lastActive.getTime()) / 86400000

  let next = 'new'
  if (c.orders >= 3 && c.spend >= 2000 && daysSinceActive <= 30) next = 'loyal'
  else if (daysSinceActive > 90 && c.orders >= 1) next = 'churn'
  else if (c.orders >= 2 && daysSinceActive <= 60) next = 'mature'
  else if (daysSinceActive <= 7) next = 'new'
  else next = c.stage || 'new'   // 灰区保留原 stage

  if (next === c.stage) return 0
  db.prepare('UPDATE customers SET stage = ?, updated_at = ? WHERE id = ?').run(next, now(), c.id)
  // 打一条小事件，给 dashboard 看
  emit('customer_stage_changed', { customer_id: c.id, payload: JSON.stringify({ from: c.stage, to: next, reason }) })
  return 1
}

/** 兜底：直接跑全量客户分级（调度器每 6h 一次） */
export function rescanAllCustomerStages() {
  const rows = db.prepare('SELECT id FROM customers').all()
  let changed = 0
  for (const r of rows) changed += autoStageCustomer(r.id, 'rescan')
  return changed
}
