import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

const db = new Database(path.join(dataDir, 'scrm.db'))
db.pragma('foreign_keys = ON')
db.pragma('journal_mode = WAL')        // 多进程 / 写密集场景下读写并行
db.pragma('busy_timeout = 5000')        // 锁冲突时等待 5s，避免 SQLITE_BUSY

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      account TEXT UNIQUE,
      password_hash TEXT,
      business_mode TEXT DEFAULT 'retail',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      wechat_nick TEXT,
      avatar TEXT,
      gender TEXT DEFAULT '女',
      phone TEXT,
      stage TEXT NOT NULL DEFAULT 'new',
      channel TEXT,
      spend REAL DEFAULT 0,
      orders INTEGER DEFAULT 0,
      last_active TEXT,
      staff_id INTEGER REFERENCES staff(id),
      rfm_score TEXT,
      health TEXT,
      notes TEXT,
      customer_type TEXT DEFAULT 'retail',
      company TEXT,
      position TEXT,
      intent_level TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      category TEXT DEFAULT '业务标签',
      mode TEXT DEFAULT 'retail'
    );
    CREATE TABLE IF NOT EXISTS customer_tags (
      customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
      tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (customer_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      conditions TEXT,
      mode TEXT DEFAULT 'retail',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS wechat_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_staff_id INTEGER REFERENCES staff(id),
      member_count INTEGER DEFAULT 0,
      capacity INTEGER DEFAULT 200,
      today_messages INTEGER DEFAULT 0,
      sop_status TEXT,
      health_score INTEGER DEFAULT 80,
      mode TEXT DEFAULT 'retail',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      staff_id INTEGER REFERENCES staff(id),
      type TEXT DEFAULT 'wechat',
      content TEXT NOT NULL,
      outcome TEXT,
      next_followup_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS broadcasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT DEFAULT '客户群发',
      audience_desc TEXT,
      message TEXT,
      target_count INTEGER DEFAULT 0,
      sent_rate REAL DEFAULT 0,
      status TEXT DEFAULT '待下发',
      mode TEXT DEFAULT 'retail',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      trigger_desc TEXT,
      steps TEXT,
      run_count INTEGER DEFAULT 0,
      conversion REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      mode TEXT DEFAULT 'retail'
    );
    CREATE TABLE IF NOT EXISTS wecom_config (
      id INTEGER PRIMARY KEY CHECK(id=1),
      corp_id TEXT DEFAULT '',
      corp_secret TEXT DEFAULT '',
      callback_token TEXT,
      encoding_aes_key TEXT,
      status TEXT DEFAULT 'unset',
      last_sync_at TEXT
    );
    CREATE TABLE IF NOT EXISTS wecom_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT,
      change_type TEXT,
      external_userid TEXT,
      userid TEXT,
      payload TEXT,
      handled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS seas_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT,
      phone TEXT,
      wechat_nick TEXT,
      channel TEXT,
      source TEXT,
      note TEXT,
      status TEXT DEFAULT 'pending',
      owner_staff_id INTEGER REFERENCES staff(id),
      claimed_at TEXT,
      mode TEXT DEFAULT 'retail',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS qr_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      channel TEXT,
      staff_id INTEGER REFERENCES staff(id),
      auto_tags TEXT DEFAULT '[]',
      scan_count INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      mode TEXT DEFAULT 'retail',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  const alters = [
    ['qr_codes', 'qr_ticket', 'TEXT'],
    ['broadcasts', 'sent_at', 'TEXT'],
    ['broadcasts', 'fail_reason', 'TEXT']
  ]
  // 活码关联活动/券模板，支持包裹卡、公开领券页等场景
  try { db.prepare('ALTER TABLE qr_codes ADD COLUMN target_type TEXT').run() } catch {}
  try { db.prepare('ALTER TABLE qr_codes ADD COLUMN target_id INTEGER').run() } catch {}
  const alters2 = [
    ['staff', 'wecom_userid', 'TEXT'],
    ['customers', 'wecom_external_userid', 'TEXT'],
    ['users', 'wecom_userid', 'TEXT'],
    ['wechat_groups', 'wecom_chat_id', 'TEXT'],
    ['wechat_groups', 'dismissed', 'INTEGER DEFAULT 0'],
    // SOP DSL 契约：固化 trigger_type 枚举 + 触发条件 + 动作计划
    ['sops', 'trigger_type', 'TEXT DEFAULT "days_inactive"'],
    ['sops', 'trigger_days', 'INTEGER DEFAULT 30'],
    ['sops', 'trigger_min_spend', 'REAL DEFAULT 0'],
    ['sops', 'trigger_channel', 'TEXT'],
    ['sops', 'mode', 'TEXT DEFAULT "retail"'],
    ['sops', 'created_at', 'TEXT']
  ]
  for (const [tbl, col, type] of alters2) {
    try { db.prepare(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${type}`).run() } catch {}
  }
  try { db.prepare(`CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES wechat_groups(id),
      external_userid TEXT NOT NULL,
      name TEXT,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, external_userid)
  )`).run() } catch {}
  // SOP 执行日志（手动/自动触发后记录）
  try { db.prepare(`CREATE TABLE IF NOT EXISTS sop_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sop_id INTEGER NOT NULL REFERENCES sops(id) ON DELETE CASCADE,
      triggered_by TEXT,
      target_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      outcome TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run() } catch {}
  // === P0：优惠券系统（闭环核心）===
  try { db.prepare(`CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('cash','percent','gift')),
      value REAL NOT NULL,
      min_order REAL DEFAULT 0,
      description TEXT,
      total_stock INTEGER NOT NULL DEFAULT 10000,
      issued_count INTEGER DEFAULT 0,
      redeemed_count INTEGER DEFAULT 0,
      start_at DATETIME NOT NULL,
      end_at DATETIME NOT NULL,
      mode TEXT DEFAULT 'retail',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run() } catch {}
  try { db.prepare(`CREATE TABLE IF NOT EXISTS coupon_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coupon_id INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      source TEXT,
      sop_id INTEGER REFERENCES sops(id) ON DELETE SET NULL,
      sop_step_index INTEGER,
      staff_id INTEGER REFERENCES staff(id),
      code TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','used','expired','revoked')),
      issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      UNIQUE(coupon_id, customer_id)
  )`).run() } catch {}
  try { db.prepare(`CREATE TABLE IF NOT EXISTS coupon_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL REFERENCES coupon_issues(id) ON DELETE CASCADE,
      coupon_id INTEGER NOT NULL REFERENCES coupons(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      order_no TEXT,
      order_amount REAL,
      saved_amount REAL,
      redemption_channel TEXT,
      redeemed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run() } catch {}
  // === P1：限时秒杀（better-sqlite3 事务防超卖）===
  try { db.prepare(`CREATE TABLE IF NOT EXISTS seckill_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      stock INTEGER NOT NULL,
      sold INTEGER DEFAULT 0,
      price REAL NOT NULL,
      original_price REAL,
      start_at DATETIME NOT NULL,
      end_at DATETIME NOT NULL,
      staff_id INTEGER REFERENCES staff(id),
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run() } catch {}
  // 迁移：老 seckill_activities 表补 staff_id
  try { db.prepare('ALTER TABLE seckill_activities ADD COLUMN staff_id INTEGER REFERENCES staff(id)').run() } catch {}
  // seckill 加商品关联（真实商品名 + 图）
  try { db.prepare('ALTER TABLE seckill_activities ADD COLUMN product_name TEXT').run() } catch {}
  try { db.prepare('ALTER TABLE seckill_activities ADD COLUMN product_image TEXT').run() } catch {}
  // 迁移：老 coupon_redemptions 表补 redemption_channel
  try { db.prepare('ALTER TABLE coupon_redemptions ADD COLUMN redemption_channel TEXT').run() } catch {}
  // wecom_config 补 ext_api_key（第三方对接 API Key）
  try { db.prepare('ALTER TABLE wecom_config ADD COLUMN ext_api_key TEXT').run() } catch {}
  // 视频号小店订单回调加密配置（与企业微信回调独立）
  try { db.prepare('ALTER TABLE wecom_config ADD COLUMN video_shop_appid TEXT').run() } catch {}
  try { db.prepare('ALTER TABLE wecom_config ADD COLUMN video_shop_secret TEXT').run() } catch {}
  try { db.prepare('ALTER TABLE wecom_config ADD COLUMN video_shop_token TEXT').run() } catch {}
  try { db.prepare('ALTER TABLE wecom_config ADD COLUMN video_shop_encoding_aes_key TEXT').run() } catch {}
  // tags 表补 expires_at（自动过期标签）
  try { db.prepare('ALTER TABLE tags ADD COLUMN expires_at DATETIME').run() } catch {}
  // === 企微会话内容存档（群聊消息数统计）===
  try { db.prepare('ALTER TABLE wecom_config ADD COLUMN msg_audit_agent_id TEXT DEFAULT "1000002"').run() } catch {}
  try { db.prepare('ALTER TABLE wecom_config ADD COLUMN msg_audit_private_key TEXT').run() } catch {}
  try { db.prepare('ALTER TABLE wecom_config ADD COLUMN msg_audit_enabled INTEGER DEFAULT 0').run() } catch {}
  try { db.prepare('ALTER TABLE wecom_config ADD COLUMN msg_audit_last_msgid TEXT').run() } catch {}
  try { db.prepare('ALTER TABLE wecom_config ADD COLUMN msg_audit_last_polled_at TEXT').run() } catch {}
  try { db.prepare('ALTER TABLE wecom_config ADD COLUMN msg_audit_status TEXT').run() } catch {}
  // === Webhook IP 白名单（P0-3）===
  try { db.prepare('ALTER TABLE wecom_config ADD COLUMN wecom_webhook_ips TEXT').run() } catch {}
  try { db.prepare('ALTER TABLE wecom_config ADD COLUMN video_shop_webhook_ips TEXT').run() } catch {}

  // P1-8: 废弃 wecom_config 上的 msg_audit runtime 字段（last_msgid / last_polled_at / status），
  // 游标统一走 msg_audit_state 表。SQLite 不支持 DROP COLUMN，走 rebuild。
  try {
    const wcCols = db.prepare('PRAGMA table_info(wecom_config)').all().map(c => c.name)
    const runtimeFields = ['msg_audit_last_msgid', 'msg_audit_last_polled_at', 'msg_audit_status']
    const needsRebuild = runtimeFields.some(f => wcCols.includes(f))
    if (needsRebuild) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS _wecom_config_new (
          id INTEGER PRIMARY KEY CHECK(id=1),
          corp_id TEXT DEFAULT '',
          corp_secret TEXT DEFAULT '',
          callback_token TEXT,
          encoding_aes_key TEXT,
          status TEXT DEFAULT 'unset',
          last_sync_at TEXT,
          ext_api_key TEXT,
          video_shop_appid TEXT,
          video_shop_secret TEXT,
          video_shop_token TEXT,
          video_shop_encoding_aes_key TEXT,
          msg_audit_agent_id TEXT DEFAULT '1000002',
          msg_audit_private_key TEXT,
          msg_audit_enabled INTEGER DEFAULT 0,
          wecom_webhook_ips TEXT,
          video_shop_webhook_ips TEXT
        );
        INSERT INTO _wecom_config_new
          (id, corp_id, corp_secret, callback_token, encoding_aes_key, status, last_sync_at,
           ext_api_key, video_shop_appid, video_shop_secret, video_shop_token, video_shop_encoding_aes_key,
           msg_audit_agent_id, msg_audit_private_key, msg_audit_enabled,
           wecom_webhook_ips, video_shop_webhook_ips)
          SELECT id, corp_id, corp_secret, callback_token, encoding_aes_key, status, last_sync_at,
                 ext_api_key, video_shop_appid, video_shop_secret, video_shop_token, video_shop_encoding_aes_key,
                 msg_audit_agent_id, msg_audit_private_key, msg_audit_enabled,
                 wecom_webhook_ips, video_shop_webhook_ips
          FROM wecom_config;
        DROP TABLE wecom_config;
        ALTER TABLE _wecom_config_new RENAME TO wecom_config;
      `)
      console.info('[db] wecom_config rebuilt: 移除了 msg_audit runtime 字段，游标已迁移到 msg_audit_state')
    }
  } catch (_e) {}

  // msg_audit_state：游标存储（不同 agent 隔离）
  try { db.prepare(`CREATE TABLE IF NOT EXISTS msg_audit_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT UNIQUE NOT NULL,
      last_msgid TEXT,
      last_polled_at TEXT,
      total_messages INTEGER DEFAULT 0,
      error_msg TEXT,
      last_error_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run() } catch {}

  // chat_messages：会话解密后的消息（用于群今日消息数聚合）
  try { db.prepare(`CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      msg_id TEXT UNIQUE NOT NULL,
      agent_id TEXT,
      seq INTEGER,
      chat_id TEXT,
      chat_name TEXT,
      sender_userid TEXT,
      sender_name TEXT,
      msg_type TEXT,
      content TEXT,
      media_url TEXT,
      ts TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES wechat_groups(wecom_chat_id) ON DELETE SET NULL
  )`).run() } catch {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id)').run() } catch {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_chat_messages_ts ON chat_messages(ts DESC)').run() } catch {}

  // === 事件总线：所有业务事件 emit → events → scheduler 消费触发 SOP ===
  try { db.prepare(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
      payload TEXT,                 -- JSON: 订单号 / 入群 chat_id / 关键词 / 金额变化等
      status TEXT DEFAULT 'pending', -- pending → processing → done / failed
      consumed_at TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run() } catch {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_events_pending ON events(status, created_at)').run() } catch {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_events_customer ON events(customer_id)').run() } catch {}

  // === 完整订单台账（orders）===
  try { db.prepare(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT UNIQUE NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      staff_id INTEGER REFERENCES staff(id),
      amount REAL NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      discount REAL DEFAULT 0,
      coupon_code TEXT,
      source TEXT DEFAULT 'manual',              -- manual / seckill / coupon / channels_shop / 有赞 / 微盟 / 企微小店 / sop
      status TEXT NOT NULL DEFAULT 'paid',       -- pending / paid / shipped / completed / cancelled / refunded
      product_name TEXT,
      product_image TEXT,
      remark TEXT,
      order_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME,
      shipped_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run() } catch {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id DESC)').run() } catch {}
  // 迁移：orders.customer_id 允许 NULL（匹配不到客户时 webhook 可以落库）
  try {
    const cols = db.prepare('PRAGMA table_info(orders)').all()
    const customerCol = cols.find(c => c.name === 'customer_id')
    if (customerCol && customerCol.notnull === 1) {
      db.exec(`
        CREATE TABLE _orders_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_no TEXT UNIQUE NOT NULL,
          customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
          staff_id INTEGER REFERENCES staff(id),
          amount REAL NOT NULL,
          paid_amount REAL NOT NULL DEFAULT 0,
          discount REAL DEFAULT 0,
          coupon_code TEXT,
          source TEXT DEFAULT 'manual',
          status TEXT NOT NULL DEFAULT 'paid',
          product_name TEXT,
          product_image TEXT,
          remark TEXT,
          order_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          paid_at DATETIME,
          shipped_at DATETIME,
          completed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO _orders_new SELECT * FROM orders;
        DROP TABLE orders;
        ALTER TABLE _orders_new RENAME TO orders;
        CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id DESC);
        CREATE INDEX IF NOT EXISTS idx_orders_order_at ON orders(order_at DESC);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      `)
    }
  } catch (_e) {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_orders_order_at ON orders(order_at DESC)').run() } catch {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)').run() } catch {}

  // orders 表补 product_image 迁移（容错，列已存在则忽略）
  try { db.prepare('ALTER TABLE orders ADD COLUMN product_image TEXT').run() } catch {}
  try { db.prepare('ALTER TABLE orders ADD COLUMN product_name TEXT').run() } catch {}

  // === 首次启动时 seed 示例订单 ===
  const orderCount = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n
  if (orderCount === 0) {
    const seedOrders = [
      { customer_id: 1, order_no: 'TM20260923001', amount: 199.9, paid_amount: 179.9, discount: 20, coupon_code: 'CP9F3K2026', source: 'coupon', status: 'completed', product_name: '美诺精华液 30ml', product_image: 'https://img.icons8.com/color/96/makeup-bag.png', days_ago: 1 },
      { customer_id: 1, order_no: 'SK20260922008', amount: 599.0, paid_amount: 599.0, discount: 0, coupon_code: null, source: 'seckill', status: 'shipped', product_name: '小棕瓶精华 50ml 限时秒杀', product_image: 'https://img.icons8.com/color/96/perfume.png', days_ago: 2 },
      { customer_id: 1, order_no: 'TM20260915023', amount: 88.0, paid_amount: 68.0, discount: 20, coupon_code: 'CPABCD1234', source: 'coupon', status: 'completed', product_name: '洁面乳 120g', product_image: 'https://img.icons8.com/color/96/soap.png', days_ago: 9 },
      { customer_id: 2, order_no: 'TM20260920015', amount: 1299.0, paid_amount: 1199.0, discount: 100, coupon_code: null, source: 'channels_shop', status: 'paid', product_name: '护肤全套礼盒', product_image: 'https://img.icons8.com/color/96/gift.png', days_ago: 4 },
      { customer_id: 3, order_no: 'SK20260921011', amount: 99.0, paid_amount: 99.0, discount: 0, coupon_code: null, source: 'seckill', status: 'completed', product_name: '口红 正红色 限时秒杀', product_image: 'https://img.icons8.com/color/96/lipstick.png', days_ago: 3 },
      { customer_id: 4, order_no: 'TM20260918033', amount: 399.0, paid_amount: 399.0, discount: 0, coupon_code: null, source: 'manual', status: 'completed', product_name: '身体乳 400ml', product_image: 'https://img.icons8.com/color/96/lotion.png', days_ago: 6 },
      { customer_id: 1, order_no: 'PO20260923002', amount: 4999.0, paid_amount: 4999.0, discount: 0, coupon_code: null, source: 'channels_shop', status: 'paid', product_name: '年度私域会员', product_image: 'https://img.icons8.com/color/96/vip.png', days_ago: 0 },
      { customer_id: 2, order_no: 'CH20260922005', amount: 680.0, paid_amount: 680.0, discount: 0, coupon_code: null, source: 'seckill', status: 'shipped', product_name: '男士洁面套装', product_image: 'https://img.icons8.com/color/96/shaving.png', days_ago: 2 },
      // B 端大客户示例
      { customer_id: 7, order_no: 'B2B20260912001', amount: 128000.0, paid_amount: 64000.0, discount: 0, coupon_code: null, source: 'manual', status: 'paid', product_name: '企业数字化咨询方案（首期款 50%）', product_image: 'https://img.icons8.com/color/96/briefcase.png', days_ago: 11 },
      { customer_id: 8, order_no: 'B2B20260918003', amount: 58000.0, paid_amount: 58000.0, discount: 2000, coupon_code: null, source: 'manual', status: 'completed', product_name: '行业白皮书定制报告', product_image: 'https://img.icons8.com/color/96/document.png', days_ago: 6 },
    ]
    const nowMs = Date.now()
    const ins = db.prepare(`INSERT OR IGNORE INTO orders
      (order_no,customer_id,staff_id,amount,paid_amount,discount,coupon_code,source,status,product_name,product_image,order_at,paid_at,shipped_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    for (const o of seedOrders) {
      const orderAt = fmt(new Date(nowMs - o.days_ago * 86400000 - Math.floor(Math.random() * 86400000)))
      const paidAt = orderAt
      const shippedAt = o.status === 'shipped' || o.status === 'completed' ? fmt(new Date(nowMs - o.days_ago * 86400000 + 86400000)) : null
      const completedAt = o.status === 'completed' ? fmt(new Date(nowMs - o.days_ago * 86400000 + 3 * 86400000)) : null
      ins.run(o.order_no, o.customer_id, null, o.amount, o.paid_amount, o.discount, o.coupon_code, o.source, o.status, o.product_name, o.product_image, orderAt, paidAt, shippedAt, completedAt)
    }
    // 同步 customers.spend/orders（只对零售客户累加）
    db.prepare(`UPDATE customers SET
      spend = (SELECT COALESCE(SUM(paid_amount),0) FROM orders WHERE orders.customer_id = customers.id),
      orders = (SELECT COUNT(*) FROM orders WHERE orders.customer_id = customers.id)
    `).run()
  }
}

function pad(n) {
  return String(n).padStart(2, '0')
}

export function fmt(dt) {
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`
}

export function dayKey(dt) {
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

export function now() {
  return fmt(new Date())
}

export function daysSince(value) {
  if (!value) return 99999
  const t = new Date(String(value).replace(' ', 'T')).getTime()
  if (Number.isNaN(t)) return 99999
  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

export function buildSegmentWhere(cond) {
  const c = cond && typeof cond === 'object' ? cond : {}
  const clauses = []
  const params = []
  if (c.stage) {
    clauses.push('stage = ?')
    params.push(c.stage)
  }
  if (Array.isArray(c.tags) && c.tags.length) {
    clauses.push(`EXISTS (SELECT 1 FROM customer_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.customer_id = customers.id AND t.name IN (${c.tags.map(() => '?').join(',')}))`)
    params.push(...c.tags)
  }
  if (Array.isArray(c.channels) && c.channels.length) {
    clauses.push(`channel IN (${c.channels.map(() => '?').join(',')})`)
    params.push(...c.channels)
  }
  if (c.minSpend !== undefined && c.minSpend !== null && !Number.isNaN(Number(c.minSpend))) {
    clauses.push('spend >= ?')
    params.push(Number(c.minSpend))
  }
  if (c.maxDaysInactive !== undefined && c.maxDaysInactive !== null && !Number.isNaN(Number(c.maxDaysInactive))) {
    clauses.push('last_active >= ?')
    params.push(fmt(new Date(Date.now() - Number(c.maxDaysInactive) * 86400000)))
  }
  return { clause: clauses.join(' AND '), params }
}

export { db, initSchema }

  // customers 补 ext_openid（视频号 openid 匹配用）
  try { db.prepare('ALTER TABLE customers ADD COLUMN ext_openid TEXT').run() } catch {}

  // === C3: API 开放平台 — api_tokens（独立于 users/JWT，用于外部 ERP/CRM 对接）===
  try { db.prepare(`CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      token_prefix TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT 'read',
      rate_limit INTEGER DEFAULT 60,
      last_used_at TEXT,
      expires_at TEXT,
      revoked_at TEXT,
      revoked_reason TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run() } catch {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash)').run() } catch {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix ON api_tokens(token_prefix)').run() } catch {}

  // C3: 开放平台调用审计（可选项，记录每次 API token 的调用）
  try { db.prepare(`CREATE TABLE IF NOT EXISTS api_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id INTEGER REFERENCES api_tokens(id),
      method TEXT,
      path TEXT,
      status INTEGER,
      duration_ms INTEGER,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run() } catch {}