import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

const db = new Database(path.join(dataDir, 'scrm.db'))
db.pragma('foreign_keys = ON')

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
  // tags 表补 expires_at（自动过期标签）
  try { db.prepare('ALTER TABLE tags ADD COLUMN expires_at DATETIME').run() } catch {}
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
