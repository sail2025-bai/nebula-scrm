import express from 'express'
import { db, now } from '../db.js'

const router = express.Router()

const qAll = `SELECT g.*, s.name AS ownerName, s.role AS owner_role, g.wecom_chat_id AS wecomChatId, g.dismissed FROM wechat_groups g LEFT JOIN staff s ON s.id = g.owner_staff_id`

router.get('/', (req, res) => {
  const mode = req.query.mode
  if (mode === 'retail' || mode === 'service') {
    return res.json(db.prepare(`${qAll} WHERE g.mode = ? ORDER BY g.id DESC`).all(mode))
  }
  res.json(db.prepare(`${qAll} ORDER BY g.id DESC`).all())
})

router.post('/', (req, res) => {
  const b = req.body || {}
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: '群名称不能为空' })
  const mode = b.mode === 'service' ? 'service' : 'retail'
  const r = db.prepare('INSERT INTO wechat_groups (name, owner_staff_id, member_count, capacity, today_messages, sop_status, health_score, created_at, mode) VALUES (?, ?, 0, 200, 0, ?, 70, ?, ?)').run(String(b.name).trim(), b.owner_staff_id ?? null, '未配置', now(), mode)
  const row = db.prepare(`${qAll} WHERE g.id = ?`).get(Number(r.lastInsertRowid))
  res.status(201).json(row)
})

router.put('/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM wechat_groups WHERE id = ?').get(id) : null
  if (!row) return res.status(404).json({ error: '社群不存在' })
  const b = req.body || {}
  const sets = []
  const params = []
  for (const k of ['name', 'owner_staff_id', 'member_count', 'capacity', 'today_messages', 'sop_status', 'health_score']) {
    if (b[k] !== undefined) {
      sets.push(`${k} = ?`)
      params.push(b[k])
    }
  }
  if (sets.length) {
    params.push(id)
    db.prepare(`UPDATE wechat_groups SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }
  res.json(db.prepare(`${qAll} WHERE g.id = ?`).get(id))
})

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const r = Number.isInteger(id) ? db.prepare('DELETE FROM wechat_groups WHERE id = ?').run(id) : null
  if (!r || !r.changes) return res.status(404).json({ error: '社群不存在' })
  res.json({ ok: true })
})

router.get("/:id/members", (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: "群 ID 非法" })
  res.json(db.prepare("SELECT * FROM group_members WHERE group_id = ? ORDER BY id ASC").all(id))
})

router.post("/:id/members", (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: "群 ID 非法" })
  const b = req.body || {}
  const rows = Array.isArray(b.members) ? b.members : [b]
  const ins = db.prepare("INSERT OR IGNORE INTO group_members (group_id, external_userid, name) VALUES (?, ?, ?)")
  let n = 0
  const tx = db.transaction(() => { for (const m of rows) { if (m && (m.external_userid || m.name)) { ins.run(id, m.external_userid || m.name, m.name || null); n++ } } })
  tx()
  return res.json({ added: n })
})

router.delete("/:id/members/:externalUserid", (req, res) => {
  const id = Number(req.params.id)
  const r = db.prepare("DELETE FROM group_members WHERE group_id = ? AND external_userid = ?").run(id, req.params.externalUserid)
  if (!r.changes) return res.status(404).json({ error: "成员不存在" })
  const cnt = db.prepare("SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?").get(id).c
  db.prepare("UPDATE wechat_groups SET member_count = ? WHERE id = ?").run(cnt, id)
  res.json({ ok: true, remaining: cnt })
})

// 群事件（企微客户群事件时间线）
router.get('/events', (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50))
  const onlyGroups = req.query.only === '1' || req.query.only === 'true'
  const q = onlyGroups
    ? `SELECT * FROM wecom_events WHERE event_type = 'group_event' ORDER BY id DESC LIMIT ?`
    : `SELECT * FROM wecom_events ORDER BY id DESC LIMIT ?`
  res.json(db.prepare(q).all(limit))
})


export default router
