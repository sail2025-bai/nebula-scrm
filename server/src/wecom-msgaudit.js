import crypto from 'node:crypto'
import { db, fmt } from './db.js'
import { getAccessToken, log } from './wecom.js'

// === 会话存档骨架模块 ===
// 设计目标：
//   - 未开通会话存档时，所有函数安全跳过，返回 { skipped: true }
//   - 开通后（corp_id/corp_secret/agent_id/private_key 全配置 + msg_audit_enabled=1）即可直接启用
//   - 游标存 msg_audit_state 表，按 agent_id 隔离

// --- 会话存档 agent_token 缓存（比 access_token 短命，单独缓存）---
const agentTokenCache = new Map()

/**
 * 前置检查：返回 null 表示已就绪，否则返回说明字符串
 */
export function msgAuditPreflight(cfg) {
  const c = cfg || db.prepare('SELECT * FROM wecom_config WHERE id = 1').get()
  if (!c) return '未初始化企微配置'
  if (!c.corp_id || !c.corp_secret) return '未配置企业ID / Secret'
  if (!c.msg_audit_enabled || Number(c.msg_audit_enabled) !== 1) return '会话存档未启用（msg_audit_enabled = 0）'
  if (!c.msg_audit_agent_id) return '未配置会话存档 AgentID'
  if (!c.msg_audit_private_key || String(c.msg_audit_private_key).trim().length < 50) return '未配置会话存档 RSA 私钥'
  return null
}

/**
 * 获取 agent_token（会话存档专用，不同 agent 隔离缓存）
 * POST https://qyapi.weixin.qq.com/cgi-bin/msgaudit/get_agent_token?access_token=XXX
 * body: { agentid: "1000002" }
 */
export async function getAgentToken(agentId) {
  const corp = db.prepare('SELECT corp_id, corp_secret FROM wecom_config WHERE id = 1').get()
  if (!corp || !corp.corp_id || !corp.corp_secret) throw new Error('未配置企微凭据')
  const accessToken = await getAccessToken(corp.corp_id, corp.corp_secret)
  const cacheKey = `${corp.corp_id}::${agentId}`
  const hit = agentTokenCache.get(cacheKey)
  if (hit && hit.expireAt > Date.now()) return hit.token

  let data = null
  try {
    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/msgaudit/get_agent_token?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentid: String(agentId) })
      }
    )
    data = await res.json()
  } catch (e) {
    throw new Error(`agent_token 请求失败：${e.message}`)
  }
  if (!data || data.errcode !== 0 || !data.agent_token) {
    throw new Error(`get_agent_token 失败：errcode=${data ? data.errcode : -1}，errmsg=${data && data.errmsg ? data.errmsg : '接口返回异常'}，请确认会话存档是否已开通`)
  }
  agentTokenCache.set(cacheKey, { token: data.agent_token, expireAt: Date.now() + ((data.expires_in || 7200) - 120) * 1000 })
  return data.agent_token
}

/**
 * RSA 私钥解密（企微会话存档用 PKCS#1 v1.5）
 * @param {string|Buffer} encrypted - base64 密文
 * @param {string} privateKey - PEM 私钥字符串（"-----BEGIN RSA PRIVATE KEY-----..."）
 * @returns {string} 明文字符串
 */
export function rsaDecrypt(encrypted, privateKey) {
  const pem = String(privateKey).trim()
  const encryptedBuf = Buffer.isBuffer(encrypted) ? encrypted : Buffer.from(String(encrypted), 'base64')
  try {
    // PKCS#1 v1.5 padding（企微旧版常用）
    const decipher = crypto.createPrivateKey(pem)
    const plain = crypto.privateDecrypt({
      key: decipher,
      padding: crypto.constants.RSA_PKCS1_PADDING
    }, encryptedBuf)
    return plain.toString('utf8')
  } catch (e1) {
    try {
      // 兜底：OAEP padding（企微新版可能用）
      const decipher = crypto.createPrivateKey(pem)
      const plain = crypto.privateDecrypt({
        key: decipher,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha1'
      }, encryptedBuf)
      return plain.toString('utf8')
    } catch (e2) {
      throw new Error(`RSA 解密失败：PKCS1(${e1.message}) / OAEP(${e2.message})`)
    }
  }
}

/**
 * 拉取指定群的今日消息列表
 * POST https://qyapi.weixin.qq.com/cgi-bin/msgaudit/getgroupchat?access_token=XXX&agent_token=YYY
 * body: { chatid, seq, limit }
 * seq 从 0 开始（首次拉取），之后用上一次返回的 next_seq
 */
export async function fetchGroupMessages({ agentId, corpId, corpSecret, chatId, seq = 0, limit = 100 }) {
  const accessToken = await getAccessToken(corpId, corpSecret)
  const agentToken = await getAgentToken(agentId)
  let data = null
  try {
    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/msgaudit/getgroupchat?access_token=${accessToken}&agent_token=${agentToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatid: chatId, seq: Number(seq) || 0, limit })
      }
    )
    data = await res.json()
  } catch (e) {
    throw new Error(`getgroupchat 请求失败：${e.message}`)
  }
  if (!data) throw new Error('getgroupchat 返回空')
  // 错误码语义：10000 为无更多数据（seq 到达最新），不算真错误
  if (data.errcode !== 0 && data.errcode !== 10000) {
    throw new Error(`getgroupchat 失败：errcode=${data.errcode}，errmsg=${data.errmsg || ''}`)
  }
  return { msgs: Array.isArray(data.msgs) ? data.msgs : [], next_seq: data.next_seq ?? seq }
}

/**
 * 轮询：拉取所有 wechat_groups 里有 wecom_chat_id 的群，聚合今日消息数
 * 主入口，被 scheduler 和手动触发都调用
 * @returns {Promise<{polled:number,updated:number,errors:string[]}>}
 */
export async function pollMsgAudit() {
  const cfg = db.prepare('SELECT * FROM wecom_config WHERE id = 1').get()
  const preflight = msgAuditPreflight(cfg)
  if (preflight) {
    log('msgaudit', 'info', `跳过轮询：${preflight}`)
    return { skipped: true, reason: preflight }
  }

  const groups = db.prepare("SELECT id, name, wecom_chat_id FROM wechat_groups WHERE wecom_chat_id IS NOT NULL AND wecom_chat_id != '' AND (dismissed IS NULL OR dismissed = 0)").all()
  if (!groups.length) {
    log('msgaudit', 'info', '跳过轮询：没有关联企微 chat_id 的群')
    return { skipped: true, reason: 'no_groups_with_chat_id' }
  }

  let updated = 0
  let polled = 0
  const errors = []

  for (const g of groups) {
    try {
      const stateRow = db.prepare('SELECT * FROM msg_audit_state WHERE agent_id = ?').get(cfg.msg_audit_agent_id)
      const seq = stateRow ? Number(stateRow.last_msgid) || 0 : 0
      const { msgs } = await fetchGroupMessages({
        agentId: cfg.msg_audit_agent_id,
        corpId: cfg.corp_id,
        corpSecret: cfg.corp_secret,
        chatId: g.wecom_chat_id,
        seq,
        limit: 100
      })

      // 入库并聚合
      for (const m of msgs) {
        const row = tryPersistMessage(m, g.id, g.wecom_chat_id, cfg)
        if (row) polled++
      }

      // 聚合 today_messages（按 chat_id + 今日日期）
      const todayStart = fmt(new Date()) // 今天 0 点在本地时区的写法... 这里简单用客户端 DATE
      const count = db.prepare(`
        SELECT COUNT(*) AS c FROM chat_messages 
        WHERE chat_id = ? AND DATE(substr(ts, 1, 10)) = DATE('now', 'localtime')
      `).get(g.wecom_chat_id).c
      db.prepare('UPDATE wechat_groups SET today_messages = ? WHERE id = ?').run(count, g.id)
      updated++

      // 更新游标
      if (msgs.length) {
        const nextSeq = Number(msgs[msgs.length - 1].seq ?? seq) + 1
        db.prepare(`INSERT INTO msg_audit_state (agent_id, last_msgid, last_polled_at, total_messages, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(agent_id) DO UPDATE SET
            last_msgid = excluded.last_msgid,
            last_polled_at = excluded.last_polled_at,
            total_messages = excluded.total_messages,
            updated_at = excluded.updated_at
        `).run(cfg.msg_audit_agent_id, String(nextSeq), fmt(new Date()), polled, fmt(new Date()))
      }

      // 更新 wecom_config 上的状态字段（给前端看）
      db.prepare('UPDATE wecom_config SET msg_audit_last_polled_at = ?, msg_audit_status = ? WHERE id = 1').run(
        fmt(new Date()), `ok: 拉取 ${polled} 条`
      )
    } catch (e) {
      errors.push(`${g.name}(${g.wecom_chat_id}): ${e.message}`)
      log('msgaudit', 'warn', `群 ${g.name} 拉取失败：${e.message}`)
    }
  }

  if (errors.length) {
    db.prepare('UPDATE wecom_config SET msg_audit_status = ?, msg_audit_last_polled_at = ? WHERE id = 1').run(
      `error: ${errors[0].slice(0, 200)}`, fmt(new Date())
    )
  }
  log('msgaudit', 'info', `轮询完成：更新 ${updated}/${groups.length} 群，入库 ${polled} 条，错误 ${errors.length}`)
  return { polled, updated, total: groups.length, errors }
}

/**
 * 把单条 msg 落库（带 RSA 解密），失败静默跳过（不影响主流程）
 */
function tryPersistMessage(m, groupId, chatId, cfg) {
  if (!m || !m.msgid) return null
  const dup = db.prepare('SELECT id FROM chat_messages WHERE msg_id = ?').get(m.msgid)
  if (dup) return null // 已存在则跳过

  let content = null
  let mediaUrl = null
  const type = String(m.msgtype || m.msgType || 'text').toLowerCase()
  const body = m.text || m.content || m.media || m.image || m.voice || m.video || m.emotion || m.link || m.revoke || {}
  let rawContent = typeof body === 'string' ? body : (body.content || body.description || body.title || body.msgid || '')

  if (body && body.encrypted && cfg.msg_audit_private_key) {
    try {
      const decrypted = rsaDecrypt(body.encrypted, cfg.msg_audit_private_key)
      try {
        const parsed = JSON.parse(decrypted)
        content = parsed.content || parsed.Text || parsed.text || decrypted.slice(0, 500)
      } catch {
        content = decrypted.slice(0, 2000)
      }
    } catch (e) {
      content = `<decrypt failed: ${e.message.slice(0, 60)}>`
    }
  } else {
    content = rawContent ? String(rawContent).slice(0, 2000) : null
  }

  if (body && body.media_id) mediaUrl = String(body.media_id)

  const sql = `INSERT OR IGNORE INTO chat_messages
    (msg_id, agent_id, seq, chat_id, chat_name, sender_userid, sender_name, msg_type, content, media_url, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  db.prepare(sql).run(
    String(m.msgid),
    cfg.msg_audit_agent_id,
    Number(m.seq) || 0,
    chatId,
    String(m.chatname || ''),
    String(m.from_user || m.userid || ''),
    String(m.from_user_name || ''),
    type,
    content,
    mediaUrl,
    fmt(new Date(Number(m.msgtimestamp || m.timestamp || Date.now()) * 1000))
  )
  return m
}

/**
 * 每日 0 点归零所有群的 today_messages（配合每日重新聚合使用）
 */
export function zeroTodayMessages() {
  const r = db.prepare('UPDATE wechat_groups SET today_messages = 0').run()
  log('msgaudit', 'info', `每日归零：${r.changes} 群 today_messages 清零`)
  return { zeroed: r.changes }
}

/**
 * 聚合今日消息数（手动或定时重新跑一遍）
 */
export function recomputeTodayMessages() {
  const groups = db.prepare("SELECT id, wecom_chat_id FROM wechat_groups WHERE wecom_chat_id IS NOT NULL AND wecom_chat_id != ''").all()
  let changed = 0
  for (const g of groups) {
    const count = db.prepare(`
      SELECT COUNT(*) AS c FROM chat_messages 
      WHERE chat_id = ? AND DATE(substr(ts, 1, 10)) = DATE('now', 'localtime')
    `).get(g.wecom_chat_id).c
    const r = db.prepare('UPDATE wechat_groups SET today_messages = ? WHERE id = ?').run(count, g.id)
    if (r.changes) changed++
  }
  log('msgaudit', 'info', `今日消息数重聚合：${changed}/${groups.length} 群有数据`)
  return { recomputed: groups.length, changed }
}
