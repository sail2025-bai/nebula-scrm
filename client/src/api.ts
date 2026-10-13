import type {
  Address,
  AuthUser,
  BizMode,
  Broadcast,
  Category,
  Cart,
  CartItem,
  Customer,
  CustomerListResponse,
  CustomerQuery,
  DashboardStats,
  FollowUp,
  FollowUpSummary,
  Order,
  OrderItem,
  OrderStatus,
  Product,
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
  WecomStatus,
  MsgAuditStatus,
  CustomerTimelineEntry,
  ConditionField,
  ConditionOperator
} from './types'

// === JWT 令牌管理 ===
const TOKEN_KEY = 'nebula_scrm_token'
const USER_KEY = 'nebula_scrm_user'

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
export function setToken(token: string, user?: AuthUser) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch { /* SSR 环境或禁用 storage */ }
}
export function clearAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  } catch { /* ignore */ }
}
export function getStoredUser(): AuthUser | null {
  try {
    const s = localStorage.getItem(USER_KEY)
    return s ? JSON.parse(s) : null
  } catch { return null }
}

// 401 时派发事件，App 层监听后跳登录
const AUTH_EVENT = 'nebula:auth-expired'
function emitAuthExpired() {
  try { window.dispatchEvent(new CustomEvent(AUTH_EVENT)) } catch { /* ignore */ }
}

// 兼容生成 requestId（某些浏览器 crypto.randomUUID 不可用）
function genRequestId(): string {
  const c: any = (globalThis as any).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-Id': genRequestId()
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`/api${path}`, { ...options, headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) } })
  } catch (e) {
    throw new Error('网络异常，请检查连接后重试')
  }

  if (res.status === 401) {
    clearAuth()
    emitAuthExpired()
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || '登录已过期，请重新登录')
  }
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
  register: (payload: { name: string; account: string; password: string; businessMode?: string | null }) =>
    request<{ user: AuthUser; token: string }>('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: { account: string; password: string }) =>
    request<{ user: AuthUser; token: string }>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  wxlogin: (payload: { code: string; name?: string }) =>
    request<{ user: AuthUser; token: string; wecomDetail?: unknown; simulated?: boolean }>('/auth/wxlogin', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  getDashboardStats: () => request<DashboardStats>(`/dashboard/stats`),
  getTrend: (days = 7) => request<TrendData>(`/dashboard/trend?days=${days}`),

  getCustomers: (query: CustomerQuery) => request<CustomerListResponse>(`/customers${toQuery(query)}`),
  getCustomer: (id: number) => request<Customer>(`/customers/${id}`),
  getCustomerTimeline: (id: number) =>
    request<{ count: number; timeline: CustomerTimelineEntry[] }>(`/customers/${id}/timeline`),
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
  batchAssignStaff: (ids: number[], staff_id: number) =>
    request<{ ok: boolean; affected: number }>('/customers/batch-assign-staff', { method: 'POST', body: JSON.stringify({ ids, staff_id }) }),
  batchStage: (ids: number[], stage: string) =>
    request<{ ok: boolean; affected: number }>('/customers/batch-stage', { method: 'POST', body: JSON.stringify({ ids, stage }) }),
  batchDelete: (ids: number[]) =>
    request<{ ok: boolean; affected: number }>('/customers/batch-delete', { method: 'POST', body: JSON.stringify({ ids }) }),

  getTags: () => request<Tag[]>(`/tags`),
  createTag: (name: string, category: string, mode?: string | null) =>
    request<Tag>('/tags', { method: 'POST', body: JSON.stringify({ name, category}) }),
  updateTag: (id: number, name: string, category: string) =>
    request<Tag>(`/tags/${id}`, { method: 'PUT', body: JSON.stringify({ name, category }) }),
  deleteTag: (id: number) => request<{ ok: boolean }>(`/tags/${id}`, { method: 'DELETE' }),

  getSegments: () => request<Segment[]>(`/segments`),
  getSegment: (id: number) => request<Segment>(`/segments/${id}`),
  createSegment: (name: string, description: string, conditions: SegmentConditions, mode?: string | null) =>
    request<Segment>('/segments', { method: 'POST', body: JSON.stringify({ name, description, conditions}) }),
  updateSegment: (id: number, name: string, description: string, conditions: SegmentConditions) =>
    request<Segment>(`/segments/${id}`, { method: 'PUT', body: JSON.stringify({ name, description, conditions }) }),
  deleteSegment: (id: number) => request<{ ok: boolean }>(`/segments/${id}`, { method: 'DELETE' }),

  getGroups: () => request<WechatGroup[]>(`/groups`),
  createGroup: (name: string, owner_staff_id: number, mode?: string | null) =>
    request<WechatGroup>('/groups', { method: 'POST', body: JSON.stringify({ name, owner_staff_id}) }),
  updateGroup: (id: number, payload: Partial<{ name: string; owner_staff_id: number; member_count: number; today_messages: number; sop_status: string }>) =>
    request<WechatGroup>(`/groups/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteGroup: (id: number) => request<{ ok: boolean }>(`/groups/${id}`, { method: 'DELETE' }),
  getGroupEvents: (limit = 50, onlyGroup = false) =>
    request<WecomEvent[]>(`/groups/events${toQuery({ limit, only: onlyGroup ? 1 : 0 })}`),
  getGroupMembers: (id: number) =>
    request<{ id: number; group_id: number; external_userid: string; name: string }[]>(`/groups/${id}/members`),

  getFollowUps: (params?: { customer_id?: number; staff_id?: number; status?: 'pending' | 'done'; scope?: 'today' | 'overdue' }) => {
    const qs = toQuery({ ...params })
    return request<FollowUp[]>(`/follow-ups${qs}`)
  },
  getFollowUpsWithSummary: (params?: { status?: 'pending' | 'done'; scope?: 'today' | 'overdue' }) => {
    const qs = toQuery({ ...params, summary: 1 })
    return request<{ items: FollowUp[]; summary: FollowUpSummary }>(`/follow-ups${qs}`)
  },
  getFollowUpSummary: () => request<FollowUpSummary>('/follow-ups/summary'),
  assignFollowUp: (id: number) => request<{ ok: boolean }>(`/follow-ups/${id}/assign`, { method: 'POST' }),
  createFollowUp: (payload: { customer_id: number; type: string; content: string; outcome?: string; next_followup_at?: string | null }) =>
    request<FollowUp>('/follow-ups', { method: 'POST', body: JSON.stringify(payload) }),
  deleteFollowUp: (id: number) => request<{ ok: boolean }>(`/follow-ups/${id}`, { method: 'DELETE' }),
  completeFollowUp: (id: number, outcome?: string) => request<{ ok: boolean }>(`/follow-ups/${id}/complete`, { method: 'POST', body: JSON.stringify({ outcome }) }),

  getBroadcasts: () => request<Broadcast[]>(`/broadcasts`),
  createBroadcast: (payload: { title: string; type: string; audience_desc: string; message: string; mode?: string | null; conditions?: SegmentConditions }) =>
    request<Broadcast>('/broadcasts', { method: 'POST', body: JSON.stringify(payload) }),

  getSops: (industry?: 'retail' | 'service' | null) =>
    request<{ items: Sop[]; _meta: { is_admin: boolean; me: { id: number; account: string; name: string | null; wecom_userid: string | null } | null } }>(
      `/sops${toQuery({ include_templates: 1, industry: industry || undefined })}`
    ),
  getSopTemplates: (industry?: 'retail' | 'service' | null) =>
    request<{ items: Sop[]; _meta?: { is_admin: boolean; me: { id: number; account: string; name: string | null } | null } }>(
      `/sops${toQuery({ include_templates: 1, industry: industry || undefined })}`
    ),
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
  getSopConditionMeta: () => request<{ fields: ConditionField[]; operators: Record<string, ConditionOperator[]> }>('/sops/meta/conditions'),

  getStaff: () => request<Staff[]>('/staff'),
  createStaff: (payload: { name: string; role?: string; wecom_userid?: string | null; avatar_url?: string | null }) =>
    request<Staff>('/staff', { method: 'POST', body: JSON.stringify(payload) }),
  updateStaff: (id: number, payload: Partial<{ name: string; role: string; wecom_userid: string | null; avatar_url: string | null }>) =>
    request<Staff>(`/staff/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteStaff: (id: number) => request<{ ok: boolean }>(`/staff/${id}`, { method: 'DELETE' }),
  getChannels: () => request<string[]>(`/channels`),

  getWecomConfig: () => request<WecomConfig>('/wecom/config'),
  saveWecomConfig: (payload: {
    corp_id: string
    corp_secret: string
    callback_token?: string | null
    encoding_aes_key?: string | null
    video_shop_appid?: string | null
    video_shop_secret?: string | null
    video_shop_token?: string | null
    video_shop_encoding_aes_key?: string | null
    ext_api_key?: string | null
    msg_audit_agent_id?: string | null
    msg_audit_private_key?: string | null
    msg_audit_enabled?: number
  }) =>
    request<WecomConfig>('/wecom/config', { method: 'PUT', body: JSON.stringify(payload) }),
  // === 企微会话内容存档 ===
  getMsgAuditStatus: () => request<MsgAuditStatus>('/msgaudit/status'),
  pollMsgAudit: () => request<{ ok: boolean; polled?: number; updated?: number; total?: number; errors?: string[]; skipped?: boolean; reason?: string; error?: string }>('/msgaudit/poll', { method: 'POST' }),
  recomputeMsgAudit: () => request<{ ok: boolean; recomputed: number; changed: number }>('/msgaudit/recompute', { method: 'POST' }),
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

  getSeasLeads: () => request<SeasLead[]>(`/seas`),
  importSeasLeads: (payload: { lines: string[]; mode?: string | null }) =>
    request<{ imported: number; failed: number }>('/seas/import', { method: 'POST', body: JSON.stringify(payload) }),
  claimSeasLead: (id: number, staff_id: number) =>
    request<SeasLead>(`/seas/${id}/claim`, { method: 'PUT', body: JSON.stringify({ staff_id }) }),
  convertSeasLead: (id: number) =>
    request<{ customer: Customer }>(`/seas/${id}/convert`, { method: 'POST' }),
  returnSeasLead: (id: number) => request<SeasLead>(`/seas/${id}/return`, { method: 'PUT' }),
  deleteSeasLead: (id: number) => request<{ ok: boolean }>(`/seas/${id}`, { method: 'DELETE' }),

  getQrCodes: () => request<QrCode[]>(`/qrcodes`),
  createQrCode: (payload: { name: string; channel: string; staff_id?: number | null; auto_tags?: string[]; cta_type?: string; target_type?: 'coupon' | 'seckill' | null; target_id?: number | null; mode?: string | null }) =>
    request<QrCode>('/qrcodes', { method: 'POST', body: JSON.stringify(payload) }),
  updateQrCode: (id: number, payload: Partial<{ name: string; channel: string; staff_id: number | null; auto_tags: string[]; active: number; cta_type: string; target_type: string | null; target_id: number | null }>) =>
    request<QrCode>(`/qrcodes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteQrCode: (id: number) => request<{ ok: boolean }>(`/qrcodes/${id}`, { method: 'DELETE' }),
  scanQrCode: (id: number, payload: { name?: string }) =>
    request<{ ok: boolean; message: string; customerId: number }>(`/qrcodes/${id}/scan`, { method: 'POST', body: JSON.stringify(payload) }),

  exportBackup: () => request<Record<string, unknown>>('/backup/export'),
  exportCustomersCsv: () => request<string>(`/backup/customers.csv`),

  // === P2: 优惠券 ===
  getCoupons: () => request<Coupon[]>(`/coupons`),
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
  getSeckillOrders: (activityId: number, status?: string) =>
    request<{ activity: SeckillActivity; orders: any[]; total: number }>(`/seckill/${activityId}/orders${toQuery({ status })}`),
  getAllSeckillOrders: (params?: { status?: string; customer_id?: number }) =>
    request<any[]>(`/seckill/orders/all${toQuery(params || {})}`),
  updateSeckillOrderStatus: (id: number, status: 'pending' | 'paid' | 'refunded' | 'cancelled') =>
    request<{ ok: boolean; id: number; status: string }>(`/seckill/orders/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),

  // === 历史日报 ===
  getDailyReports: (days = 7) =>
    request<{ count: number; days: number; rows: { id: number; day: string; summary: any; sop_top: any[]; channel_top: any[] }[] }>(`/reports/daily${toQuery({ days })}`),
  runDailyReport: (day?: string) =>
    request<{ ok: boolean; day: string; summary: any }>(`/reports/daily/run${toQuery({ day })}`, { method: 'POST' }),


  // === P3: 订单台账 ===
  getOrders: (query?: { status?: string; source?: string; customer_id?: number; min_amount?: number; search?: string; start?: string; end?: string; page?: number; pageSize?: number }) =>
    request<{ total: number; page: number; pageSize: number; list: Order[] }>(`/orders${toQuery(query || {})}`),
  getCustomerOrders: (customerId: number) => request<Order[]>(`/orders/customer/${customerId}`),
  getOrder: (id: number) => request<Order>(`/orders/${id}`),
  createOrder: (payload: Partial<Order> & { customer_id: number; amount: number }) =>
    request<Order>('/orders', { method: 'POST', body: JSON.stringify(payload) }),
  updateOrderStatus: (id: number, data: { status: OrderStatus; shipping_no?: string; shipping_company?: string; remark?: string }) =>
    request<Order>(`/orders/${id}/status`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteOrder: (id: number) => request<{ ok: boolean }>(`/orders/${id}`, { method: 'DELETE' }),
  recordPurchase: (customerId: number, payload: { order_no: string; amount: number; coupon_code?: string }) =>
    request<{
      ok: boolean; order_id: number;
      amount?: number; new_spend?: number;
      coupon?: { saved: number; code: string };
      was_first_purchase?: boolean;
      sop_triggered?: { name: string; coupon_issued: number } | null
    }>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: customerId,
        order_no: payload.order_no,
        amount: payload.amount,
        paid_amount: payload.amount,
        coupon_code: payload.coupon_code || null,
        source: 'manual',
        status: 'paid',
        product_name: '手动下单',
        remark: '运营手动记录'
      })
    }),

  // === Phase 1: 自建商城 ===
  getProducts: (query?: { category?: number; q?: string; all?: 1; page?: number; pageSize?: number }) =>
    request<{ items: Product[]; total?: number; page?: number; pageSize?: number; totalPages?: number }>(`/products${toQuery(query || {})}`),
  getProduct: (id: number) => request<Product>(`/products/${id}`),
  createProduct: (payload: Partial<Product> & { name: string; price: number }) =>
    request<Product>('/products', { method: 'POST', body: JSON.stringify(payload) }),
  updateProduct: (id: number, payload: Partial<Product>) =>
    request<Product>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteProduct: (id: number) => request<{ ok: boolean }>(`/products/${id}`, { method: 'DELETE' }),
  toggleProduct: (id: number) => request<Product>(`/products/${id}/toggle`, { method: 'PUT' }),
  getCategories: () => request<{ items: Category[] }>('/products/categories'),
  createCategory: (payload: { name: string; icon?: string; sort_order?: number }) =>
    request<Category>('/products/categories', { method: 'POST', body: JSON.stringify(payload) }),
  deleteCategory: (id: number) => request<{ ok: boolean }>(`/products/categories/${id}`, { method: 'DELETE' }),
  getCart: (customerId: number) => request<Cart>(`/products/cart?customer_id=${customerId}`),
  addToCart: (customerId: number, productId: number, quantity = 1) =>
    request<{ ok: boolean }>('/products/cart', { method: 'POST', body: JSON.stringify({ customer_id: customerId, product_id: productId, quantity }) }),
  updateCartItem: (cartId: number, quantity: number) =>
    request<{ ok: boolean }>(`/products/cart/${cartId}`, { method: 'PUT', body: JSON.stringify({ quantity }) }),
  removeCartItem: (cartId: number) => request<{ ok: boolean }>(`/products/cart/${cartId}`, { method: 'DELETE' }),
  clearCart: (customerId: number) =>
    request<{ ok: boolean }>('/products/cart/clear', { method: 'DELETE', body: JSON.stringify({ customer_id: customerId }) }),

  // === 收货地址 ===
  getAddressesByCustomer: (customerId: number) =>
    request<{ items: Address[] }>(`/addresses?customer_id=${customerId}`).then((r) => r.items || []),
  getAddress: (id: number) => request<Address>(`/addresses/${id}`),
  createAddress: (data: Partial<Address>) =>
    request<Address>('/addresses', { method: 'POST', body: JSON.stringify(data) }),
  updateAddress: (id: number, data: Partial<Address>) =>
    request<Address>(`/addresses/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAddress: (id: number) => request<{ ok: boolean }>(`/addresses/${id}`, { method: 'DELETE' }),
}
