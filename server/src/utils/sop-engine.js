import { db, now, fmt } from '../db.js'
import { sendInternalWecomMessage, sendWechatMsgToCustomer, inviteCustomerToGroup } from '../wecom.js'

/**
 * utils/sop-engine.js —— 统一 SOP 执行引擎
 *
 * 被以下三处复用：
 *   1. events.js（事件驱动执行，每次 1 customer）
 *   2. scheduler.js（days_inactive 直扫执行，批量 customer）
 *   3. routes/sops.js（手动触发执行，最完整的 coupon/followup/logic）
 *
 * 每个 step 的 action 支持：
 *   push_coupon     → 发优惠券（需 step.coupon_id）
 *   add_tag / note_mark → 给客户打标签（需 step.tag_name）
 *   send_wechat     → 企微消息（降级：写 wecom_events intent 日志）
 *   phone_call      → 电话回访（降级：写 intent）
 *   invite_group    → 拉入社群（降级：写 intent）
 *   assign_staff    → 分配顾问（降级：写 intent）
 *   gift_send       → 寄礼（降级：写 intent）
 *
 * 如果 step 没 action，会尝试从 title/detail 关键词推断。
 */

// === 1. 从中文关键词推断 step action ===
const ACTION_KEYWORDS = [
  { action: 'push_coupon',  kws: ['优惠券', '红包', '领券', '无门槛', '回归礼', '券'] },
  { action: 'send_wechat',  kws: ['企微消息', '私信', '发送', '推送', '触达', '话术', '欢迎语'] },
  { action: 'invite_group', kws: ['社群', '交流群', '打卡群', '进群', '入群'] },
  { action: 'assign_staff', kws: ['顾问', '分配', '专家', '客户经理', '专属'] },
  { action: 'phone_call',   kws: ['电话', '回访', '一对一'] },
  { action: 'gift_send',    kws: ['寄礼', '寄送', '试用装', '礼品'] },
  { action: 'note_mark',   kws: ['标签', '备注', '标记'] },
]

export function inferStepAction(step) {
  if (!step) return null
  if (step.action && step.action !== 'send_wechat') return step.action
  const hay = `${step.title || ''} ${step.detail || ''} ${step.phase || ''}`
  for (const { action, kws } of ACTION_KEYWORDS) {
    if (kws.some(k => hay.includes(k))) return action
  }
  return step.action || 'send_wechat'   // 默认企微消息
}

/**
 * 规范化 step：补全 action，补全 tag_name/coupon_id 默认值
 * 保留原始 step 不变，返回新对象
 */
export function normalizeStep(step, sop) {
  const action = inferStepAction(step)
  const norm = { ...step, action }
  // push_coupon 需要 coupon_id 才能真正发；没配就创建一个默认券
  if (action === 'push_coupon' && !norm.coupon_id) {
    const existing = db.prepare('SELECT id FROM coupons WHERE name LIKE ? LIMIT 1').get(`${sop.name}%`)
    if (existing) { norm.coupon_id = existing.id }
  }
  // add_tag/note_mark 需要 tag_name
  if ((action === 'add_tag' || action === 'note_mark') && !norm.tag_name) {
    const tagFromTitle = (step.title || '').slice(0, 20)
    norm.tag_name = `SOP-${sop.name.slice(0, 8)}-${tagFromTitle}`
  }
  return norm
}

// === 2. 执行单个 step ===
async function executeStep(step, sop, customerId, ctx = {}) {
  const stepType = step.action || step.type
  const logs = []
  // 计算"应该什么时候做"：按 step.delay_days 从 SOP 触发时刻推算
  const delayDays = Number(step.delay_days || 0)
  const nextAt = delayDays > 0
    ? fmt(new Date(Date.now() + delayDays * 86400000))
    : null

  switch (stepType) {
    case 'push_coupon': {
      if (!step.coupon_id) break
      const code = Math.random().toString(36).slice(2, 10).toUpperCase()
      const r = db.prepare(
        `INSERT INTO coupon_issues (coupon_id,customer_id,source,sop_id,sop_step_index,code,status)
         VALUES (?,?,?,?,?,?, 'pending')`
      ).run(step.coupon_id, customerId, `sop:${ctx.source || sop.id}`, sop.id, ctx.stepIndex || 0, code)
      // 券已发放，更新券 issued_count
      db.prepare('UPDATE coupons SET issued_count = COALESCE(issued_count, 0) + 1 WHERE id = ?').run(step.coupon_id)
      logs.push({ kind: 'coupon_issued', coupon_id: step.coupon_id, issue_id: r.lastInsertRowid, code })
      break
    }

    case 'add_tag':
    case 'note_mark': {
      if (!step.tag_name) break
      let tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(step.tag_name)
      if (!tag) {
        const expires = fmt(new Date(Date.now() + 30 * 24 * 3600 * 1000))
        const cat = stepType === 'note_mark' ? 'SOP备注' : 'SOP自动'
        const r = db.prepare('INSERT INTO tags (name, category, mode, expires_at) VALUES (?, ?, ?, ?)')
          .run(step.tag_name, cat, sop.mode || 'retail', expires)
        tag = { id: Number(r.lastInsertRowid) }
      }
      db.prepare('INSERT OR IGNORE INTO customer_tags (customer_id, tag_id) VALUES (?, ?)').run(customerId, tag.id)
      // note_mark 同时写 follow_up
      if (stepType === 'note_mark') {
        db.prepare(
          `INSERT INTO follow_ups (customer_id, staff_id, type, content, outcome, next_followup_at, created_at)
           VALUES (?, NULL, 'sop', ?, '自动执行', ?, ?)`
        ).run(customerId, `[${sop.name}] ${step.title || step.detail || step.tag_name}`, nextAt, now())
        // note_mark 是自动打标签，没有指定顾问，不推企微
      }
      logs.push({ kind: 'tag_applied', tag_id: tag.id, tag_name: step.tag_name })
      break
    }

    case 'assign_staff': {
      // 优先用 step.staff_id 指定的顾问，否则取首位
      let staff = null
      if (step.staff_id) {
        staff = db.prepare('SELECT id, name FROM staff WHERE id = ?').get(step.staff_id)
      }
      if (!staff) {
        staff = db.prepare('SELECT id, name FROM staff LIMIT 1').get()
      }
      if (staff) {
        db.prepare('UPDATE customers SET staff_id = ?, updated_at = ? WHERE id = ?').run(staff.id, now(), customerId)
        db.prepare(
          `INSERT INTO follow_ups (customer_id, staff_id, type, content, outcome, next_followup_at, created_at)
           VALUES (?, ?, 'sop_assign', ?, '自动分配', ?, ?)`
        ).run(customerId, staff.id, `[${sop.name}] 自动分配顾问 ${staff.name}`, nextAt, now())
        // fire-and-forget 推企微：顾问被自动分到新客户了
        void sendInternalWecomMessage({
          staffId: staff.id,
          content: `系统自动分配了新客户：${customerId}（请登录查看客户详情）`,
          title: '🔔 SOP 新顾问分配',
          source: 'sop_engine_assign'
        }).catch(() => {})
        logs.push({ kind: 'staff_assigned', staff_id: staff.id, staff_name: staff.name })
      } else {
        logs.push({ kind: 'intent_logged', target: 'assign_staff', reason: '无可用顾问' })
      }
      break
    }

    case 'invite_group': {
      // === 自动执行类：调企微拉群 API，降级则 outcome=降级未发，不进待办 ===
      const groupInfo = step.group_id
        ? db.prepare('SELECT id, name, chat_id FROM groups WHERE id = ?').get(Number(step.group_id))
        : null
      const customerInfo = db.prepare('SELECT staff_id FROM customers WHERE id = ?').get(customerId)
      const targetStaff = customerInfo?.staff_id ? Number(customerInfo.staff_id) : null
      const groupLabel = groupInfo ? `【${groupInfo.name}】` : ''

      const inviteResult = await inviteCustomerToGroup({
        customerId,
        groupId: groupInfo?.id || Number(step.group_id)
      })
      const outcomeText = inviteResult.simulated
        ? (inviteResult.outcome || '降级未拉')
        : '自动执行:已拉入群'

      db.prepare(
        `INSERT INTO follow_ups (customer_id, staff_id, type, content, outcome, next_followup_at, created_at)
         VALUES (?, ?, 'sop_invite_group', ?, ?, ?, ?)`
      ).run(customerId, targetStaff,
        `[SOP·${sop.name}] 拉群${groupLabel}：${step.title || step.detail || ''}`,
        outcomeText, nextAt, now())

      logs.push({ kind: inviteResult.simulated ? 'intent_logged' : 'invited', target: 'invite_group', group_id: step.group_id, outcome: outcomeText })
      break
    }

    case 'send_wechat': {
      // === 自动执行类：调企微客户消息 API，降级则 outcome=降级未发，不进待办 ===
      const customerInfo = db.prepare('SELECT staff_id FROM customers WHERE id = ?').get(customerId)
      const templateUsed = step.message_template
      const content = step.detail || step.title || ''

      const msgResult = await sendWechatMsgToCustomer({
        customerId,
        staffId: customerInfo?.staff_id ? Number(customerInfo.staff_id) : null,
        content,
        templateId: templateUsed ? Number(step.message_template) : null
      })
      const outcomeText = msgResult.simulated
        ? (msgResult.outcome || '降级未发')
        : '自动执行:已发送'

      db.prepare(
        `INSERT INTO wecom_events (event_type, change_type, payload, created_at)
         VALUES ('sop_step_intent', ?, ?, ?)`
      ).run('send_wechat', JSON.stringify({
        sop_id: sop.id, step_index: ctx.stepIndex, step_title: step.title,
        customer_id: customerId, source: ctx.source || 'sop-engine',
        template: templateUsed ? step.message_template : null,
        wecom_outcome: outcomeText
      }), now())

      db.prepare(
        `INSERT INTO follow_ups (customer_id, staff_id, type, content, outcome, next_followup_at, created_at)
         VALUES (?, ?, 'sop_send_wechat', ?, ?, ?, ?)`
      ).run(customerId, customerInfo?.staff_id ? Number(customerInfo.staff_id) : null,
        `[SOP·${sop.name}] 企微消息：${step.title || step.detail || ''}`,
        outcomeText, nextAt, now())

      logs.push({ kind: msgResult.simulated ? 'intent_logged' : 'sent_wechat', target: 'send_wechat', outcome: outcomeText })
      break
    }

    case 'phone_call':
    case 'gift_send': {
      // === 人工待办类：写 follow_up(outcome=待处理) + 推内部企微 ===
      const customerInfo = db.prepare('SELECT staff_id FROM customers WHERE id = ?').get(customerId)
      const targetStaff = customerInfo?.staff_id ? Number(customerInfo.staff_id) : null

      db.prepare(
        `INSERT INTO wecom_events (event_type, change_type, payload, created_at)
         VALUES ('sop_step_intent', ?, ?, ?)`
      ).run(stepType, JSON.stringify({
        sop_id: sop.id, step_index: ctx.stepIndex, step_title: step.title,
        customer_id: customerId, source: ctx.source || 'sop-engine'
      }), now())

      db.prepare(
        `INSERT INTO follow_ups (customer_id, staff_id, type, content, outcome, next_followup_at, created_at)
         VALUES (?, ?, ?, ?, '待处理', ?, ?)`
      ).run(customerId, targetStaff, `sop_${stepType}`,
        `[SOP·${sop.name}] 待执行 ${ACTION_LABEL[stepType] || stepType}：${step.title || step.detail || ''}`,
        nextAt, now())

      if (targetStaff) {
        const title = stepType === 'phone_call' ? '📞 SOP 电话待办' : '🎁 SOP 寄礼待办'
        const dueLabel = nextAt ? `（应于 ${nextAt.slice(5, 16)} 完成）` : ''
        void sendInternalWecomMessage({
          staffId: targetStaff,
          content: `【SOP·${sop.name}】${ACTION_LABEL[stepType] || stepType}：${step.title || step.detail || ''}${dueLabel}`,
          title, source: 'sop_engine'
        }).catch(() => {})
      }
      logs.push({ kind: 'intent_logged', target: stepType })
      break
    }

    default:
      logs.push({ kind: 'unknown_action', stepType })
  }

  return logs
}

const ACTION_LABEL = {
  send_wechat: '企微消息',
  phone_call: '电话',
  invite_group: '拉群',
  gift_send: '寄礼',
}

// === 3. 对单个客户执行完整 SOP ===
export async function runSopForCustomer(sop, customerId, triggeredBy = 'manual', eventCtx = null) {
  const rawSteps = JSON.parse(sop.steps || '[]')
  const steps = rawSteps.map(s => normalizeStep(s, sop))

  const outcome = {
    couponIssued: 0,
    tagApplied: 0,
    staffAssigned: 0,
    intentLogged: 0,
    details: []
  }

  for (let i = 0; i < steps.length; i++) {
    const logs = await executeStep(steps[i], sop, customerId, { stepIndex: i, source: triggeredBy })
    for (const l of logs) {
      if (l.kind === 'coupon_issued') outcome.couponIssued++
      else if (l.kind === 'tag_applied') outcome.tagApplied++
      else if (l.kind === 'staff_assigned') outcome.staffAssigned++
      else if (l.kind === 'intent_logged') outcome.intentLogged++
    }
    outcome.details.push({ step: i, action: steps[i].action, logs })
  }

  const r = db.prepare(
    `INSERT INTO sop_runs (sop_id, triggered_by, target_count, success_count, outcome, created_at)
     VALUES (?, ?, 1, 1, ?, ?)`
  ).run(sop.id, `${triggeredBy}${eventCtx ? `:event_id=${eventCtx.id}` : ''}`, JSON.stringify(outcome), now())
  db.prepare('UPDATE sops SET run_count = COALESCE(run_count, 0) + 1 WHERE id = ?').run(sop.id)

  return { run_id: r.lastInsertRowid, success: true, outcome }
}

// === 4. 批量执行（给 scheduler.js 用）===
export async function runSopBatch(sop, customerIds, triggeredBy = 'scheduler') {
  let success = 0
  let couponIssued = 0, tagApplied = 0, staffAssigned = 0, intentLogged = 0
  const failed = []

  for (const cid of customerIds) {
    try {
      const r = await runSopForCustomer(sop, cid, triggeredBy)
      success++
      couponIssued += r.outcome.couponIssued
      tagApplied += r.outcome.tagApplied
      staffAssigned += r.outcome.staffAssigned
      intentLogged += r.outcome.intentLogged
    } catch (e) {
      failed.push({ customer_id: cid, error: e.message })
    }
  }

  // 写一条聚合 sop_run（scheduler 批量跑场景用）
  if (customerIds.length > 1) {
    db.prepare(
      `INSERT INTO sop_runs (sop_id, triggered_by, target_count, success_count, outcome, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sop.id, triggeredBy, customerIds.length, success,
      JSON.stringify({ couponIssued, tagApplied, staffAssigned, intentLogged, failed }), now())
  }

  return { success, total: customerIds.length, couponIssued, tagApplied, staffAssigned, intentLogged, failed }
}
