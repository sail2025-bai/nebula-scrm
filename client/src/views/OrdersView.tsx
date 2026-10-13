import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { Address, Order, OrderStatus } from '../types'
import { useToast } from '../components/ui/Toast'
import Modal from '../components/ui/Modal'
import Empty from '../components/ui/Empty'
import { formatMoney, formatDateTime } from '../utils'

interface Props { dataVersion?: number }

const PAGE_SIZE = 15

const STATUS_TABS: { value: OrderStatus | ''; label: string; icon: string }[] = [
  { value: '', label: '全部',     icon: 'fa-solid fa-list' },
  { value: 'pending', label: '待支付', icon: 'fa-solid fa-clock' },
  { value: 'paid',    label: '待发货', icon: 'fa-solid fa-hourglass-half' },
  { value: 'shipped', label: '已发货', icon: 'fa-solid fa-truck' },
  { value: 'completed', label: '已完成', icon: 'fa-solid fa-circle-check' },
  { value: 'cancelled', label: '已取消', icon: 'fa-solid fa-ban' },
  { value: 'refunded',  label: '已退款', icon: 'fa-solid fa-arrow-rotate-left' },
]

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部来源' },
  { value: 'manual', label: '手动录入' },
  { value: 'seckill', label: '限时秒杀' },
  { value: 'coupon', label: '优惠券核销' },
  { value: 'channels_shop', label: '视频号小店' },
  { value: 'wecom_mini', label: '企微小程序' },
  { value: 'sop', label: 'SOP 自动触达' },
  { value: 'ext_api', label: '外部 API 同步' },
]

const SHIPPING_COMPANIES = ['京东', '顺丰', '中通', '圆通', '韵达', 'EMS', '极兔', '邮政']

function buildPageItems(current: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1)
  if (current <= 3) return [1, 2, 3, 4, '...', totalPages]
  if (current >= totalPages - 2) return [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  return [1, '...', current - 1, current, current + 1, '...', totalPages]
}

function MetricCard({ label, value, icon, iconCls, hint }: { label: string; value: string; icon: string; iconCls: string; hint?: string }) {
  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-200/80 custom-shadow card-hover">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <h3 className="text-2xl font-bold text-slate-900 mt-1">{value}</h3>
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-base ${iconCls}`}>
          <i className={icon} />
        </div>
      </div>
      {hint && <div className="mt-2 text-[11px] text-slate-400">{hint}</div>}
    </div>
  )
}

function resolveAddress(order: Order): Address | null {
  if (order.address) return order.address
  if (order.address_snapshot) {
    try { return JSON.parse(order.address_snapshot) } catch { return null }
  }
  return null
}

export default function OrdersView({ dataVersion }: Props) {
  const toast = useToast()
  const [list, setList] = useState<Order[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<OrderStatus | ''>('')
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // 统计
  const [stats, setStats] = useState({ pendingShip: 0, shipped: 0, todayCount: 0, monthGMV: 0 })

  // Modal
  const [shipTarget, setShipTarget] = useState<Order | null>(null)
  const [shipNo, setShipNo] = useState('')
  const [shipCompany, setShipCompany] = useState('顺丰')
  const [shipLoading, setShipLoading] = useState(false)
  const [detailTarget, setDetailTarget] = useState<Order | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await api.getOrders({
        status: status || undefined,
        source: source || undefined,
        search: search.trim() || undefined,
        start: startDate || undefined,
        end: endDate || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      setList(res.list)
      setTotal(res.total)
    } catch (e: any) {
      toast.showToast(e.message || '加载失败', 'warning')
    } finally {
      setLoading(false)
    }
  }

  async function loadStats() {
    try {
      const [pendingRes, shippedRes, todayRes, monthRes] = await Promise.all([
        api.getOrders({ status: 'paid', pageSize: 1 }),
        api.getOrders({ status: 'shipped', pageSize: 1 }),
        (async () => {
          const today = new Date()
          const s = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')} 00:00:00`
          const e = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')} 23:59:59`
          return api.getOrders({ start: s, end: e, pageSize: 1 })
        })(),
        (async () => {
          const today = new Date()
          const s = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01 00:00:00`
          return api.getOrders({ start: s, pageSize: 200 })
        })(),
      ])
      const monthGMV = monthRes.list.reduce((s, o) => s + (o.paid_amount || 0), 0)
      setStats({
        pendingShip: pendingRes.total,
        shipped: shippedRes.total,
        todayCount: todayRes.total,
        monthGMV,
      })
    } catch {}
  }

  useEffect(() => { load(); loadStats() }, [page, status, source, search, startDate, endDate, dataVersion])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageItems = buildPageItems(page, totalPages)

  function resetFilters() {
    setStatus(''); setSource(''); setSearch(''); setStartDate(''); setEndDate(''); setPage(1)
  }

  function openShip(o: Order) {
    setShipTarget(o)
    setShipNo(o.shipping_no || '')
    setShipCompany(o.shipping_company || '顺丰')
  }

  async function confirmShip() {
    if (!shipTarget) return
    if (!shipNo.trim()) { toast.showToast('请填写物流单号', 'warning'); return }
    setShipLoading(true)
    try {
      await api.updateOrderStatus(shipTarget.id, {
        status: 'shipped',
        shipping_no: shipNo.trim(),
        shipping_company: shipCompany,
      })
      toast.showToast('发货成功', 'success')
      setShipTarget(null)
      await load()
      await loadStats()
    } catch (e: any) {
      toast.showToast(e.message || '发货失败', 'warning')
    } finally {
      setShipLoading(false)
    }
  }

  async function quickAction(o: Order, action: 'cancel' | 'complete' | 'refund') {
    const label = action === 'cancel' ? '取消' : action === 'complete' ? '确认完成' : '退款'
    if (!window.confirm(`确定要${label}订单 ${o.order_no} 吗？`)) return
    try {
      const s: OrderStatus = action === 'cancel' ? 'cancelled' : action === 'complete' ? 'completed' : 'refunded'
      await api.updateOrderStatus(o.id, { status: s })
      toast.showToast(`已${label}`, 'success')
      await load()
      await loadStats()
    } catch (e: any) {
      toast.showToast(e.message || '操作失败', 'warning')
    }
  }

  async function handleDelete(o: Order) {
    if (!window.confirm(`确定删除订单 ${o.order_no}？此操作不可恢复`)) return
    try {
      await api.deleteOrder(o.id)
      toast.showToast('已删除', 'success')
      if (list.length === 1 && page > 1) setPage(page - 1)
      else await load()
      await loadStats()
    } catch (e: any) {
      toast.showToast(e.message || '删除失败', 'warning')
    }
  }

  const sourceColor = useMemo(() => {
    const map: Record<string, string> = {
      manual: 'bg-slate-100 text-slate-600',
      seckill: 'bg-rose-100 text-rose-700',
      coupon: 'bg-amber-100 text-amber-700',
      channels_shop: 'bg-sky-100 text-sky-700',
      youzan: 'bg-teal-100 text-teal-700',
      wecom_mini: 'bg-emerald-100 text-emerald-700',
      sop: 'bg-indigo-100 text-indigo-700',
      ext_api: 'bg-violet-100 text-violet-700',
    }
    return map
  }, [])

  return (
    <div className="space-y-4">
      {/* 统计卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <MetricCard label="待发货订单" value={String(stats.pendingShip)} icon="fa-solid fa-hourglass-half" iconCls="bg-amber-100 text-amber-600" hint="已支付未发货" />
        <MetricCard label="已发货未完成" value={String(stats.shipped)} icon="fa-solid fa-truck" iconCls="bg-indigo-100 text-indigo-600" hint="需跟进确认收货" />
        <MetricCard label="今日新增订单" value={String(stats.todayCount)} icon="fa-solid fa-calendar-plus" iconCls="bg-emerald-100 text-emerald-600" hint="今日 00:00 至今" />
        <MetricCard label="本月 GMV" value={formatMoney(stats.monthGMV)} icon="fa-solid fa-coins" iconCls="bg-rose-100 text-rose-600" hint="本月实付总额" />
      </div>

      {/* 筛选工具栏 */}
      <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow p-4">
        {/* 状态 tab */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {STATUS_TABS.map((t) => {
            const active = status === t.value
            return (
              <button
                key={t.value || 'all'}
                onClick={() => { setStatus(t.value); setPage(1) }}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                  active
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <i className={t.icon} />
                {t.label}
              </button>
            )
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <select
            value={source}
            onChange={(e) => { setSource(e.target.value); setPage(1) }}
            className="h-9 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400"
          >
            {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <div className="relative">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1) } }}
              placeholder="订单号 / 商品 / 客户名"
              className="h-9 pl-8 pr-3 w-56 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-emerald-400"
            />
          </div>

          <div className="flex items-center gap-1 text-xs text-slate-500">
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1) }}
              className="h-9 px-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-emerald-400" />
            <span>至</span>
            <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1) }}
              className="h-9 px-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-emerald-400" />
          </div>

          <button onClick={resetFilters} className="ml-auto h-9 px-3 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition">
            <i className="fa-solid fa-rotate-left mr-1" />重置
          </button>
        </div>
      </div>

      {/* 订单列表 */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-16 text-center text-slate-400">
          <i className="fa-solid fa-spinner fa-spin text-2xl text-emerald-500" />
          <div className="text-xs mt-2">订单加载中...</div>
        </div>
      ) : list.length === 0 ? (
        <Empty icon="fa-solid fa-box-open" title="暂无订单" description="调整筛选条件或等待客户下单" />
      ) : (
        <div className="space-y-3">
          {list.map((o) => {
            const addr = resolveAddress(o)
            return (
              <div key={o.id} className="bg-white rounded-2xl border border-slate-200/80 custom-shadow overflow-hidden">
                {/* 订单头 */}
                <div className="px-4 py-2.5 bg-slate-50/60 border-b border-slate-100 flex items-center gap-3 flex-wrap">
                  <button
                    onClick={() => setDetailTarget(o)}
                    className="font-mono text-sm font-semibold text-slate-800 hover:text-emerald-600 transition"
                    title="查看详情"
                  >
                    {o.order_no}
                  </button>
                  <span className="text-xs text-slate-400">{formatDateTime(o.order_at || o.created_at)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${sourceColor[o.source] || 'bg-slate-100 text-slate-600'}`}>
                    {o.source_label || o.source}
                  </span>
                  {o.coupon_code && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                      <i className="fa-solid fa-tags mr-0.5" />{o.coupon_code}
                    </span>
                  )}
                  <span className={`ml-auto px-2.5 py-1 rounded-full text-xs font-semibold ${o.status_color || 'bg-slate-100 text-slate-500'}`}>
                    {o.status_label || o.status}
                  </span>
                </div>

                {/* 订单主体 */}
                <div className="p-4 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4">
                  {/* 左：客户 + 商品 */}
                  <div className="space-y-3">
                    {/* 客户 */}
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 text-white text-xs font-bold flex items-center justify-center shrink-0">
                        {(o.customerName || '客').charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">{o.customerName || `客户#${o.customer_id}`}</div>
                        <div className="text-[11px] text-slate-400 truncate">
                          <i className="fa-brands fa-weixin mr-1 text-emerald-500" />{o.customerWechat || '-'}
                        </div>
                      </div>
                    </div>

                    {/* 商品 */}
                    <div className="flex items-center gap-2 bg-slate-50/60 rounded-xl p-2.5">
                      <div className="w-12 h-12 rounded-lg bg-slate-100 shrink-0 overflow-hidden flex items-center justify-center">
                        {o.product_image ? (
                          <img src={o.product_image} className="w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
                        ) : (
                          <i className="fa-solid fa-image text-slate-300 text-xs" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-700 truncate">{o.product_name || (o.items && o.items[0]?.product_name) || '商品'}</div>
                        {o.items && o.items.length > 1 && (
                          <div className="text-[11px] text-slate-400">等 {o.items.length} 件商品</div>
                        )}
                      </div>
                      {(o.item_count || (o.items?.length ?? 0)) > 1 && (
                        <span className="shrink-0 px-2 py-0.5 bg-slate-200 text-slate-600 text-[10px] rounded-full">
                          ×{o.item_count || o.items?.length}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 中：地址 */}
                  {addr ? (
                    <div className="text-xs space-y-0.5">
                      <div className="flex items-center gap-1 text-slate-700 font-medium">
                        <i className="fa-solid fa-location-dot text-rose-400" />
                        {addr.name} {addr.phone && <span className="text-slate-500">· {addr.phone}</span>}
                      </div>
                      <div className="text-slate-500 leading-relaxed pl-4">
                        {[addr.province, addr.city, addr.district].filter(Boolean).join(' ')} {addr.detail}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 flex items-center gap-1">
                      <i className="fa-regular fa-envelope" />无收货地址
                    </div>
                  )}

                  {/* 右：金额 + 操作 */}
                  <div className="flex flex-col items-end gap-2 md:min-w-[180px]">
                    <div className="text-right w-full">
                      <div className="text-[11px] text-slate-400 space-x-2">
                        <span>金额 {formatMoney(o.amount || 0)}</span>
                        {o.discount > 0 && <span className="text-emerald-500">优惠 -{formatMoney(o.discount)}</span>}
                      </div>
                      <div className="text-lg font-bold text-rose-500">
                        {formatMoney(o.paid_amount || 0)}
                      </div>
                      <div className="text-[10px] text-slate-400">实付</div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      <button
                        onClick={() => setDetailTarget(o)}
                        className="px-2.5 py-1 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition"
                      >
                        <i className="fa-solid fa-eye mr-0.5" />详情
                      </button>
                      {o.status === 'pending' && (
                        <button
                          onClick={() => quickAction(o, 'cancel')}
                          className="px-2.5 py-1 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition"
                        >
                          取消
                        </button>
                      )}
                      {o.status === 'paid' && (
                        <button
                          onClick={() => openShip(o)}
                          className="px-2.5 py-1 text-[11px] bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition"
                        >
                          <i className="fa-solid fa-truck mr-0.5" />发货
                        </button>
                      )}
                      {o.status === 'shipped' && (
                        <>
                          <button
                            onClick={() => quickAction(o, 'complete')}
                            className="px-2.5 py-1 text-[11px] bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition"
                          >
                            确认完成
                          </button>
                          {o.shipping_no && (
                            <div className="px-2 py-1 text-[10px] bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100 max-w-[120px] truncate" title={`${o.shipping_company} ${o.shipping_no}`}>
                              <i className="fa-solid fa-magnifying-glass mr-0.5" />{o.shipping_company || '快递'} · {o.shipping_no}
                            </div>
                          )}
                        </>
                      )}
                      {(o.status === 'completed' || o.status === 'cancelled' || o.status === 'refunded') && (
                        <button
                          onClick={() => handleDelete(o)}
                          className="px-2.5 py-1 text-[11px] bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition"
                        >
                          <i className="fa-solid fa-trash-can mr-0.5" />删除
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 分页 */}
      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>共 {total} 条 · 第 {page}/{totalPages} 页</span>
          <div className="flex gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage(Math.max(1, page - 1))}
              className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition"
            >
              <i className="fa-solid fa-chevron-left" />
            </button>
            {pageItems.map((it, idx) =>
              it === '...' ? (
                <span key={`e${idx}`} className="px-2 py-1 text-slate-400">…</span>
              ) : (
                <button
                  key={it}
                  onClick={() => setPage(it)}
                  className={`min-w-[28px] px-2 py-1 rounded-lg border transition ${
                    page === it
                      ? 'bg-emerald-500 text-white border-emerald-500'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {it}
                </button>
              )
            )}
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition"
            >
              <i className="fa-solid fa-chevron-right" />
            </button>
          </div>
        </div>
      )}

      {/* 发货 Modal */}
      <Modal
        open={!!shipTarget}
        onClose={() => !shipLoading && setShipTarget(null)}
        title="订单发货"
        subtitle={shipTarget ? `订单号：${shipTarget.order_no}` : undefined}
        maxWidth="max-w-md"
        footer={
          <>
            <button onClick={() => setShipTarget(null)} disabled={shipLoading}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition disabled:opacity-50">
              取消
            </button>
            <button onClick={confirmShip} disabled={shipLoading || !shipNo.trim()}
              className="px-4 py-2 text-sm bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg transition flex items-center gap-1.5">
              {shipLoading && <i className="fa-solid fa-spinner fa-spin" />}
              确认发货
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">快递公司</label>
            <div className="grid grid-cols-4 gap-1.5">
              {SHIPPING_COMPANIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setShipCompany(c)}
                  className={`px-2 py-1.5 text-xs rounded-lg border transition ${
                    shipCompany === c
                      ? 'bg-emerald-500 text-white border-emerald-500'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-400'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">物流单号</label>
            <input
              value={shipNo}
              onChange={(e) => setShipNo(e.target.value)}
              placeholder="请输入物流单号"
              className="w-full h-10 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400"
            />
          </div>
        </div>
      </Modal>

      {/* 订单详情 Modal */}
      <Modal
        open={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        title="订单详情"
        subtitle={detailTarget ? `订单号：${detailTarget.order_no}` : undefined}
        maxWidth="max-w-3xl"
      >
        {detailTarget && (() => {
          const d = detailTarget
          const addr = resolveAddress(d)
          return (
            <div className="space-y-4">
              {/* 状态头 */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${d.status_color || 'bg-slate-100 text-slate-500'}`}>
                  {d.status_label || d.status}
                </span>
                <span className="text-xs text-slate-500">来源：{d.source_label || d.source}</span>
                <span className="text-xs text-slate-500">下单时间：{formatDateTime(d.order_at || d.created_at)}</span>
                {d.paid_at && <span className="text-xs text-slate-500">支付时间：{formatDateTime(d.paid_at)}</span>}
                {d.shipped_at && <span className="text-xs text-slate-500">发货时间：{formatDateTime(d.shipped_at)}</span>}
              </div>

              {/* 客户信息 */}
              <div className="bg-slate-50 rounded-xl p-3">
                <div className="text-[11px] text-slate-400 mb-2">客户信息</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-slate-400">姓名：</span>{d.customerName || '-'}</div>
                  <div><span className="text-slate-400">企微昵称：</span>{d.customerWechat || '-'}</div>
                  <div><span className="text-slate-400">客户 ID：</span>{d.customer_id}</div>
                  {d.remark && <div className="col-span-2"><span className="text-slate-400">备注：</span>{d.remark}</div>}
                </div>
              </div>

              {/* 收货地址 */}
              {addr && (
                <div className="bg-slate-50 rounded-xl p-3">
                  <div className="text-[11px] text-slate-400 mb-2">收货地址</div>
                  <div className="text-sm">
                    <span className="font-medium">{addr.name}</span>
                    {addr.phone && <span className="ml-2 text-slate-500">{addr.phone}</span>}
                    {addr.is_default === 1 && <span className="ml-2 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">默认</span>}
                  </div>
                  <div className="text-slate-600 text-xs mt-1">
                    {[addr.province, addr.city, addr.district].filter(Boolean).join(' ')} {addr.detail}
                  </div>
                </div>
              )}

              {/* 商品明细 */}
              <div>
                <div className="text-[11px] text-slate-400 mb-2">商品明细</div>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-[11px]">
                      <tr>
                        <th className="text-left px-3 py-2">商品</th>
                        <th className="text-right px-3 py-2 w-20">单价</th>
                        <th className="text-center px-3 py-2 w-16">数量</th>
                        <th className="text-right px-3 py-2 w-24">小计</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(d.items && d.items.length > 0) ? d.items.map((it) => (
                        <tr key={it.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 flex items-center gap-2">
                            <div className="w-10 h-10 rounded-lg bg-slate-100 shrink-0 overflow-hidden">
                              {it.product_image ? (
                                <img src={it.product_image} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-300 text-[10px]">
                                  <i className="fa-solid fa-image" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-slate-700 truncate">{it.product_name}</div>
                              <div className="text-[10px] text-slate-400">#{it.product_id}</div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">{formatMoney(it.price)}</td>
                          <td className="px-3 py-2 text-center text-slate-600">{it.quantity}</td>
                          <td className="px-3 py-2 text-right font-medium text-slate-700">{formatMoney(it.subtotal)}</td>
                        </tr>
                      )) : (
                        <tr className="border-t border-slate-100">
                          <td colSpan={4} className="px-3 py-4 text-center text-slate-400 text-xs">无商品明细数据</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 金额拆解 */}
              <div className="bg-slate-50 rounded-xl p-3 text-sm space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>商品金额</span><span>{formatMoney(d.amount || 0)}</span>
                </div>
                {d.discount > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>优惠</span><span>-{formatMoney(d.discount)}</span>
                  </div>
                )}
                {d.coupon_code && (
                  <div className="flex justify-between text-amber-600 text-[11px]">
                    <span>优惠券</span><span className="font-mono">{d.coupon_code}</span>
                  </div>
                )}
                <div className="pt-1 border-t border-slate-200 flex justify-between font-bold text-rose-500 text-base">
                  <span>实付金额</span><span>{formatMoney(d.paid_amount || 0)}</span>
                </div>
              </div>

              {/* 物流信息 */}
              {d.shipping_no && (
                <div className="bg-indigo-50 rounded-xl p-3 text-sm">
                  <div className="text-[11px] text-indigo-400 mb-1">物流信息</div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-indigo-700">{d.shipping_company || '快递'}</span>
                    <span className="font-mono text-indigo-600">{d.shipping_no}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
