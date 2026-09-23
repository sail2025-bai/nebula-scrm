import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { MODE_META, type BizMode, type Coupon, type CouponIssue } from '../types'
import { useToast } from '../components/ui/Toast'
import Empty from '../components/ui/Empty'
import Modal from '../components/ui/Modal'

type CouponForm = {
  name: string
  type: Coupon['type']
  value: number
  min_order: number
  description: string
  total_stock: number
  start_at: string
  end_at: string
}

const COUPON_TYPES: { value: Coupon['type']; label: string; hint: string }[] = [
  { value: 'cash', label: '无门槛现金券', hint: '满减型，value 为立减金额' },
  { value: 'percent', label: '折扣券', hint: '百分比折扣，value 填 10~50' },
  { value: 'gift', label: '赠品券', hint: '视同固定金额抵扣' }
]

function formatDateTime(d?: string | null) {
  if (!d) return '—'
  return d.replace('T', ' ').slice(0, 16)
}

function toLocalInput(d: string) {
  return d.replace(' ', 'T').slice(0, 16)
}

function fmtCoupon(c: Coupon) {
  if (c.type === 'cash') return `￥${c.value}${c.min_order > 0 ? ` 满￥${c.min_order}` : ''}`
  if (c.type === 'percent') return `${c.value}% 折扣${c.min_order > 0 ? ` 满￥${c.min_order}` : ''}`
  return `${c.value}`
}

function normalizeChannel(ch: string | undefined | null): { label: string; emoji: string } {
  if (!ch) return { label: '手动核销', emoji: '📮' }
  if (ch.includes('商城') || ch.includes('微商城')) return { label: ch, emoji: '🛍️' }
  if (ch.includes('订单')) return { label: ch, emoji: '📦' }
  if (ch.includes('扫码')) return { label: ch, emoji: '📱' }
  if (ch.includes('sop') || ch.includes('SOP')) return { label: 'SOP 自动化', emoji: '⚙️' }
  return { label: ch, emoji: '🏷️' }
}

export default function CouponView({ mode }: { mode: BizMode }) {
  const toast = useToast()
  const [list, setList] = useState<Coupon[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [detail, setDetail] = useState<Coupon | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'out'>('all')
  const [qrModal, setQrModal] = useState<{ couponId: number; couponName: string; url: string; qrUrl: string } | null>(null)

  const defaultForm: CouponForm = useMemo(() => ({
    name: '', type: 'cash', value: 10, min_order: 50, description: '',
    total_stock: 100,
    start_at: toLocalInput(new Date().toISOString().slice(0, 10) + 'T00:00'),
    end_at: toLocalInput(new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10) + 'T23:59')
  }), [])

  const [form, setForm] = useState<CouponForm>(defaultForm)

  async function load() {
    setLoading(true)
    try {
      const arr = await api.getCoupons(mode)
      setList(arr)
    } catch (e: any) {
      toast.showToast(e.message || '加载失败', "warning")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [mode])

  const filtered = list.filter(c => {
    if (filter === 'active') return c.active === 1
    if (filter === 'paused') return c.active === 0
    if (filter === 'out') return c.issued_count >= c.total_stock
    return true
  })

  const totals = useMemo(() => ({
    count: list.length,
    totalStock: list.reduce((s, c) => s + c.total_stock, 0),
    totalIssued: list.reduce((s, c) => s + c.issued_count, 0),
    totalRedeemed: list.reduce((s, c) => s + c.redeemed_count, 0)
  }), [list])

  async function handleCreate() {
    if (!form.name.trim()) return toast.showToast('券名称必填', "warning")
    if (!form.value || form.value <= 0) return toast.showToast('面额必填', "warning")
    if (form.type === 'percent' && form.value > 100) return toast.showToast('折扣不能超过 100', "warning")
    try {
      await api.createCoupon({
        name: form.name.trim(), type: form.type, value: form.value,
        min_order: form.min_order, description: form.description,
        total_stock: form.total_stock, mode,
        start_at: form.start_at.replace('T', ' '), end_at: form.end_at.replace('T', ' ')
      })
      toast.showToast('券模板创建成功', "success")
      setShowCreate(false); setForm(defaultForm)
      load()
    } catch (e: any) { toast.showToast(e.message, "warning") }
  }

  async function handleToggle(c: Coupon) {
    try {
      await api.updateCoupon(c.id, { active: c.active === 1 ? 0 : 1 })
      toast.showToast(c.active === 1 ? '已停用' : '已启用', "success")
      load()
    } catch (e: any) { toast.showToast(e.message, "warning") }
  }

  async function handleDelete(id: number) {
    if (!confirm('确认删除券模板？历史发放记录保留不删。')) return
    try {
      await api.deleteCoupon(id)
      toast.showToast('已删除', "success")
      load()
    } catch (e: any) { toast.showToast(e.message, "warning") }
  }

  async function openDetail(id: number) {
    try {
      const c = await api.getCoupon(id)
      setDetail(c)
    } catch (e: any) { toast.showToast(e.message, "warning") }
  }

  async function handleIssueFromDetail() {
    if (!detail) return
    const customer_ids = prompt('临时发券：输入客户 ID 列表，逗号分隔（用于快速测试）')
    if (!customer_ids) return
    const ids = customer_ids.split(',').map(s => Number(s.trim())).filter(Boolean)
    if (!ids.length) return toast.showToast('至少一个客户 ID', "warning")
    try {
      const r = await api.issueCoupon({ coupon_id: detail.id, customer_ids: ids, source: 'manual' })
      toast.showToast(`发放成功：已发 ${r.issued}，跳过 ${r.skipped}（可能已领过）`, "success")
      openDetail(detail.id); load()
    } catch (e: any) { toast.showToast(e.message, "warning") }
  }

  // === 生成公开领券活码 ===
  async function handleCreateClaimQr(c: Coupon) {
    try {
      // 创建一个关联该券的活码
      const qr = await fetch('/api/qrcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `领券活码-${c.name}`,
          target_type: 'coupon',
          target_id: c.id,
          mode
        })
      }).then(r => r.json())
      if (!qr.id) throw new Error(qr.error || '活码创建失败')
      const publicUrl = `${window.location.origin}/p/coupon?qr=${qr.id}`
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(publicUrl)}`
      setQrModal({ couponId: c.id, couponName: c.name, url: publicUrl, qrUrl })
      toast.showToast('领券活码已生成！', 'success')
    } catch (e: any) { toast.showToast(e.message, 'warning') }
  }

  return (
    <div className="space-y-4">
      {/* 顶部统计卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="券模板数" value={totals.count} icon="fa-tags" color="emerald" />
        <StatCard label="总库存" value={totals.totalStock.toLocaleString()} icon="fa-box-archive" color="sky" />
        <StatCard label="已发放" value={totals.totalIssued.toLocaleString()} icon="fa-paper-plane" color="amber" />
        <StatCard label="已核销" value={totals.totalRedeemed.toLocaleString()} icon="fa-circle-check" color="rose" />
      </div>

      {/* 过滤 + 新建 */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex gap-1 bg-white rounded-lg p-1 border border-slate-200 shadow-sm">
          {(['all', 'active', 'paused', 'out'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm rounded-md transition ${filter === f ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
              {f === 'all' ? '全部' : f === 'active' ? '启用中' : f === 'paused' ? '已停用' : '已发完'}
            </button>
          ))}
        </div>
        <button onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-lg shadow-sm hover:shadow-md transition text-sm font-medium flex items-center gap-2">
          <i className="fa-solid fa-plus" /> 新建优惠券
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl p-12 text-center text-slate-400"><i className="fa-solid fa-spinner fa-spin text-2xl" /></div>
      ) : filtered.length === 0 ? (
        <Empty title="暂无优惠券模板" description="新建后可在 SOP 规则里引用 push_coupon 步骤，首购/流失挽回等场景直接给客户发券" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(c => {
            const usageRate = c.total_stock ? (c.issued_count / c.total_stock * 100) : 0
            const redemptionRate = c.issued_count ? (c.redeemed_count / c.issued_count * 100) : 0
            const out = c.issued_count >= c.total_stock
            return (
              <div key={c.id} onClick={() => openDetail(c.id)}
                className={`cursor-pointer bg-white rounded-xl border shadow-sm hover:shadow-lg transition overflow-hidden ${c.active === 0 ? 'opacity-60' : ''}`}>
                <div className="h-1.5 bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-400" />
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="text-xs text-slate-400 mb-1">#{c.id} · {MODE_META[c.mode].label}</div>
                      <div className="font-semibold text-slate-800">{c.name}</div>
                    </div>
                    <div className={`text-xs px-2 py-1 rounded-full ${out ? 'bg-rose-100 text-rose-600' : c.active === 1 ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}>
                      {out ? '已发完' : c.active === 1 ? '启用中' : '已停用'}
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-emerald-600 mb-3">{fmtCoupon(c)}</div>
                  <div className="text-xs text-slate-500 mb-3">有效期 {formatDateTime(c.start_at)} → {formatDateTime(c.end_at)}</div>
                  <div className="space-y-2">
                    <UsageBar label="发放进度" cur={c.issued_count} total={c.total_stock} rate={usageRate} color="emerald" />
                    <UsageBar label="核销转化" cur={c.redeemed_count} total={c.issued_count} rate={redemptionRate} color="rose" />
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button onClick={(e) => { e.stopPropagation(); handleCreateClaimQr(c) }}
                      className="flex-1 py-1.5 text-xs rounded-md bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:shadow-sm transition">
                      📱 生成领券活码
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={(e) => { e.stopPropagation(); handleToggle(c) }}
                      className="flex-1 py-1.5 text-xs rounded-md border border-slate-200 hover:bg-slate-50 transition">
                      {c.active === 1 ? '停用' : '启用'}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(c.id) }}
                      className="flex-1 py-1.5 text-xs rounded-md border border-rose-200 text-rose-500 hover:bg-rose-50 transition">
                      删除
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 新建 Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="新建优惠券" maxWidth="max-w-lg">
        <div className="space-y-3">
          <Field label="券名称" required>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="如：新人首单满50减10券"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-emerald-400 focus:outline-none" />
          </Field>
          <Field label="券类型">
            <div className="grid grid-cols-3 gap-2">
              {COUPON_TYPES.map(t => (
                <button key={t.value} type="button" onClick={() => setForm({ ...form, type: t.value })}
                  className={`p-2 rounded-lg border text-xs transition text-left ${form.type === t.value ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <div className="font-medium text-slate-800">{t.label}</div>
                  <div className="text-slate-400 text-[10px] mt-0.5 leading-tight">{t.hint}</div>
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={form.type === 'percent' ? '折扣(%)' : '面额(元)'} required>
              <input type="number" min={1} max={form.type === 'percent' ? 100 : 9999} value={form.value}
                onChange={e => setForm({ ...form, value: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </Field>
            <Field label="使用门槛(元)">
              <input type="number" min={0} value={form.min_order}
                onChange={e => setForm({ ...form, min_order: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </Field>
          </div>
          <Field label="总库存">
            <input type="number" min={1} value={form.total_stock}
              onChange={e => setForm({ ...form, total_stock: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="生效时间">
              <input type="datetime-local" value={form.start_at}
                onChange={e => setForm({ ...form, start_at: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </Field>
            <Field label="失效时间">
              <input type="datetime-local" value={form.end_at}
                onChange={e => setForm({ ...form, end_at: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </Field>
          </div>
          <Field label="描述（可选）">
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              rows={2} placeholder="如：包裹卡扫码专属福利"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setShowCreate(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">取消</button>
          <button onClick={handleCreate} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm shadow-sm hover:bg-emerald-600">创建</button>
        </div>
      </Modal>

      {/* 详情 Modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name || ''} maxWidth="max-w-xl">
        {detail && (
          <div className="space-y-4">
            <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl p-4 flex items-center gap-4">
              <div className="text-3xl font-bold text-emerald-600">{fmtCoupon(detail)}</div>
              <div className="text-xs text-slate-500 flex-1">{detail.description || fmtCoupon(detail)} · 有效期至 {formatDateTime(detail.end_at)}</div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <DetailStat label="总库存" value={detail.total_stock} />
              <DetailStat label="已发放" value={`${detail.issued_count} (${detail.total_stock ? (detail.issued_count / detail.total_stock * 100).toFixed(0) : 0}%)`} />
              <DetailStat label="已核销" value={`${detail.redeemed_count} (${detail.issued_count ? (detail.redeemed_count / detail.issued_count * 100).toFixed(0) : 0}%)`} />
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-2">最近发放实例（{detail.issues?.length || 0} 条）</div>
              {!detail.issues?.length ? (
                <div className="text-xs text-slate-400 bg-slate-50 rounded-lg p-4 text-center">暂无发放记录</div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {detail.issues.map((it: CouponIssue) => (
                    <div key={it.id} className="flex justify-between items-center text-xs bg-slate-50 rounded px-3 py-1.5">
                      <span className="font-mono text-slate-700">{it.code}</span>
                      <span className="text-slate-500">客户 #{it.customer_id} {it.sop_id ? `· SOP#${it.sop_id}` : ''}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${it.status === 'used' ? 'bg-rose-100 text-rose-600' : it.status === 'pending' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}>
                        {it.status === 'used' ? '已核销' : it.status === 'pending' ? '待使用' : it.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 核销渠道分布 + 最近核销记录 */}
            {detail.channelBreakdown && detail.channelBreakdown.length > 0 && (
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-500">
                    核销渠道分布 · 共 {detail.redeemed_count} 次核销
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {detail.channelBreakdown.map((b: any) => {
                    const { label, emoji } = normalizeChannel(b.channel)
                    const percent = detail.redeemed_count ? (b.count / detail.redeemed_count * 100).toFixed(0) : 0
                    return (
                      <div key={b.channel} className="bg-white rounded-lg px-3 py-2 border border-slate-200 min-w-[100px]">
                        <div className="text-lg">{emoji}</div>
                        <div className="text-xs font-medium text-slate-700 truncate max-w-[110px]">{label}</div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-base font-bold text-rose-500">{b.count}</span>
                          <span className="text-[10px] text-slate-400">{percent}%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="text-[10px] text-slate-400">
                  客户的券在这些渠道被使用后会自动核销并回流到 SCRM，运营后台实时看到转化数据
                </div>
              </div>
            )}

            {detail.recentRedemptions && detail.recentRedemptions.length > 0 && (
              <div>
                <div className="text-xs text-slate-500 mb-2">最近核销明细</div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {detail.recentRedemptions.slice(0, 10).map((r: any) => {
                    const { label, emoji } = normalizeChannel(r.redemption_channel)
                    return (
                      <div key={r.id} className="flex items-center justify-between text-xs bg-slate-50 rounded px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{emoji}</span>
                          <span className="text-slate-700">{r.customer_name} <span className="text-slate-400">({r.customer_code})</span></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-600 font-semibold">省￥{r.saved_amount}</span>
                          <span className="text-[10px] text-slate-400 px-1.5 py-0.5 bg-slate-200 rounded">{label}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={handleIssueFromDetail} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm shadow-sm hover:bg-emerald-600">手动发券</button>
              <button onClick={() => setDetail(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">关闭</button>
            </div>
          </div>
        )}
      </Modal>

      {/* 领券活码 Modal */}
      <Modal open={!!qrModal} onClose={() => setQrModal(null)} title="📱 领券活码（给客户用）" maxWidth="max-w-sm">
        {qrModal && (
          <div className="text-center space-y-4">
            <div className="text-sm text-slate-500">
              扫这个二维码即可领取：<br />
              <span className="font-bold text-slate-800">{qrModal.couponName}</span>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <img src={qrModal.qrUrl} alt="领券活码" className="w-48 h-48 mx-auto" />
            </div>
            <div className="bg-slate-100 rounded-lg p-2 text-xs font-mono text-slate-700 break-all">
              {qrModal.url}
            </div>
            <button
              onClick={() => { navigator.clipboard?.writeText(qrModal.url); toast.showToast('链接已复制', 'success') }}
              className="w-full py-2 bg-emerald-500 text-white rounded-lg text-sm"
            >
              复制领券链接
            </button>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              可打印在包裹卡、海报上，或直接分享给客户。<br />
              扫活码后自动识别/创建客户，领券到客户券包。
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">
        {label} {required && <span className="text-rose-400">*</span>}
      </label>
      {children}
    </div>
  )
}

function StatCard({ label, value, icon, color }: { label: string; value: number | string; icon: string; color: string }) {
  const colors: Record<string, string> = {
    emerald: 'from-emerald-400 to-teal-500',
    sky: 'from-sky-400 to-blue-500',
    amber: 'from-amber-400 to-orange-500',
    rose: 'from-rose-400 to-pink-500'
  }
  return (
    <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colors[color]} flex items-center justify-center text-white shadow-sm`}>
          <i className={`fa-solid ${icon} text-sm`} />
        </div>
        <div>
          <div className="text-xs text-slate-400">{label}</div>
          <div className="text-lg font-bold text-slate-800">{value}</div>
        </div>
      </div>
    </div>
  )
}

function UsageBar({ label, cur, total, rate, color }: { label: string; cur: number; total: number; rate: number; color: string }) {
  const colors: Record<string, string> = { emerald: 'bg-emerald-500', rose: 'bg-rose-500' }
  return (
    <div>
      <div className="flex justify-between text-[11px] text-slate-500 mb-1">
        <span>{label}</span><span>{cur}/{total} · {rate.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${colors[color]} transition-all`} style={{ width: `${Math.min(100, rate)}%` }} />
      </div>
    </div>
  )
}

function DetailStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3 text-center">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-base font-bold text-slate-800 mt-0.5">{value}</div>
    </div>
  )
}
