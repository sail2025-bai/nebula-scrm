#!/usr/bin/env node
/**
 * 共享的 McpServer 创建工厂
 *
 * 被以下两个入口复用：
 *   1. mcp-server.js  — stdio 模式（本地 AI 助手直接拉起）
 *   2. mcp-http.js     — StreamableHTTP + SSE 双入口（豆包 / 火山方舟 / 远程 AI 调用）
 *
 * 使用：
 *   import { createScrmMcpServer } from './mcp-tools.js'
 *   const server = createScrmMcpServer({ readOnly: false })
 *   await server.connect(transport)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { db, initSchema, now, dayKey, buildSegmentWhere } from './db.js'
import { runDailyReport } from './utils/daily-report.js'

// 启动时确保 Schema 已初始化
try { initSchema() } catch (e) {
  process.stderr?.write?.(`[scrm-mcp] initSchema 警告: ${e.message}\n`)
}

const TABLE_WHITELIST = {
  customers: ['id', 'name', 'wechat_nick', 'stage', 'channel', 'spend', 'orders', 'last_active', 'created_at'],
  orders: ['id', 'order_no', 'customer_id', 'paid_amount', 'status', 'order_at', 'source'],
  follow_ups: ['id', 'customer_id', 'type', 'created_at'],
  events: ['id', 'type', 'customer_id', 'created_at'],
  broadcasts: ['id', 'title', 'type', 'status', 'created_at'],
  sop_runs: ['id', 'sop_id', 'success_count', 'target_count', 'created_at'],
  coupon_redemptions: ['id', 'customer_id', 'order_amount', 'saved_amount', 'redeemed_at']
}

/**
 * @param {{ readOnly?: boolean, version?: string }} opts
 * @returns {McpServer}
 */
export function createScrmMcpServer(opts = {}) {
  const readOnly = !!opts.readOnly
  const version = opts.version || '1.0.0'

  const server = new McpServer({
    name: '星云企微 SCRM',
    version,
    description: 'AI 助手通过此 MCP Server 操作 SCRM：客户台账、订单、分群、日报、群发、事件总线'
  })

  function canWrite() { return !readOnly }

  // =====================================================================
  // 工具 1-4：客户域
  // =====================================================================

  server.tool(
    'search_customers',
    '🔍 按条件搜索客户列表——可按阶段(loyal/mature/churn/new)、渠道、关键词、最小消费、业务模式过滤。返回客户基本信息、消费、标签。',
    {
      stage: z.enum(['loyal', 'mature', 'churn', 'new']).optional().describe('客户阶段'),
      channel: z.string().optional().describe('获客渠道，如 wechat/video/store/ads'),
      keyword: z.string().optional().describe('姓名/企微昵称模糊搜索'),
      min_spend: z.number().optional().describe('最小消费金额'),
      mode: z.enum(['retail', 'service']).optional().describe('业务模式（零售/服务）'),
      limit: z.number().max(100).default(20).describe('返回条数，上限 100'),
      order_by: z.enum(['created_at', 'last_active', 'spend', 'orders']).default('created_at').describe('排序字段')
    },
    async ({ stage, channel, keyword, min_spend, mode, limit, order_by }) => {
      const params = []
      const wh = []
      if (stage) { wh.push('stage = ?'); params.push(stage) }
      if (channel) { wh.push('channel = ?'); params.push(channel) }
      if (keyword) { wh.push('(name LIKE ? OR wechat_nick LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
      if (min_spend != null) { wh.push('spend >= ?'); params.push(min_spend) }
      if (mode) { wh.push('customer_type = ?'); params.push(mode) }
      const where = wh.length ? `WHERE ${wh.join(' AND ')}` : ''
      const rows = db.prepare(`
        SELECT id, name, wechat_nick, phone, stage, channel, spend, orders,
               last_active, created_at FROM customers ${where}
        ORDER BY ${order_by} DESC LIMIT ${Math.min(limit, 100)}
      `).all(...params)
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }
    }
  )

  server.tool(
    'get_customer_timeline',
    '👤 获取客户完整画像 + 互动时间线——包含订单、事件总线、跟进记录，按时间倒序。用于分析单个客户生命周期。',
    { id: z.number().describe('客户 ID') },
    async ({ id }) => {
      const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id)
      if (!c) return { content: [{ type: 'text', text: `客户 #${id} 不存在` }] }
      const timeline = db.prepare(`
        SELECT ts, kind, title, detail, source, amount, extra FROM (
          SELECT order_at AS ts, 'order' AS kind, '订单 ' || order_no AS title,
                 '状态: ' || status AS detail, source, paid_amount AS amount, CAST(id AS TEXT) AS extra
          FROM orders WHERE customer_id = ?
          UNION ALL
          SELECT created_at AS ts, 'followup' AS kind, content AS title,
                 COALESCE(outcome, '') AS detail, type AS source, NULL AS amount, CAST(id AS TEXT) AS extra
          FROM follow_ups WHERE customer_id = ?
          UNION ALL
          SELECT created_at AS ts, 'event' AS kind, type AS title,
                 COALESCE(payload, '') AS detail, 'event_bus' AS source, NULL AS amount, CAST(id AS TEXT) AS extra
          FROM events WHERE customer_id = ?
        ) ORDER BY ts DESC LIMIT 50
      `).all(id, id, id)
      return { content: [{ type: 'text', text: JSON.stringify({ customer: c, timeline }, null, 2) }] }
    }
  )

  server.tool(
    'create_customer',
    '➕ 新建客户/线索——创建后 stage 默认 new。',
    {
      name: z.string().describe('客户姓名'),
      wechat_nick: z.string().optional().describe('企微昵称'),
      phone: z.string().optional().describe('手机号'),
      channel: z.string().optional().describe('获客渠道'),
      tags: z.array(z.string()).optional().describe('初始标签列表'),
      mode: z.enum(['retail', 'service']).default('retail')
    },
    async ({ name, wechat_nick, phone, channel, tags, mode }) => {
      if (!canWrite()) return { content: [{ type: 'text', text: '⚠️ 当前是只读模式，无法创建客户' }] }
      const r = db.prepare(`
        INSERT INTO customers (name, wechat_nick, phone, channel, customer_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(name, wechat_nick || null, phone || null, channel || null, mode, now())
      const cid = r.lastInsertRowid
      const tagList = tags || []
      if (tagList.length) {
        const upsertTag = db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`)
        const getTagId = db.prepare(`SELECT id FROM tags WHERE name = ?`)
        const link = db.prepare(`INSERT OR IGNORE INTO customer_tags (customer_id, tag_id) VALUES (?, ?)`)
        const tx = db.transaction((names) => {
          for (const t of names) {
            upsertTag.run(t)
            const { id } = getTagId.get(t) || {}
            if (id) link.run(cid, id)
          }
        })
        tx(tagList)
      }
      return { content: [{ type: 'text', text: `✅ 客户 #${cid} "${name}" 已创建 (mode=${mode}, tags=[${tagList.join(',')}])` }] }
    }
  )

  server.tool(
    'add_follow_up',
    '📝 给客户添加一条跟进记录——电话/企微/拜访/送礼/备注。',
    {
      customer_id: z.number().describe('客户 ID'),
      type: z.enum(['wechat', 'call', 'visit', 'gift', 'note']).describe('跟进方式'),
      content: z.string().describe('跟进内容'),
      outcome: z.string().optional().describe('跟进结果（如 已成交/下次跟进/异议处理中）'),
      staff_id: z.number().optional().describe('跟进员工 ID（可选）')
    },
    async ({ customer_id, type, content, outcome, staff_id }) => {
      if (!canWrite()) return { content: [{ type: 'text', text: '⚠️ 只读模式' }] }
      const r = db.prepare(`
        INSERT INTO follow_ups (customer_id, type, content, outcome, staff_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(customer_id, type, content, outcome || null, staff_id || null, now())
      db.prepare('UPDATE customers SET last_active = ? WHERE id = ?').run(now(), customer_id)
      return { content: [{ type: 'text', text: `✅ 跟进 #${r.lastInsertRowid} 已添加 | 更新了 last_active` }] }
    }
  )

  // =====================================================================
  // 工具 5-6：订单域
  // =====================================================================

  server.tool(
    'list_orders',
    '📦 查询订单——按状态/客户/时间范围过滤。返回订单号、金额、状态、来源。',
    {
      status: z.enum(['created', 'pending', 'paid', 'shipped', 'completed', 'cancelled', 'refunded']).optional(),
      customer_id: z.number().optional(),
      from: z.string().optional().describe('起始日期 YYYY-MM-DD'),
      to: z.string().optional().describe('结束日期 YYYY-MM-DD'),
      limit: z.number().max(100).default(20)
    },
    async ({ status, customer_id, from, to, limit }) => {
      const wh = []; const p = []
      if (status) { wh.push('o.status = ?'); p.push(status) }
      if (customer_id) { wh.push('o.customer_id = ?'); p.push(customer_id) }
      if (from) { wh.push("DATE(o.order_at) >= ?"); p.push(from) }
      if (to) { wh.push("DATE(o.order_at) <= ?"); p.push(to) }
      const rows = db.prepare(`
        SELECT o.*, c.name AS customer_name FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        ${wh.length ? 'WHERE ' + wh.join(' AND ') : ''}
        ORDER BY o.order_at DESC LIMIT ${Math.min(limit, 100)}
      `).all(...p)
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }
    }
  )

  server.tool(
    'update_order_status',
    '🔄 更新订单状态——允许的转换: paid→shipped→completed, paid→refunded, *→cancelled',
    {
      order_id: z.number(),
      status: z.enum(['paid', 'shipped', 'completed', 'refunded', 'cancelled'])
    },
    async ({ order_id, status }) => {
      if (!canWrite()) return { content: [{ type: 'text', text: '⚠️ 只读模式' }] }
      const r = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order_id)
      if (!r.changes) return { content: [{ type: 'text', text: `订单 #${order_id} 不存在` }] }
      if (status === 'completed') {
        const o = db.prepare('SELECT paid_amount, customer_id FROM orders WHERE id = ?').get(order_id)
        if (o) db.prepare('UPDATE customers SET spend = spend + ?, orders = orders + 1 WHERE id = ?').run(o.paid_amount, o.customer_id)
      }
      return { content: [{ type: 'text', text: `✅ 订单 #${order_id} 状态 → ${status}` }] }
    }
  )

  // =====================================================================
  // 工具 7-8：分析域
  // =====================================================================

  server.tool(
    'get_dashboard_stats',
    '📊 仪表盘核心指标——总客户、今日新增、本周新增、今日跟进、总消费、平均客单价、复购率、群聊数。',
    { mode: z.enum(['retail', 'service']).optional().describe('按业务模式过滤') },
    async ({ mode }) => {
      const args = mode ? [mode] : []
      const cw = mode ? 'WHERE customer_type = ?' : ''
      const cwa = mode ? 'AND customer_type = ?' : ''
      const today = dayKey() + " 00:00:00"
      const weekAgo = dayKey(new Date(Date.now() - 6 * 86400000)) + ' 00:00:00'
      const total = db.prepare(`SELECT COUNT(*) AS n FROM customers ${cw}`).get(...args).n
      const todayNew = db.prepare(`SELECT COUNT(*) AS n FROM customers WHERE created_at >= ? ${cwa}`).get(today, ...args).n
      const weekNew = db.prepare(`SELECT COUNT(*) AS n FROM customers WHERE created_at >= ? ${cwa}`).get(weekAgo, ...args).n
      const spend = db.prepare(`SELECT COALESCE(SUM(spend),0) AS s, COALESCE(SUM(orders),0) AS o FROM customers ${cw}`).get(...args)
      const repeat = db.prepare(`SELECT COUNT(*) AS n FROM customers WHERE orders >= 2 ${cwa}`).get(...args).n
      const avg = spend.o > 0 ? Math.round(spend.s / spend.o) : 0
      const repeatRate = total > 0 ? Math.round((repeat / total) * 1000) / 10 : 0
      const ordersToday = db.prepare(`SELECT COALESCE(SUM(paid_amount),0) AS s FROM orders WHERE DATE(order_at) = ?`).get(dayKey()).s
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            mode: mode || '全模式',
            总客户: total, 今日新增: todayNew, 本周新增: weekNew,
            今日订单额: ordersToday, 总消费: spend.s, 总订单数: spend.o,
            平均客单价: avg, 复购数: repeat, 复购率_百分: repeatRate
          }, null, 2)
        }]
      }
    }
  )

  server.tool(
    'run_custom_analytics',
    '📈 自定义聚合查询——白名单表 + 白名单字段 + 5 种聚合 + 时间粒度 + 分组。用于画趋势图/占比图。',
    {
      table: z.enum(Object.keys(TABLE_WHITELIST).map((k) => k)),
      agg: z.enum(['count', 'sum', 'avg', 'min', 'max']).default('count'),
      field: z.string().optional().describe('聚合字段（sum/avg/min/max 时必填）'),
      group_by: z.string().optional().describe('分组字段'),
      time_col: z.string().optional().describe('时间列（开启后可按 day/week/month/year 分组）'),
      time_gran: z.enum(['day', 'week', 'month', 'year']).default('day'),
      time_from: z.string().optional().describe('起始 YYYY-MM-DD'),
      time_to: z.string().optional().describe('结束 YYYY-MM-DD')
    },
    async ({ table, agg, field, group_by, time_col, time_gran, time_from, time_to }) => {
      const cols = TABLE_WHITELIST[table]
      if (group_by && !cols.includes(group_by)) return { content: [{ type: 'text', text: `❌ group_by 字段 ${group_by} 不在白名单: ${cols.join(', ')}` }] }
      if (time_col && !cols.includes(time_col)) return { content: [{ type: 'text', text: `❌ time_col 不在白名单` }] }
      const p = []; let wh = '1=1'
      if (time_col && time_from) { wh += ` AND ${time_col} >= ?`; p.push(time_from) }
      if (time_col && time_to)   { wh += ` AND ${time_col} <= ?`; p.push(time_to) }
      const aggExpr = agg === 'count' ? 'COUNT(*)' : `${agg.toUpperCase()}(${field})`
      const groupParts = []
      if (group_by) groupParts.push(group_by)
      if (time_col) {
        groupParts.push({ day:   `strftime('%Y-%m-%d', ${time_col})`,
                          week:  `strftime('%Y-W%W', ${time_col})`,
                          month: `strftime('%Y-%m', ${time_col})`,
                          year:  `strftime('%Y', ${time_col})` }[time_gran])
      }
      const gc = groupParts.length ? ` GROUP BY ${groupParts.join(', ')}` : ''
      const sql = `SELECT ${aggExpr} AS value${groupParts.length ? ', ' + groupParts.map((g, i) => `${g} AS g${i}`).join(', ') : ''} FROM ${table} WHERE ${wh}${gc} ORDER BY ${groupParts[groupParts.length - 1] || '1'} ASC LIMIT 500`
      try {
        const rows = db.prepare(sql).all(...p)
        return { content: [{ type: 'text', text: JSON.stringify({ table, agg, field, rows }, null, 2) }] }
      } catch (e) {
        return { content: [{ type: 'text', text: `❌ ${e.message}` }] }
      }
    }
  )

  // =====================================================================
  // 工具 9-11：分群域
  // =====================================================================

  server.tool(
    'list_segments',
    '🎯 列出所有分群（客群）——显示实时圈选人数、冻结快照状态。',
    { mode: z.enum(['retail', 'service']).optional() },
    async ({ mode }) => {
      const rows = mode
        ? db.prepare('SELECT * FROM segments WHERE mode = ? ORDER BY id DESC').all(mode)
        : db.prepare('SELECT * FROM segments ORDER BY id DESC').all()
      const list = rows.map((s) => {
        try {
          const f = buildSegmentWhere(typeof s.conditions === 'string' ? JSON.parse(s.conditions || '{}') : s.conditions || {})
          const where = f.clause ? `(${f.clause})` : '1=1'
          const count = db.prepare(`SELECT COUNT(*) AS n FROM customers WHERE ${where}`).get(...f.params).n
          return { ...s, count }
        } catch { return s }
      })
      return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] }
    }
  )

  server.tool(
    'compare_segments',
    '⚖️ 两个分群对比——overlap/union/delta（人数差、平均消费差、复购率差）。',
    {
      id1: z.number().describe('分群 A ID'),
      id2: z.number().describe('分群 B ID'),
      use_snapshot: z.boolean().default(false).describe('true = 使用冻结快照，false = 实时圈选')
    },
    async ({ id1, id2, use_snapshot }) => {
      const s1 = db.prepare('SELECT * FROM segments WHERE id = ?').get(id1)
      const s2 = db.prepare('SELECT * FROM segments WHERE id = ?').get(id2)
      if (!s1 || !s2) return { content: [{ type: 'text', text: '分群不存在' }] }
      function seg(seg) {
        if (use_snapshot && seg.snapshot) return JSON.parse(seg.snapshot)
        const cond = typeof seg.conditions === 'string' ? JSON.parse(seg.conditions || '{}') : seg.conditions || {}
        const f = buildSegmentWhere(cond)
        const where = f.clause ? `(${f.clause})` : '1=1'
        return db.prepare(`SELECT id FROM customers WHERE ${where}`).all(...f.params).map((r) => Number(r.id))
      }
      const ids1 = seg(s1), ids2 = seg(s2)
      const set1 = new Set(ids1), set2 = new Set(ids2)
      const both = [...set1].filter((x) => set2.has(x))
      return {
        content: [{ type: 'text', text: JSON.stringify({
          seg1: { id: id1, name: s1.name, size: ids1.length },
          seg2: { id: id2, name: s2.name, size: ids2.length },
          overlap: both.length,
          union: set1.size + set2.size - both.length,
          only_in_seg1: ids1.length - both.length,
          only_in_seg2: ids2.length - both.length
        }, null, 2) }]
      }
    }
  )

  server.tool(
    'snapshot_segment',
    '🧊 冻结分群快照——把当前圈选的客户列表固化下来，后续 compare 可用 frozen 版。',
    { id: z.number().describe('分群 ID') },
    async ({ id }) => {
      if (!canWrite()) return { content: [{ type: 'text', text: '⚠️ 只读模式' }] }
      const seg = db.prepare('SELECT * FROM segments WHERE id = ?').get(id)
      if (!seg) return { content: [{ type: 'text', text: '分群不存在' }] }
      const cond = typeof seg.conditions === 'string' ? JSON.parse(seg.conditions || '{}') : seg.conditions || {}
      const f = buildSegmentWhere(cond)
      const where = f.clause ? `(${f.clause})` : '1=1'
      const ids = db.prepare(`SELECT id FROM customers WHERE ${where}`).all(...f.params).map((r) => Number(r.id))
      db.prepare('UPDATE segments SET snapshot = ?, snapshot_count = ?, snapshot_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        JSON.stringify(ids), ids.length, id
      )
      return { content: [{ type: 'text', text: `✅ 分群 #${id} "${seg.name}" 快照已冻结，共 ${ids.length} 位客户` }] }
    }
  )

  // =====================================================================
  // 工具 12-13：日报域
  // =====================================================================

  server.tool(
    'get_daily_report',
    '📰 获取运营日报——近 N 天的订单/消费/客户/事件汇总。',
    { days: z.number().max(30).default(7).describe('获取近几天') },
    async ({ days }) => {
      const rows = db.prepare(`
        SELECT payload, DATE(created_at) AS day, created_at FROM wecom_events
        WHERE event_type = 'daily_report'
        ORDER BY id DESC LIMIT ?
      `).all(days)
      const parsed = rows.map((r) => {
        try { const p = JSON.parse(r.payload); return { day: r.day, ...p.summary } }
        catch { return { day: r.day, raw: r.payload } }
      })
      return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] }
    }
  )

  server.tool(
    'generate_daily_report',
    '⚡ 立即生成今日运营日报——通常 1 秒完成，结果同时写入 wecom_events。',
    { day: z.string().optional().describe('指定日期 YYYY-MM-DD，默认今天') },
    async ({ day }) => {
      const r = runDailyReport(day || dayKey())
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...r }, null, 2) }] }
    }
  )

  // =====================================================================
  // 工具 14-16：群发 + 事件域
  // =====================================================================

  server.tool(
    'list_broadcasts',
    '📢 群发记录列表——返回最近的企微群发/视频号推送历史。',
    { limit: z.number().max(50).default(10) },
    async ({ limit }) => {
      const rows = db.prepare('SELECT * FROM broadcasts ORDER BY id DESC LIMIT ?').all(limit)
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }
    }
  )

  server.tool(
    'query_events',
    '🔔 查询事件总线——order_paid/chat_keyword/customer_stage_changed 等事件流。',
    {
      type: z.string().optional().describe('事件类型，如 order_paid, chat_keyword, customer_stage_changed'),
      customer_id: z.number().optional(),
      status: z.enum(['pending', 'processing', 'done', 'failed']).optional(),
      limit: z.number().max(100).default(20)
    },
    async ({ type, customer_id, status, limit }) => {
      const wh = []; const p = []
      if (type) { wh.push('type = ?'); p.push(type) }
      if (customer_id) { wh.push('customer_id = ?'); p.push(customer_id) }
      if (status) { wh.push('status = ?'); p.push(status) }
      const rows = db.prepare(`
        SELECT * FROM events ${wh.length ? 'WHERE ' + wh.join(' AND ') : ''}
        ORDER BY id DESC LIMIT ${Math.min(limit, 100)}
      `).all(...p)
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }
    }
  )

  server.tool(
    'create_broadcast',
    '📣 创建群发任务——指定标题/类型/内容/目标分群，状态置为 待下发（不会立即发送，安全起见）。',
    {
      title: z.string().describe('群发标题'),
      type: z.enum(['text', 'image', 'article', 'video']).default('text').describe('素材类型'),
      content: z.string().describe('群发内容或素材 URL'),
      segment_id: z.number().optional().describe('目标分群 ID（可选，留空则全量）'),
      mode: z.enum(['retail', 'service']).default('retail')
    },
    async ({ title, type, content, segment_id, mode }) => {
      if (!canWrite()) return { content: [{ type: 'text', text: '⚠️ 只读模式' }] }
      const audienceDesc = segment_id ? `分群#${segment_id}` : '全量客户'
      const r = db.prepare(`
        INSERT INTO broadcasts (title, message, type, audience_desc, status, mode, created_at)
        VALUES (?, ?, ?, ?, '待下发', ?, ?)
      `).run(title, content, type, audienceDesc, mode, now())
      return { content: [{ type: 'text', text: `✅ 群发 #${r.lastInsertRowid} 已创建（${audienceDesc}，待下发，需人工确认发送）` }] }
    }
  )

  return server
}

// Tool 名称列表（给外部快速获取）
export const MCP_TOOL_NAMES = [
  'search_customers', 'get_customer_timeline', 'create_customer', 'add_follow_up',
  'list_orders', 'update_order_status',
  'get_dashboard_stats', 'run_custom_analytics',
  'list_segments', 'compare_segments', 'snapshot_segment',
  'get_daily_report', 'generate_daily_report',
  'list_broadcasts', 'query_events', 'create_broadcast'
]
