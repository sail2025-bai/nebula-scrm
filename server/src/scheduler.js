import { log, syncStaffWecom } from './wecom.js'
import { pollMsgAudit, zeroTodayMessages } from './wecom-msgaudit.js'
import { db } from './db.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { processPendingEvents, rescanAllCustomerStages } from './utils/events.js'
import { runOnce as runChatConsumer } from './utils/chat-consumer.js'
import { runDailyReport } from './utils/daily-report.js'
import { runSopBatch } from './utils/sop-engine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let timers = []

export function startScheduler() {
  stopScheduler()

  log('scheduler', 'info', '=== SCRM 生产化调度器启动 ===')

  // 启动立即跑一轮
  syncStaffWecom().catch((e) => log('scheduler', 'warn', `预同步跳过：${e.message}`))
  scanPendingBroadcasts().catch((e) => log('scheduler', 'error', e.message))
  closeExpiredSeckills().catch((e) => log('scheduler', 'error', e.message))
  expireOldCoupons().catch((e) => log('scheduler', 'error', e.message))
  runInactiveCustomerSOPs().catch((e) => log('scheduler', 'error', e.message))
  cleanExpiredTags().catch((e) => log('scheduler', 'error', e.message))
  // 事件总线：启动即扫一次积压 pending
  try {
    const r = processPendingEvents(100)
    if (r.processed) log('scheduler', 'info', `启动事件消费: processed=${r.processed} sopRuns=${r.sopRuns} autoStaged=${r.autoStaged} errors=${r.errors}`)
    else log('scheduler', 'info', '启动事件消费: 无积压 pending')
  } catch (e) { log('scheduler', 'warn', `事件消费初始化跳过: ${e.message}`) }

  // A：每 30 分钟同步企微通讯录
  timers.push(setInterval(() => {
    log('scheduler', 'info', '[定时] 30 分钟 → 通讯录自动同步')
    syncStaffWecom().catch((e) => log('scheduler', 'warn', e.message))
  }, 30 * 60 * 1000))

  // B：每 5 分钟扫描待下发群发
  timers.push(setInterval(() => {
    scanPendingBroadcasts().catch((e) => log('scheduler', 'error', e.message))
  }, 5 * 60 * 1000))

  // C：每 1 分钟检查秒杀过期 / 券过期 / 券发完自动关
  timers.push(setInterval(() => {
    closeExpiredSeckills().catch((e) => log('scheduler', 'error', e.message))
    expireOldCoupons().catch((e) => log('scheduler', 'error', e.message))
  }, 60 * 1000))

  // D：每 10 分钟扫描 days_inactive SOP
  timers.push(setInterval(() => {
    runInactiveCustomerSOPs().catch((e) => log('scheduler', 'error', e.message))
  }, 10 * 60 * 1000))

  // E：每小时扫一次过期标签（低频，tag 过期一般按天算）
  timers.push(setInterval(() => {
    cleanExpiredTags().catch((e) => log('scheduler', 'error', e.message))
  }, 60 * 60 * 1000))

  // F：每 5 分钟尝试拉取会话存档群聊消息（未开通时内部跳过）
  timers.push(setInterval(() => {
    pollMsgAudit().catch((e) => log('scheduler', 'error', `msgaudit poll: ${e.message}`))
  }, 5 * 60 * 1000))

  // F2：每 3 分钟消费 chat_messages：关键词打标 + 未回复提醒
  timers.push(setInterval(() => {
    try { runChatConsumer() } catch (e) { log('scheduler', 'error', `[chat-consumer] 异常: ${e.message}`) }
  }, 3 * 60 * 1000))

  // G：每 1 分钟扫 events 表（A1 事件总线 → SOP / 客户分级）
  timers.push(setInterval(() => {
    try {
      const r = processPendingEvents(100)
      if (r.processed || r.errors) log('scheduler', 'info', `[事件] processed=${r.processed} sopRuns=${r.sopRuns} autoStaged=${r.autoStaged} errors=${r.errors}`)
    } catch (e) { log('scheduler', 'error', `[事件] 消费异常: ${e.message}`) }
  }, 60 * 1000))

  // H：每 6 小时兜底全量客户分级重扫（A3，处理遗漏的 / last_active 自然衰减）
  timers.push(setInterval(() => {
    try {
      const changed = rescanAllCustomerStages()
      if (changed) log('scheduler', 'info', `[客户分级] 全量重扫，${changed} 客户 stage 变更`)
      else log('scheduler', 'info', '[客户分级] 全量重扫：无变更')
    } catch (e) { log('scheduler', 'error', `[客户分级] 重扫异常: ${e.message}`) }
  }, 6 * 60 * 60 * 1000))

  // I：每日 0 点归零 today_messages
  //   用递归 setTimeout 计算到下次 0 点的毫秒数，避免每分钟轮询 + GC 丢触发
  function scheduleMidnightZero() {
    const now = new Date()
    const next = new Date(now)
    next.setHours(24, 0, 0, 0) // 明天 0 点
    const ms = next.getTime() - now.getTime()
    const handle = setTimeout(async () => {
      try {
        await zeroTodayMessages()
        log('scheduler', 'info', `每日归零完成，下一次将在 ${next.toISOString().slice(0, 10)} 00:00`)
      } catch (e) {
        log('scheduler', 'error', `msgaudit zero: ${e.message}`)
      } finally {
        scheduleMidnightZero() // 递归：排下一次
      }
    }, ms + 1000) // +1s 错开整点
    timers.push(handle)
  }
  scheduleMidnightZero()

  // J：每日 08:00 自动生成运营日报（B1）
  //   写 wecom_events 表让后续推送通道消费；REST /api/reports/daily 也能手动拉
  function scheduleDailyReport() {
    const now = new Date()
    const next = new Date(now)
    next.setHours(8, 0, 0, 0)
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
    const ms = next.getTime() - now.getTime()
    const handle = setTimeout(() => {
      try {
        runDailyReport()
      } catch (e) {
        log('scheduler', 'error', `[日报] 生成失败: ${e.message}`)
      } finally {
        scheduleDailyReport()
      }
    }, ms + 1000)
    timers.push(handle)
  }
  scheduleDailyReport()

  log('scheduler', 'info', `调度器已启动：会话存档轮询(5min) + 每日归零(递归) + 每日日报(递归)`)
}

export function stopScheduler() {
  for (const t of timers) {
    if (typeof t === 'object' && t.hasRef && typeof t.ref === 'function') clearTimeout(t)
    else clearInterval(t)
  }
  timers = []
}

// === 功能：扫描待下发群发 ===
export async function scanPendingBroadcasts() {
  const pending = db.prepare(`SELECT * FROM broadcasts WHERE status = '待下发' ORDER BY id ASC`).all()
  if (!pending.length) return { scanned: 0, sent: 0 }
  log('scheduler', 'info', `扫描到 ${pending.length} 个待下发任务`)
  let sent = 0
  for (const b of pending) {
    if (sent >= 3) {
      log('scheduler', 'warn', '单轮自动下发上限 3 个，剩余留待下一轮')
      break
    }
    try {
      const cfg = db.prepare('SELECT status FROM wecom_config WHERE id = 1').get()
      const simulated = !cfg || cfg.status !== 'connected'
      if (simulated) {
        db.prepare('UPDATE broadcasts SET status=?, sent_at=CURRENT_TIMESTAMP, sent_rate=100.0 WHERE id=?').run('已下发(模拟)', b.id)
        db.prepare(`INSERT INTO wecom_events (event_type, change_type, payload, handled) VALUES ('broadcast_send','scheduled_simulated',?,1)`).run(
          JSON.stringify({ broadcast_id: b.id, title: b.title })
        )
        log('scheduler', 'info', `群发 #${b.id} 模拟自动下发`)
      } else {
        log('scheduler', 'info', `群发 #${b.id} connected 模式自动下发（跳过，需前端手动调用 /send 确认）`)
      }
      sent++
    } catch (e) {
      log('scheduler', 'error', `群发 #${b.id} 自动下发失败：${e.message}`)
    }
  }
  return { scanned: pending.length, sent }
}

// === 功能：关闭过期秒杀活动 ===
export async function closeExpiredSeckills() {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const expired = db.prepare(`SELECT id,title FROM seckill_activities WHERE active = 1 AND end_at < ?`).all(now)
  if (!expired.length) return { closed: 0 }
  const ids = expired.map(e => e.id)
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`UPDATE seckill_activities SET active = 0 WHERE id IN (${placeholders})`).run(...ids)
  log('scheduler', 'info', `自动关闭 ${ids.length} 个过期秒杀活动: ${expired.map(e => e.title).join(', ')}`)
  return { closed: ids.length, ids }
}

// === 功能：失效过期优惠券 + 券发完自动关闭 ===
export async function expireOldCoupons() {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  // 1. 券模板到期关闭（end_at 过了）
  const cExpired = db.prepare(`SELECT id,name FROM coupons WHERE active = 1 AND end_at < ?`).all(now)
  if (cExpired.length) {
    const ids = cExpired.map(e => e.id)
    const ph = ids.map(() => '?').join(',')
    db.prepare(`UPDATE coupons SET active = 0 WHERE id IN (${ph})`).run(...ids)
    log('scheduler', 'info', `[券过期关闭] 自动失效 ${ids.length} 张到期券模板`)
  }
  // 2. 券模板发完自动关闭（issued_count >= total_stock）
  const soldOut = db.prepare(`SELECT id,name,issued_count,total_stock FROM coupons WHERE active = 1 AND issued_count >= total_stock AND total_stock > 0`).all()
  if (soldOut.length) {
    const ids = soldOut.map(e => e.id)
    const ph = ids.map(() => '?').join(',')
    db.prepare(`UPDATE coupons SET active = 0 WHERE id IN (${ph})`).run(...ids)
    log('scheduler', 'info', `[券发完关闭] 自动关闭 ${ids.length} 张已发完券模板: ${soldOut.map(e => e.name + `(${e.issued_count}/${e.total_stock})`).join(', ')}`)
  }
  // 3. 券实例失效（expires_at 过了 & 还在 pending 状态）
  const iExpired = db.prepare(`
    SELECT count(*) AS n FROM coupon_issues 
    WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?
  `).get(now)
  if (iExpired.n > 0) {
    db.prepare(`UPDATE coupon_issues SET status = 'expired' WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?`).run(now)
    log('scheduler', 'info', `[券实例失效] 自动失效 ${iExpired.n} 张过期券实例`)
  }
  return { couponsExpired: cExpired.length, couponsSoldOut: soldOut.length, issues: iExpired.n }
}

// === 功能：执行 days_inactive 类型 SOP（带 24h dedup，避免和 events churn_warning 重复）===
export async function runInactiveCustomerSOPs() {
  const activeSOPs = db.prepare(`SELECT * FROM sops WHERE active = 1 AND trigger_type = 'days_inactive'`).all()
  if (!activeSOPs.length) return { sop: 0, customers: 0 }
  let totalCustomers = 0
  for (const sop of activeSOPs) {
    const days = Number(sop.trigger_days) || 30
    const cutoffStr = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)
    const params = [cutoffStr]
    let sql = `SELECT id FROM customers WHERE (last_active IS NULL OR last_active < ?) AND stage != 'churned'`
    if (sop.trigger_channel) { sql += ` AND channel = ?`; params.push(sop.trigger_channel) }
    const customers = db.prepare(sql).all(...params)
    if (!customers.length) continue

    // dedup：过滤掉过去 24h 已跑过此 SOP 的客户
    const targetIds = []
    for (const c of customers) {
      const ran = db.prepare(
        `SELECT 1 FROM sop_runs WHERE sop_id = ? AND triggered_by != '手动触发'
         AND created_at > datetime('now', '-24 hours')
         AND (outcome LIKE ? OR target_count = 1) LIMIT 1`
      ).get(sop.id, `%${c.id}%`)
      if (!ran) targetIds.push(c.id)
    }
    if (!targetIds.length) continue

    const result = await runSopBatch(sop, targetIds, 'scheduler:inactive')
    totalCustomers += result.success
    log('scheduler', 'info', `[SOP] ${sop.name} 匹配 ${targetIds.length} 客户，成功 ${result.success}（券 ${result.couponIssued} 标签 ${result.tagApplied} intent ${result.intentLogged}）`)
  }
  return { sop: activeSOPs.length, customers: totalCustomers }
}

// === 功能：清理过期标签 ===
// tags.expires_at 已过 → 删掉 customer_tags 关联 + 删 tag 本身
export async function cleanExpiredTags() {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const expiredTags = db.prepare(`SELECT id, name FROM tags WHERE expires_at IS NOT NULL AND expires_at < ?`).all(now)
  if (!expiredTags.length) return { cleaned: 0 }
  const tagIds = expiredTags.map(t => t.id)
  const ph = tagIds.map(() => '?').join(',')
  const delRel = db.prepare(`DELETE FROM customer_tags WHERE tag_id IN (${ph})`).run(...tagIds)
  const delTag = db.prepare(`DELETE FROM tags WHERE id IN (${ph})`).run(...tagIds)
  log('scheduler', 'info', `[标签清理] 删除 ${delTag.changes} 个过期标签，解除 ${delRel.changes} 个客户关联: ${expiredTags.map(t => t.name).join(', ')}`)
  return { cleaned: delTag.changes, relations: delRel.changes }
}

/**
 * 立即执行一次 SQLite 备份 + 7 天轮转
 * 独立导出函数，可在启动/测试/手动触发时直接调用
 * @returns {{ file: string, size: number, retained: string[] }}
 */
export function runDailyBackup() {
  const backupDir = path.join(__dirname, '..', 'data', 'backups')
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
  const dateStr = new Date().toISOString().slice(0, 10)
  const backupFile = path.join(backupDir, `scrm-${dateStr}.db`)

  // WAL 模式下 VACUUM INTO 能在不断写的同时产出一个完整快照
  db.prepare('VACUUM INTO ?').run(backupFile)
  const size = fs.statSync(backupFile).size
  log('backup', 'info', `每日备份完成: ${backupFile} (${(size / 1024).toFixed(1)} KB)`)

  // 保留最近 7 天，清老备份
  const files = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith('scrm-') && f.endsWith('.db'))
    .sort()
  files.slice(0, -7).forEach((f) => {
    try { fs.unlinkSync(path.join(backupDir, f)) } catch {}
  })

  return { file: backupFile, size, retained: files.slice(-7) }
}

// H：每日 3 点做 SQLite 备份（VACUUM INTO），保留最近 7 天
//   递归 setTimeout 计算到下次 3 点的毫秒数，避免每分钟轮询
//   模块加载即自启动（与 startScheduler 的定时器共用 timers 数组）
function scheduleDailyBackup() {
  const now = new Date()
  const next = new Date(now)
  next.setHours(3, 0, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  const ms = next.getTime() - now.getTime()
  const handle = setTimeout(() => {
    try {
      runDailyBackup()
    } catch (e) {
      log('backup', 'error', `每日备份失败: ${e.message}`)
    } finally {
      scheduleDailyBackup()
    }
  }, ms + 1000)
  timers.push(handle)
}
scheduleDailyBackup()
