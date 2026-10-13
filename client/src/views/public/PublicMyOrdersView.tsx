import { useEffect, useState } from 'react'
import { api } from '../../api'
import type { Order, Address } from '../../types'

interface Props {
  customerCode: string | null
  navigate: (page: string, extra?: Record<string, string>) => void
}

type Tab = 'all' | 'pending' | 'paid' | 'shipped' | 'completed' | 'cancelled'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'all', label: '全部', icon: 'fa-receipt' },
  { key: 'pending', label: '待支付', icon: 'fa-credit-card' },
  { key: 'paid', label: '待发货', icon: 'fa-box' },
  { key: 'shipped', label: '已发货', icon: 'fa-truck' },
  { key: 'completed', label: '已完成', icon: 'fa-circle-check' },
  { key: 'cancelled', label: '已取消', icon: 'fa-circle-xmark' },
]

function resolveAddress(o: Order): Address | null {
  if (o.address) return o.address as Address
  if (o.address_snapshot) {
    try { return JSON.parse(o.address_snapshot) } catch { return null }
  }
  return null
}

export default function PublicMyOrdersView({ customerCode, navigate }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [tab, setTab] = useState<Tab>('all')

  useEffect(() => {
    if (!customerCode) {
      setError('客户标识缺失')
      setLoading(false)
      return
    }
    let mounted = true
    fetch(`/api/public/customer/${customerCode}/coupons`)
      .then((r) => r.json())
      .then(async (data) => {
        if (!mounted) return
        if (!data.customer) throw new Error('客户不存在')
        const cid = data.customer.id
        setCustomerId(cid)
        const list = await api.getCustomerOrders(cid).catch(() => [])
        if (mounted) setOrders(list)
      })
      .catch((e) => mounted && setError(e.message))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [customerCode])

  const filtered = orders.filter((o) => {
    if (tab === 'all') return true
    return o.status === tab
  })

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-emerald-50 flex items-center justify-center">
            <i className="fa-solid fa-spinner fa-spin text-xl text-emerald-500" />
          </div>
          <div className="text-xs text-slate-500">加载中...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
        <div className="bg-white rounded-3xl p-6 text-center shadow-sm max-w-sm">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-rose-50 flex items-center justify-center">
            <i className="fa-solid fa-circle-exclamation text-2xl text-rose-400" />
          </div>
          <p className="text-slate-600 text-sm mb-5">{error}</p>
          <button
            onClick={() => navigate('shop', { code: customerCode! })}
            className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-full text-sm font-medium shadow-sm hover:shadow-md transition"
          >
            <i className="fa-solid fa-arrow-left mr-1" />返回商城
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-8">
      {/* 顶部 Banner */}
      <div className="bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 text-white pt-5 pb-6 shadow-lg">
        <div className="max-w-md mx-auto px-4">
          <button
            onClick={() => navigate('shop', { code: customerCode! })}
            className="inline-flex items-center gap-1 text-xs opacity-80 hover:opacity-100 mb-3 transition"
          >
            <i className="fa-solid fa-chevron-left" />
            返回商城
          </button>
          <h1 className="text-2xl font-bold tracking-tight">我的订单</h1>
          <div className="text-xs opacity-90 mt-1">
            <i className="fa-solid fa-receipt mr-1" />
            共 <span className="font-semibold">{orders.length}</span> 笔订单
          </div>
        </div>
      </div>

      {/* 状态 Tab chips */}
      <div className="max-w-md mx-auto px-4 pt-4">
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 scrollbar-hide">
          {TABS.map((t) => {
            const active = tab === t.key
            const count = t.key === 'all' ? orders.length : orders.filter((o) => o.status === t.key).length
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 flex items-center gap-1.5 ${
                  active
                    ? 'bg-white text-emerald-600 shadow-md'
                    : 'bg-white/60 text-slate-500 hover:bg-white hover:text-emerald-500'
                }`}
              >
                <i className={`fa-solid ${t.icon} text-[11px]`} />
                {t.label}
                {count > 0 && (
                  <span className={`px-1.5 py-0.5 text-[9px] rounded-full font-semibold ${
                    active ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* 列表 */}
      <div className="max-w-md mx-auto p-4 space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-3xl shadow-sm p-12 text-center">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
              <i className="fa-solid fa-box-open text-3xl text-slate-300" />
            </div>
            <div className="text-slate-600 font-medium mb-1">暂无订单</div>
            <div className="text-xs text-slate-400 mb-5">快去挑选心仪的商品吧</div>
            <button
              onClick={() => navigate('shop', { code: customerCode! })}
              className="px-8 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-full text-sm font-medium shadow-sm hover:shadow-md transition"
            >
              <i className="fa-solid fa-bag-shopping mr-1" />去逛逛
            </button>
          </div>
        ) : (
          filtered.map((o) => {
            const addr = resolveAddress(o)
            const items = o.items && o.items.length > 0 ? o.items : []
            const statusColor = o.status_color || (() => {
              const m: Record<string, string> = {
                pending: 'bg-amber-100 text-amber-700',
                paid: 'bg-sky-100 text-sky-700',
                shipped: 'bg-indigo-100 text-indigo-700',
                completed: 'bg-emerald-100 text-emerald-700',
                cancelled: 'bg-slate-100 text-slate-500',
                refunded: 'bg-rose-100 text-rose-700',
              }
              return m[o.status] || 'bg-slate-100 text-slate-500'
            })()

            return (
              <div key={o.id} className="bg-white rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-all duration-200">
                {/* 订单头 */}
                <div className="px-3 py-2.5 flex items-center justify-between bg-slate-50/60 border-b border-slate-100">
                  <div className="flex items-center gap-2 min-w-0">
                    <i className="fa-solid fa-receipt text-[11px] text-slate-400" />
                    <span className="text-[10px] text-slate-400">订单号</span>
                    <span className="font-mono text-[11px] text-slate-600 truncate">{o.order_no}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColor} shrink-0 ml-2`}>
                    {o.status_label || o.status}
                  </span>
                </div>

                {/* 商品列表 */}
                {items.length > 0 ? (
                  <div className="p-3 space-y-2">
                    {items.map((it) => (
                      <div key={it.id} className="flex gap-2.5 items-center">
                        <div className="w-16 h-16 rounded-xl bg-slate-50 shrink-0 overflow-hidden shadow-sm">
                          {it.product_image ? (
                            <img src={it.product_image} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-200">
                              <i className="fa-solid fa-image text-base" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-slate-700 line-clamp-2 leading-tight">{it.product_name}</div>
                          <div className="flex justify-between items-baseline mt-1.5">
                            <span className="text-emerald-600 font-bold text-sm">￥{it.price.toFixed(2)}</span>
                            <span className="text-xs text-slate-400">×{it.quantity}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 flex gap-2.5 items-center">
                    <div className="w-16 h-16 rounded-xl bg-slate-50 shrink-0 overflow-hidden shadow-sm">
                      {o.product_image ? (
                        <img src={o.product_image} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-200">
                          <i className="fa-solid fa-image text-base" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-700 line-clamp-2 leading-tight">{o.product_name || '商品'}</div>
                      <div className="text-emerald-600 font-bold text-sm mt-1">￥{(o.paid_amount || 0).toFixed(2)}</div>
                    </div>
                  </div>
                )}

                {/* 地址 */}
                {addr && (
                  <div className="mx-3 p-2.5 bg-emerald-50/60 border border-emerald-100 rounded-xl">
                    <div className="flex items-center gap-1.5 text-slate-700 font-medium text-xs">
                      <i className="fa-solid fa-location-dot text-emerald-500 text-[11px]" />
                      {addr.name}
                      {addr.phone && <span className="text-slate-500 font-normal">· {addr.phone}</span>}
                    </div>
                    <div className="text-slate-500 leading-relaxed mt-1 pl-4">
                      {[addr.province, addr.city, addr.district].filter(Boolean).join(' ')} {addr.detail}
                    </div>
                  </div>
                )}

                {/* 合计 + 操作 */}
                <div className="px-3 py-2.5 flex items-center justify-between border-t border-slate-100">
                  <div className="text-[11px] text-slate-400">
                    <i className="fa-solid fa-clock mr-1 text-slate-300" />
                    {o.order_at ? o.order_at.slice(0, 16).replace('T', ' ') : '-'}
                    <span className="ml-2">合计 <span className="text-emerald-600 font-bold text-base">￥{(o.paid_amount || 0).toFixed(2)}</span></span>
                  </div>
                  <div className="flex gap-1.5 shrink-0 ml-2">
                    {o.status === 'pending' && (
                      <button
                        onClick={() => alert('请联系客服完成支付')}
                        className="px-3 py-1.5 text-[11px] bg-gradient-to-r from-rose-500 to-rose-600 text-white rounded-full font-medium shadow-sm hover:shadow-md transition"
                      >
                        <i className="fa-solid fa-credit-card mr-1" />去支付
                      </button>
                    )}
                    {o.status === 'shipped' && (
                      <button
                        onClick={async () => {
                          try {
                            await api.updateOrderStatus(o.id, { status: 'completed' })
                            const list = await api.getCustomerOrders(customerId!)
                            setOrders(list)
                          } catch (e: any) { alert(e.message) }
                        }}
                        className="px-3 py-1.5 text-[11px] bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-full font-medium shadow-sm hover:shadow-md transition"
                      >
                        <i className="fa-solid fa-check mr-1" />确认收货
                      </button>
                    )}
                    {(o.status === 'completed' || o.status === 'cancelled' || o.status === 'refunded') && (
                      <button
                        onClick={() => navigate('shop', { code: customerCode! })}
                        className="px-3 py-1.5 text-[11px] border border-slate-200 text-slate-600 rounded-full font-medium hover:border-emerald-300 hover:text-emerald-500 transition"
                      >
                        <i className="fa-solid fa-bag-shopping mr-1" />再次购买
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
