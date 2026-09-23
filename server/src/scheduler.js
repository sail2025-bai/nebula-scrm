import { log, syncStaffWecom } from './wecom.js'
import { pollMsgAudit, zeroTodayMessages } from './wecom-msgaudit.js'
import { db } from './db.js'

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

  // G：每日 0 点归零 today_messages
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

  log('scheduler', 'info', `调度器已启动：会话存档轮询(5min) + 每日归零(递归)`)
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

// === 功能：执行 days_inactive 类型 SOP ===
export async function runInactiveCustomerSOPs() {
  const activeSOPs = db.prepare(`SELECT * FROM sops WHERE active = 1 AND trigger_type = 'days_inactive'`).all()
  if (!activeSOPs.length) return { sop: 0, customers: 0 }
  let totalCustomers = 0
  for (const sop of activeSOPs) {
    const days = Number(sop.trigger_days) || 30
    const cutoffDate = new Date(Date.now() - days * 24 * 3600 * 1000)
    const cutoffStr = cutoffDate.toISOString().replace('T', ' ').slice(0, 19)
    const params = [cutoffStr]
    let sql = `SELECT id FROM customers WHERE (last_active IS NULL OR last_active < ?) AND stage != 'churned'`
    if (sop.trigger_channel) {
      sql += ` AND channel = ?`
      params.push(sop.trigger_channel)
    }
    const customers = db.prepare(sql).all(...params)
    if (!customers.length) continue
    const targetIds = customers.map(c => c.id)
    const result = await runSOP(sop, targetIds, 'scheduler:inactive')
    totalCustomers += result.success_count
    log('scheduler', 'info', `[SOP] ${sop.name} 匹配 ${targetIds.length} 客户，成功执行 ${result.success_count}`)
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

// SOP 执行核心（push_coupon / add_tag）
async function runSOP(sop, customerIds, triggeredBy) {
  const steps = JSON.parse(sop.steps || '[]')
  let success = 0
  let couponIssued = 0
  let tagApplied = 0

  for (const cid of customerIds) {
    try {
      for (const step of steps) {
        const stepType = step.type || step.action
        if (stepType === 'push_coupon' && step.coupon_id) {
          const code = Math.random().toString(36).slice(2, 10).toUpperCase()
          db.prepare(`INSERT INTO coupon_issues (coupon_id,customer_id,source,sop_id,sop_step_index,code,status)
            VALUES (?,?,?,?,?,?, 'pending')`).run(
            step.coupon_id, cid, `sop:${sop.id}`, sop.id, steps.indexOf(step), code
          )
          couponIssued++
        } else if (stepType === 'add_tag' && step.tag_name) {
          // SOP 自动打的 tag 默认 30 天过期
          const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)
          let tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(step.tag_name)
          if (!tag) {
            const r = db.prepare('INSERT INTO tags (name, category, mode, expires_at) VALUES (?, "SOP自动", ?, ?)').run(step.tag_name, sop.mode || 'retail', expires)
            tag = { id: Number(r.lastInsertRowid) }
          }
          db.prepare('INSERT OR IGNORE INTO customer_tags (customer_id, tag_id) VALUES (?, ?)').run(cid, tag.id)
          tagApplied++
        }
      }
      success++
    } catch (e) {
      log('scheduler', 'warn', `[SOP] 客户 #${cid} 执行失败: ${e.message}`)
    }
  }
  const r = db.prepare(`INSERT INTO sop_runs (sop_id, triggered_by, target_count, success_count, outcome, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(
    sop.id, triggeredBy, customerIds.length, success,
    JSON.stringify({ couponIssued, tagApplied })
  )
  db.prepare('UPDATE sops SET run_count = run_count + 1 WHERE id = ?').run(sop.id)
  return { run_id: r.lastInsertRowid, success_count: success, couponIssued, tagApplied }
}

  // H：每日 3 点做 SQLite 备份（VACUUM INTO），保留最近 7 天
  function scheduleDailyBackup() {
    const now = new Date()
    const next = new Date(now)
    next.setHours(3, 0, 0, 0)
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
    const ms = next.getTime() - now.getTime()
    const handle = setTimeout(() => {
      try {
        const fs = require('node:fs')
        const path = require('node:path')
        const backupDir = path.join(__dirname, '..', 'data', 'backups')
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
        const dateStr = new Date().toISOString().slice(0, 10)
        const backupFile = path.join(backupDir, `scrm-${dateStr}.db`)
        // WAL 模式下用 VACUUM INTO，保证备份一致性
        db.prepare('VACUUM INTO ?').run(backupFile)
        log('backup', 'info', `每日备份完成: ${backupFile}`)
        // 保留最近 7 天，清老备份
        const files = fs.readdirSync(backupDir)
          .filter((f) => f.startsWith('scrm-') && f.endsWith('.db'))
          .sort()
        files.slice(0, -7).forEach((f) => {
          try { fs.unlinkSync(path.join(backupDir, f)) } catch {}
        })
      } catch (e) {
        log('backup', 'error', `每日备份失败: ${e.message}`)
      } finally {
        scheduleDailyBackup()
      }
    }, ms + 1000)
    timers.push(handle)
  }
  scheduleDailyBackup()
