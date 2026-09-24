import { db } from '../db.js'
import { log } from '../wecom.js'
import { processPendingEvents } from './events.js'

/**
 * utils/daily-report.js — 自动运营日报聚合
 *
 * scheduler 每天 08:00 跑一次 runDailyReport()，把结果写入 wecom_events (payload)
 * 方便后续企微/飞书推送通道消费。也暴露 REST /api/reports/daily 让运营手动看。
 */

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10)
}

function dayRange(day) {
  const start = `${day} 00:00:00`
  const end = `${day} 23:59:59`
  return { start, end }
}

export function runDailyReport(day = dayKey()) {
  const { start, end } = dayRange(day)
  const prev = db.prepare("SELECT DATE('now', '-1 day') AS d").get().d

  const todayNew = db.prepare('SELECT COUNT(*) AS n FROM customers WHERE created_at BETWEEN ? AND ?').get(start, end).n
  const prevNew = db.prepare('SELECT COUNT(*) AS n FROM customers WHERE DATE(created_at) = ?').get(prev).n
  const todayOrders = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(paid_amount),0) AS amt FROM orders WHERE DATE(order_at) = ?").get(day).n
  const todayOrderAmt = db.prepare("SELECT COALESCE(SUM(paid_amount),0) AS amt FROM orders WHERE DATE(order_at) = ?").get(day).amt
  const prevOrderAmt = db.prepare("SELECT COALESCE(SUM(paid_amount),0) AS amt FROM orders WHERE DATE(order_at) = ?").get(prev).amt
  const todayPaidOrders = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE DATE(order_at) = ? AND status IN ('paid','shipped','completed')").get(day).n
  const todayCouponRedeem = db.prepare("SELECT COUNT(*) AS n FROM coupon_redemptions WHERE DATE(redeemed_at) = ?").get(day).n
  const todaySopRuns = db.prepare("SELECT COUNT(*) AS n FROM sop_runs WHERE DATE(created_at) = ?").get(day).n
  const todayEvents = db.prepare("SELECT COUNT(*) AS n FROM events WHERE DATE(created_at) = ?").get(day).n
  const todayChatKeywords = db.prepare("SELECT COUNT(*) AS n FROM events WHERE DATE(created_at) = ? AND type='chat_keyword'").get(day).n
  const todayNeedReply = db.prepare("SELECT COUNT(*) AS n FROM events WHERE DATE(created_at) = ? AND type='chat_need_reply'").get(day).n
  const loyalCount = db.prepare("SELECT COUNT(*) AS n FROM customers WHERE stage='loyal'").get().n
  const churnCount = db.prepare("SELECT COUNT(*) AS n FROM customers WHERE stage='churn'").get().n
  const pendingBroadcast = db.prepare("SELECT COUNT(*) AS n FROM broadcasts WHERE status='pending'").get().n
  const activeSop = db.prepare("SELECT COUNT(*) AS n FROM sops WHERE active=1 AND (is_template IS NULL OR is_template = 0)").get().n

  // 阶段迁移统计（A3 自动分级）
  const stageChanges = db.prepare(`
    SELECT json_extract(payload, '$.to') AS to_stage, COUNT(*) AS n
    FROM events
    WHERE DATE(created_at) = ? AND type = 'customer_stage_changed'
    GROUP BY to_stage
  `).all(day).map((r) => ({ to: r.to_stage, count: r.n }))

  // 今日 SOP 跑的情况
  const sopTop = db.prepare(`
    SELECT s.name, s.trigger_type, sr.success_count, sr.target_count
    FROM sop_runs sr JOIN sops s ON s.id = sr.sop_id
    WHERE DATE(sr.created_at) = ?
    ORDER BY sr.created_at DESC LIMIT 5
  `).all(day)

  // 渠道 TOP3
  const channelTop = db.prepare(`
    SELECT channel, COUNT(*) AS n FROM customers
    WHERE DATE(created_at) = ? AND channel IS NOT NULL
    GROUP BY channel ORDER BY n DESC LIMIT 3
  `).all(day)

  // 流失高风险 TOP
  const churnRiskTop = db.prepare(`
    SELECT id, name, wechat_nick, stage, CAST((julianday('now') - julianday(last_active)) AS INTEGER) AS days
    FROM customers WHERE stage='churn' ORDER BY last_active ASC LIMIT 3
  `).all()

  const report = {
    day,
    summary: {
      customers_new: todayNew,
      customers_new_vs_prev: prevNew ? Math.round((todayNew - prevNew) / prevNew * 1000) / 10 : (todayNew > 0 ? 100 : 0),
      orders_count: todayOrders,
      orders_paid_count: todayPaidOrders,
      orders_amount: Math.round(todayOrderAmt * 100) / 100,
      orders_amount_vs_prev: prevOrderAmt ? Math.round((todayOrderAmt - prevOrderAmt) / prevOrderAmt * 1000) / 10 : (todayOrderAmt > 0 ? 100 : 0),
      coupon_redeem: todayCouponRedeem,
      sop_runs: todaySopRuns,
      events_total: todayEvents,
      chat_keyword_hits: todayChatKeywords,
      chat_need_reply: todayNeedReply,
      loyal_count: loyalCount,
      churn_count: churnCount,
      stage_changes: stageChanges,
      pending_broadcasts: pendingBroadcast,
      active_sops: activeSop
    },
    sop_top: sopTop,
    channel_top: channelTop,
    churn_risk_top: churnRiskTop
  }

  // 写 wecom_events 让后续推送通道消费（payload 里存完整 JSON）
  db.prepare(`INSERT INTO wecom_events (event_type, change_type, payload, handled) VALUES (?, ?, ?, 0)`).run(
    'daily_report', 'generated', JSON.stringify({ day, report })
  )

  log('daily-report', 'info', `日报生成: ${day} 新客=${todayNew} 订单=${todayOrders} 金额=${todayOrderAmt.toFixed(2)} events=${todayEvents}`)
  return report
}
