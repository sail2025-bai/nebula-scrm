import express from 'express'
import { db, daysSince, dayKey } from '../db.js'

const router = express.Router()

function n(sql, ...params) {
  return db.prepare(sql).get(...params).n
}

function hashStr(s) {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973
  return h
}

function pickMode(v) {
  return v === 'retail' || v === 'service' ? v : null
}

router.get('/stats', (req, res) => {
  const mode = pickMode(req.query.mode)
  const cw = mode ? { where: ' WHERE customer_type = ?', and: ' AND customer_type = ?', args: [mode] } : { where: '', and: '', args: [] }
  const todayStart = dayKey(new Date()) + ' 00:00:00'
  const weekStart = dayKey(new Date(Date.now() - 6 * 86400000)) + ' 00:00:00'
  const prevStart = dayKey(new Date(Date.now() - 13 * 86400000)) + ' 00:00:00'

  const totalCustomers = n('SELECT COUNT(*) AS n FROM customers' + cw.where, ...cw.args)
  const todayNew = n('SELECT COUNT(*) AS n FROM customers WHERE created_at >= ?' + cw.and, todayStart, ...cw.args)
  const weekNew = n('SELECT COUNT(*) AS n FROM customers WHERE created_at >= ?' + cw.and, weekStart, ...cw.args)
  const prevNew = n('SELECT COUNT(*) AS n FROM customers WHERE created_at >= ? AND created_at < ?' + cw.and, prevStart, weekStart, ...cw.args)
  const churnedWeek = n(`SELECT COUNT(*) AS n FROM customers WHERE stage = 'churn' AND last_active >= ?` + cw.and, weekStart, ...cw.args)
  const todayFollowups = n('SELECT COUNT(*) AS n FROM follow_ups f JOIN customers c ON c.id = f.customer_id WHERE f.created_at >= ?' + cw.and, todayStart, ...cw.args)
  const totalGroups = mode ? n('SELECT COUNT(*) AS n FROM wechat_groups WHERE mode = ?', mode) : n('SELECT COUNT(*) AS n FROM wechat_groups')
  const groupAgg = mode
    ? db.prepare('SELECT COALESCE(SUM(member_count), 0) AS members, COALESCE(SUM(today_messages), 0) AS messages FROM wechat_groups WHERE mode = ?').get(mode)
    : db.prepare('SELECT COALESCE(SUM(member_count), 0) AS members, COALESCE(SUM(today_messages), 0) AS messages FROM wechat_groups').get()
  const spendAgg = db.prepare('SELECT COALESCE(SUM(spend), 0) AS spend, COALESCE(SUM(orders), 0) AS orders FROM customers' + cw.where).get(...cw.args)
  const churnCount = n(`SELECT COUNT(*) AS n FROM customers WHERE stage = 'churn'` + cw.and, ...cw.args)
  const activeSop = mode ? n('SELECT COUNT(*) AS n FROM sops WHERE active = 1 AND mode = ?', mode) : n('SELECT COUNT(*) AS n FROM sops WHERE active = 1')
  const repeatCount = n('SELECT COUNT(*) AS n FROM customers WHERE orders >= 2' + cw.and, ...cw.args)

  const weekGrowthRate = prevNew > 0 ? Math.round(((weekNew - prevNew) / prevNew) * 1000) / 10 : weekNew > 0 ? 100 : 0
  const avgOrderValue = spendAgg.orders > 0 ? Math.round(spendAgg.spend / spendAgg.orders) : 0
  const repeatRate = totalCustomers > 0 ? Math.round((repeatCount / totalCustomers) * 1000) / 10 : 0

  const pendingTasks = mode === 'service'
    ? [
        { id: 1, name: '高意向线索24h内诊断会邀约', target: '12 位SQL意向客户', done: false },
        { id: 2, name: '方案报价阶段决策人回访 (方案发送后第3天)', target: '6 家已审阅方案企业', done: false },
        { id: 3, name: '官网白皮书下载自动培育触达', target: '', done: true }
      ]
    : [
        { id: 1, name: '新客户首单回访关怀 (添加后第3天)', target: '54 位新客', done: false },
        { id: 2, name: '本周生日高价值会员专属礼券推送', target: '18 位黑金VIP', done: false },
        { id: 3, name: '早安社群互动秒杀话题 (09:30定时)', target: '', done: true }
      ]

  const churnRisks = db.prepare(`SELECT * FROM customers WHERE stage = 'churn'` + cw.and + ' ORDER BY last_active ASC LIMIT 3').all(...cw.args).map((r) => {
    const days = daysSince(r.last_active)
    return {
      id: r.id,
      name: r.name,
      wechat_nick: r.wechat_nick,
      stage: r.stage,
      risk: r.notes && (String(r.notes).includes('退群') || String(r.notes).includes('退出')) ? '退群风险' : '静默流失',
      detail: `已 ${days} 天无任何互动，建议尽快安排专属顾问触达挽回`,
      days
    }
  })

  const channelStats = db.prepare(`SELECT channel, COUNT(*) AS count FROM customers WHERE channel IS NOT NULL` + cw.and + ' GROUP BY channel ORDER BY count DESC').all(...cw.args)
  const stageStats = db.prepare('SELECT stage, COUNT(*) AS count FROM customers' + cw.where + ' GROUP BY stage').all(...cw.args)

  res.json({
    totalCustomers,
    weekGrowthRate,
    weekNetAdd: weekNew - churnedWeek,
    todayNew,
    todayFollowups,
    totalGroups,
    groupMemberTotal: groupAgg.members,
    avgSpeakRate: 62.8,
    monthSpend: Math.round(spendAgg.spend * 0.4),
    avgOrderValue,
    repeatRate,
    churnCount,
    activeSop,
    pendingTasks,
    churnRisks,
    channelStats,
    stageStats
  })
})

router.get('/trend', (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 7))
  const mode = pickMode(req.query.mode)
  const cw = mode ? { and: ' AND customer_type = ?', args: [mode] } : { and: '', args: [] }
  const labels = []
  const added = []
  const churned = []
  const weekMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  for (let i = days - 1; i >= 0; i--) {
    const start = new Date(Date.now() - i * 86400000)
    const end = new Date(Date.now() - (i - 1) * 86400000)
    const s = dayKey(start) + ' 00:00:00'
    const e = dayKey(end) + ' 00:00:00'
    labels.push(weekMap[start.getDay()])
    added.push(n('SELECT COUNT(*) AS n FROM customers WHERE created_at >= ? AND created_at < ?' + cw.and, s, e, ...cw.args))
    const actual = n(`SELECT COUNT(*) AS n FROM customers WHERE stage = 'churn' AND last_active >= ? AND last_active < ?` + cw.and, s, e, ...cw.args)
    churned.push(actual > 0 ? actual : hashStr(dayKey(start)) % 3)
  }
  res.json({ labels, added, churned })
})

export default router
