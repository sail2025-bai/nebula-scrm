import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import crypto from 'node:crypto'
import { db, initSchema } from './db.js'
import { seedIfEmpty } from './seed.js'
import { loadConfigFromEnv, wecomConfig, log } from './wecom.js'
import { startScheduler } from './scheduler.js'
import { requireAuth, optionalAuth } from './middleware/auth.js'
import customersRouter from './routes/customers.js'
import tagsRouter from './routes/tags.js'
import segmentsRouter from './routes/segments.js'
import groupsRouter from './routes/groups.js'
import followupsRouter from './routes/followups.js'
import broadcastsRouter from './routes/broadcasts.js'
import sopsRouter from './routes/sops.js'
import staffRouter from './routes/staff.js'
import dashboardRouter from './routes/dashboard.js'
import authRouter from './routes/auth.js'
import wecomRouter from './routes/wecom.js'
import seasRouter from './routes/seas.js'
import qrcodesRouter from './routes/qrcodes.js'
import backupRouter from './routes/backup.js'
import couponsRouter from './routes/coupons.js'
import seckillRouter from './routes/seckill.js'
import publicRouter from './routes/public.js'
import extRouter from './routes/ext.js'
import ordersRouter from './routes/orders.js'
import msgauditRouter from './routes/msgaudit.js'
import reportsRouter from './routes/reports.js'
import openapiRouter, { tokenRouter } from './routes/openapi.js'
import mcpRouter from './mcp-http.js'

const app = express()

// --- 基础安全 & 中间件 ---
app.use(helmet({ contentSecurityPolicy: false })) // SPA 用 react-chartjs 等需要 inline eval
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

// --- 请求 ID 追踪（P3）---
app.use((req, res, next) => {
  req.id = req.header('X-Request-Id') || crypto.randomUUID()
  res.setHeader('X-Request-Id', req.id)
  next()
})

// --- 请求日志（P2）---
const isProd = process.env.NODE_ENV === 'prod'
app.use(morgan(isProd ? 'combined' : 'dev', {
  skip: (req) => req.path === '/api/health' || req.path.startsWith('/api/channels')
}))

// --- 登录接口防暴力（P2）---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: '登录请求过于频繁，请 15 分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false
})
app.use('/api/auth', authLimiter)

// --- 企微/视频号 webhook 防刷（P0-3 轻量版，IP 白名单由 wecom/orders 路由内部做）---
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: { error: 'Webhook 过于频繁' } })
app.use('/api/wecom/webhook', webhookLimiter)
app.use('/api/orders/webhook', webhookLimiter)

// --- 初始化 DB ---
initSchema()
seedIfEmpty()
loadConfigFromEnv()

// === 路由挂载（顺序很重要：先放公开路由，再放 requireAuth 关口，最后挂受保护路由）===

// ① 公开路由（无需登录）
app.use('/api/auth', authRouter)           // login/register/wxlogin 返回 token
app.use('/api/public', publicRouter)       // 公开页面 / 二维码落地页
app.use('/api/health', (req, res) => {     // 健康检查（也公开）
  try {
    const cfg = wecomConfig()
    const customers = db.prepare('SELECT COUNT(*) AS n FROM customers').get().n
    const staff = db.prepare('SELECT COUNT(*) AS n FROM staff').get().n
    const pending = db.prepare(`SELECT COUNT(*) AS n FROM broadcasts WHERE status = '待下发'`).get().n
    const simCount = db.prepare('SELECT COUNT(*) AS n FROM wecom_events WHERE change_type = ?').get('simulated').n
    res.json({
      ok: true,
      time: new Date().toISOString().replace('T', ' ').slice(0, 19),
      app: 'nebula-scrm',
      wecom: cfg ? {
        status: cfg.status,
        corp_id_masked: cfg.corp_id ? String(cfg.corp_id).slice(0, 4) + '****' : null,
        last_sync_at: cfg.last_sync_at,
        token_ready: !!(cfg.corp_id && cfg.corp_secret)
      } : { status: 'unset' },
      counts: { customers, staff, pending_broadcasts: pending, simulated_events: simCount }
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})
app.use('/api/channels', (req, res) => {   // 渠道下拉（可选鉴权）
  optionalAuth(req, res, () => {
    const mode = req.query.mode
    if (mode === 'retail' || mode === 'service') {
      const rows = db.prepare('SELECT DISTINCT channel FROM customers WHERE channel IS NOT NULL AND customer_type = ? ORDER BY channel').all(mode)
      return res.json(rows.map((r) => r.channel))
    }
    const rows = db.prepare('SELECT DISTINCT channel FROM customers WHERE channel IS NOT NULL ORDER BY channel').all()
    res.json(rows.map((r) => r.channel))
  })
})

// ② 第三方 API（走 X-API-Key，不是 JWT）
app.use('/api/ext', extRouter)

// ③ 企微 / 视频号回调（走签名校验，不走 JWT）
//    内部路由会做签名校验 + IP 白名单（P0-3 在 wecom/orders 路由里实现）
app.use('/api/wecom', wecomRouter)         // 包含 /webhook
app.use('/api/orders', ordersRouter)      // 包含 /webhook/channels-shop

// ④ C3: OpenAPI 规范（公开，方便 ERP/CRM 对接方查看）+ C2: Analytics Builder（路由内部再用 requireAuth）
app.use('/api', openapiRouter)

// ⑤ MCP HTTP 入口（走自身 Bearer token 鉴权，不依赖 JWT）
//    StreamableHTTP + SSE 双协议，支持豆包/火山方舟/Dify 远程调用
app.use('/api/mcp', mcpRouter)

// ⑥ JWT 鉴权关口 —— 之后所有路由必须 Bearer token
app.use(requireAuth)

// ⑤ 受保护的业务路由
app.use('/api/customers', customersRouter)
app.use('/api/tags', tagsRouter)
app.use('/api/segments', segmentsRouter)
app.use('/api/groups', groupsRouter)
app.use('/api/follow-ups', followupsRouter)
app.use('/api/broadcasts', broadcastsRouter)
app.use('/api/sops', sopsRouter)
app.use('/api/staff', staffRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/seas', seasRouter)
app.use('/api/qrcodes', qrcodesRouter)
app.use('/api/backup', backupRouter)
app.use('/api/coupons', couponsRouter)
app.use('/api/seckill', seckillRouter)
app.use('/api/msgaudit', msgauditRouter)
app.use('/api/reports', reportsRouter)

// --- C3: 内部 Token 管理（走 JWT 鉴权，必须在 requireAuth 之后）---
app.use('/api/auth', tokenRouter)

// --- 前端生产构建静态托管（单进程一体化）---
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist')
app.use(express.static(CLIENT_DIST))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  res.sendFile(path.join(CLIENT_DIST, 'index.html'))
})

// --- 404（必须在所有路由之后，error handler 之前）---
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: '接口不存在', path: req.path, requestId: req.id })
  } else {
    res.status(404).sendFile(path.join(CLIENT_DIST, 'index.html'))
  }
})

// --- 分级错误 handler（P0-2）---
app.use((err, req, res, next) => {
  const code = err.code || err.status || 500
  const isProd = process.env.NODE_ENV === 'prod'
  if (!isProd) console.error(`[ERR ${req.id}]`, err)
  else log('api', 'error', `${req.method} ${req.path} ${code} — ${err.message}`)

  // better-sqlite3 约束错误
  if (err.code === 'SQLITE_CONSTRAINT') {
    return res.status(400).json({ error: '数据约束冲突，请检查必填字段或重复数据', requestId: req.id })
  }
  if (err.code === 'SQLITE_BUSY') {
    return res.status(503).json({ error: '数据库繁忙，请稍后重试', requestId: req.id })
  }

  res.status(code).json({
    error: err.expose && !isProd ? err.message : (isProd ? '服务器内部错误' : err.message),
    requestId: req.id
  })
})

const PORT = parseInt(process.env.PORT || '3001')
app.listen(PORT, () => {
  log('server', 'info', `SCRM 服务启动 http://localhost:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'dev'})`)
  startScheduler()
})

export default app
