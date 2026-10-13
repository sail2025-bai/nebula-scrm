import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { MODE_META, type BizMode, type SeckillActivity } from '../types'
import { useToast } from '../components/ui/Toast'
import Empty from '../components/ui/Empty'
import Modal from '../components/ui/Modal'

function fmtDateTime(d?: string | null) { return d ? d.replace('T',' ').slice(0,16) : '—' }
function toLocalInput(d: string) { return d.replace(' ','T').slice(0,16) }
function countdown(d: string) {
  const now = Date.now(), end = new Date(d.replace(' ','T')).getTime()
  const diff = Math.max(0, end - now)
  const h = Math.floor(diff/3600000), m = Math.floor((diff%3600000)/60000), s = Math.floor((diff%60000)/1000)
  return `${h}h ${m}m ${s}s`
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:   { label: '待支付',   cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  paid:      { label: '已支付',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  refunded:  { label: '已退款',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  cancelled: { label: '已取消',   cls: 'bg-rose-50 text-rose-700 border-rose-200' },
}
const STATUS_FLOW: Record<string, { target: string; label: string; cls: string }[]> = {
  pending:   [{ target: 'paid',      label: '标记已付', cls: 'bg-emerald-600 hover:bg-emerald-700' },
              { target: 'cancelled', label: '取消订单', cls: 'bg-rose-500 hover:bg-rose-600' }],
  paid:      [{ target: 'refunded',  label: '退款',     cls: 'bg-amber-500 hover:bg-amber-600' }],
  refunded:  [{ target: 'cancelled', label: '作废',     cls: 'bg-rose-500 hover:bg-rose-600' }],
  cancelled: [],
}

type Form = {
  title: string; description: string; stock: number; price: number; original_price: number;
  start_at: string; end_at: string; product_name: string; product_image: string
}

interface SeckillOrderRow {
  id: number; activity_id: number; customer_id: number; price: number;
  grab_at: string; status: keyof typeof STATUS_META | string;
  customerName?: string; phone?: string; wechat_nick?: string;
  activityTitle?: string; activityPrice?: number;
}

export default function SeckillView({ onPrefillQr }: { onPrefillQr?: (payload: { target_type: 'seckill'; target_id: number; suggestName: string }) => void }) {
  const toast = useToast()
  const [tab, setTab] = useState<'activity' | 'orders'>('activity')

  // === 活动管理 tab state ===
  const [list, setList] = useState<SeckillActivity[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const defaultForm: Form = useMemo(() => {
    const now = new Date(); const later = new Date(now.getTime() + 60*60*1000)
    return {
      title: '', description: '', product_name: '', product_image: '',
      stock: 100, price: 29.9, original_price: 99,
      start_at: toLocalInput(now.toISOString().slice(0,16)),
      end_at: toLocalInput(later.toISOString().slice(0,16))
    }
  }, [])
  const [form, setForm] = useState<Form>(defaultForm)

  async function load() {
    try { setList(await api.getSeckills()) } catch(e:any){ toast.showToast(e.message, "warning") }
  }
  useEffect(() => { load() }, [])

  // === 订单管理 tab state ===
  const [orders, setOrders] = useState<SeckillOrderRow[]>([])
  const [orderStatus, setOrderStatus] = useState<string>('')
  const [selectedAct, setSelectedAct] = useState<number | ''>('')

  async function loadOrders() {
    try {
      const data = await api.getAllSeckillOrders({
        status: orderStatus || undefined,
        customer_id: selectedAct ? undefined : undefined
      })
      setOrders(data as SeckillOrderRow[])
    } catch(e:any) { toast.showToast(e.message, 'warning') }
  }

  useEffect(() => {
    if (tab === 'orders') loadOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, orderStatus])

  // === handlers ===
  async function handleCreate() {
    if (!form.title.trim()) return toast.showToast('标题必填', "warning")
    try {
      await api.createSeckill({ ...form, start_at: form.start_at.replace('T',' '), end_at: form.end_at.replace('T',' ') })
      toast.showToast('秒杀活动创建成功', "success")
      setShowCreate(false); setForm(defaultForm); load()
    } catch(e:any){ toast.showToast(e.message, "warning") }
  }
  async function handleToggle(a: SeckillActivity) {
    try { await api.toggleSeckill(a.id); load() } catch(e:any){ toast.showToast(e.message, "warning") }
  }
  function handleCreateSeckillQr(a: SeckillActivity) {
    if (onPrefillQr) {
      onPrefillQr({ target_type: 'seckill', target_id: a.id, suggestName: `秒杀活码-${a.title}` })
    } else {
      toast.showToast('活码跳转未启用', 'warning')
    }
  }
  async function handleStatusChange(orderId: number, target: string) {
    try {
      await api.updateSeckillOrderStatus(orderId, target as any)
      toast.showToast(`订单 #${orderId} → ${STATUS_META[target]?.label || target}`, 'success')
      loadOrders()
    } catch(e:any) { toast.showToast(e.message, 'warning') }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <div className="text-slate-400 text-sm">{MODE_META.label} · 限时秒杀 / 福利抢单</div>
          <div className="text-lg font-semibold text-slate-800">限时秒杀活动管理</div>
        </div>
        {tab === 'activity' && (
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-gradient-to-r from-rose-500 to-orange-500 text-white rounded-lg shadow-sm text-sm font-medium flex items-center gap-2">
            <i className="fa-solid fa-bolt" /> 新建秒杀活动
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {[
          { id: 'activity' as const, label: '活动管理', icon: 'fa-solid fa-bolt-lightning' },
          { id: 'orders' as const,   label: '订单管理', icon: 'fa-solid fa-receipt' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1.5 transition ${
              tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <i className={t.icon} /> {t.label}
          </button>
        ))}
      </div>

      {/* ===== Activity Tab ===== */}
      {tab === 'activity' && (
        <>
          {list.length === 0 ? (
            <Empty title="暂无秒杀活动" description="秒杀用于包裹卡福利、老客专属、社群裂变等场景，支持事务防超卖" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {list.map(a => {
                const pct = a.stock ? a.sold / a.stock * 100 : 0
                return (
                  <div key={a.id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                    <div className="bg-gradient-to-r from-rose-500 via-orange-500 to-amber-500 text-white px-5 py-4 flex items-center justify-between">
                      <div>
                        <div className="text-xs opacity-80 mb-1">#{a.id} · {fmtDateTime(a.start_at)} 开抢</div>
                        <div className="font-bold text-lg">{a.title}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] opacity-80">{a.active === 1 ? '距结束' : '已结束'}</div>
                        <div className="font-mono text-sm">{a.active === 1 ? countdown(a.end_at) : '⏹️'}</div>
                      </div>
                    </div>
                    <div className="p-5">
                      {a.product_name && (
                        <div className="flex items-start gap-3 mb-3 pb-3 border-b border-slate-100">
                          {a.product_image ? (
                            <img src={a.product_image} alt={a.product_name} className="w-16 h-16 rounded-lg object-cover border border-slate-100 flex-shrink-0" />
                          ) : (
                            <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-rose-100 to-orange-100 flex items-center justify-center text-2xl flex-shrink-0">🛍️</div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-800 truncate">{a.product_name}</div>
                            {a.description && <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{a.description}</div>}
                          </div>
                        </div>
                      )}
                      <div className="flex items-baseline gap-3 mb-3">
                        <span className="text-2xl font-bold text-rose-600">￥{a.price}</span>
                        {a.original_price && <span className="text-sm text-slate-400 line-through">￥{a.original_price}</span>}
                        <span className="ml-auto text-xs text-slate-400">{fmtDateTime(a.start_at)} → {fmtDateTime(a.end_at)}</span>
                      </div>
                      {!a.product_name && a.description && <div className="text-xs text-slate-500 mb-2">{a.description}</div>}
                      <div className="mb-2">
                        <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                          <span>已抢</span><span>{a.sold}/{a.stock} · {pct.toFixed(0)}%</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-rose-400 to-orange-400 transition-all" style={{ width: `${Math.min(100,pct)}%` }} />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => handleCreateSeckillQr(a)}
                          className="flex-1 py-1.5 text-sm rounded-md bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:shadow-sm transition">
                          📱 生成活码
                        </button>
                        <button onClick={() => handleToggle(a)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-md hover:bg-slate-50">
                          {a.active === 1 ? '停用' : '启用'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ===== Orders Tab ===== */}
      {tab === 'orders' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          {/* Filter bar */}
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">状态</span>
              <select
                value={orderStatus}
                onChange={e => setOrderStatus(e.target.value)}
                className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white"
              >
                <option value="">全部</option>
                {Object.entries(STATUS_META).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            {list.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">活动</span>
                <select
                  value={selectedAct}
                  onChange={e => setSelectedAct(e.target.value ? Number(e.target.value) : '')}
                  className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white"
                >
                  <option value="">全部活动</option>
                  {list.map(a => <option key={a.id} value={a.id}>#{a.id} {a.title}</option>)}
                </select>
              </div>
            )}
            <button onClick={loadOrders} className="ml-auto text-xs text-emerald-600 font-medium hover:underline flex items-center gap-1">
              <i className="fa-solid fa-rotate-right" /> 刷新
            </button>
          </div>

          {/* Order list */}
          <div className="overflow-x-auto">
            {orders.length === 0 ? (
              <div className="py-12">
                <Empty icon="fa-solid fa-receipt" title="暂无抢单订单" description="模拟抢单或客户真实下单后会出现在这里" />
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs text-slate-500">
                    <th className="px-4 py-2 text-left font-medium">#ID</th>
                    <th className="px-4 py-2 text-left font-medium">活动</th>
                    <th className="px-4 py-2 text-left font-medium">客户</th>
                    <th className="px-4 py-2 text-right font-medium">金额</th>
                    <th className="px-4 py-2 text-left font-medium">抢单时间</th>
                    <th className="px-4 py-2 text-center font-medium">状态</th>
                    <th className="px-4 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.filter(o => !selectedAct || o.activity_id === selectedAct).map(o => {
                    const meta = STATUS_META[o.status] || STATUS_META.pending
                    const flows = STATUS_FLOW[o.status] || []
                    return (
                      <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">#{o.id}</td>
                        <td className="px-4 py-2.5 text-slate-800 font-medium">
                          <div className="truncate max-w-[180px]" title={o.activityTitle || `活动 #${o.activity_id}`}>
                            {o.activityTitle || `活动 #${o.activity_id}`}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="text-slate-800 font-medium">{o.customerName || `客户 #${o.customer_id}`}</div>
                          {o.phone && <div className="text-[11px] text-slate-400">{o.phone}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-rose-600">￥{o.price}</td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">{fmtDateTime(o.grab_at)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-medium border ${meta.cls}`}>{meta.label}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex gap-1">
                            {flows.map(f => (
                              <button
                                key={f.target}
                                onClick={() => handleStatusChange(o.id, f.target)}
                                className={`px-2 py-1 rounded text-[11px] text-white font-medium ${f.cls} transition`}
                              >
                                {f.label}
                              </button>
                            ))}
                            {flows.length === 0 && <span className="text-[11px] text-slate-300">—</span>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-4 py-3 border-t border-slate-100 text-[11px] text-slate-400">
            共 {orders.length} 条抢单记录，支持 pending → paid → refunded 状态流转
          </div>
        </div>
      )}

      {/* Create Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="新建秒杀活动" maxWidth="max-w-md">
        <div className="space-y-3">
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="活动标题，如：包裹卡 9.9 元抢小样"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} placeholder="活动描述（可选）"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.product_name} onChange={e => setForm({ ...form, product_name: e.target.value })} placeholder="商品名（如：美诺清透防晒乳 SPF50）"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            <input value={form.product_image} onChange={e => setForm({ ...form, product_image: e.target.value })} placeholder="商品图 URL（可选）"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input type="number" value={form.stock} onChange={e => setForm({ ...form, stock: Number(e.target.value) })} min={1} placeholder="库存"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            <input type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} placeholder="秒杀价"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            <input type="number" step="0.01" value={form.original_price} onChange={e => setForm({ ...form, original_price: Number(e.target.value) })} placeholder="原价"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="datetime-local" value={form.start_at} onChange={e => setForm({ ...form, start_at: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            <input type="datetime-local" value={form.end_at} onChange={e => setForm({ ...form, end_at: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setShowCreate(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">取消</button>
          <button onClick={handleCreate} className="px-4 py-2 bg-rose-500 text-white rounded-lg text-sm hover:bg-rose-600">创建</button>
        </div>
      </Modal>
    </div>
  )
}
