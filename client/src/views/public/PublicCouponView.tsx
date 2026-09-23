import { useState, useEffect } from 'react'

interface Props {
  qrCodeId: string | null
  navigate: (page: string, extra?: Record<string, string>) => void
}

interface ScanResult {
  ok: boolean
  customer: { id: number; code: string; name: string; wechat_nick: string }
  target: { type: string; data: any } | null
}

interface ClaimResult {
  ok: boolean
  issue: { id: number; code: string; coupon_name: string; coupon_type: string; value: number; min_order: number; expires_at: string }
}


function couponTypeLabel(type: string) {
  if (type === 'cash') return '立减'
  if (type === 'percent') return '折'
  return '礼品券'
}
export default function PublicCouponView({ qrCodeId, navigate }: Props) {
  const [step, setStep] = useState<'form' | 'claiming' | 'success' | 'error'>('form')
  const [form, setForm] = useState({ name: '', phone: '', wechat_nick: '' })
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null)
  const [error, setError] = useState('')

  const hasQr = !!qrCodeId


  const couponValueText = (coupon: any) => {
    if (coupon.type === 'cash') return `￥${coupon.value}`
    if (coupon.type === 'percent') return `${coupon.value}%OFF`
    return `￥${coupon.value} 等值礼品`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hasQr) {
      setError('无效的活码链接')
      setStep('error')
      return
    }
    if (!form.name.trim()) {
      setError('请填写您的姓名/昵称')
      return
    }

    setStep('claiming')
    setError('')

    try {
      // 1. 扫活码入客户
      const scanRes = await fetch('/api/public/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_code_id: Number(qrCodeId), ...form })
      })
      const scanData: ScanResult = await scanRes.json()
      if (!scanData.ok) throw new Error(scanRes.statusText)
      setScanResult(scanData)

      // 2. 如果活码关联了 coupon，自动领券
      if (scanData.target?.type === 'coupon') {
        const claimRes = await fetch('/api/public/coupons/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qr_code_id: Number(qrCodeId), customer_code: scanData.customer.code })
        })
        const claimData = await claimRes.json()
        if (!claimRes.ok && claimRes.status !== 409) throw new Error(claimData.error || '领券失败')
        if (claimRes.ok) setClaimResult(claimData)
        // 409 = 已领过，也算成功（避免重复提示）
      }

      setStep('success')
    } catch (err: any) {
      setError(err.message || '操作失败，请重试')
      setStep('error')
    }
  }

  // === 渲染 ===
  if (step === 'success' && scanResult) {
    const coupon = scanResult.target?.data
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white text-4xl">
            🎉
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">
            {claimResult ? '领券成功！' : '您已领取过这张券'}
          </h2>
          <p className="text-slate-500 mb-6">欢迎您，{scanResult.customer.name}</p>

          {coupon && (
            <div className="bg-gradient-to-br from-orange-500 to-rose-500 rounded-2xl p-5 text-white mb-6">
              <div className="text-sm opacity-90 mb-1">{coupon.name}</div>
              <div className="text-4xl font-bold my-2">
                {coupon.type === 'cash' ? '￥' : ''}{coupon.value}
                <span className="text-lg ml-1">{couponTypeLabel(coupon.type)}</span>
              </div>
              {coupon.min_order > 0 && <div className="text-xs opacity-80">满￥{coupon.min_order}可用</div>}
              {coupon.description && <div className="text-xs opacity-70 mt-2">{coupon.description}</div>}
            </div>
          )}

          {claimResult && (
            <div className="bg-slate-50 rounded-xl p-4 mb-6">
              <div className="text-xs text-slate-400 mb-1">您的专属券码</div>
              <div className="text-2xl font-mono font-bold text-slate-800 tracking-widest">{claimResult.issue.code}</div>
              <div className="text-xs text-slate-400 mt-1">有效期至 {claimResult.issue.expires_at?.slice(0, 10)}</div>
            </div>
          )}

          <button
            onClick={() => navigate('my-coupons', { code: scanResult.customer.code })}
            className="w-full py-3 bg-slate-800 text-white rounded-xl font-medium hover:bg-slate-900 transition"
          >
            查看我的全部券包 →
          </button>
        </div>
      </div>
    )
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 text-center">
          <div className="text-5xl mb-4">😢</div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">领券失败</h2>
          <p className="text-slate-500 mb-6">{error}</p>
          <button onClick={() => { setStep('form'); setError('') }} className="px-6 py-2 bg-orange-500 text-white rounded-xl">
            重新尝试
          </button>
        </div>
      </div>
    )
  }

  // 表单页
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* 顶部品牌区 */}
        <div className="text-center mb-6">
          <div className="inline-block px-4 py-1 bg-orange-100 text-orange-600 text-xs rounded-full font-medium mb-2">
            🎁 包裹卡专属福利
          </div>
          <h1 className="text-3xl font-bold text-slate-800">扫码领券</h1>
          <p className="text-slate-500 text-sm mt-2">填写信息立即领取专属优惠券</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl p-6">
          {/* 活动预览（如果能拿到活码关联的券信息） */}
          {hasQr && (
            <ActivityPreview qrCodeId={Number(qrCodeId)} onCouponLoad={(c) => {
              if (c && !scanResult) {
                // 预先显示券信息
              }
            }} />
          )}

          <form onSubmit={handleSubmit} className="space-y-4 mt-6">
            <div>
              <label className="block text-sm text-slate-600 mb-1">姓名/昵称 *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="请输入您的姓名或昵称"
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">手机号</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="用于关联您的专属权益"
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">企微昵称</label>
              <input
                type="text"
                value={form.wechat_nick}
                onChange={(e) => setForm({ ...form, wechat_nick: e.target.value })}
                placeholder="方便顾问后续为您服务"
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none"
              />
            </div>

            {error && (
              <div className="p-3 bg-rose-50 text-rose-600 text-sm rounded-xl">{error}</div>
            )}

            <button
              type="submit"
              disabled={step === 'claiming'}
              className="w-full py-4 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl font-bold text-lg hover:shadow-lg transition disabled:opacity-50"
            >
              {step === 'claiming' ? '领券中...' : '立即领取 →'}
            </button>
          </form>

          <p className="text-xs text-slate-400 text-center mt-6">
            提交即表示您同意我们为您提供专属服务，信息仅用于客户关系管理
          </p>
        </div>
      </div>
    </div>
  )
}

// 子组件：预加载活码关联的券信息（用于在表单页顶部展示）
function ActivityPreview({ qrCodeId, onCouponLoad }: { qrCodeId: number; onCouponLoad: (c: any) => void }) {
  const [coupon, setCoupon] = useState<any>(null)

  useEffect(() => {
    // 通过扫活码预览（不真正入库），用 HEAD 请求不行，直接用 GET qrcodes 接口拿 target
    fetch(`/api/qrcodes/${qrCodeId}`)
      .then((r) => r.json())
      .then((qr) => {
        if (qr.target_type === 'coupon' && qr.target_id) {
          fetch(`/api/coupons/${qr.target_id}`)
            .then((r) => r.json())
            .then((c) => { setCoupon(c); onCouponLoad(c) })
        }
      })
      .catch(() => {})
  }, [qrCodeId])

  if (!coupon) return null

  return (
    <div className="bg-gradient-to-br from-orange-500 to-rose-500 rounded-2xl p-5 text-white">
      <div className="text-xs opacity-90 mb-1">🎁 专属福利</div>
      <div className="text-xl font-bold mb-1">{coupon.name}</div>
      <div className="text-3xl font-bold">
        {coupon.type === 'cash' ? '￥' : ''}{coupon.value}
        <span className="text-base ml-1">{couponTypeLabel(coupon.type)}</span>
      </div>
      {coupon.min_order > 0 && <div className="text-xs opacity-80 mt-1">满￥{coupon.min_order}可用</div>}
    </div>
  )
}
