import express from 'express'
import { db } from '../db.js'
import { msgAuditPreflight, pollMsgAudit, zeroTodayMessages, recomputeTodayMessages } from '../wecom-msgaudit.js'

const router = express.Router()

router.get('/status', (req, res) => {
  const cfg = db.prepare('SELECT * FROM wecom_config WHERE id = 1').get()
  const groupsWithChat = db.prepare("SELECT COUNT(*) AS c FROM wechat_groups WHERE wecom_chat_id IS NOT NULL AND wecom_chat_id != ''").get().c
  const messagesTotal = db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get().c
  const todayCount = db.prepare(`
    SELECT COUNT(*) AS c FROM chat_messages WHERE DATE(substr(ts, 1, 10)) = DATE('now', 'localtime')
  `).get().c
  const state = db.prepare('SELECT * FROM msg_audit_state WHERE agent_id = ?').get(
    cfg && cfg.msg_audit_agent_id ? cfg.msg_audit_agent_id : '1000002'
  )
  const preflight = msgAuditPreflight(cfg)

  res.json({
    enabled: !!(cfg && cfg.msg_audit_enabled && Number(cfg.msg_audit_enabled) === 1),
    preflight_ok: preflight === null,
    preflight_issue: preflight,
    agent_id: cfg && cfg.msg_audit_agent_id || null,
    last_msgid: cfg && cfg.msg_audit_last_msgid || null,
    last_polled_at: cfg && cfg.msg_audit_last_polled_at || null,
    status: cfg && cfg.msg_audit_status || null,
    groups_with_chat_id: groupsWithChat,
    total_messages_stored: messagesTotal,
    today_messages_stored: todayCount,
    cursor: state || null
  })
})

router.post('/poll', async (req, res) => {
  try {
    const result = await pollMsgAudit()
    res.json({ ok: true, ...result })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

router.post('/recompute', (req, res) => {
  try {
    const result = recomputeTodayMessages()
    res.json({ ok: true, ...result })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

router.post('/zero', (req, res) => {
  try {
    const result = zeroTodayMessages()
    res.json({ ok: true, ...result })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

export default router
