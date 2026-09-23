import express from 'express'
import { db } from '../db.js'

const router = express.Router()

router.get('/export', (req, res) => {
  const qCustomerTags = db.prepare('SELECT t.id, t.name, t.category, t.mode FROM customer_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.customer_id = ? ORDER BY t.id')
  const staff = db.prepare('SELECT * FROM staff ORDER BY id').all()
  const customers = db.prepare('SELECT * FROM customers ORDER BY id').all().map((c) => ({ ...c, tags: qCustomerTags.all(c.id) }))
  const tags = db.prepare('SELECT * FROM tags ORDER BY id').all()
  const segments = db.prepare('SELECT * FROM segments ORDER BY id').all()
  const wechatGroups = db.prepare('SELECT * FROM wechat_groups ORDER BY id').all()
  const broadcasts = db.prepare('SELECT * FROM broadcasts ORDER BY id').all()
  const sops = db.prepare('SELECT * FROM sops ORDER BY id').all()
  const seasLeads = db.prepare('SELECT * FROM seas_leads ORDER BY id').all()
  const qrCodes = db.prepare('SELECT * FROM qr_codes ORDER BY id').all()
  const wecomEvents = db.prepare('SELECT * FROM wecom_events ORDER BY id').all()
  const users = db.prepare('SELECT id, name, account, business_mode FROM users ORDER BY id').all()
  res.json({ staff, customers, tags, segments, wechat_groups: wechatGroups, broadcasts, sops, seas_leads: seasLeads, qr_codes: qrCodes, wecom_events: wecomEvents, users })
})

router.get('/customers.csv', (req, res) => {
  const mode = req.query.mode
  const where = mode === 'retail' || mode === 'service' ? 'WHERE c.customer_type = ?' : ''
  const params = where ? [mode] : []
  const rows = db.prepare(`SELECT c.*, s.name AS staffName FROM customers c LEFT JOIN staff s ON s.id = c.staff_id ${where} ORDER BY c.id`).all(...params)
  const qTagNames = db.prepare('SELECT t.name FROM customer_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.customer_id = ? ORDER BY t.id')
  const esc = (v) => {
    if (v === undefined || v === null) return ''
    const s = String(v)
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const header = ['编号', '姓名', '企微昵称', '性别', '手机', '阶段', '渠道', '金额', '订单数', '公司', '职位', '意向等级', '负责人', '标签', '最近互动']
  const lines = [header.join(',')]
  for (const r of rows) {
    const tagNames = qTagNames.all(r.id).map((t) => t.name).join('|')
    lines.push([r.code, r.name, r.wechat_nick, r.gender, r.phone, r.stage, r.channel, r.spend, r.orders, r.company, r.position, r.intent_level, r.staffName, tagNames, r.last_active].map(esc).join(','))
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.send('\uFEFF' + lines.join('\r\n'))
})

export default router
