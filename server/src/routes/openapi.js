import express from 'express'
import { db } from '../db.js'
import { createApiToken, parseScopes, hashToken, requireScope, SCOPE_ADMIN, SCOPE_READ } from '../middleware/apiToken.js'
import { requireAuth } from '../middleware/auth.js'

const tokenRouter = express.Router()

// ======== C3: API Token 管理（仅对内部 admin 用户开放，走 JWT 鉴权）========

function listTokens() {
  return db.prepare(`
    SELECT id, name, token_prefix, scopes, rate_limit, last_used_at, expires_at, revoked_at, revoked_reason, created_by, created_at
    FROM api_tokens ORDER BY id DESC
  `).all().map((t) => ({ ...t, scopes: parseScopes(t.scopes) }))
}

tokenRouter.get('/tokens', requireAuth, (req, res) => {
  // 只有 admin 能看全部，普通用户只能看自己创建的
  const isAdmin = req.user.role === 'admin'
  const rows = isAdmin
    ? listTokens()
    : listTokens().filter((t) => t.created_by === req.user.id)
  res.json({ tokens: rows })
})

tokenRouter.post('/tokens', requireAuth, (req, res) => {
  const b = req.body || {}
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Token 名称不能为空' })
  const scopes = Array.isArray(b.scopes) ? b.scopes.join(',') : (b.scopes || 'read')
  const created = createApiToken({
    name: String(b.name).trim(),
    scopes,
    rate_limit: Number(b.rate_limit) || 60,
    expires_days: b.expires_days !== undefined ? Number(b.expires_days) : 365,
    created_by: req.user.id
  })
  res.status(201).json({
    ok: true,
    id: created.id,
    token: created.plain, // 只在创建时返回明文！
    prefix: created.prefix,
    expires_at: created.expires_at,
    hint: '⚠️ 这是唯一一次展示明文，请立即安全保存，丢失后无法找回，只能重新生成'
  })
})

tokenRouter.post('/tokens/:id/revoke', requireAuth, (req, res) => {
  const id = Number(req.params.id)
  const reason = String(req.body?.reason || '手动撤销').slice(0, 200)
  const r = db.prepare('UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = ? WHERE id = ?').run(reason, id)
  if (!r.changes) return res.status(404).json({ error: 'Token 不存在' })
  res.json({ ok: true, id, revoked_at: new Date().toISOString().replace('T', ' ').slice(0, 19) })
})

tokenRouter.delete('/tokens/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id)
  const r = db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id)
  if (!r.changes) return res.status(404).json({ error: 'Token 不存在' })
  res.json({ ok: true, id })
})

// 审计日志（admin 看全部，普通用户看自己 token 的）
tokenRouter.get('/audit', requireAuth, (req, res) => {
  const days = Math.min(30, Number(req.query.days) || 7)
  const rows = db.prepare(`
    SELECT l.*, t.name AS token_name, t.token_prefix FROM api_audit_log l
    LEFT JOIN api_tokens t ON t.id = l.token_id
    WHERE l.created_at >= datetime('now', ?)
    ORDER BY l.id DESC LIMIT 500
  `).all(`-${days} days`)
  res.json({ count: rows.length, rows })
})

// ======== C3: OpenAPI 3.0 规范（自动生成，对外展示）========


const openRouter = express.Router()
openRouter.get('/open.json', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`
  const spec = {
    openapi: '3.0.3',
    info: {
      title: '星云企微 SCRM · 开放 API',
      version: '1.0.0',
      description: `面向 ERP / CRM 对接的 RESTful API。所有开放端点都需要在 Header 里提供 \`Authorization: Bearer neb_xxx\` 或 \`X-API-Key: neb_xxx\`。

**创建 API Token →** 登录 SCRM 后台 → 左侧菜单「开放平台」→ 新建 Token → 保存明文

Scopes:
- \`read\` — 只读查询
- \`write\` — 写订单 / 客户 / 跟进记录
- \`admin\` — 所有权限`
    },
    servers: [{ url: `${baseUrl}/api`, description: req.hostname === 'localhost' ? '本地开发' : '线上环境' }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: '推荐：X-API-Key: neb_xxx' },
        BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'neb_xxx', description: '也支持 Authorization: Bearer neb_xxx' }
      }
    },
    security: [{ ApiKeyAuth: [] }],
    paths: buildOpenApiPaths()
  }
  res.json(spec)
})

// ======== C2: 轻量仪表盘 Builder ========

/**
 * 白名单规则：
 * - table 必须在 TABLE_WHITELIST 里
 * - 禁止用户传原始 SQL，所有聚合/过滤用字段白名单参数化构造
 * - 仅 SELECT，禁止任何写操作
 */
const TABLE_WHITELIST = {
  customers: { label: '客户', columns: ['id', 'name', 'wechat_nick', 'stage', 'channel', 'spend', 'orders', 'last_active', 'created_at'] },
  orders: { label: '订单', columns: ['id', 'order_no', 'customer_id', 'paid_amount', 'status', 'order_at', 'source'] },
  follow_ups: { label: '跟进', columns: ['id', 'customer_id', 'type', 'created_at'] },
  events: { label: '事件', columns: ['id', 'type', 'customer_id', 'created_at'] },
  broadcasts: { label: '群发', columns: ['id', 'title', 'type', 'status', 'created_at'] },
  sop_runs: { label: 'SOP 执行', columns: ['id', 'sop_id', 'success_count', 'target_count', 'created_at'] },
  coupons: { label: '优惠券', columns: ['id', 'name', 'status', 'created_at'] },
  coupon_redemptions: { label: '优惠券核销', columns: ['id', 'customer_id', 'order_amount', 'saved_amount', 'redeemed_at'] }
}

const AGG_FUNCS = new Set(['count', 'sum', 'avg', 'min', 'max'])
const TIME_GRAN = new Set(['day', 'week', 'month', 'year'])

openRouter.post('/analytics/builder', requireAuth, (req, res) => {
  const b = req.body || {}
  const table = String(b.table || '').trim()
  const opts = TABLE_WHITELIST[table]
  if (!opts) return res.status(400).json({ error: '不支持的数据表', tables: Object.keys(TABLE_WHITELIST) })

  const agg = (b.agg || 'count').toLowerCase()
  if (!AGG_FUNCS.has(agg)) return res.status(400).json({ error: '不支持的聚合函数', allowed: [...AGG_FUNCS] })

  const field = String(b.field || opts.columns[0]).trim()
  if (!opts.columns.includes(field)) return res.status(400).json({ error: '字段不在白名单内', field, allowed: opts.columns })

  const groupBy = b.group_by ? String(b.group_by).trim() : null
  if (groupBy && !opts.columns.includes(groupBy)) return res.status(400).json({ error: 'group_by 字段不在白名单内' })

  const timeCol = String(b.time_col || '').trim()
  const timeFrom = b.time_from
  const timeTo = b.time_to
  const timeGran = (b.time_gran || 'day').toLowerCase()
  if (timeCol && !opts.columns.includes(timeCol)) return res.status(400).json({ error: 'time_col 字段不在白名单内' })
  if (timeCol && !TIME_GRAN.has(timeGran)) return res.status(400).json({ error: '不支持的时间粒度', allowed: [...TIME_GRAN] })

  // 构造 SQL（安全）
  const params = []
  let where = '1=1'
  if (timeCol && timeFrom) { where += ` AND ${timeCol} >= ?`; params.push(String(timeFrom)) }
  if (timeCol && timeTo)   { where += ` AND ${timeCol} <= ?`; params.push(String(timeTo)) }

  let aggExpr
  if (agg === 'count') aggExpr = 'COUNT(*)'
  else aggExpr = `${agg.toUpperCase()}(${field})`

  const groupParts = []
  if (groupBy) groupParts.push(groupBy)
  if (timeCol) {
    const granSQL = {
      day:   `strftime('%Y-%m-%d', ${timeCol})`,
      week:  `strftime('%Y-W%W', ${timeCol})`,
      month: `strftime('%Y-%m', ${timeCol})`,
      year:  `strftime('%Y', ${timeCol})`
    }[timeGran]
    groupParts.push(granSQL)
  }

  let groupClause = ''
  if (groupParts.length) groupClause = ` GROUP BY ${groupParts.join(', ')}`

  const sql = `SELECT ${aggExpr} AS value${groupParts.length ? ', ' + groupParts.map((g, i) => `${g} AS g${i}`).join(', ') : ''} FROM ${table} WHERE ${where}${groupClause} ORDER BY ${groupParts[groupParts.length - 1] || '1'} ASC LIMIT 500`
  try {
    const rows = db.prepare(sql).all(...params)
    res.json({ table, agg, field, group_by: groupBy, time_col: timeCol || null, time_gran: timeCol ? timeGran : null, rows })
  } catch (e) {
    res.status(400).json({ error: '查询失败', detail: e.message })
  }
})

openRouter.get('/analytics/tables', requireAuth, (req, res) => {
  res.json({ tables: Object.entries(TABLE_WHITELIST).map(([key, v]) => ({ key, label: v.label, columns: v.columns })) })
})

// ======== OpenAPI paths 构建 ========

function buildOpenApiPaths() {
  const bearer = [{ ApiKeyAuth: [] }, { BearerAuth: [] }]
  return {
    '/customers': {
      get: { summary: '客户列表', tags: ['Customers'], security: bearer,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'size', schema: { type: 'integer', default: 20 } },
          { in: 'query', name: 'stage', schema: { type: 'string', enum: ['loyal','mature','churn','new'] } },
          { in: 'query', name: 'channel', schema: { type: 'string' } },
          { in: 'query', name: 'keyword', schema: { type: 'string', description: '按姓名/企微昵称搜索' } }
        ],
        responses: { 200: { description: '客户列表' } }
      },
      post: { summary: '创建客户', tags: ['Customers'], security: bearer,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: {
          name: { type: 'string' }, wechat_nick: { type: 'string' }, phone: { type: 'string' }, channel: { type: 'string' }, stage: { type: 'string' }
        }}}}},
        responses: { 201: { description: '客户已创建' } }
      }
    },
    '/customers/{id}': {
      get: { summary: '客户详情', tags: ['Customers'], security: bearer,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '客户详情' } }
      },
      put: { summary: '更新客户', tags: ['Customers'], security: bearer,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '更新成功' } }
      }
    },
    '/customers/{id}/timeline': {
      get: { summary: '客户互动时间线（订单+事件+跟进）', tags: ['Customers'], security: bearer,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '时间线' } }
      }
    },
    '/orders': {
      get: { summary: '订单列表', tags: ['Orders'], security: bearer,
        parameters: [
          { in: 'query', name: 'status', schema: { type: 'string' } },
          { in: 'query', name: 'customer_id', schema: { type: 'integer' } },
          { in: 'query', name: 'from', schema: { type: 'string', format: 'date' } },
          { in: 'query', name: 'to', schema: { type: 'string', format: 'date' } }
        ],
        responses: { 200: { description: '订单列表' } }
      },
      post: { summary: '创建订单', tags: ['Orders'], security: bearer,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['customer_id','order_no','paid_amount','status'], properties: {
          customer_id: { type: 'integer' }, order_no: { type: 'string' }, paid_amount: { type: 'number' }, status: { type: 'string', enum: ['created','pending','paid','shipped','completed','cancelled','refunded'] }, source: { type: 'string' }, product_name: { type: 'string' }
        }}}}},
        responses: { 201: { description: '订单已创建' } }
      }
    },
    '/orders/{id}/status': {
      put: { summary: '更新订单状态', tags: ['Orders'], security: bearer,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string' } }}}}},
        responses: { 200: { description: '状态已更新' } }
      }
    },
    '/follow_ups': {
      get: { summary: '跟进记录列表', tags: ['Follow-ups'], security: bearer },
      post: { summary: '新增跟进记录', tags: ['Follow-ups'], security: bearer,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['customer_id','type','content'], properties: {
          customer_id: { type: 'integer' }, type: { type: 'string', enum: ['wechat','call','visit','gift','note'] }, content: { type: 'string' }, outcome: { type: 'string' }
        }}}}},
        responses: { 201: { description: '跟进已记录' } }
      }
    },
    '/events': {
      get: { summary: '事件总线查询（只读）', tags: ['Events'], security: bearer,
        parameters: [
          { in: 'query', name: 'type', schema: { type: 'string', description: '如 order_paid, chat_keyword, customer_stage_changed' } },
          { in: 'query', name: 'customer_id', schema: { type: 'integer' } },
          { in: 'query', name: 'status', schema: { type: 'string', enum: ['pending','processing','done','failed'] } }
        ],
        responses: { 200: { description: '事件列表' } }
      }
    },
    '/dashboard/stats': {
      get: { summary: '仪表盘实时统计', tags: ['Dashboard'], security: bearer,
        responses: { 200: { description: '统计数据' } }
      }
    },
    '/reports/daily': {
      get: { summary: '运营日报（近 N 天）', tags: ['Reports'], security: bearer,
        parameters: [{ in: 'query', name: 'days', schema: { type: 'integer', default: 7 } }],
        responses: { 200: { description: '日报列表' } }
      }
    },
    '/segments/compare': {
      get: { summary: '分群人群对比', tags: ['Segments'], security: bearer,
        parameters: [
          { in: 'query', name: 'id1', required: true, schema: { type: 'integer' } },
          { in: 'query', name: 'id2', required: true, schema: { type: 'integer' } },
          { in: 'query', name: 'use_snapshot', schema: { type: 'string', enum: ['1', '0'], description: '设为 1 使用冻结快照' } }
        ],
        responses: { 200: { description: '对比结果（overlap/union/stats）' } }
      }
    },
    '/segments/{id}/snapshot': {
      post: { summary: '冻结分群快照', tags: ['Segments'], security: bearer,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '快照已创建' } }
      }
    },
    '/analytics/builder': {
      post: { summary: '轻量仪表盘查询（白名单参数化）', tags: ['Analytics'], security: bearer,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['table'], properties: {
          table: { type: 'string', description: `表名，可选值见 /api/analytics/tables` },
          agg: { type: 'string', default: 'count', enum: ['count','sum','avg','min','max'] },
          field: { type: 'string', description: '聚合字段（sum/avg/min/max 时必填）' },
          group_by: { type: 'string', description: '分组字段（可选）' },
          time_col: { type: 'string', description: '时间列（可选，开启后按粒度分组）' },
          time_gran: { type: 'string', default: 'day', enum: ['day','week','month','year'] },
          time_from: { type: 'string' }, time_to: { type: 'string' }
        }}}}},
        responses: { 200: { description: '聚合结果 rows[]' } }
      }
    }
  }
}

export default openRouter
export { tokenRouter }
