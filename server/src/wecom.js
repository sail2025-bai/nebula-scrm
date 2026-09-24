import crypto from 'node:crypto'
import { db } from './db.js'

export function sha1(str) {
  return crypto.createHash('sha1').update(String(str), 'utf8').digest('hex')
}

export class WXBizMsgCrypt {
  constructor(token, encodingAesKey, corpId) {
    if (!token || !encodingAesKey) throw new Error('Token 或 EncodingAESKey 未配置')
    const key = Buffer.from(encodingAesKey + '=', 'base64')
    if (key.length < 32) throw new Error('EncodingAESKey 格式非法')
    this.token = token
    this.corpId = corpId || ''
    this.aesKey = key.subarray(0, 32)
    this.iv = this.aesKey.subarray(0, 16)
  }

  signature(timestamp, nonce, encrypt) {
    return sha1([this.token, timestamp, nonce, encrypt].sort().join(''))
  }

  encrypt(plainText) {
    const random = crypto.randomBytes(16)
    const msg = Buffer.from(String(plainText), 'utf8')
    const len = Buffer.alloc(4)
    len.writeUInt32BE(msg.length)
    const data = Buffer.concat([random, len, msg, Buffer.from(this.corpId, 'utf8')])
    const padLen = 32 - (data.length % 32)
    const padded = Buffer.concat([data, Buffer.alloc(padLen, padLen)])
    const cipher = crypto.createCipheriv('aes-256-cbc', this.aesKey, this.iv)
    cipher.setAutoPadding(false)
    return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64')
  }

  decrypt(encryptText) {
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.aesKey, this.iv)
    decipher.setAutoPadding(false)
    const buf = Buffer.concat([decipher.update(Buffer.from(String(encryptText), 'base64')), decipher.final()])
    if (!buf.length) throw new Error('解密失败：密文为空')
    const padLen = buf[buf.length - 1]
    if (padLen < 1 || padLen > 32) throw new Error('解密失败：填充非法')
    const plain = buf.subarray(0, buf.length - padLen)
    if (plain.length < 20) throw new Error('解密失败：明文长度非法')
    const msgLen = plain.readUInt32BE(16)
    if (20 + msgLen > plain.length) throw new Error('解密失败：消息长度非法')
    const msg = plain.subarray(20, 20 + msgLen).toString('utf8')
    const tailCorpId = plain.subarray(20 + msgLen).toString('utf8')
    if (this.corpId && tailCorpId !== this.corpId) throw new Error('解密失败：corp_id 校验不通过')
    return msg
  }

  verifyUrl(msgSignature, timestamp, nonce, echostr) {
    if (this.signature(timestamp, nonce, echostr) !== msgSignature) throw new Error('URL 验签失败')
    return this.decrypt(echostr)
  }

  decryptMsg(msgSignature, timestamp, nonce, encryptXml) {
    const m = String(encryptXml || '').match(/<Encrypt>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/Encrypt>/)
    if (!m) throw new Error('回调消息缺少 Encrypt 字段')
    if (this.signature(timestamp, nonce, m[1]) !== msgSignature) throw new Error('消息验签失败')
    return this.decrypt(m[1])
  }
}

const tokenCache = new Map()

export async function getAccessToken(corpId, secret) {
  const cacheKey = `${corpId}::${secret}`
  const hit = tokenCache.get(cacheKey)
  if (hit && hit.expireAt > Date.now()) return hit.token
  let data = null
  try {
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`)
    data = await res.json()
  } catch (e) {
    throw new Error(`请求企微接口失败：errcode=-1，errmsg=${e && e.message ? e.message : '网络异常'}`)
  }
  if (!data || data.errcode !== 0 || !data.access_token) {
    throw new Error(`获取 access_token 失败：errcode=${data ? data.errcode : -1}，errmsg=${data && data.errmsg ? data.errmsg : '接口返回异常'}`)
  }
  tokenCache.set(cacheKey, { token: data.access_token, expireAt: Date.now() + ((data.expires_in || 7200) - 120) * 1000 })
  return data.access_token
}

export async function callWecomApi(path, params = {}) {
  const cfg = db.prepare('SELECT corp_id, corp_secret FROM wecom_config WHERE id = 1').get()
  if (!cfg || !cfg.corp_id || !cfg.corp_secret) throw new Error('未配置企微企业ID与Secret，无法调用企微接口')
  const token = await getAccessToken(cfg.corp_id, cfg.corp_secret)
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) search.set(k, String(v))
  }
  search.set('access_token', token)
  let data = null
  try {
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/${path}?${search}`)
    data = await res.json()
  } catch (e) {
    throw new Error(`请求企微接口失败：errcode=-1，errmsg=${e && e.message ? e.message : '网络异常'}`)
  }
  if (!data || data.errcode !== 0) {
    throw new Error(`企微接口调用失败：errcode=${data ? data.errcode : -1}，errmsg=${data && data.errmsg ? data.errmsg : '接口返回异常'}`)
  }
  return data
}

export function log(tag, level, msg, data) {
  const t = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const line = `[${t}][${level}][${tag}] ${msg}${data !== undefined && data !== null ? ' | ' + JSON.stringify(data).slice(0, 500) : ''}`
  if (level === 'error') console.error(line)
  else console.log(line)
}

export function wecomConfig() {
  return db.prepare('SELECT * FROM wecom_config WHERE id = 1').get() || null
}

export function loadConfigFromEnv() {
  const cfg = db.prepare('SELECT * FROM wecom_config WHERE id = 1').get()
  const fields = ['corp_id', 'corp_secret', 'callback_token', 'encoding_aes_key']
  let dirty = false
  const next = {}
  for (const f of fields) {
    const envKey = ('WECOM_' + f.toUpperCase())
    const envVal = process.env[envKey]
    if (envVal && envVal.trim()) {
      next[f] = envVal.trim()
      dirty = true
    } else {
      next[f] = cfg && cfg[f] ? cfg[f] : null
    }
  }
  if (!dirty) return cfg
  const allSet = next.corp_id && next.corp_secret
  const status = allSet ? 'connected' : cfg && cfg.status ? cfg.status : 'unset'
  db.prepare(`UPDATE wecom_config SET corp_id=?, corp_secret=?, callback_token=?, encoding_aes_key=?, status=? WHERE id=1`).run(
    next.corp_id || '', next.corp_secret || '', next.callback_token, next.encoding_aes_key, status
  )
  log('wecom', 'info', `环境变量已灌入企微配置，status=${status}`)
  return wecomConfig()
}

const staffCache = new Map()

export async function syncStaffWecom() {
  const cfg = wecomConfig()
  if (!cfg || !cfg.corp_id || !cfg.corp_secret) {
    log('wecom', 'warn', 'syncStaffWecom 跳过：未配置企微凭据')
    return 0
  }
  const data = await callWecomApi('cgi-bin/user/simplelist', { department_id: 1, fetch_child: 1 })
  const users = data.userlist || []
  let upserted = 0
  for (const u of users) {
    const existing = db.prepare('SELECT id FROM staff WHERE wecom_userid = ?').get(u.userid)
    if (existing) {
      db.prepare('UPDATE staff SET name=?, position=?, department=? WHERE id=?').run(
        u.name, u.position || null, (u.department || []).join(','), existing.id
      )
    } else {
      db.prepare('INSERT INTO staff (name, wecom_userid, role, position) VALUES (?, ?, ?, ?)').run(
        u.name, u.userid, '企微同步', u.position || null
      )
    }
    upserted++
  }
  db.prepare('UPDATE wecom_config SET last_sync_at = CURRENT_TIMESTAMP WHERE id = 1').run()
  log('wecom', 'info', `企微通讯录同步完成：${upserted} 人`)
  return upserted
}

export async function sendBroadcast(broadcast, onProgress) {
  const cfg = wecomConfig()
  if (!broadcast || !broadcast.id) throw new Error('群发任务无效')
  if (broadcast.status === '已下发' || broadcast.status === '已下发(模拟)') {
    throw new Error('该任务已下发，请勿重复操作')
  }
  if (!broadcast.message && !broadcast.title) throw new Error('群发内容为空')
  const content = broadcast.message || broadcast.title
  if (!cfg || cfg.status !== 'connected') {
    db.prepare('UPDATE broadcasts SET status=?, sent_at=CURRENT_TIMESTAMP, sent_rate=100.0 WHERE id=?').run('已下发(模拟)', broadcast.id)
    db.prepare(`INSERT INTO wecom_events (event_type, change_type, external_userid, userid, payload, handled) VALUES (?, ?, ?, ?, ?, ?)`).run(
      'broadcast_send', 'simulated', null, null, JSON.stringify({ broadcast_id: broadcast.id, title: broadcast.title, target: broadcast.target_count, mode: broadcast.mode }), null
    )
    log('wecom', 'info', `群发任务 #${broadcast.id} 模拟下发完成`, { target: broadcast.target_count })
    return { ok: true, simulated: true, message: '未连接企微，已按模拟模式记录下发：' + broadcast.title }
  }
  let templateId = null
  let sendRes = null
  try {
    const staff = db.prepare('SELECT id, name, wecom_userid FROM staff ORDER BY id').all()
    const msgData = {
      msgtype: 'text',
      text: { content },
      safe: 0
    }
    const addRes = await callWecomApi('cgi-bin/externalcontact/add_msg_template', msgData)
    templateId = addRes.msgid
    log('wecom', 'info', `群发模板创建成功 msgid=${templateId}`)
    let okCount = 0
    let failCount = 0
    for (const s of staff) {
      if (!s.wecom_userid) continue
      try {
        const r = await callWecomApi('cgi-bin/externalcontact/group_wchat', {
          msgid: templateId,
          sender: s.wecom_userid,
          exclude_list: []
        })
        okCount++
        if (onProgress) onProgress(okCount, failCount, staff.length)
        log('wecom', 'info', `群发 ${s.name}/${s.wecom_userid} ok chatid=${r.chatid}`)
      } catch (e) {
        failCount++
        log('wecom', 'warn', `群发 ${s.name} 失败：${e.message}`)
      }
      await new Promise(r => setTimeout(r, 200))
    }
    sendRes = { ok: okCount, fail: failCount }
    const rate = staff.length > 0 ? Math.round(okCount / staff.length * 100) : 0
    db.prepare('UPDATE broadcasts SET status=?, sent_rate=?, sent_at=CURRENT_TIMESTAMP, fail_reason=? WHERE id=?').run(
      failCount === 0 ? '已下发' : '部分下发', rate, failCount > 0 ? `失败${failCount}人` : null, broadcast.id
    )
    db.prepare(`INSERT INTO wecom_events (event_type, change_type, external_userid, userid, payload, handled) VALUES (?, ?, ?, ?, ?, ?)`).run(
      'broadcast_send', 'connected', null, null, JSON.stringify({ broadcast_id: broadcast.id, title: broadcast.title, msgid: templateId, ...sendRes }), null
    )
    return { ok: true, simulated: false, ...sendRes, msgid: templateId }
  } catch (e) {
    db.prepare('UPDATE broadcasts SET status=?, fail_reason=? WHERE id=?').run('下发失败', String(e.message).slice(0, 500), broadcast.id)
    db.prepare(`INSERT INTO wecom_events (event_type, change_type, external_userid, userid, payload, handled) VALUES (?, ?, ?, ?, ?, 0)`).run(
      'broadcast_send', 'error', null, null, JSON.stringify({ broadcast_id: broadcast.id, error: e.message }), null
    )
    log('wecom', 'error', `群发任务 #${broadcast.id} 下发失败：${e.message}`)
    throw e
  }
}

export async function createQrTicket(qrcode) {
  const cfg = wecomConfig()
  const sceneId = Number(qrcode.id)
  if (!cfg || cfg.status !== 'connected') {
    const fakeTicket = `TICKET-SIM-${qrcode.id}-${Date.now().toString(36)}`
    db.prepare('UPDATE qr_codes SET qr_ticket=? WHERE id=?').run(fakeTicket, qrcode.id)
    log('wecom', 'info', `活码 #${qrcode.id} 模拟 ticket 生成`)
    return fakeTicket
  }
  const data = await callWecomApi('cgi-bin/qrcode/create', {
    action_name: 'QR_SCENE',
    action_info: JSON.stringify({ scene: { scene_id: sceneId } })
  })
  db.prepare('UPDATE qr_codes SET qr_ticket=? WHERE id=?').run(data.ticket, qrcode.id)
  log('wecom', 'info', `活码 #${qrcode.id} 真实 ticket=${data.ticket.slice(0, 30)}...`)
  return data.ticket
}

export async function getStaffByCode(code) {
  const cfg = wecomConfig()
  if (!cfg || !cfg.corp_id || !cfg.corp_secret) throw new Error('未配置企微凭据')
  const token = await getAccessToken(cfg.corp_id, cfg.corp_secret)
  let data = null
  try {
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${token}&code=${code}`)
    data = await res.json()
  } catch (e) {
    throw new Error(`侧边栏 code 交换失败：${e.message}`)
  }
  if (!data || data.errcode !== 0 || !data.userid) {
    throw new Error(`侧边栏 code 无效：errcode=${data ? data.errcode : -1} errmsg=${data ? data.errmsg : '接口返回异常'}`)
  }
  let detail = null
  try {
    detail = await callWecomApi('cgi-bin/user/get', { userid: data.userid })
  } catch (e) {
    log('wecom', 'warn', `获取企微员工详情失败，仅用 userid=${data.userid}`)
  }
  return { userid: data.userid, detail: detail || null }
}

export function upsertGroupFromWecom(chatId, chatName, memberList = []) {
  const existing = db.prepare('SELECT * FROM wechat_groups WHERE wecom_chat_id = ?').get(chatId)
  const memberCount = Array.isArray(memberList) ? memberList.length : 0
  let groupId = null
  if (existing) {
    db.prepare('UPDATE wechat_groups SET name=?, member_count=?, dismissed=0 WHERE id=?').run(chatName || existing.name, memberCount, existing.id)
    groupId = existing.id
  } else {
    const r = db.prepare('INSERT INTO wechat_groups (name, wecom_chat_id, member_count, health_score, sop_status, mode, created_at) VALUES (?, ?, ?, 70, ?, ?, CURRENT_TIMESTAMP)').run(
      chatName || `企微群 ${chatId.slice(-6)}`, chatId, memberCount, '未配置', 'retail'
    )
    groupId = Number(r.lastInsertRowid)
    log('wecom', 'info', `新群同步：${chatName || chatId} → wechat_groups#${groupId}`)
  }
  if (Array.isArray(memberList) && memberList.length && groupId) {
    const ins = db.prepare(`INSERT OR IGNORE INTO group_members (group_id, external_userid, name) VALUES (?, ?, ?)`)
    const updCount = db.prepare('UPDATE wechat_groups SET member_count=? WHERE id=?').run(memberCount, groupId)
    for (const m of memberList) {
      ins.run(groupId, m.userid || m.ExternalUserID || m.external_userid || '', m.name || null)
    }
  }
  return groupId
}

export function syncGroupMemberJoin(groupId, externalUserid, name) {
  if (!groupId || !externalUserid) return
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, external_userid, name) VALUES (?, ?, ?)').run(groupId, externalUserid, name || null)
  const row = db.prepare('SELECT member_count FROM wechat_groups WHERE id = ?').get(groupId)
  if (row) db.prepare('UPDATE wechat_groups SET member_count = ? WHERE id = ?').run((row.member_count || 0) + 1, groupId)
}

export function syncGroupMemberLeave(groupId, externalUserid) {
  if (!groupId || !externalUserid) return
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND external_userid = ?').run(groupId, externalUserid)
  const n = db.prepare('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?').get(groupId).c
  db.prepare('UPDATE wechat_groups SET member_count = ? WHERE id = ?').run(n, groupId)
}

export function dismissGroup(groupId) {
  db.prepare('UPDATE wechat_groups SET dismissed = 1 WHERE id = ?').run(groupId)
}

// === 内部应用消息：给企业员工推通知（SOP 待办、内部提醒）===
// 真实调用走 message/send；没配 agent/app_secret 或 staff.wecom_userid 为空 → 降级记录 wecom_events
// 经验：硬编码的外部接口失败不可阻断主流程，必须降级 + 日志闭环

// === 企微外部联系人消息（给客户发消息，真调 API + 降级）===
// 调用 externalcontact/add_msg_template 发送群发模板消息，
// 或 externalcontact/send_welcome_msg 发送欢迎语（新客48小时内）
// 生产环境需要配置企微客户联系权限 + 已审核的模板，没配就走降级
export async function sendWechatMsgToCustomer({ customerId, staffId, content, templateId = null }) {
  const customer = db.prepare('SELECT id, name, external_userid, staff_id FROM customers WHERE id = ?').get(customerId)
  if (!customer) return { ok: false, simulated: true, reason: '客户不存在' }
  const staff = staffId
    ? db.prepare('SELECT id, name, wecom_userid FROM staff WHERE id = ?').get(staffId)
    : db.prepare('SELECT id, name, wecom_userid FROM staff WHERE id = ?').get(customer.staff_id)

  const cfg = db.prepare('SELECT corp_id, corp_secret FROM wecom_config WHERE id = 1').get()
  const hasReal = !!(cfg && cfg.corp_id && cfg.corp_secret && cfg.corp_id !== 'wwtest')
  const hasExtUserId = !!(customer.external_userid && customer.external_userid.trim())
  const hasStaffUserId = !!(staff && staff.wecom_userid && staff.wecom_userid.trim())

  const logIt = (outcome, wecomEvent) => {
    db.prepare(`INSERT INTO wecom_events (event_type, change_type, userid, payload, handled)
      VALUES (?, ?, ?, ?, 1)`).run('customer_msg', outcome, customer.external_userid || null,
      JSON.stringify({ customer_id: customer.id, customer_name: customer.name, staff_id: staff?.id, content, template_id: templateId, reason: outcome }))
  }

  if (!hasReal) {
    logIt('降级未发:企微未配置', '降级未发:企微未配置')
    return { ok: true, simulated: true, outcome: '降级未发:企微未配置', customer: customer.name }
  }
  if (!hasExtUserId) {
    logIt('降级未发:客户未同步 external_userid')
    return { ok: true, simulated: true, outcome: '降级未发:客户未绑定企微', customer: customer.name }
  }
  if (!hasStaffUserId) {
    logIt('降级未发:顾问未同步 wecom_userid')
    return { ok: true, simulated: true, outcome: '降级未发:顾问未绑定企微', customer: customer.name }
  }

  try {
    // 优先用模板消息（可批量、有审核），没模板就用文本群发
    let apiPath, msgData
    if (templateId) {
      apiPath = 'cgi-bin/externalcontact/add_msg_template'
      msgData = {
        chat_type: 'single',
        external_userid_list: [customer.external_userid],
        sender: staff.wecom_userid,
        text: { content },
        template_id: templateId
      }
    } else {
      // 无模板 → 用群发文本（企微限制：每人每天最多 1 条群发）
      apiPath = 'cgi-bin/externalcontact/add_msg_template'
      msgData = {
        chat_type: 'single',
        external_userid_list: [customer.external_userid],
        sender: staff.wecom_userid,
        text: { content }
      }
    }
    const token = await getAccessToken(cfg.corp_id, cfg.corp_secret)
    const res = await fetch(`https://qyapi.weixin.qq.com/${apiPath}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msgData)
    })
    const data = await res.json()
    if (data.errcode === 0) {
      logIt('已发送', '已发送')
      return { ok: true, simulated: false, outcome: '已发送', customer: customer.name, msgid: data.msgid }
    } else {
      const reason = `企微 errcode=${data.errcode}`
      logIt(`降级未发:${data.errmsg || reason}`)
      return { ok: true, simulated: true, outcome: `降级未发:${data.errmsg || reason}`, customer: customer.name }
    }
  } catch (e) {
    logIt(`降级未发:${e.message}`)
    return { ok: true, simulated: true, outcome: `降级未发:${e.message}`, customer: customer.name }
  }
}

// === 拉外部联系人入企微客户群（真调 API + 降级）===
export async function inviteCustomerToGroup({ customerId, groupId }) {
  const customer = db.prepare('SELECT id, name, external_userid FROM customers WHERE id = ?').get(customerId)
  const group = db.prepare('SELECT id, name, chat_id FROM groups WHERE id = ?').get(groupId)
  if (!customer || !group) return { ok: false, simulated: true, reason: '客户或群组不存在' }

  const cfg = db.prepare('SELECT corp_id, corp_secret FROM wecom_config WHERE id = 1').get()
  const hasReal = !!(cfg && cfg.corp_id && cfg.corp_secret && cfg.corp_id !== 'wwtest')
  const hasExt = !!(customer.external_userid && customer.external_userid.trim())
  const hasChatId = !!(group.chat_id && group.chat_id.trim())

  const logIt = (outcome) => {
    db.prepare(`INSERT INTO wecom_events (event_type, change_type, userid, payload, handled)
      VALUES (?, ?, ?, ?, 1)`).run('group_invite', outcome, customer.external_userid || null,
      JSON.stringify({ customer_id: customer.id, customer_name: customer.name, group_id: group.id, group_name: group.name, reason: outcome }))
  }

  if (!hasReal) {
    logIt('降级未拉:企微未配置')
    return { ok: true, simulated: true, outcome: '降级未拉:企微未配置', customer: customer.name, group: group.name }
  }
  if (!hasExt || !hasChatId) {
    logIt(`降级未拉:${!hasExt ? '客户' : '群'}未同步企微字段`)
    return { ok: true, simulated: true, outcome: '降级未拉:客户/群组未绑定企微', customer: customer.name, group: group.name }
  }

  try {
    const token = await getAccessToken(cfg.corp_id, cfg.corp_secret)
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/appchat/invite?access_token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatid: group.chat_id,
        invite_list: [{ userid: customer.external_userid }]
      })
    })
    const data = await res.json()
    // 注意：客户群拉人 API 实际是 group_wchat / invite，具体路径可能要按企微文档调整
    if (data.errcode === 0) {
      logIt('已拉入群')
      return { ok: true, simulated: false, outcome: '已拉入群', customer: customer.name, group: group.name }
    } else {
      logIt(`降级未拉:${data.errmsg || 'errcode=' + data.errcode}`)
      return { ok: true, simulated: true, outcome: `降级未拉:${data.errmsg || data.errcode}`, customer: customer.name, group: group.name }
    }
  } catch (e) {
    logIt(`降级未拉:${e.message}`)
    return { ok: true, simulated: true, outcome: `降级未拉:${e.message}`, customer: customer.name, group: group.name }
  }
}

export async function sendInternalWecomMessage({ staffId, content, title = '', source = 'sop' }) {
  const staff = db.prepare('SELECT id, name, wecom_userid FROM staff WHERE id = ?').get(staffId)
  if (!staff) return { ok: false, simulated: false, reason: '顾问不存在' }

  const cfg = db.prepare('SELECT corp_id, app_agent_id, app_secret FROM wecom_config WHERE id = 1').get()
  const hasRealCfg = !!(cfg && cfg.corp_id && cfg.app_agent_id && cfg.app_secret && cfg.corp_id !== 'wwtest')
  const hasUserId = !!(staff.wecom_userid && staff.wecom_userid.trim())

  const simulatedLog = (reason) => {
    db.prepare(`INSERT INTO wecom_events (event_type, change_type, userid, payload, handled)
      VALUES ('internal_msg', 'simulated', ?, ?, ?)`).run(
      staff.wecom_userid || null,
      JSON.stringify({ source, title, content, staff_id: staff.id, staff_name: staff.name, reason }),
      1
    )
    log('wecom', 'info', `内部消息(模拟) → ${staff.name}: ${title || content.slice(0, 40)} [reason=${reason}]`)
  }

  if (!hasRealCfg) {
    simulatedLog('未配置企微自建应用 (app_agent_id/app_secret)')
    return { ok: true, simulated: true, reason: '未配置企微应用', staff_name: staff.name }
  }
  if (!hasUserId) {
    simulatedLog(`顾问 ${staff.name} 未同步 wecom_userid`)
    return { ok: true, simulated: true, reason: '顾问未绑定企微账号', staff_name: staff.name }
  }

  try {
    // 独立 token 缓存：应用 secret 和企业 secret 不同，必须单独换
    const token = await getAccessToken(cfg.corp_id, cfg.app_secret)
    const body = {
      touser: staff.wecom_userid,
      msgtype: 'textcard',
      agentid: Number(cfg.app_agent_id),
      textcard: {
        title: title || 'SOP 待办提醒',
        description: content,
        url: '#',
        btntxt: '查看详情'
      }
    }
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json()
    if (data.errcode === 0) {
      db.prepare(`INSERT INTO wecom_events (event_type, change_type, userid, payload, handled)
        VALUES ('internal_msg', 'sent', ?, ?, 1)`).run(
        staff.wecom_userid,
        JSON.stringify({ source, title, content, staff_id: staff.id, msgid: data.msgid })
      )
      log('wecom', 'info', `内部消息 → ${staff.name} 成功 msgid=${data.msgid}`)
      return { ok: true, simulated: false, staff_name: staff.name }
    } else {
      simulatedLog(`企微返回 errcode=${data.errcode} errmsg=${data.errmsg}`)
      return { ok: false, simulated: true, reason: `企微 ${data.errmsg || data.errcode}`, staff_name: staff.name }
    }
  } catch (e) {
    simulatedLog(`网络异常: ${e.message}`)
    return { ok: false, simulated: true, reason: e.message, staff_name: staff.name }
  }
}
