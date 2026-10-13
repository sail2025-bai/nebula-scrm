export type BizMode = 'retail' | 'service'

export interface ModeMeta {
  label: string
  shortLabel: string
  icon: string
  orgBadge: string
  orgName: string
  orgSub: string
  staffWord: string
  revenueTitle: string
  revenueIcon: string
  revenueSub1Label: string
  revenueSub2Label: string
  metric1Label: string
  metric2Label: string
  valueColTitle: string
  funnelTitle: string
  funnelSummary: string
  trendDesc: string
  taskTitle: string
  sopBadge: string
  sopDesc: string
  docBtn: string
  meetingBtn: string
  benefitBtn: string
  spendLabel: string
  ordersLabel: string
}

export const MODE_META: ModeMeta = {
  label: '私域增长运营',
  shortLabel: '私域运营',
  icon: 'fa-solid fa-users-viewfinder',
  orgBadge: '星',
  orgName: '逸云企微 · 私域增长引擎',
  orgSub: '已授权运营团队',
  staffWord: '运营',
  revenueTitle: '本月私域转化业绩',
  revenueIcon: 'fa-solid fa-hand-holding-dollar',
  revenueSub1Label: '客单价/单商机',
  revenueSub2Label: '转化率',
  metric1Label: '私域累计消费/商机',
  metric2Label: '客户互动频次',
  valueColTitle: '客户价值',
  funnelTitle: '全渠道获客转私域转化漏斗',
  funnelSummary: '转化效率高于行业基准',
  trendDesc: '追踪活码、包裹卡、门店扫码、社媒投流等全触点获客',
  taskTitle: '今日 SOP 待执行任务',
  sopBadge: '私域全链路增长 SOP',
  sopDesc: '基于活码、社群、优惠券、秒杀自动化驱动客户从加好友到复购的全旅程',
  docBtn: '发送资料/商品画册',
  meetingBtn: '邀约会面/预约体验',
  benefitBtn: '发放福利/优惠券',
  spendLabel: '客户价值',
  ordersLabel: '互动频次'
}

export type Stage = 'new' | 'contacted' | 'intended' | 'trying' | 'mature' | 'paid' | 'loyal' | 'retained' | 'churn' | 'lost' | string

export interface StageMetaEntry {
  label: string
  badge: string
  dot: string
}

export const STAGE_META: Record<string, StageMetaEntry> = {
  new:      { label: '新增好友',     badge: 'bg-teal-100 text-teal-800',  dot: 'bg-teal-500' },
  contacted:{ label: '已初步沟通',   badge: 'bg-sky-100 text-sky-800',    dot: 'bg-sky-500' },
  intended: { label: '意向明确',     badge: 'bg-indigo-100 text-indigo-800', dot: 'bg-indigo-500' },
  trying:   { label: '体验/试用',     badge: 'bg-violet-100 text-violet-800', dot: 'bg-violet-500' },
  mature:   { label: '成长期',       badge: 'bg-blue-100 text-blue-800',  dot: 'bg-blue-500' },
  paid:     { label: '已成交/首购',   badge: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  loyal:    { label: '高忠诚VIP',    badge: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  retained: { label: '留存老客',     badge: 'bg-green-100 text-green-800', dot: 'bg-green-500' },
  churn:    { label: '流失预警',     badge: 'bg-rose-100 text-rose-800',  dot: 'bg-rose-500' },
  lost:     { label: '已流失',       badge: 'bg-slate-100 text-slate-800', dot: 'bg-slate-500' }
}

export interface FunnelStep {
  name: string
  count: string
  pct: string
  color: string
}

export const FUNNEL: FunnelStep[] = [
  { name: '1. 公域触达 / 活码曝光', count: '12,500', pct: '100%', color: 'bg-slate-400' },
  { name: '2. 扫码添加企微', count: '4,120 (32.9%)', pct: '65%', color: 'bg-teal-500' },
  { name: '3. 企微自动通过并留存', count: '3,650 (88.6%)', pct: '55%', color: 'bg-emerald-500' },
  { name: '4. 进群 / 领券 / 启动 SOP', count: '1,980 (54.2%)', pct: '38%', color: 'bg-brand-600' },
  { name: '5. 7天内产生首购 / 签约', count: '842 (42.5%)', pct: '22%', color: 'bg-amber-500' }
]

export interface AuthUser {
  id: number
  name: string
  account: string
  businessMode?: BizMode | null
  wecomUserid?: string
}

export interface Customer {
  id: number
  code: string
  name: string
  wechat_nick: string
  avatar: string | null
  gender: string
  phone: string | null
  stage: Stage
  channel: string
  spend: number
  orders: number
  last_active: string
  staff_id: number | null
  staffName: string
  rfm_score: string
  health: string
  notes: string | null
  created_at: string
  customer_type: BizMode
  company: string | null
  position: string | null
  intent_level: string | null
  tags: Tag[]
  followupCount: number
  lastFollowupAt: string | null
}

export const INTENT_LEVEL_META: Record<string, { label: string; badge: string }> = {
  A: { label: '意向A级', badge: 'bg-amber-100 text-amber-800' },
  B: { label: '意向B级', badge: 'bg-blue-100 text-blue-800' },
  C: { label: '意向C级', badge: 'bg-slate-100 text-slate-600' }
}

export interface Tag {
  id: number
  name: string
  category: string

  count?: number
}

export interface FollowUp {
  id: number
  customer_id: number
  staff_id: number | null
  staffName?: string
  customerName?: string
  customerNick?: string
  type: 'wechat' | 'call' | 'visit' | 'gift' | 'note'
  content: string
  outcome: string | null
  next_followup_at: string | null
  created_at: string
}

export interface FollowUpSummary {
  pending: number | null
  done: number | null
  overdue: number | null
  today: number | null
  unassigned?: number | null
}

export interface TimelineItem {
  time: string
  title: string
  detail: string
  source: string
  color: string
}

export interface Staff {
  id: number
  name: string
  role: string
  wecom_userid?: string | null
  avatar_url?: string | null
  position?: string | null
  department?: string | null
  customer_count?: number
  pending_followups?: number
}

export interface Segment {
  id: number
  name: string
  description: string
  conditions: SegmentConditions
  count: number

  created_at: string
}

export interface SegmentConditions {
  stage?: Stage | ''
  tags?: string[]
  channels?: string[]
  minSpend?: number | null
  maxDaysInactive?: number | null
}

export interface WechatGroup {
  id: number
  name: string
  ownerName: string
  owner_role: string
  member_count: number
  capacity: number
  today_messages: number
  sop_status: string
  health_score: number

  wecomChatId?: string | null
  dismissed?: number
  created_at?: string
}

export interface Broadcast {
  id: number
  title: string
  type: '客户群发' | '企业朋友圈'
  audience_desc: string
  message: string
  target_count: number
  sent_rate: number
  status: string

  created_at: string
}

export interface Sop {
  id: number
  name: string
  trigger_desc: string
  trigger_type: string
  trigger_days: number
  trigger_min_spend: number
  trigger_channel: string | null
  steps: SopStep[]
  conditions: SopConditions | null
  conditions_human: string | null
  run_count: number
  conversion: number
  active: number

  is_template?: number
  /** 行业标签：retail=零售/C端，service=服务业/B端，null=未标记（自建 SOP 通常为 null） */
  mode?: 'retail' | 'service' | null
  /** 作用域: all=全局对全部客户生效（仅admin）, mine=仅创建者名下客户 */
  scope?: 'all' | 'mine'
  created_by?: number | null
  created_by_name?: string | null
  created_at: string | null
}

// === SOP 条件引擎（嵌套 AND/OR，可序列化 JSON）===
export interface SopConditionLeaf {
  field: string
  op: string
  value: string | number | (string | number)[]
}

export interface SopConditions {
  op: 'AND' | 'OR'
  rules: (SopConditions | SopConditionLeaf)[]
}

export interface ConditionField {
  value: string
  label: string
  type: 'number' | 'enum' | 'string'
  units?: string
  hint?: string
  options?: { value: string; label: string }[]
}

export interface ConditionOperator {
  value: string
  label: string
}

export interface SopStep {
  phase: string
  title: string
  detail: string
  metric: string
  action?: string
  delay_days?: number
  coupon_id?: number
  tag_name?: string
  staff_id?: number | null
  group_id?: number | null
  message_template?: string
}

export interface SopRun {
  id: number
  sop_id: number
  sop_name?: string
  triggered_by: string
  target_count: number
  success_count: number
  outcome: string | null
  created_at: string
}

export interface DashboardStats {
  totalCustomers: number
  weekGrowthRate: number
  weekNetAdd: number
  todayNew: number
  todayFollowups: number
  totalGroups: number
  groupMemberTotal: number
  avgSpeakRate: number
  monthSpend: number
  avgOrderValue: number
  repeatRate: number
  churnCount: number
  activeSop: number
  pendingTasks: { id: string | number; name: string; target: string; dueAt?: string; overdue?: boolean; done: boolean }[]
  followupStats: { overdue: number; todayDue: number; future: number }
  churnRisks: { id: number; name: string; wechat_nick: string; stage: Stage; risk: string; detail: string; days: number }[]
  channelStats: { channel: string; count: number }[]
  stageStats: { stage: Stage; count: number }[]
}

export interface TrendData {
  labels: string[]
  added: number[]
  churned: number[]
}

export interface CustomerListResponse {
  items: Customer[]
  total: number
  page: number
  pageSize: number
}

export interface CustomerQuery {
  stage?: string
  channel?: string
  staff_id?: string
  tag?: string
  search?: string
  segment?: string
  mode?: BizMode
  page?: number
  pageSize?: number
}

export const FOLLOWUP_TYPES: Record<FollowUp['type'], { label: string; icon: string; color: string }> = {
  wechat: { label: '企微沟通', icon: 'fa-brands fa-weixin', color: 'text-emerald-600' },
  call: { label: '电话回访', icon: 'fa-solid fa-phone', color: 'text-blue-600' },
  visit: { label: '到店拜访', icon: 'fa-solid fa-store', color: 'text-purple-600' },
  gift: { label: '赠券/礼品', icon: 'fa-solid fa-gift', color: 'text-amber-600' },
  note: { label: '备注记录', icon: 'fa-solid fa-pen', color: 'text-slate-600' }
}

export type WecomStatus = 'unset' | 'connected' | 'simulated'

export interface WecomConfig {
  id: number
  corp_id: string
  corp_secret: string
  callback_token: string | null
  encoding_aes_key: string | null
  status: WecomStatus
  last_sync_at: string | null
  video_shop_appid: string | null
  video_shop_secret: string | null
  video_shop_token: string | null
  video_shop_encoding_aes_key: string | null
  ext_api_key: string | null
  // === 企微会话内容存档 ===
  msg_audit_agent_id: string | null
  msg_audit_private_key: string | null
  msg_audit_enabled: number
  // 注：msg_audit 游标不再挂在 wecom_config 上，统一从 msg_audit_state 表读（见 MsgAuditStatus.cursor）
}

export interface MsgAuditStatus {
  enabled: boolean
  preflight_ok: boolean
  preflight_issue: string | null
  agent_id: string | null
  last_msgid: string | null
  last_polled_at: string | null
  status: string | null
  groups_with_chat_id: number
  total_messages_stored: number
  today_messages_stored: number
  cursor: { agent_id: string; last_msgid: string | null; last_polled_at: string | null; total_messages: number } | null
}

export interface WecomEvent {
  id: number
  event_type: string
  change_type: string | null
  external_userid: string | null
  userid: string | null
  payload: string
  handled: number
  created_at: string
}

export type SeasLeadStatus = 'pending' | 'claimed' | 'converted'

export interface SeasLead {
  id: number
  name: string
  company: string | null
  phone: string | null
  wechat_nick: string | null
  channel: string
  source: string | null
  note: string | null
  status: SeasLeadStatus
  owner_staff_id: number | null
  ownerName: string | null
  claimed_at: string | null

  created_at: string
}

export interface QrCode {
  id: number
  name: string
  channel: string
  staff_id: number | null
  staffName: string | null
  auto_tags: string[]
  scan_count: number
  active: number

  target_type?: string | null
  target_id?: number | null
  cta_type?: string  // 'hybrid' | 'target_page' | 'add_staff'
  created_at: string
}

export interface SimulateEventPayload {
  changeType: 'add' | 'del_follow' | 'del'
  name: string
  staffId: number | null
  channel?: string
  tags?: string[]

}

export interface Coupon {
  id: number
  name: string
  type: 'cash' | 'percent' | 'gift'
  value: number
  min_order: number
  description: string | null
  total_stock: number
  issued_count: number
  redeemed_count: number
  start_at: string
  end_at: string

  active: number
  created_at: string
  issues?: CouponIssue[]
  channelBreakdown?: { channel: string; count: number; total_saved: number }[]
  recentRedemptions?: { id: number; customer_code: string; customer_name: string; saved_amount: number; redemption_channel: string; redeemed_at: string }[]
}

export interface CouponIssue {
  id: number
  coupon_id: number
  customer_id: number
  source: string | null
  sop_id: number | null
  sop_step_index: number | null
  staff_id: number | null
  code: string
  status: 'pending' | 'used' | 'expired' | 'revoked'
  issued_at: string
  expires_at: string | null
  coupon_name?: string
  type?: string
  value?: number
  min_order?: number
  description?: string | null
  end_at?: string
}

export interface CouponRedemption {
  id: number
  issue_id: number
  coupon_id: number
  customer_id: number
  order_no: string | null
  order_amount: number | null
  saved_amount: number
  redeemed_at: string
}

export interface SeckillActivity {
  id: number
  title: string
  description: string | null
  product_name: string | null
  product_image: string | null
  staff_id: number | null
  stock: number
  sold: number
  price: number
  original_price: number | null
  start_at: string
  end_at: string
  active: number
  created_at: string
}

// === 订单台账 ===
export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'completed' | 'cancelled' | 'refunded'
export type OrderSource = 'manual' | 'seckill' | 'coupon' | 'channels_shop' | 'youzan' | 'weimeng' | 'wecom_mini' | 'sop' | 'ext_api'

export interface Address {
  id: number
  customer_id: number
  name: string
  phone?: string | null
  province?: string | null
  city?: string | null
  district?: string | null
  detail: string
  is_default: number
  created_at?: string | null
}

export interface OrderItem {
  id: number
  order_id: number
  product_id: number
  product_name: string
  product_image?: string | null
  price: number
  quantity: number
  subtotal: number
}

export interface Order {
  id: number
  order_no: string
  customer_id: number
  customerName?: string
  customerWechat?: string
  staff_id: number | null
  amount: number
  paid_amount: number
  discount: number
  coupon_code: string | null
  source: OrderSource
  source_label?: string
  status: OrderStatus
  status_label?: string
  status_color?: string
  product_name: string | null
  product_image: string | null
  item_count?: number
  items_json?: string | null
  remark: string | null
  order_at: string
  paid_at: string | null
  shipped_at: string | null
  completed_at: string | null
  created_at: string
  shipping_no?: string | null
  shipping_company?: string | null
  address_id?: number | null
  address_snapshot?: string | null
  items?: OrderItem[]
  address?: Address | null
}


// 客户360 时间线（多源 UNION ALL：order + event + followup）
export interface CustomerTimelineEntry {
  time: string
  kind: 'order' | 'event' | 'followup' | 'sop'
  title: string
  detail: string
  source: string
  amount?: number | null
  extra?: string | null
  icon?: string
  color?: string
}

// === Phase 1: 自建商城 ===
export interface Category {
  id: number; name: string; icon?: string | null; sort_order: number; active: number; created_at: string | null;
}
export interface Product {
  id: number; name: string; category_id: number | null; category_name?: string | null;
  price: number; original_price: number | null; stock: number; sold: number;
  description: string; image_url: string | null; images: string[]; tag: string;
  sku: string | null; active: number; created_at: string | null; updated_at: string | null;
}
export interface CartItem { cart_id: number; quantity: number; product: Product }
export interface Cart { items: CartItem[]; total: number; count: number }
