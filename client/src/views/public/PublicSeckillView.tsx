import { useState, useEffect } from 'react'

interface Props {
  qrCodeId: string | null
  customerCode: string | null
  navigate: (page: string, extra?: Record<string, string>) => void
}

interface SeckillActivity {
  id: number
  title: string
  description: string
  stock: number
  sold: number
  price: number
  original_price: number | null
  start_at: string
  end_at: string
  active: number
}

export default function PublicSeckillView({ qrCodeId, customerCode, navigate }: Props) {
  const [activity, setActivity] = useState<SeckillActivity | null>(null)
  const [loading, setLoading] = useState(true)
  const [grabState, setGrabState] = useState<'idle' | 'grabbing' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(customerCode)
  const [countdown, setCountdown] = useState<{ days: number; hours: number; mins: number; secs: number } | null>(null)
  const [isStarted, setIsStarted] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '' })

  // 预加载秒杀活动（通过活码 target 关联）
  useEffect(() => {
    if (!qrCodeId) {
      setError('无效的活码链接')
      setLoading(false)
      return
    }
    const loadQr = async () => {
      try {
        const qrRes = await fetch(`/api/qrcodes/${qrCodeId}`)
        const qr = await qrRes.json()
        if (qr.target_type === 'seckill' && qr.target_id) {
          const secRes = await fetch(`/api/seckill/${qr.target_id}`)
          const act = await secRes.json()
          setActivity(act)
        } else {
          setError('该活码未关联秒杀活动')
        }
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    loadQr()
  }, [qrCodeId])

  // 倒计时逻辑
  useEffect(() => {
    if (!activity) return
    const tick = () => {
      const now = Date.now()
      const start = new Date(activity.start_at.replace(' ', 'T')).getTime()
      const end = new Date(activity.end_at.replace(' ', 'T')).getTime()

      if (now < start) {
        setIsStarted(false)
        const diff = start - now
        setCountdown({
          days: Math.floor(diff / 86400000),
          hours: Math.floor((diff % 86400000) / 3600000),
          mins: Math.floor((diff % 3600000) / 60000),
          secs: Math.floor((diff % 60000) / 1000)
        })
      } else if (now < end) {
        setIsStarted(true)
        const diff = end - now
        setCountdown({
          days: 0,
          hours: Math.floor(diff / 3600000),
          mins: Math.floor((diff % 3600000) / 60000),
          secs: Math.floor((diff % 60000) / 1000)
        })
      } else {
        setIsStarted(false)
        setCountdown(null)
      }
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [activity])

  // 如果客户还没扫码入，先让填信息
  const handleScan = async () => {
    if (!form.name.trim()) {
      setError('请填写姓名')
      return
    }
    if (!qrCodeId) return
    try {
      setLoading(true)
      const res = await fetch('/api/public/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_code_id: Number(qrCodeId), ...form })
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      setCustomerId(data.customer.code)
      navigate('seckill', { qr: qrCodeId, code: data.customer.code })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleGrab = async () => {
    if (!activity || !customerId) return
    setGrabState('grabbing')
    setError('')
    try {
      const res = await fetch(`/api/public/seckill/${activity.id}/grab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_code: customerId })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '抢单失败')
      setGrabState('success')
    } catch (e: any) {
      setError(e.message)
      setGrabState('error')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-400">加载中...</div>
      </div>
    )
  }

  if (error && !activity) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-5xl mb-4">😢</div>
          <p className="text-slate-600">{error}</p>
        </div>
      </div>
    )
  }

  if (!activity) return null

  const remaining = activity.stock - activity.sold
  const soldOut = remaining <= 0

  // === 渲染 ===
  return (
    <div className="min-h-screen p-4 pb-20">
      <div className="max-w-md mx-auto pt-6">
        {/* 头部倒计时区 */}
        <div className="bg-gradient-to-br from-rose-500 via-red-500 to-orange-500 rounded-3xl p-6 text-white text-center shadow-xl mb-6">
          <div className="text-xs opacity-90 mb-1">⚡ 限时秒杀</div>
          <h1 className="text-2xl font-bold mb-4">{activity.title}</h1>

          {/* 倒计时 */}
          {countdown && (
            <div className="flex justify-center gap-2 mb-3">
              {countdown.days > 0 && (
                <TimeBox label="天" value={countdown.days} />
              )}
              <TimeBox label="时" value={countdown.hours} />
              <TimeBox label="分" value={countdown.mins} />
              <TimeBox label="秒" value={countdown.secs} />
            </div>
          )}
          {!countdown && <div className="text-xl opacity-80">活动已结束</div>}

          {/* 状态 */}
          <div className="text-xs opacity-90 mt-2">
            {isStarted ? '🔥 正在进行中' : remaining > 0 ? '⏰ 活动未开始' : '已结束'}
          </div>
        </div>

        {/* 商品信息 */}
        <div className="bg-white rounded-2xl p-6 shadow-sm mb-6">
          <div className="flex items-end gap-2 mb-2">
            <div className="text-4xl font-bold text-rose-500">￥{activity.price}</div>
            {activity.original_price && (
              <div className="text-slate-400 line-through mb-1">￥{activity.original_price}</div>
            )}
          </div>
          {activity.description && <p className="text-slate-600 text-sm">{activity.description}</p>}

          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
            <div className="text-sm text-slate-500">
              剩余 <span className="font-bold text-rose-500">{remaining}</span> / {activity.stock} 件
            </div>
            <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-rose-500 to-orange-500"
                style={{ width: `${(activity.sold / activity.stock) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* 如果还没扫活码入客户：先填信息 */}
        {!customerId && (
          <div className="bg-white rounded-2xl p-6 shadow-sm mb-6">
            <div className="text-sm text-slate-600 mb-3">请先填写信息（扫活码自动关联）</div>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="姓名"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl"
              />
              <input
                type="tel"
                placeholder="手机号"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl"
              />
              {error && <div className="text-xs text-rose-500">{error}</div>}
              <button
                onClick={handleScan}
                className="w-full py-3 bg-slate-800 text-white rounded-xl font-medium"
              >
                进入抢单 →
              </button>
            </div>
          </div>
        )}

        {/* 抢单按钮 */}
        {customerId && !soldOut && grabState !== 'success' && (
          <button
            onClick={handleGrab}
            disabled={!isStarted || grabState === 'grabbing'}
            className={`w-full py-5 rounded-2xl font-bold text-lg shadow-lg transition ${
              isStarted && grabState !== 'grabbing'
                ? 'bg-gradient-to-r from-rose-500 to-orange-500 text-white hover:shadow-xl active:scale-95'
                : 'bg-slate-200 text-slate-500 cursor-not-allowed'
            }`}
          >
            {grabState === 'grabbing' ? '抢单中...' : !isStarted ? '⏰ 活动未开始' : '⚡ 立即抢单'}
          </button>
        )}

        {soldOut && customerId && (
          <div className="text-center py-8 bg-white rounded-2xl">
            <div className="text-5xl mb-3">🏃</div>
            <p className="text-slate-500">已抢光啦，下次再来~</p>
          </div>
        )}

        {/* 抢单成功 */}
        {grabState === 'success' && (
          <div className="text-center py-8 bg-white rounded-2xl">
            <div className="text-5xl mb-3">🎉</div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">抢单成功！</h3>
            <p className="text-slate-500 mb-6">顾问稍后会与您联系确认订单</p>
            <button
              onClick={() => navigate('my-coupons')}
              className="px-6 py-3 bg-slate-800 text-white rounded-xl"
            >
              查看我的券包
            </button>
          </div>
        )}

        {grabState === 'error' && error && (
          <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-center">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

function TimeBox({ label, value }: { label: string; value: number }) {
  const padded = String(value).padStart(2, '0')
  return (
    <div className="bg-white/20 rounded-lg px-2 py-1 min-w-[48px]">
      <div className="text-xl font-bold">{padded}</div>
      <div className="text-[10px] opacity-80">{label}</div>
    </div>
  )
}
