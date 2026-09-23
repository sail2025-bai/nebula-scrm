import express from 'express'
import { db, now } from '../db.js'
import { WXBizMsgCrypt, getAccessToken, callWecomApi, upsertGroupFromWecom, syncGroupMemberJoin, syncGroupMemberLeave, dismissGroup, getStaffByCode } from '../wecom.js'

const router = express.Router()

function getConfig() {
  let row = db.prepare('SELECT * FROM wecom_config WHERE id = 1').get()
  if (!row) {
    db.prepare("INSERT INTO wecom_config (id, corp_id, corp_secret, callback_token, encoding_aes_key, status) VALUES (1, '', '', NULL, NULL, 'unset')").run()
    row = db.prepare('SELECT * FROM wecom_config WHERE id = 1').get()
  }
  return row
}

function insertCustomer({ name, wechatNick, phone, channel, staffId, customerType, company }) {
  const type = customerType === 'service' ? 'service' : 'retail'
  const r = db.prepare(`INSERT INTO customers (code, name, wechat_nick, avatar, gender, phone, stage, channel, spend, orders, last_active, staff_id, rfm_score, health, notes, customer_type, company, position, intent_level, created_at) VALUES (NULL, ?, ?, NULL, '女', ?, 'new', ?, 0, 0, ?, ?, '511', '新人活跃', NULL, ?, ?, NULL, NULL, ?)`).run(
    name,
    wechatNick ?? null,
    phone ?? null,
    channel ?? null,
    now(),
    staffId ?? null,
    type,
    company ?? null,
    now()
  )
  const id = Number(r.lastInsertRowid)
  db.prepare('UPDATE customers SET code = ? WHERE id = ?').run((type === 'service' ? 'S' : 'C') + (1000 + id), id)
  return id
}

function ensureTag(name, mode) {
  let row = db.prepare('SELECT id FROM tags WHERE name = ?').get(name)
  if (!row) {
    const r = db.prepare('INSERT INTO tags (name, category, mode) VALUES (?, ?, ?)').run(name, '业务标签', mode === 'service' ? 'service' : 'retail')
    row = { id: Number(r.lastInsertRowid) }
  }
  return row.id
}

function applyTags(customerId, names, mode) {
  const ins = db.prepare('INSERT OR IGNORE INTO customer_tags (customer_id, tag_id) VALUES (?, ?)')
  for (const name of names || []) {
    if (name) ins.run(customerId, ensureTag(String(name), mode))
  }
}

function fakeExternalId() {
  return 'wmSIM' + String(Math.floor(100000 + Math.random() * 900000))
}

function insertEvent(eventType, changeType, externalUserid, userid, payload) {
  db.prepare('INSERT INTO wecom_events (event_type, change_type, external_userid, userid, payload) VALUES (?, ?, ?, ?, ?)').run(eventType, changeType, externalUserid, userid, payload)
}

function staffById(id) {
  if (!Number.isInteger(id)) return null
  return db.prepare('SELECT id, name FROM staff WHERE id = ?').get(id) || null
}

function findCustomerByExternalId(externalUserid) {
  if (!externalUserid) return null
  return db.prepare('SELECT * FROM customers WHERE wecom_external_userid = ? OR wechat_nick = ? ORDER BY id DESC').get(externalUserid, externalUserid)
}

router.get('/config', (req, res) => {
  res.json(getConfig())
})

router.put('/config', (req, res) => {
  const b = req.body || {}
  getConfig()
  const val = (v) => (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim()
  db.prepare('UPDATE wecom_config SET corp_id = ?, corp_secret = ?, callback_token = ?, encoding_aes_key = ? WHERE id = 1').run(val(b.corp_id), val(b.corp_secret), val(b.callback_token), val(b.encoding_aes_key))
  res.json(getConfig())
})

router.post('/test', async (req, res) => {
  const b = req.body || {}
  const cfg = getConfig()
  const pick = (v, fallback) => (v !== undefined && v !== null && String(v).trim() !== '') ? String(v).trim() : fallback
  const corpId = pick(b.corp_id, cfg.corp_id || '')
  const corpSecret = pick(b.corp_secret, cfg.corp_secret || '')
  if (corpId && corpSecret) {
    try {
      await getAccessToken(corpId, corpSecret)
      db.prepare("UPDATE wecom_config SET status = 'connected' WHERE id = 1").run()
      res.json({ ok: true, status: 'connected', message: '企微连接验证成功' })
    } catch (e) {
      db.prepare("UPDATE wecom_config SET status = 'error' WHERE id = 1").run()
      res.json({ ok: false, status: 'error', message: '企微连接验证失败：' + e.message })
    }
    return
  }
  db.prepare("UPDATE wecom_config SET status = 'simulated' WHERE id = 1").run()
  res.json({ ok: true, status: 'simulated', message: '未配置真实凭据，已进入模拟模式：可使用模拟事件注入体验完整闭环' })
})

router.post('/sync-staff', async (req, res) => {
  const cfg = getConfig()
  if (cfg.status === 'connected') {
    try {
      const data = await callWecomApi('user/simplelist', { department_id: 1, fetch_child: 1 })
      const list = data && Array.isArray(data.userlist) ? data.userlist : []
      const findStaff = db.prepare('SELECT id FROM staff WHERE name = ?')
      const updateStaff = db.prepare("UPDATE staff SET role = '企微同步' WHERE id = ?")
      const insertStaff = db.prepare("INSERT INTO staff (name, role, created_at) VALUES (?, '企微同步', ?)")
      let synced = 0
      const tx = db.transaction(() => {
        for (const u of list) {
          if (!u || !u.name) continue
          const row = findStaff.get(u.name)
          if (row) updateStaff.run(row.id)
          else insertStaff.run(u.name, now())
          synced++
        }
      })
      tx()
      db.prepare('UPDATE wecom_config SET last_sync_at = ? WHERE id = 1').run(now())
      return res.json({ synced, mode: cfg.status })
    } catch (e) {
      return res.status(400).json({ error: '同步企微通讯录失败：' + e.message })
    }
  }
  const demoStaff = ['唐薇', '程皓', '纪云']
  const findStaff = db.prepare('SELECT id FROM staff WHERE name = ?')
  const insertStaff = db.prepare('INSERT INTO staff (name, role, created_at) VALUES (?, ?, ?)')
  let synced = 0
  const tx = db.transaction(() => {
    for (const name of demoStaff) {
      if (!findStaff.get(name)) insertStaff.run(name, '演示顾问(模拟)', now())
      synced++
    }
  })
  tx()
  db.prepare('UPDATE wecom_config SET last_sync_at = ? WHERE id = 1').run(now())
  res.json({ synced, mode: cfg.status })
})

router.get('/events', (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50))
  res.json(db.prepare('SELECT * FROM wecom_events ORDER BY id DESC LIMIT ?').all(limit))
})

router.post('/simulate', (req, res) => {
  const b = req.body || {}
  const mode = b.mode === 'service' ? 'service' : 'retail'
  const changeType = b.changeType
  const name = b.name !== undefined && b.name !== null ? String(b.name).trim() : ''
  const staffRow = staffById(b.staffId !== undefined && b.staffId !== null ? Number(b.staffId) : null)
  const payload = JSON.stringify(b)

  if (changeType === 'add') {
    if (!name) return res.status(400).json({ error: '客户姓名不能为空' })
    const tags = Array.isArray(b.tags) ? b.tags.filter(Boolean) : []
    const customerId = insertCustomer({ name, wechatNick: name, channel: b.channel || '模拟活码', staffId: staffRow ? staffRow.id : null, customerType: mode })
    applyTags(customerId, tags, mode)
    insertEvent('change_external_contact', 'add_external_contact', fakeExternalId(), staffRow ? staffRow.name : null, payload)
    return res.json({ ok: true, message: `模拟添加好友事件已处理：客户「${name}」已入库并打上${tags.length}个标签`, customerId })
  }

  if (changeType === 'del_follow' || changeType === 'del') {
    if (!name) return res.status(400).json({ error: '客户姓名不能为空' })
    const customer = db.prepare('SELECT * FROM customers WHERE name = ? AND customer_type = ? ORDER BY id DESC').get(name, mode)
    if (!customer) {
      const action = changeType === 'del_follow' ? '删除跟进人' : '删除联系人'
      return res.status(400).json({ ok: false, message: `模拟事件处理失败：未找到名为「${name}」的${mode === 'service' ? 'B端' : 'C端'}客户，无法执行${action}操作` })
    }
    let userid = staffRow ? staffRow.name : null
    if (!userid && customer.staff_id) {
      const owner = db.prepare('SELECT name FROM staff WHERE id = ?').get(customer.staff_id)
      if (owner) userid = owner.name
    }
    if (changeType === 'del_follow') {
      db.prepare("UPDATE customers SET stage = 'churn', rfm_score = '211', health = '高危预警' WHERE id = ?").run(customer.id)
      insertEvent('change_external_contact', 'del_follow_user', fakeExternalId(), userid, payload)
      return res.json({ ok: true, message: `模拟删除跟进人事件已处理：客户「${name}」已标记为流失预警` })
    }
    db.prepare('DELETE FROM customers WHERE id = ?').run(customer.id)
    insertEvent('change_external_contact', 'del_external_contact', fakeExternalId(), userid, payload)
    return res.json({ ok: true, message: `模拟删除联系人事件已处理：客户「${name}」已删除` })
  }

  res.status(400).json({ error: 'changeType 只能是 add、del_follow 或 del' })
})

router.get('/callback', (req, res) => {
  const cfg = getConfig()
  if (!cfg.callback_token || !cfg.encoding_aes_key) {
    return res.status(403).json({ error: '请先在企微对接中心配置 Token 与 EncodingAESKey' })
  }
  try {
    const crypt = new WXBizMsgCrypt(cfg.callback_token, cfg.encoding_aes_key, cfg.corp_id)
    const echo = crypt.verifyUrl(req.query.msg_signature, req.query.timestamp, req.query.nonce, req.query.echostr)
    res.set('Content-Type', 'text/plain')
    res.send(echo)
  } catch (e) {
    res.status(400).json({ error: '企微回调验证失败：' + e.message })
  }
})

router.post('/callback', express.text({ type: () => true }), async (req, res) => {
  try {
    const cfg = getConfig()
    if (!cfg.callback_token || !cfg.encoding_aes_key) throw new Error('未配置 Token 与 EncodingAESKey')
    const crypt = new WXBizMsgCrypt(cfg.callback_token, cfg.encoding_aes_key, cfg.corp_id)
    const plainXml = crypt.decryptMsg(req.query.msg_signature, req.query.timestamp, req.query.nonce, req.body)
    const pickTag = (tag) => {
      const m = String(plainXml).match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))
      return m ? m[1] : null
    }
    const event = pickTag('Event')
    const changeType = pickTag('ChangeType')
    const externalUserid = pickTag('ExternalUserID')
    const userid = pickTag('UserID')
        const chatId = pickTag('ChatId')
    const chatName = pickTag('ChatName')
    const memberListRaw = pickTag('MemberList')
    let memberList = []
    if (memberListRaw) {
      try { memberList = JSON.parse(memberListRaw) } catch (e) {}
    }
    const joinExternalUid = pickTag('MemberUserID')
    const joinName = pickTag('MemberNickName')
    await handleCallbackEvent(event, changeType, externalUserid, userid, chatId, chatName, memberList, joinExternalUid, joinName)
  } catch (e) {
    console.error('企微回调处理异常：' + (e && e.message ? e.message : e))
  }
  res.set('Content-Type', 'text/plain')
  res.send('success')
})

async function handleCallbackEvent(event, changeType, externalUserid, userid, chatId, chatName, memberList, joinExternalUid, joinName) {
  if (changeType === 'add_external_contact') {
    let name = null
    let company = null
    try {
      const detail = await callWecomApi('externalcontact/get', { external_userid: externalUserid })
      if (detail && detail.external_contact) {
        name = detail.external_contact.name || null
        company = detail.external_contact.corp_name || null
      }
    } catch (e) {
      console.error('拉取企微客户详情失败，已降级使用 ExternalUserID 作为客户名：' + e.message)
    }
    if (!name) name = String(externalUserid || '').slice(0, 20) || '企微新客户'
    const staffRow = userid ? db.prepare('SELECT id, name FROM staff WHERE name = ? OR wecom_userid = ?').get(userid, userid) : null
    const customerId = insertCustomer({ name, wechatNick: name, channel: '企微回调', staffId: staffRow ? staffRow.id : null, customerType: 'retail', company })
    if (externalUserid) db.prepare('UPDATE customers SET wecom_external_userid = ? WHERE id = ?').run(externalUserid, customerId)
    insertEvent('change_external_contact', changeType, externalUserid, userid, JSON.stringify({ event, changeType, externalUserid, userid, customerId, name }))
    return
  }
  if (changeType === 'del_follow_user' || changeType === 'del_external_contact') {
    const customer = findCustomerByExternalId(externalUserid)
    if (customer) {
      if (changeType === 'del_follow_user') {
        db.prepare("UPDATE customers SET stage = 'churn', rfm_score = '211', health = '高危预警' WHERE id = ?").run(customer.id)
      } else {
        db.prepare('DELETE FROM customers WHERE id = ?').run(customer.id)
      }
    }
    insertEvent('change_external_contact', changeType, externalUserid, userid, JSON.stringify({ event, changeType, externalUserid, userid, customerId: customer ? customer.id : null }))
    return
  }
  if (event === 'create_chat' || changeType === 'create_chat') {
    const gid = upsertGroupFromWecom(chatId, chatName, memberList || [])
    insertEvent('group_event', 'create_chat', null, null, JSON.stringify({ chatId, chatName, groupId: gid, memberCount: (memberList || []).length }))
    return
  }
  if (event === 'chat_member_add') {
    const gid = upsertGroupFromWecom(chatId, chatName, [])
    syncGroupMemberJoin(gid, joinExternalUid, joinName)
    insertEvent('group_event', 'chat_member_add', joinExternalUid, null, JSON.stringify({ chatId, chatName, groupId: gid, member: { userid: joinExternalUid, name: joinName } }))
    return
  }
  if (event === 'chat_member_del') {
    const gid = db.prepare('SELECT id FROM wechat_groups WHERE wecom_chat_id = ?').get(chatId)
    if (gid) syncGroupMemberLeave(gid.id, joinExternalUid)
    insertEvent('group_event', 'chat_member_del', joinExternalUid, null, JSON.stringify({ chatId, groupId: gid ? gid.id : null, member: { userid: joinExternalUid } }))
    return
  }
  if (event === 'dismiss_chat') {
    const gid = db.prepare('SELECT id FROM wechat_groups WHERE wecom_chat_id = ?').get(chatId)
    if (gid) dismissGroup(gid.id)
    insertEvent('group_event', 'dismiss_chat', null, null, JSON.stringify({ chatId, groupId: gid ? gid.id : null }))
    return
  }
  insertEvent(event || 'unknown', changeType, externalUserid, userid, JSON.stringify({ event, changeType, externalUserid, userid }))
}

export default router

router.post('/simulate-group', async (req, res) => {
  const b = req.body || {}
  const { event, chatId, chatName, externalUserid, memberList } = b
  if (!event) return res.status(400).json({ error: 'event 必填' })
  const call = async (...args) => {
    const existingFind = db.prepare('SELECT id FROM wechat_groups WHERE wecom_chat_id = ?').get(args[0])
    const changeType = event === 'create_chat' ? 'create_chat' : event
    await handleCallbackEvent(event, changeType, externalUserid || null, null, chatId || args[0], chatName || args[1] || null, memberList || args[2] || [], externalUserid || null, b.memberName || null)
  }
  try {
    if (event === 'create_chat') {
      const cid = chatId || 'wrSIM' + String(Math.floor(100000 + Math.random() * 900000))
      const ml = Array.isArray(memberList) ? memberList : []
      const gid = upsertGroupFromWecom(cid, chatName || '模拟企微群', ml)
      insertEvent('group_event', 'create_chat', null, null, JSON.stringify({ chatId: cid, chatName, groupId: gid, memberCount: ml.length, simulated: true }))
      return res.json({ ok: true, message: `模拟创建企微群成功，group_id=${gid}`, groupId: gid, chatId: cid })
    }
    if (event === 'chat_member_add') {
      const cid = chatId || 'wrSIM_FAKE'
      const gid = upsertGroupFromWecom(cid, chatName || '模拟企微群', [])
      syncGroupMemberJoin(gid, externalUserid || ('wmSIM' + String(Math.floor(100000 + Math.random() * 900000))), b.memberName || null)
      insertEvent('group_event', 'chat_member_add', externalUserid, null, JSON.stringify({ chatId: cid, groupId: gid, simulated: true }))
      return res.json({ ok: true, message: `模拟群成员入群，group_id=${gid}`, groupId: gid })
    }
    if (event === 'chat_member_del') {
      const cid = chatId || 'wrSIM_FAKE'
      const row = db.prepare('SELECT id FROM wechat_groups WHERE wecom_chat_id = ?').get(cid)
      if (row) syncGroupMemberLeave(row.id, externalUserid)
      insertEvent('group_event', 'chat_member_del', externalUserid, null, JSON.stringify({ chatId: cid, groupId: row ? row.id : null, simulated: true }))
      return res.json({ ok: true, message: `模拟群成员退群`, groupId: row ? row.id : null })
    }
    if (event === 'dismiss_chat') {
      const cid = chatId
      const row = db.prepare('SELECT id FROM wechat_groups WHERE wecom_chat_id = ?').get(cid)
      if (row) dismissGroup(row.id)
      insertEvent('group_event', 'dismiss_chat', null, null, JSON.stringify({ chatId: cid, groupId: row ? row.id : null, simulated: true }))
      return res.json({ ok: true, message: `模拟群解散成功`, groupId: row ? row.id : null })
    }
    res.status(400).json({ error: 'event 只能是 create_chat/chat_member_add/chat_member_del/dismiss_chat' })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

