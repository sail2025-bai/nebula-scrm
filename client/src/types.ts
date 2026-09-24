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

export const MODE_META: Record<BizMode, ModeMeta> = {
  service: {
    label: 'B端·线索与大客户',
    shortLabel: 'B端大客户',
    icon: 'fa-solid fa-briefcase',
    orgBadge: '企',
    orgName: '知行智远·企服咨询与解决方案',
    orgSub: '已授权 18 位大客户顾问与售前专家',
    staffWord: '顾问',
    revenueTitle: '本月私域转化签约商机',
    revenueIcon: 'fa-solid fa-file-contract',
    revenueSub1Label: '平均单笔商机金额',
    revenueSub2Label: '方案转化率',
    metric1Label: '商机预估价值',
    metric2Label: '顾问跟进轮次',
    valueColTitle: '预估商机预算',
    funnelTitle: 'B端线索MQL到合同签约漏斗',
    funnelSummary: '商机推进速度高于同行业 +24.6%',
    trendDesc: '追踪官网白皮书下载、广告留资、行业峰会名片、转介绍活码等全触点获客',
    taskTitle: '今日专属顾问执行 SOP 任务',
    sopBadge: 'B端大客户培育与商机推进流',
    sopDesc: '以专业内容、决策人穿透、一对一诊断为核心驱动线索从 MQL 晋级为 SQL 并签约',
    docBtn: '发送资料/方案',
    meetingBtn: '邀约会面/诊断',
    benefitBtn: '试听/体验权限',
    spendLabel: '预估商机预算',
    ordersLabel: '跟进轮次'
  },
  retail: {
    label: 'C端·消费与会员零售',
    shortLabel: 'C端零售',
    icon: 'fa-solid fa-cart-shopping',
    orgBadge: '美',
    orgName: '美诺美妆·品牌企微总部',
    orgSub: '已授权 18 个门店导购与私域客服',
    staffWord: '导购',
    revenueTitle: '本月私域专属转化 GMV',
    revenueIcon: 'fa-solid fa-hand-holding-dollar',
    revenueSub1Label: '客单价',
    revenueSub2Label: '复购贡献率',
    metric1Label: '私域累计消费',
    metric2Label: '商城下单频次',
    valueColTitle: '私域累计消费',
    funnelTitle: '公域引流转私域首购漏斗',
    funnelSummary: '首购转化率高于行业基准 +18.4%',
    trendDesc: '实时追踪包裹卡、门店扫码、社媒投流等渠道获客',
    taskTitle: '今日门店导购执行 SOP 任务',
    sopBadge: 'C端快消高频触达与首购SOP',
    sopDesc: '基于优惠券、限时秒杀、包裹卡福利快速激发首次购买与社群裂变',
    docBtn: '发送商品画册',
    meetingBtn: '预约到店体验',
    benefitBtn: '发放代金优惠券',
    spendLabel: '私域累计消费',
    ordersLabel: '下单频次'
  }
}

export type Stage = 'new' | 'mature' | 'loyal' | 'churn'

export interface StageMetaEntry {
  label: string
  badge: string
  dot: string
}

export const STAGE_META_BY_MODE: Record<BizMode, Record<Stage, StageMetaEntry>> = {
  retail: {
    new: { label: '新手成长期', badge: 'bg-teal-100 text-teal-800', dot: 'bg-teal-500' },
    mature: { label: '成长成熟期', badge: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500' },
    loyal: { label: '高忠诚VIP', badge: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
    churn: { label: '流失预警', badge: 'bg-rose-100 text-rose-800', dot: 'bg-rose-500' }
  },
  service: {
    new: { label: '新线索初步沟通', badge: 'bg-teal-100 text-teal-800', dot: 'bg-teal-500' },
    mature: { label: '方案报价阶段', badge: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500' },
    loyal: { label: '已签约交付', badge: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
    churn: { label: '停滞/流失预警', badge: 'bg-rose-100 text-rose-800', dot: 'bg-rose-500' }
  }
}

export interface FunnelStep {
  name: string
  count: string
  pct: string
  color: string
}

export const FUNNEL_BY_MODE: Record<BizMode, FunnelStep[]> = {
  service: [
    { name: '1. 公域广告/官网/展会留资', count: '10,800', pct: '100%', color: 'bg-slate-400' },
    { name: '2. 扫码添加企微咨询顾问', count: '3,240 (30.0%)', pct: '62%', color: 'bg-teal-500' },
    { name: '3. 需求清洗与方案初审 (SQL)', count: '2,150 (66.3%)', pct: '44%', color: 'bg-emerald-500' },
    { name: '4. 方案演示/深度试用/线下面谈', count: '1,120 (52.1%)', pct: '28%', color: 'bg-brand-600' },
    { name: '5. 商务谈判并签约付费', count: '353 (31.5%)', pct: '15%', color: 'bg-amber-500' }
  ],
  retail: [
    { name: '1. 公域触达/包裹卡曝光', count: '12,500', pct: '100%', color: 'bg-slate-400' },
    { name: '2. 扫码发起好友申请', count: '4,120 (32.9%)', pct: '65%', color: 'bg-teal-500' },
    { name: '3. 企微自动通过并留存', count: '3,650 (88.6%)', pct: '55%', color: 'bg-emerald-500' },
    { name: '4. 进VIP社群并领券', count: '1,980 (54.2%)', pct: '38%', color: 'bg-brand-600' },
    { name: '5. 7天内产生私域首购', count: '842 (42.5%)', pct: '22%', color: 'bg-amber-500' }
  ]
}

export interface AuthUser {
  id: number
  name: string
  account: string
  businessMode: BizMode
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
  mode: BizMode
  count?: number
}

export interface FollowUp {
  id: number
  customer_id: number
  staff_id: number | null
  staffName?: string
  type: 'wechat' | 'call' | 'visit' | 'gift' | 'note'
  content: string
  outcome: string | null
  next_followup_at: string | null
  created_at: string
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
}

export interface Segment {
  id: number
  name: string
  description: string
  conditions: SegmentConditions
  count: number
  mode: BizMode
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
  mode: BizMode
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
  mode: BizMode
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
  mode: BizMode
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
  pendingTasks: { id: number; name: string; target: string; done: boolean }[]
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
  mode: BizMode
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
  mode: BizMode
  created_at: string
}

export interface SimulateEventPayload {
  changeType: 'add' | 'del_follow' | 'del'
  name: string
  staffId: number | null
  channel?: string
  tags?: string[]
  mode: BizMode
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
  mode: BizMode
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
  remark: string | null
  order_at: string
  paid_at: string | null
  shipped_at: string | null
  completed_at: string | null
  created_at: string
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
