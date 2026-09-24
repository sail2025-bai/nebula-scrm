import express from 'express'
import { db } from '../db.js'
import { runDailyReport } from '../utils/daily-report.js'

const router = express.Router()

/** 手动触发一次今日日报生成（覆盖 wecom_events 里的旧记录） */
router.post('/daily/run', (req, res) => {
  const day = req.query.day || new Date().toISOString().slice(0, 10)
  try {
    const report = runDailyReport(day)
    res.json({ ok: true, day, summary: report.summary })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/** 拉取历史日报列表（近 N 天） */
router.get('/daily', (req, res) => {
  const days = Math.min(30, Math.max(1, parseInt(req.query.days) || 7))
  const rows = db.prepare(`
    SELECT id, created_at, payload FROM wecom_events
    WHERE event_type = 'daily_report' AND change_type = 'generated'
    ORDER BY id DESC LIMIT ?
  `).all(days).map((r) => {
    try {
      const p = JSON.parse(r.payload || '{}')
      return { id: r.id, day: p.day, summary: p.report?.summary || null, sop_top: p.report?.sop_top || [], channel_top: p.report?.channel_top || [] }
    } catch {
      return { id: r.id, created_at: r.created_at, summary: null }
    }
  })
  res.json({ count: rows.length, days, rows })
})

export default router
