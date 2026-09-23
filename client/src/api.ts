import type {
  AuthUser,
  BizMode,
  Broadcast,
  Customer,
  CustomerListResponse,
  CustomerQuery,
  DashboardStats,
  FollowUp,
  QrCode,
  SeasLead,
  Segment,
  SegmentConditions,
  SimulateEventPayload,
  Sop,
  SopRun,
  Coupon,
  CouponIssue,
  CouponRedemption,
  SeckillActivity,
  SopStep,
  Staff,
  Tag,
  TrendData,
  WechatGroup,
  WecomConfig,
  WecomEvent,
  WecomStatus
} from './types'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `请求失败 (${res.status})`)
  }
  return res.json()
}

function toQuery(params: object): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')
  return qs ? `?${qs}` : ''
}

export interface CustomerPayload {
  name: string
  wechat_nick: string
  gender: string
  phone?: string | null
  channel: string
  stage: string
  staff_id?: number | null
  spend?: number
  orders?: number
  notes?: string | null
  tags?: string[]
  customer_type?: BizMode
  company?: string | null
  position?: string | null
  intent_level?: string | null
}

export const api = {
  register: (payload: { name: string; account: string; password: string; businessMode: BizMode }) =>
    request<{ user: AuthUser }>('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: { account: string; password: string }) =>
    request<{ user: AuthUser }>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  wxlogin: (payload: { code: string; name?: string }) =>
    request<{ user: AuthUser; wecomDetail?: unknown; simulated?: boolean }>('/auth/wxlogin', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  getDashboardStats: (mode: BizMode) => request<DashboardStats>(`/dashboard/stats${toQuery({ mode })}`),
  getTrend: (days = 7, mode: BizMode = 'retail') =>
    request<TrendData>(`/dashboard/trend${toQuery({ days, mode })}`),

  getCustomers: (query: CustomerQuery) => request<CustomerListResponse>(`/customers${toQuery(query)}`),
  getCustomer: (id: number) => request<Customer>(`/customers/${id}`),
  createCustomer: (payload: CustomerPayload) =>
    request<Customer>('/customers', { method: 'POST', body: JSON.stringify(payload) }),
  updateCustomer: (id: number, payload: Partial<CustomerPayload>) =>
    request<Customer>(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCustomer: (id: number) => request<{ ok: boolean }>(`/customers/${id}`, { method: 'DELETE' }),
  batchTagCustomers: (ids: number[], tagName: string) =>
    request<{ ok: boolean; affected: number }>('/customers/batch-tags', {
      method: 'POST',
      body: JSON.stringify({ ids, tagName })
    }),

  getTags: (mode: BizMode) => request<Tag[]>(`/tags${toQuery({ mode })}`),
  createTag: (name: string, category: string, mode: BizMode) =>
    request<Tag>('/tags', { method: 'POST', body: JSON.stringify({ name, category, mode }) }),
  updateTag: (id: number, name: string, category: string) =>
    request<Tag>(`/tags/${id}`, { method: 'PUT', body: JSON.stringify({ name, category }) }),
  deleteTag: (id: number) => request<{ ok: boolean }>(`/tags/${id}`, { method: 'DELETE' }),

  getSegments: (mode: BizMode) => request<Segment[]>(`/segments${toQuery({ mode })}`),
  getSegment: (id: number) => request<Segment>(`/segments/${id}`),
  createSegment: (name: string, description: string, conditions: SegmentConditions, mode: BizMode) =>
    request<Segment>('/segments', { method: 'POST', body: JSON.stringify({ name, description, conditions, mode }) }),
  updateSegment: (id: number, name: string, description: string, conditions: SegmentConditions) =>
    request<Segment>(`/segments/${id}`, { method: 'PUT', body: JSON.stringify({ name, description, conditions }) }),
  deleteSegment: (id: number) => request<{ ok: boolean }>(`/segments/${id}`, { method: 'DELETE' }),

  getGroups: (mode: BizMode) => request<WechatGroup[]>(`/groups${toQuery({ mode })}`),
  createGroup: (name: string, owner_staff_id: number, mode: BizMode) =>
    request<WechatGroup>('/groups', { method: 'POST', body: JSON.stringify({ name, owner_staff_id, mode }) }),
  updateGroup: (id: number, payload: Partial<{ name: string; owner_staff_id: number; member_count: number; today_messages: number; sop_status: string }>) =>
    request<WechatGroup>(`/groups/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteGroup: (id: number) => request<{ ok: boolean }>(`/groups/${id}`, { method: 'DELETE' }),
  getGroupEvents: (limit = 50, onlyGroup = false) =>
    request<WecomEvent[]>(`/groups/events${toQuery({ limit, only: onlyGroup ? 1 : 0 })}`),
  getGroupMembers: (id: number) =>
    request<{ id: number; group_id: number; external_userid: string; name: string }[]>(`/groups/${id}/members`),

  getFollowUps: (customerId: number) => request<FollowUp[]>(`/follow-ups${toQuery({ customer_id: customerId })}`),
  createFollowUp: (payload: { customer_id: number; type: string; content: string; outcome?: string; next_followup_at?: string | null }) =>
    request<FollowUp>('/follow-ups', { method: 'POST', body: JSON.stringify(payload) }),
  deleteFollowUp: (id: number) => request<{ ok: boolean }>(`/follow-ups/${id}`, { method: 'DELETE' }),

  getBroadcasts: (mode: BizMode) => request<Broadcast[]>(`/broadcasts${toQuery({ mode })}`),
  createBroadcast: (payload: { title: string; type: string; audience_desc: string; message: string; mode: BizMode; conditions?: SegmentConditions }) =>
    request<Broadcast>('/broadcasts', { method: 'POST', body: JSON.stringify(payload) }),

  getSops: (mode: BizMode) => request<Sop[]>(`/sops${toQuery({ mode })}`),
  getSop: (id: number) => request<Sop>(`/sops/${id}`),
  createSop: (payload: Partial<Sop> & { name: string; trigger_type: string; steps: SopStep[] }) =>
    request<Sop>('/sops', { method: 'POST', body: JSON.stringify(payload) }),
  updateSop: (id: number, payload: Partial<Sop>) =>
    request<Sop>(`/sops/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSop: (id: number) => request<{ ok: boolean }>(`/sops/${id}`, { method: 'DELETE' }),
  cloneSop: (id: number) => request<Sop>(`/sops/${id}/clone`, { method: 'POST' }),
  toggleSop: (id: number) => request<Sop>(`/sops/${id}/toggle`, { method: 'PUT' }),
  runSop: (id: number, payload?: { limit?: number; triggered_by?: string }) =>
    request<{ ok: boolean; run_id: number; sop_id: number; target_count: number; success_count: number; steps_per_customer: number; triggered_by: string }>(
      `/sops/${id}/run`, { method: 'POST', body: JSON.stringify(payload || {}) }
    ),
  previewSopCustomers: (id: number) =>
    request<{ total: number; customers: { id: number; name: string; stage: string; spend: number; orders: number; channel: string }[] }>(`/sops/${id}/customers`),
  getSopRuns: (limit = 30) => request<SopRun[]>(`/sops/runs/all${toQuery({ limit })}`),

  getStaff: () => request<Staff[]>('/staff'),
  getChannels: (mode: BizMode) => request<string[]>(`/channels${toQuery({ mode })}`),

  getWecomConfig: () => request<WecomConfig>('/wecom/config'),
  saveWecomConfig: (payload: { corp_id: string; corp_secret: string; callback_token?: string | null; encoding_aes_key?: string | null }) =>
    request<WecomConfig>('/wecom/config', { method: 'PUT', body: JSON.stringify(payload) }),
  testWecomConnect: () => request<{ ok: boolean; status: WecomStatus; message: string }>('/wecom/test', { method: 'POST' }),
  syncWecomStaff: () => request<{ synced: number; mode: WecomStatus }>('/wecom/sync-staff', { method: 'POST' }),
  getWecomEvents: (limit = 50) => request<WecomEvent[]>(`/wecom/events${toQuery({ limit })}`),
  simulateWecomEvent: (payload: SimulateEventPayload) =>
    request<{ ok: boolean; message: string; customerId?: number }>('/wecom/simulate', { method: 'POST', body: JSON.stringify(payload) }),
  simulateGroupEvent: (payload: { event: string; chatId?: string; chatName?: string; externalUserid?: string; memberName?: string; memberList?: { userid: string; name: string }[] }) =>
    request<{ ok: boolean; message: string; groupId?: number; chatId?: string }>('/wecom/simulate-group', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  getSeasLeads: (mode: BizMode) => request<SeasLead[]>(`/seas${toQuery({ mode })}`),
  importSeasLeads: (payload: { lines: string[]; mode: BizMode }) =>
    request<{ imported: number; failed: number }>('/seas/import', { method: 'POST', body: JSON.stringify(payload) }),
  claimSeasLead: (id: number, staff_id: number) =>
    request<SeasLead>(`/seas/${id}/claim`, { method: 'PUT', body: JSON.stringify({ staff_id }) }),
  convertSeasLead: (id: number) =>
    request<{ customer: Customer }>(`/seas/${id}/convert`, { method: 'POST' }),
  returnSeasLead: (id: number) => request<SeasLead>(`/seas/${id}/return`, { method: 'PUT' }),
  deleteSeasLead: (id: number) => request<{ ok: boolean }>(`/seas/${id}`, { method: 'DELETE' }),

  getQrCodes: (mode: BizMode) => request<QrCode[]>(`/qrcodes${toQuery({ mode })}`),
  createQrCode: (payload: { name: string; channel: string; staff_id?: number | null; auto_tags?: string[]; mode: BizMode }) =>
    request<QrCode>('/qrcodes', { method: 'POST', body: JSON.stringify(payload) }),
  updateQrCode: (id: number, payload: Partial<{ name: string; channel: string; staff_id: number | null; auto_tags: string[]; active: number }>) =>
    request<QrCode>(`/qrcodes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteQrCode: (id: number) => request<{ ok: boolean }>(`/qrcodes/${id}`, { method: 'DELETE' }),
  scanQrCode: (id: number, payload: { name?: string }) =>
    request<{ ok: boolean; message: string; customerId: number }>(`/qrcodes/${id}/scan`, { method: 'POST', body: JSON.stringify(payload) }),

  exportBackup: () => request<Record<string, unknown>>('/backup/export'),
  exportCustomersCsv: (mode: BizMode) => request<string>(`/backup/customers.csv${toQuery({ mode })}`),

  // === P2: 优惠券 ===
  getCoupons: (mode: BizMode) => request<Coupon[]>(`/coupons${toQuery({ mode })}`),
  getCoupon: (id: number) => request<Coupon>(`/coupons/${id}`),
  createCoupon: (payload: Partial<Coupon> & { name: string; type: Coupon['type']; value: number; start_at: string; end_at: string }) =>
    request<Coupon>('/coupons', { method: 'POST', body: JSON.stringify(payload) }),
  updateCoupon: (id: number, payload: Partial<Coupon>) =>
    request<Coupon>(`/coupons/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCoupon: (id: number) => request<{ ok: boolean }>(`/coupons/${id}`, { method: 'DELETE' }),
  issueCoupon: (payload: { coupon_id: number; customer_ids: number[]; source?: string; sop_id?: number; sop_step_index?: number; staff_id?: number }) =>
    request<{ ok: boolean; coupon_id: number; requested: number; issued: number; skipped: number }>('/coupons/issue', { method: 'POST', body: JSON.stringify(payload) }),
  redeemCoupon: (payload: { issue_id?: number; code?: string; order_no?: string; order_amount?: number }) =>
    request<{ ok: boolean; issue_id: number; coupon_id: number; coupon_name: string; saved_amount: number; type: string; value: number; min_order: number }>('/coupons/redeem', { method: 'POST', body: JSON.stringify(payload) }),
  getCustomerCoupons: (customerId: number) => request<CouponIssue[]>(`/coupons/issues/customer/${customerId}`),

  // === P2: 限时秒杀 ===
  getSeckills: () => request<SeckillActivity[]>('/seckill'),
  createSeckill: (payload: Partial<SeckillActivity> & { title: string; stock: number; price: number; start_at: string; end_at: string }) =>
    request<SeckillActivity>('/seckill', { method: 'POST', body: JSON.stringify(payload) }),
  toggleSeckill: (id: number) => request<SeckillActivity>(`/seckill/${id}/toggle`, { method: 'PUT' }),
  grabSeckill: (id: number, customer_id: number) =>
    request<{ ok: boolean; price: number; customer_id: number; activity_id: number; title: string; grab_at: string }>(`/seckill/${id}/grab`, { method: 'POST', body: JSON.stringify({ customer_id }) }),

  // === P2: 外部订单对接 ===
  recordPurchase: (customerId: number, payload: { order_no?: string; amount: number; coupon_code?: string }) =>
    request<{ ok: boolean; order_no: string; amount: number; new_orders: number; new_spend: number; stage: string; was_first_purchase: boolean; coupon: { saved: number; coupon_id: number; coupon_name: string } | null; sop_triggered: { sop_id: number; name: string; coupon_issued: number } | null }>(
      `/customers/${customerId}/purchase`, { method: 'POST', body: JSON.stringify(payload) })
}
