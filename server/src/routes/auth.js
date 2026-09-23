import express from 'express'
import crypto from 'node:crypto'
import { db, now } from '../db.js'
import { signToken } from '../middleware/auth.js'

const router = express.Router()

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false
  const candidate = crypto.scryptSync(password, parts[0], 64)
  const expected = Buffer.from(parts[1], 'hex')
  if (candidate.length !== expected.length) return false
  return crypto.timingSafeEqual(candidate, expected)
}

router.post('/register', (req, res) => {
  const b = req.body || {}
  const name = b.name !== undefined && b.name !== null ? String(b.name).trim() : ''
  const account = b.account !== undefined && b.account !== null ? String(b.account).trim() : ''
  const password = b.password !== undefined && b.password !== null ? String(b.password) : ''
  const businessMode = b.businessMode || b.business_mode || 'retail'
  if (!name) return res.status(400).json({ error: '姓名不能为空' })
  if (account.length < 3) return res.status(400).json({ error: '账号长度不能少于3个字符' })
  if (password.length < 6) return res.status(400).json({ error: '密码长度不能少于6位' })
  if (businessMode !== 'retail' && businessMode !== 'service') return res.status(400).json({ error: '业务模式只能是 retail 或 service' })
  if (db.prepare('SELECT id FROM users WHERE account = ?').get(account)) return res.status(400).json({ error: '该账号已被注册' })
  try {
    const r = db.prepare('INSERT INTO users (name, account, password_hash, business_mode, created_at) VALUES (?, ?, ?, ?, ?)').run(name, account, hashPassword(password), businessMode, now())
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(r.lastInsertRowid))
    const user = { id: row.id, name: row.name, account: row.account, businessMode: row.business_mode }
    const token = signToken({ id: row.id, account: row.account, name: row.name, businessMode: row.business_mode, role: 'admin' })
    res.status(201).json({ user, token })
  } catch (e) {
    res.status(400).json({ error: '注册失败，该账号可能已被注册' })
  }
})

router.post('/login', (req, res) => {
  const b = req.body || {}
  const account = b.account !== undefined && b.account !== null ? String(b.account).trim() : ''
  const password = b.password !== undefined && b.password !== null ? String(b.password) : ''
  const row = db.prepare('SELECT * FROM users WHERE account = ?').get(account)
  if (!row || !verifyPassword(password, row.password_hash)) return res.status(401).json({ error: '账号或密码错误' })
  const user = { id: row.id, name: row.name, account: row.account, businessMode: row.business_mode }
  const token = signToken({
    id: row.id, account: row.account, name: row.name,
    businessMode: row.business_mode, role: row.role || 'user',
    wecomUserid: row.wecom_userid || null
  })
  res.json({ user, token })
})

import { getStaffByCode, wecomConfig, log } from '../wecom.js'

router.post('/wxlogin', async (req, res) => {
  const b = req.body || {}
  const code = String(b.code || '').trim()
  if (!code) return res.status(400).json({ error: '缺少企微侧边栏 code 参数' })

  // 模拟模式：code 以 SIM_ 开头或企微凭据未配置，使用模拟员工
  const cfg = wecomConfig()
  const isSimulated = code.startsWith('SIM_') || !cfg || !cfg.corp_id || !cfg.corp_secret

  let userid = null
  let detail = null

  if (isSimulated) {
    const simName = b.name ? String(b.name).trim() : null
    const candidates = ['唐薇', '程皓', '纪云', '周扬', '林悦']
    const pick = simName || candidates[Math.floor(Math.random() * candidates.length)]
    userid = 'SIM_' + pick
    detail = { userid, name: pick, mobile: null, position: '顾问(模拟)', department: ['模拟部门'] }
    log('wxlogin', 'info', `模拟侧边栏登录 userid=${userid}`)
  } else {
    try {
      const r = await getStaffByCode(code)
      userid = r.userid
      detail = r.detail
    } catch (e) {
      log('wxlogin', 'warn', `真实企微 code 交换失败，降级为模拟：${e.message}`)
      userid = 'SIM_' + code.slice(-6)
      detail = { userid, name: '企微员工(模拟)', mobile: null, position: null, department: null }
    }
  }

  try {
    let user = db.prepare('SELECT * FROM users WHERE wecom_userid = ?').get(userid)
    const displayName = detail && detail.name ? detail.name : userid
    if (!user) {
      const staffRow = db.prepare('SELECT id, name FROM staff WHERE wecom_userid = ? OR name = ?').get(userid, displayName)
      const r = db.prepare('INSERT INTO users (name, account, password_hash, business_mode, wecom_userid, created_at) VALUES (?, ?, NULL, ?, ?, ?)').run(
        displayName, userid, staffRow ? 'retail' : 'retail', userid, now()
      )
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(r.lastInsertRowid))
      // 同步更新 staff 表
      if (!db.prepare('SELECT id FROM staff WHERE wecom_userid = ?').get(userid)) {
        db.prepare('INSERT INTO staff (name, wecom_userid, role, created_at) VALUES (?, ?, ?, ?)').run(
          displayName, userid, isSimulated ? '模拟顾问' : '企微同步', now()
        )
      }
    } else if (!user.wecom_userid) {
      db.prepare('UPDATE users SET wecom_userid = ? WHERE id = ?').run(userid, user.id)
    }
    res.json({
      user: { id: user.id, name: user.name, account: user.account, businessMode: user.business_mode, wecomUserid: userid },
      wecomDetail: detail,
      simulated: isSimulated,
      token: signToken({
        id: user.id, account: user.account, name: user.name,
        businessMode: user.business_mode, role: 'user',
        wecomUserid: userid
      })
    })
  } catch (e) {
    res.status(400).json({ error: '企微侧边栏登录失败：' + e.message })
  }
})

export default router
