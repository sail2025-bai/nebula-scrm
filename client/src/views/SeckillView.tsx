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

type Form = {
  title: string; description: string; stock: number; price: number; original_price: number;
  start_at: string; end_at: string; product_name: string; product_image: string
}
export default function SeckillView({ mode }: { mode: BizMode }) {
  const toast = useToast()
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

  async function load() { try { setList(await api.getSeckills()) } catch(e:any){ toast.showToast(e.message, "warning") } }
  useEffect(() => { load() }, [])

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

  async function handleGrab(id: number) {
    const cid = Number(prompt('模拟抢单：输入客户 ID'))
    if (!cid) return
    try {
      const r = await api.grabSeckill(id, cid)
      toast.showToast(`抢购成功！￥${r.price} · 已生成订单占位`, "success")
      load()
    } catch(e:any){ toast.showToast(e.message, "warning") }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <div className="text-slate-400 text-sm">{MODE_META[mode].label} · 限时秒杀 / 福利抢单</div>
          <div className="text-lg font-semibold text-slate-800">限时秒杀活动管理</div>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-gradient-to-r from-rose-500 to-orange-500 text-white rounded-lg shadow-sm text-sm font-medium flex items-center gap-2">
          <i className="fa-solid fa-bolt" /> 新建秒杀活动
        </button>
      </div>

      {list.length === 0 ? (
        <Empty title="暂无秒杀活动" description="秒杀用于包裹卡福利、老客专属、社群裂变等场景，支持事务防超卖" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {list.map(a => {
            const pct = a.stock ? a.sold / a.stock * 100 : 0
            const gone = a.sold >= a.stock
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
                  {/* 商品信息 */}
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
                    <button onClick={() => handleGrab(a.id)} disabled={gone || a.active === 0}
                      className="flex-1 py-1.5 text-sm bg-rose-500 text-white rounded-md hover:bg-rose-600 disabled:bg-slate-300 disabled:cursor-not-allowed transition">
                      {gone ? '已抢光' : '模拟抢单'}
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
