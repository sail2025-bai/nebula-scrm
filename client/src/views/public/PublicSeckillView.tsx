import { useState, useEffect, useRef } from 'react'
import StaffTrustCard from './shared/StaffTrustCard'

interface Props {
  qrCodeId: string | null
  customerCode: string | null
  navigate: (page: string, extra?: Record<string, string>) => void
}

interface SeckillActivity {
  id: number
  title: string
  description?: string
  product_name?: string
  product_image?: string | null
  stock: number
  sold: number
  price: number
  original_price: number | null
  start_at: string
  end_at: string
}

interface ScanResult {
  ok: boolean
  customer: { id: number; code: string; name: string }
  target: { type: string; data: any } | null
}

interface GrabResult {
  ok: boolean
  order_no?: string
  coupon_code?: string
}

// ============ 倒计时组件 ============
function Countdown({ target, onTick }: { target: Date; onTick?: () => void }) {
  const [now, setNow] = useState(() => new Date())
  const rafRef = useRef<number>()

  useEffect(() => {
    let stopped = false
    const tick = () => {
      if (stopped) return
      setNow(new Date())
      onTick?.()
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { stopped = true; if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [onTick])

  const diff = Math.max(0, target.getTime() - now.getTime())
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  const expired = diff === 0

  if (expired) return null

  const Box = ({ v, label }: { v: number; label: string }) => (
    <div className="flex flex-col items-center">
      <div className="bg-gradient-to-br from-slate-900 to-amber-900 text-amber-100 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 text-xl sm:text-3xl font-display font-bold tabular-nums min-w-[44px] sm:min-w-[56px] leading-none shadow-md">
        {String(v).padStart(2, '0')}
      </div>
      <div className="text-[9px] sm:text-[10px] text-amber-700/70 font-semibold mt-1 tracking-wider">{label}</div>
    </div>
  )

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      {d > 0 && <Box v={d} label="天" />}
      <Box v={h} label="时" />
      <Box v={m} label="分" />
      <Box v={s} label="秒" />
    </div>
  )
}

// ============ 秒杀 Hero ============
function SeckillHero({ act, imgOk, setImgOk }: { act: SeckillActivity; imgOk: boolean; setImgOk: (v: boolean) => void }) {
  const sold = act.sold ?? 0
  const stock = act.stock ?? 0
  const left = Math.max(0, stock - sold)
  const urgent = left < stock * 0.3

  return (
    <div className="animate-pop-in card-gold rounded-2xl overflow-hidden mb-5 relative" style={{ animationDelay: '0.1s' }}>
      {/* 顶部闪电条 */}
      <div className="bg-gradient-to-r from-rose-500 via-orange-500 to-amber-500 text-white text-[10px] sm:text-xs font-bold px-3 py-1.5 flex items-center gap-1.5 justify-center tracking-wider">
        <span className="text-base">⚡</span>
        限时秒杀 · 售完即止
        <span className="text-base">⚡</span>
      </div>

      <div className="p-3 sm:p-4 flex gap-3 sm:gap-4 items-center">
        {/* 左：商品图 */}
        <div className="relative shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-gradient-to-br from-amber-50 to-rose-50 border border-amber-200/50 shadow-sm">
          {act.product_image && imgOk ? (
            <img src={act.product_image} alt="" onError={() => setImgOk(false)}
              className="w-full h-full object-contain p-2" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-3xl sm:text-4xl text-amber-300">
              <i className="fa-solid fa-bolt" />
            </div>
          )}
        </div>

        {/* 右：价格 + 标题 */}
        <div className="flex-1 min-w-0">
          <div className="font-bold text-slate-800 text-sm sm:text-base leading-tight line-clamp-2">{act.product_name || act.title}</div>
          {act.description && <div className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 line-clamp-1">{act.description}</div>}

          <div className="mt-1.5 flex items-baseline gap-2 sm:gap-3">
            <span className="text-rose-600 font-display text-3xl sm:text-4xl font-bold leading-none">
              <span className="text-base sm:text-xl mr-0.5">￥</span>{act.price}
            </span>
            {act.original_price && act.original_price > act.price && (
              <span className="text-slate-400 text-[11px] sm:text-xs line-through">￥{act.original_price}</span>
            )}
            {act.original_price && act.original_price > act.price && (
              <span className="text-[10px] sm:text-xs px-1.5 py-0.5 bg-rose-100 text-rose-600 rounded font-semibold">
                -{Math.round((1 - act.price / act.original_price) * 100)}%
              </span>
            )}
          </div>

          {/* 紧张度 */}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-700 ${urgent ? 'bg-gradient-to-r from-rose-500 to-amber-500' : 'bg-gradient-to-r from-rose-400 to-orange-400'}`}
                style={{ width: `${stock > 0 ? (sold / stock) * 100 : 0}%` }} />
            </div>
            <span className={`text-[10px] font-semibold whitespace-nowrap ${urgent ? 'text-rose-600' : 'text-orange-600'}`}>
              {urgent ? `仅剩 ${left} 件` : `已抢 ${sold}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============ 主组件 ============
export default function PublicSeckillView({ qrCodeId, customerCode, navigate }: Props) {
  const [activity, setActivity] = useState<SeckillActivity | null>(null)
  const [imgOk, setImgOk] = useState(true)
  const [grabState, setGrabState] = useState<'idle' | 'grabbing' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(customerCode)
  const [customerName, setCustomerName] = useState('')
  const [scanRes, setScanRes] = useState<ScanResult | null>(null)
  const [grabRes, setGrabRes] = useState<GrabResult | null>(null)
  const [form, setForm] = useState({ name: '', phone: '', wechat_nick: '' })
  const hasQr = !!qrCodeId
  const qrNum = qrCodeId ? Number(qrCodeId) : null

  // 1. 预加载秒杀活动（公开端点）
  useEffect(() => {
    if (!qrNum) return
    ;(async () => {
      try {
        const qr = await fetch(`/api/public/qrcodes/${qrNum}/landing-url`).then(r => r.json())
        if (qr.target_type === 'seckill' && qr.target_id) {
          const act = await fetch(`/api/public/seckill/${qr.target_id}`).then(r => r.json())
          if (act.ok) setActivity(act)
          else setError('秒杀活动不存在或已结束')
        } else {
          setError('该活码未关联秒杀活动')
        }
      } catch { setError('活动加载失败') }
    })()
  }, [qrNum])

  const isStarted = activity ? new Date(activity.start_at) <= new Date() : false
  const isEnded = activity ? new Date(activity.end_at) <= new Date() : false
  const soldOut = activity ? (activity.stock - activity.sold) <= 0 : false

  // 2. 抢购 → 先 scan 创建 customer（如果还没有），再 grab
  const handleGrab = async () => {
    if (!activity || !hasQr) return
    if (!isStarted || isEnded || soldOut) return

    setGrabState('grabbing'); setError('')
    try {
      let custCode = customerId
      if (!custCode) {
        // 没 customerCode → 先创建 customer
        if (!form.name.trim()) { setError('请填写您的姓名'); setGrabState('idle'); return }
        const scanRes = await fetch('/api/public/scan', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qr_code_id: qrNum, ...form })
        }).then(r => r.json())
        if (!scanRes.ok) throw new Error('客户创建失败')
        custCode = scanRes.customer.code
        setScanRes(scanRes)
        setCustomerId(custCode)
        setCustomerName(scanRes.customer.name)
      }

      const grab = await fetch(`/api/public/seckill/grab`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_code_id: qrNum, seckill_id: activity.id, customer_code: custCode })
      }).then(r => r.json())
      if (!grab.ok) throw new Error(grab.error || '抢单失败')
      setGrabRes(grab)
      setGrabState('success')
    } catch (err: any) {
      setError(err.message || '操作失败')
      setGrabState('error')
    }
  }

  // ======= 渲染 =======
  if (!activity) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 relative z-10">
        <div className="card-gold rounded-2xl p-8 text-center max-w-sm">
          {error ? (
            <>
              <div className="text-4xl mb-3">😢</div>
              <h2 className="font-display text-xl font-bold text-slate-800 mb-1">加载失败</h2>
              <p className="text-sm text-slate-500">{error}</p>
            </>
          ) : (
            <>
              <div className="text-3xl mb-3 animate-pulse">⏳</div>
              <p className="text-slate-500 text-sm">加载中…</p>
            </>
          )}
        </div>
      </div>
    )
  }

  const startTime = new Date(activity.start_at)
  const endTime = new Date(activity.end_at)
  const target = !isStarted ? startTime : endTime

  return (
    <div className="min-h-screen flex items-start justify-center py-4 sm:py-6 px-3 sm:px-4 relative z-10">
      <div className="w-full max-w-md">
        {/* Hero 徽章 */}
        <div className="text-center mb-3 sm:mb-4 animate-fade-rise">
          <div className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 bg-gradient-to-r from-rose-100 via-amber-50 to-orange-50 border border-rose-300/60 rounded-full text-[10px] sm:text-[11px] text-rose-700 font-semibold shadow-sm">
            <span>⚡</span>
            限时秒杀 · 仅今日有效
            <span>⚡</span>
          </div>
        </div>

        {/* 秒杀 Hero */}
        <SeckillHero act={activity} imgOk={imgOk} setImgOk={setImgOk} />

        {/* 倒计时 */}
        {!isStarted && (
          <div className="animate-fade-rise card-gold rounded-2xl p-4 mb-4 text-center" style={{ animationDelay: '0.2s' }}>
            <div className="text-[11px] sm:text-xs text-amber-700 font-semibold mb-2 tracking-wider">
              <i className="fa-regular fa-clock mr-1" />距离开抢
            </div>
            <Countdown target={target} />
            <button disabled className="w-full mt-3 py-3 bg-slate-200 text-slate-500 rounded-xl font-bold text-sm">
              ⏰ 活动未开始
            </button>
          </div>
        )}

        {isEnded && (
          <div className="animate-fade-rise card-gold rounded-2xl p-6 mb-4 text-center" style={{ animationDelay: '0.2s' }}>
            <div className="text-4xl mb-2">🏁</div>
            <div className="font-display text-xl font-bold text-slate-800 mb-1">活动已结束</div>
            <p className="text-sm text-slate-500">感谢您的关注，下次活动再见~</p>
          </div>
        )}

        {isStarted && !isEnded && !soldOut && grabState !== 'success' && (
          <>
            {/* 如果没 customerCode，先填信息 */}
            {!customerId && (
              <form onSubmit={(e) => { e.preventDefault(); handleGrab() }} className="animate-fade-rise bg-white/80 backdrop-blur-md rounded-2xl border border-white shadow-xl shadow-amber-900/5 p-4 sm:p-5 space-y-2.5 sm:space-y-3 mb-4" style={{ animationDelay: '0.25s' }}>
                <div className="text-[11px] sm:text-xs text-slate-500 text-center">填写信息，1 秒参与秒杀</div>
                <div className="animate-fade-rise" style={{ animationDelay: '0.28s' }}>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">姓名 *</label>
                  <div className="field-glow flex items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <i className="fa-solid fa-user text-amber-500 text-xs w-4 text-center" />
                    <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="方便顾问联系您"
                      className="flex-1 bg-transparent outline-none text-sm text-slate-800 placeholder:text-slate-300" />
                  </div>
                </div>
                <div className="animate-fade-rise" style={{ animationDelay: '0.32s' }}>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">手机号</label>
                  <div className="field-glow flex items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <i className="fa-solid fa-phone text-amber-500 text-xs w-4 text-center" />
                    <input type="text" value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="用于下单到账提醒"
                      className="flex-1 bg-transparent outline-none text-sm text-slate-800 placeholder:text-slate-300" />
                  </div>
                </div>

                {error && (
                  <div className="animate-fade-rise p-2.5 bg-rose-50 border border-rose-200/70 text-rose-600 text-xs rounded-lg flex items-center gap-2">
                    <i className="fa-solid fa-circle-exclamation text-rose-400" />{error}
                  </div>
                )}

                <button type="submit" disabled={grabState === 'grabbing'}
                  className="btn-cta w-full py-3 sm:py-3.5 bg-gradient-to-r from-rose-500 via-orange-500 to-amber-500 text-white rounded-xl font-bold text-sm sm:text-base hover:shadow-lg hover:shadow-rose-500/30 active:scale-[0.98] transition disabled:opacity-60">
                  {grabState === 'grabbing' ? (
                    <span className="flex items-center justify-center gap-2"><i className="fa-solid fa-circle-notch fa-spin" />抢单中…</span>
                  ) : (
                    <span className="flex items-center justify-center gap-2"><i className="fa-solid fa-bolt" />立即秒杀</span>
                  )}
                </button>
              </form>
            )}

            {/* 已有 customerCode → 直接抢 */}
            {customerId && (
              <div className="animate-fade-rise mb-4" style={{ animationDelay: '0.25s' }}>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3 flex items-center gap-2 text-xs text-emerald-700">
                  <i className="fa-solid fa-check-circle text-emerald-500" />
                  您已登录：<span className="font-semibold">{customerName}</span>
                </div>
                <button onClick={handleGrab} disabled={grabState === 'grabbing'}
                  className="btn-cta w-full py-3.5 sm:py-4 bg-gradient-to-r from-rose-500 via-orange-500 to-amber-500 text-white rounded-xl font-bold text-base sm:text-lg hover:shadow-xl hover:shadow-rose-500/40 active:scale-[0.98] transition disabled:opacity-60">
                  {grabState === 'grabbing' ? (
                    <span className="flex items-center justify-center gap-2"><i className="fa-solid fa-circle-notch fa-spin" />抢单中…</span>
                  ) : (
                    <span className="flex items-center justify-center gap-2"><i className="fa-solid fa-bolt" />立即秒杀 ￥{activity.price}</span>
                  )}
                </button>
              </div>
            )}
          </>
        )}

        {/* 已抢光 */}
        {soldOut && grabState !== 'success' && (
          <div className="animate-fade-rise card-gold rounded-2xl p-6 mb-4 text-center" style={{ animationDelay: '0.2s' }}>
            <div className="text-5xl mb-3">🏃</div>
            <h2 className="font-display text-xl font-bold text-slate-800 mb-1">已抢光啦</h2>
            <p className="text-sm text-slate-500">下次活动记得更早来~</p>
          </div>
        )}

        {/* 抢单成功 */}
        {grabState === 'success' && (
          <div className="animate-pop-in card-gold rounded-2xl p-6 mb-4 text-center" style={{ animationDelay: '0.15s' }}>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 shadow-xl shadow-emerald-500/30 mb-4 animate-float">
              <i className="fa-solid fa-party-horn text-white text-2xl" />
            </div>
            <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 mb-1">恭喜抢单成功！</h2>
            {(scanRes?.customer.name || customerName) && (
              <p className="text-sm text-slate-500 mb-4">
                欢迎您，<span className="font-semibold text-slate-700">{scanRes?.customer.name || customerName}</span>
              </p>
            )}
            {grabRes?.order_no && (
              <div className="bg-amber-50 border border-amber-200/70 rounded-xl p-3 mb-3">
                <div className="text-[10px] text-amber-700 font-semibold tracking-wider mb-1">订单编号</div>
                <div className="font-mono font-bold text-amber-700 text-sm tracking-wider">{grabRes.order_no}</div>
              </div>
            )}
            <p className="text-xs text-slate-400 mb-4">顾问稍后会与您联系确认订单</p>
            <button onClick={() => navigate('my-coupons')}
              className="btn-cta w-full py-3 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white rounded-xl font-bold text-sm hover:shadow-lg">
              <i className="fa-solid fa-ticket mr-2" />查看我的券包
            </button>
          </div>
        )}

        {/* 顾问信任卡（hybrid 模式） */}
        {qrNum !== null && <StaffTrustCard qrCodeId={qrNum} />}
      </div>
    </div>
  )
}
