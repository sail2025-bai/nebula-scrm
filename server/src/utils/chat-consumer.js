import { db, now } from '../db.js'
import { log } from '../wecom.js'
import { emit as emitEvent } from './events.js'

/**
 * utils/chat-consumer.js — chat_messages 的业务消费端
 *
 * 功能 3 条，scheduler 每 3min 跑一次 runOnce()：
 *   1) **关键词打标**：扫描 chat_messages 里包含"价格""多少钱""竞品""退群""不满意""售后""发票""方案"等词 →
 *      对群 member 里的客户打对应 tag + emit('chat_keyword') → 触发 SOP 自动跟进
 *   2) **未回复提醒**：群内连续 N 条消息 sender_userid 都不是 staff 且间隔 > 5min →
 *      emit('chat_need_reply') 提醒销售
 *   3) **首包欢迎**：客户首次在群发言 → emit('chat_join') 兜底（有时 wecom_events member_add 没拉全）
 *
 * 所有扫描都用 chat_messages 里的自增 id 作为 cursor（不重复消费同一条），
 * 消费结果写入 wecom_events + events 表，不直接改 customers。
 */

// —— 关键词字典（先硬编码，未来可移到 wecom_config / tags.category='chat关键词' 里自动发现）——
const KEYWORDS = [
  { tag: '问价格', words: ['价格', '多少钱', '报价', '优惠多少', '怎么卖', '贵不贵'] },
  { tag: '竞品对比', words: ['竞品', '某厂', '某品牌', 'XX 产品', '他家'] },
  { tag: '退群意向', words: ['退群', '我退了', '不想加了', '退我出去'] },
  { tag: '不满意',   words: ['不满意', '很差', '失望', '坑', '垃圾'] },
  { tag: '售后问题', words: ['售后', '退货', '退款', '坏了', '修一下', '报修'] },
  { tag: '发票需求', words: ['发票', '开票', '抬头发票'] },
  { tag: '要方案',   words: ['方案', 'demo', 'ppt', '演示', '试用版'] },
]

const PROCESSED_SQL = null // cursor 已迁移到 events 表的 chat_keyword_processed 记录

function getKeywordCursor() {
  // cursor 存 events 表里 status='done' 且 type='chat_keyword_processed' 的最后一条 payload
  const r = db.prepare(`
    SELECT id, payload FROM events
    WHERE type = 'chat_keyword_processed' AND status = 'done'
    ORDER BY id DESC LIMIT 1
  `).get()
  if (r) {
    try { return Number(JSON.parse(r.payload).last_msg_id) || 0 } catch { return 0 }
  }
  return 0
}

function saveKeywordCursor(lastMsgId) {
  emitEvent('chat_keyword_processed', {
    payload: JSON.stringify({ last_msg_id: lastMsgId })
  })
}

/** 确保 tag 存在（30 天过期），返回 tag_id */
function ensureTag(name) {
  let row = db.prepare('SELECT id FROM tags WHERE name = ?').get(name)
  if (row) return row.id
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)
  const r = db.prepare('INSERT INTO tags (name, category, mode, expires_at) VALUES (?, ?, ?, ?)').run(
    name, 'chat关键词', 'retail', expires
  )
  return Number(r.lastInsertRowid)
}

/** 从 sender_userid 反查 customers 表里的企微外部联系人 id / ext_openid */
function matchCustomerBySender(senderUserId, chatId = null) {
  // wecom_events 群成员表里有 external_userid；chat_messages 里的 sender_userid 可能是 external_userid 也可能是 staff 的 userid
  // 先用 wecom_events 里群成员 join 来匹配
  if (chatId) {
    const r = db.prepare(`
      SELECT c.id FROM customers c
      WHERE (c.wecom_external_userid = ? OR c.ext_openid = ? OR c.wechat_nick = ?)
      LIMIT 1
    `).get(senderUserId, senderUserId, senderUserId)
    if (r) return r.id
  }
  // 不指定群：只做精确 external_userid / ext_openid / wechat_nick 匹配
  const r = db.prepare(`
    SELECT id FROM customers
    WHERE wecom_external_userid = ? OR ext_openid = ? OR wechat_nick = ?
    LIMIT 1
  `).get(senderUserId, senderUserId, senderUserId)
  return r ? r.id : null
}

/**
 * 关键词扫描：扫 last_msg_id 之后的新 chat_messages → 打 tag + emit chat_keyword
 */
function scanKeywords() {
  const cursor = getKeywordCursor()
  const msgs = db.prepare(`
    SELECT id, chat_id, sender_userid, sender_name, content, ts FROM chat_messages
    WHERE id > ? AND sender_userid NOT LIKE '%@work%'
    ORDER BY id ASC LIMIT 200
  `).all(cursor)

  let lastMsgId = cursor
  let hits = 0
  for (const m of msgs) {
    lastMsgId = m.id
    const text = (m.content || '').toLowerCase()
    for (const kw of KEYWORDS) {
      if (!kw.words.some((w) => text.includes(w.toLowerCase()))) continue
      // 匹配到关键词 → 打 tag（30 天过期，幂等）
      const customerId = matchCustomerBySender(m.sender_userid, m.chat_id)
      const tagId = ensureTag(kw.tag)
      if (customerId) {
        db.prepare('INSERT OR IGNORE INTO customer_tags (customer_id, tag_id) VALUES (?, ?)').run(customerId, tagId)
        emitEvent('chat_keyword', {
          customer_id: customerId,
          payload: JSON.stringify({
            keyword: kw.tag, content: m.content, chat_id: m.chat_id, ts: m.ts,
            sender: m.sender_name || m.sender_userid
          })
        })
      } else {
        // 没匹配到客户也 emit 一下，让运营看到群里有信号但还没建档
        emitEvent('chat_keyword', {
          payload: JSON.stringify({
            keyword: kw.tag, content: m.content, chat_id: m.chat_id, sender: m.sender_userid,
            ts: m.ts, matched: false
          })
        })
      }
      hits++
    }
  }
  if (lastMsgId > cursor) saveKeywordCursor(lastMsgId)
  return { scanned: msgs.length, hits, last_msg_id: lastMsgId }
}

/**
 * 未回复检测：最近 30 分钟群内 >= 3 条 sender_userid 不包含 staff 名字 且 时间差 > 5min → emit chat_need_reply
 * staff 名字从 staff 表拉，硬编码 3min 窗口，避免重复 emit（用 events 表状态防重）
 */
function scanUnreplied() {
  // staff userid 列表（chat_messages 里 sender_userid 含 `@work`）
  const recentMsgs = db.prepare(`
    SELECT id, chat_id, sender_userid, sender_name, content, ts FROM chat_messages
    WHERE id > (SELECT MAX(id) FROM chat_messages) - 200
    ORDER BY chat_id, ts DESC
  `).all()

  // 按 chat_id 分组
  const byChat = {}
  for (const m of recentMsgs) {
    if (!byChat[m.chat_id]) byChat[m.chat_id] = []
    byChat[m.chat_id].push(m)
  }

  let alerts = 0
  for (const [chatId, list] of Object.entries(byChat)) {
    if (!chatId || list.length < 3) continue
    // 找连续 >= 3 条非 staff 且时间差 > 5min
    list.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''))
    let nonStaff = []
    for (const m of list) {
      const isStaff = /@work\b|^\d+$/.test(m.sender_userid || '') || false
      // 用 staff 表名二次确认
      const maybeStaff = db.prepare('SELECT 1 FROM staff WHERE name = ? LIMIT 1').get(m.sender_name || '')
      if (isStaff || maybeStaff) {
        // 遇到 staff → 重置
        nonStaff = []
        continue
      }
      nonStaff.push(m)
      if (nonStaff.length >= 3) {
        // 算时间差
        const gap = (new Date(nonStaff[nonStaff.length - 1].ts) - new Date(nonStaff[0].ts)) / 60000
        if (gap > 5) {
          // 防重：过去 10min 已发过 chat_need_reply + chat_id 的不重复
          const recent = db.prepare(`
            SELECT id FROM events
            WHERE type = 'chat_need_reply'
              AND datetime(created_at) > datetime('now', '-10 minutes')
              AND payload LIKE ?
            LIMIT 1
          `).get(`%${chatId}%`)
          if (!recent) {
            emitEvent('chat_need_reply', {
              payload: JSON.stringify({
                chat_id: chatId,
                count: nonStaff.length,
                first: nonStaff[0].sender_name || nonStaff[0].sender_userid,
                last: nonStaff[nonStaff.length - 1].sender_name || nonStaff[nonStaff.length - 1].sender_userid,
                preview: nonStaff.map((n) => n.content?.slice(0, 40)).join(' / ')
              })
            })
            alerts++
          }
          nonStaff = []
        }
      }
    }
  }
  return { alerts }
}

/**
 * 单次消费（scheduler 调这个）
 */
export function runOnce() {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'").get()) {
    return { skipped: true, reason: 'chat_messages 表不存在' }
  }
  const kws = scanKeywords()
  const unr = scanUnreplied()
  log('chat-consumer', 'info', `关键词: scanned=${kws.scanned} hits=${kws.hits}; 未回复提醒: alerts=${unr.alerts}`)
  return { keywords: kws, unreplied: unr }
}
