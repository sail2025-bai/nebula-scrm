import { db } from '../db.js'

/**
 * utils/sop-conditions.js —— SOP 自定义条件引擎
 *
 * 用可视化 JSON 替代手写 SQL-like，条件结构支持嵌套 AND/OR：
 *
 * {
 *   "op": "AND",       // 或 "OR"
 *   "rules": [
 *     { "field": "spend",   "op": ">=",        "value": 2000 },
 *     { "field": "channel", "op": "=",         "value": "wechat" },
 *     { "field": "stage",   "op": "in",        "value": ["loyal","mature"] },
 *     { "field": "tags",    "op": "contains",  "value": "高价值" },
 *     { "field": "event",   "op": "in",        "value": ["order_paid","high_value"] }
 *   ]
 * }
 *
 * 支持的字段（人类可读 ↔ DB 字段映射）：
 *   spend       → customers.spend（累计消费）或 event.payload.spend
 *   orders      → customers.orders（订单数）
 *   stage       → customers.stage（客户阶段）
 *   channel     → customers.channel（获客渠道）或 event.payload.channel
 *   days_since_active → daysSince customers.last_active（未互动天数）
 *   tags        → customer_tags（包含指定 tag 名称）
 *   event       → events.type（当前事件类型，仅 custom SOP 有意义）
 */

// 可用字段 + 操作符 + 人类可读标签
export const CONDITION_FIELDS = [
  { value: 'spend',             label: '累计消费金额',  type: 'number',  units: '元' },
  { value: 'orders',            label: '累计订单数',    type: 'number',  units: '单' },
  { value: 'stage',             label: '客户阶段',      type: 'enum',    options: [
    { value: 'new',       label: '新客户' },
    { value: 'mature',    label: '成熟客户' },
    { value: 'loyal',     label: '忠诚客户' },
    { value: 'churn',     label: '流失客户' },
  ]},
  { value: 'channel',           label: '获客渠道',      type: 'enum',    options: [
    { value: 'wechat',    label: '企微好友' },
    { value: 'weibo',     label: '微博' },
    { value: 'douyin',    label: '抖音' },
    { value: 'offline',   label: '线下门店' },
    { value: 'referral',  label: '转介绍' },
    { value: 'ad',        label: '广告投放' },
  ]},
  { value: 'days_since_active', label: '未互动天数',    type: 'number',  units: '天' },
  { value: 'tags',              label: '客户标签',      type: 'string',  hint: '包含指定标签名称' },
  { value: 'event',             label: '触发事件类型',  type: 'enum',    options: [
    { value: 'add_friend',        label: '添加好友' },
    { value: 'order_paid',        label: '订单支付' },
    { value: 'order_completed',   label: '订单完成' },
    { value: 'high_value',        label: '高消费' },
    { value: 'churn_warning',     label: '流失预警' },
    { value: 'chat_join',         label: '入群' },
    { value: 'customer_stage_changed', label: '阶段变更' },
  ]},
]

// 可用操作符（按字段类型分组）
export const CONDITION_OPERATORS = {
  number: [
    { value: '>=',  label: '大于等于' },
    { value: '>',   label: '大于' },
    { value: '<=',  label: '小于等于' },
    { value: '<',   label: '小于' },
    { value: '=',   label: '等于' },
    { value: '!=',  label: '不等于' },
  ],
  enum: [
    { value: '=',   label: '等于' },
    { value: '!=',  label: '不等于' },
    { value: 'in',  label: '属于以下任一' },
    { value: 'not_in', label: '不属于以下任一' },
  ],
  string: [
    { value: 'contains',  label: '包含' },
    { value: 'not_contains', label: '不包含' },
    { value: '=',   label: '等于' },
  ],
}

// ========== 核心匹配引擎 ==========

/**
 * 评估一棵条件树对单个 customer 的命中情况
 *
 * @param {object} root   - 条件树 root（包含 op + rules）
 * @param {number} customerId - 客户 ID
 * @param {object} eventCtx   - 事件上下文（{ type, payload }），用于 event 字段
 * @returns {boolean}
 */
export function matchConditions(root, customerId, eventCtx = null) {
  if (!root || !Array.isArray(root.rules) || root.rules.length === 0) return true
  return evalNode(root, customerId, eventCtx)
}

function evalNode(node, customerId, eventCtx) {
  const op = node.op?.toUpperCase() || 'AND'
  const results = node.rules.map(r => {
    // 子组（AND/OR 嵌套）
    if (Array.isArray(r.rules)) return evalNode(r, customerId, eventCtx)
    // 叶子规则
    return evalLeaf(r, customerId, eventCtx)
  })
  return op === 'OR' ? results.some(Boolean) : results.every(Boolean)
}

function evalLeaf(rule, customerId, eventCtx) {
  const actual = resolveField(rule.field, customerId, eventCtx)
  return compare(actual, rule.op, rule.value)
}

/** 解析字段的实际值（从 customers / event payload / tags 中取）*/
function resolveField(field, customerId, eventCtx) {
  if (field === 'event') return eventCtx?.type ?? null
  if (field === 'tags') {
    const rows = db.prepare(
      `SELECT t.name FROM tags t JOIN customer_tags ct ON ct.tag_id = t.id WHERE ct.customer_id = ?`
    ).all(customerId)
    return rows.map(r => r.name)
  }
  // 客户基础字段
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId)
  if (!c) return null

  if (field === 'spend') {
    // 优先取 event.payload.spend（单笔金额），否则累计消费
    const p = tryParse(eventCtx?.payload)
    return Number(p?.spend ?? p?.amount ?? c.spend ?? 0)
  }
  if (field === 'days_since_active') {
    const last = c.last_active ? new Date(c.last_active + 'Z') : new Date(c.created_at + 'Z')
    return Math.floor((Date.now() - last.getTime()) / 86400000)
  }
  if (field === 'channel') {
    const p = tryParse(eventCtx?.payload)
    return p?.channel ?? c.channel ?? null
  }
  // orders, stage 直接取值
  return c[field] ?? null
}

function compare(actual, op, expected) {
  if (actual === null || actual === undefined) {
    // 字段不存在：仅 != 和 not_contains 算"命中"（表示该字段为空）
    return op === '!=' || op === 'not_in' || op === 'not_contains'
  }
  const a = Number.isFinite(Number(actual)) && ['>=', '>', '<=', '<', '=', '!='].includes(op)
    ? Number(actual) : actual
  const e = Number.isFinite(Number(expected)) ? Number(expected) : expected

  switch (op) {
    case '=':    return a == e
    case '!=':   return a != e
    case '>':    return a > e
    case '>=':   return a >= e
    case '<':    return a < e
    case '<=':   return a <= e
    case 'in': {
      const arr = Array.isArray(expected) ? expected : [expected]
      if (Array.isArray(a)) return a.some(x => arr.includes(x))
      return arr.includes(a)
    }
    case 'not_in': {
      const arr = Array.isArray(expected) ? expected : [expected]
      if (Array.isArray(a)) return !a.some(x => arr.includes(x))
      return !arr.includes(a)
    }
    case 'contains': {
      if (Array.isArray(a)) return a.some(x => String(x).includes(String(expected)))
      return String(a).includes(String(expected))
    }
    case 'not_contains': {
      if (Array.isArray(a)) return !a.some(x => String(x).includes(String(expected)))
      return !String(a).includes(String(expected))
    }
    default: return false
  }
}

function tryParse(s) {
  if (!s) return null
  try { return typeof s === 'string' ? JSON.parse(s) : s } catch { return null }
}

// ========== 人类可读描述（给"规则生效说明"用）==========

export function conditionsToHuman(root, depth = 0) {
  if (!root || !Array.isArray(root.rules) || root.rules.length === 0) return '（无额外条件）'
  const sep = root.op?.toUpperCase() === 'OR' ? ' 或者 ' : ' 并且 '
  const parts = root.rules.map(r => {
    if (Array.isArray(r.rules)) return conditionsToHuman(r, depth + 1)
    return leafToHuman(r)
  })
  const text = parts.join(sep)
  return depth > 0 ? `(${text})` : text
}

function leafToHuman(rule) {
  const f = CONDITION_FIELDS.find(x => x.value === rule.field)
  const opDef = f ? CONDITION_OPERATORS[f.type]?.find(o => o.value === rule.op) : null
  const fieldLabel = f?.label || rule.field
  const opLabel = opDef?.label || rule.op
  let v = rule.value
  if (Array.isArray(v)) {
    const opts = f?.options || []
    v = v.map(x => opts.find(o => o.value === x)?.label || x).join(' 或 ')
  } else if (typeof v === 'string') {
    const opts = f?.options || []
    v = opts.find(o => o.value === v)?.label || v
  }
  const unit = f?.units ? (typeof v === 'number' || !isNaN(Number(v)) ? ` ${f.units}` : '') : ''
  return `${fieldLabel} ${opLabel} ${v}${unit}`
}

// ========== 校验 ==========
export function validateConditions(root) {
  const errors = []
  if (!root) return errors
  if (!root.op || !['AND', 'OR', 'and', 'or'].includes(root.op)) errors.push('条件组缺少 op（AND/OR）')
  if (!Array.isArray(root.rules)) errors.push('rules 必须是数组')
  root.rules.forEach((r, i) => {
    if (Array.isArray(r.rules)) {
      errors.push(...validateConditions(r).map(e => `子组#${i + 1}: ${e}`))
    } else {
      if (!r.field) errors.push(`规则#${i + 1}: 缺少 field`)
      if (!r.op) errors.push(`规则#${i + 1}: 缺少 op`)
      if (r.value === undefined || r.value === null || r.value === '') errors.push(`规则#${i + 1}: 缺少 value`)
    }
  })
  return errors
}
