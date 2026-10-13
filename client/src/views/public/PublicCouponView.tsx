import { useState, useEffect } from 'react'
import StaffTrustCard from './shared/StaffTrustCard'

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

interface StaffInfo { id: number; name: string; role: string; wecom_userid: string | null; avatar_url?: string | null }
interface CouponData {
  id: number; name: string; type: string; value: number; min_order: number
  description?: string; total_stock?: number; issued_count?: number; image_url?: string | null
}

function couponTypeLabel(type: string) {
  if (type === 'cash') return '元 立减'
  if (type === 'percent') return '% OFF'
  return '元 兑换'
}


// ============ 输入框 ============
function Field({
  label, required, icon, value, onChange, placeholder, delay
}: { label: string; required?: boolean; icon?: string; value: string; onChange: (v: string) => void; placeholder: string; delay?: string }) {
  return (
    <div className="animate-fade-rise" style={{ animationDelay: delay }}>
      <label className="block text-[11px] sm:text-xs font-semibold text-slate-600 mb-1">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      <div className="field-glow flex items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl transition">
        {icon && <i className={`fa-solid ${icon} text-amber-500 text-xs w-4 text-center shrink-0`} />}
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className="flex-1 bg-transparent outline-none text-sm text-slate-800 placeholder:text-slate-300" />
      </div>
    </div>
  )
}

// ============ 券面 Hero ============
function CouponHero({ coupon }: { coupon: CouponData }) {
  const claimed = coupon.issued_count ?? 128
  const stock = coupon.total_stock ?? 500
  const left = Math.max(0, stock - claimed)
  const urgent = left < stock * 0.3
  const [imgOk, setImgOk] = useState(true)

  return (
    <div className="animate-pop-in card-gold rounded-2xl overflow-hidden mb-5" style={{ animationDelay: '0.1s' }}>
      <div className="flex items-stretch">
        {/* 左：券面值大字 */}
        <div className="coupon-notch flex items-center justify-center w-[42%] bg-gradient-to-br from-amber-50 via-amber-100 to-amber-200 py-5 sm:py-6 relative">
          {/* 可选商品小图角标 */}
          {coupon.image_url && imgOk && (
            <img src={coupon.image_url} alt="" onError={() => setImgOk(false)}
              className="absolute top-1.5 right-1.5 w-8 h-8 sm:w-10 sm:h-10 object-contain drop-shadow-sm opacity-70 pointer-events-none" />
          )}
          <div className="text-center">
            <div className="coupon-value font-display text-5xl sm:text-6xl md:text-7xl leading-none">
              {coupon.type === 'cash' ? (
                <><span className="text-2xl sm:text-3xl align-top mr-0.5">￥</span>{coupon.value}</>
              ) : (
                <>{coupon.value}<span className="text-xl sm:text-2xl ml-1">%</span></>
              )}
            </div>
            <div className="text-[10px] sm:text-xs text-amber-700 font-semibold mt-1 tracking-wider">{couponTypeLabel(coupon.type).trim()}</div>
          </div>
        </div>
        {/* 右：券信息 */}
        <div className="flex-1 py-4 sm:py-5 px-3 sm:px-4 flex flex-col justify-center">
          <div className="font-bold text-slate-800 text-sm sm:text-base leading-tight truncate">{coupon.name}</div>
          {coupon.min_order > 0 && <div className="text-[10px] sm:text-[11px] text-slate-500 mt-1">满 ￥{coupon.min_order} 可用</div>}
          {coupon.description && <div className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 line-clamp-2">{coupon.description}</div>}
          <div className="mt-2 sm:mt-3 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-700 ${urgent ? 'bg-gradient-to-r from-emerald-500 to-amber-500' : 'bg-gradient-to-r from-emerald-400 to-amber-400'}`}
                style={{ width: `${Math.min(100, (claimed / Math.max(stock, 1)) * 100)}%` }} />
            </div>
            <span className={`text-[10px] sm:text-[11px] font-semibold whitespace-nowrap ${urgent ? 'text-amber-600' : 'text-emerald-600'}`}>
              {urgent ? `仅剩 ${left} 张` : `已领 ${claimed}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============ 表单页 ============
function CouponForm({
  hasQr, qrCodeNum, coupon, onSubmit, submitting, error, form, setForm
}: {
  hasQr: boolean; qrCodeNum: number | null; coupon: CouponData | null
  onSubmit: (e: React.FormEvent) => void; submitting: boolean; error: string
  form: { name: string; phone: string; wechat_nick: string }
  setForm: (f: any) => void
}) {
  return (
    <div className="min-h-screen flex items-start justify-center py-4 sm:py-6 px-3 sm:px-4 relative z-10">
      <div className="w-full max-w-md">
        {/* Hero 标题 */}
        <div className="text-center mb-4 sm:mb-5 animate-fade-rise" style={{ animationDelay: '0s' }}>
          <div className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 bg-gradient-to-r from-amber-100 via-amber-50 to-emerald-50 border border-amber-300/70 rounded-full text-[10px] sm:text-[11px] text-amber-800 font-semibold shadow-sm mb-2 sm:mb-3">
            <span className="text-amber-500">✦</span>专属福利包裹扫码领取<span className="text-amber-500">✦</span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-slate-900 leading-tight">
            <span className="text-gold">限时福利</span><br className="hidden sm:block" />等您来领
          </h1>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-1 sm:mt-2">填写信息，1 秒解锁您的专属优惠券</p>
        </div>

        {/* 券面 */}
        {coupon && <CouponHero coupon={coupon} />}

        {/* 表单 */}
        <form onSubmit={onSubmit} className="animate-fade-rise bg-white/80 backdrop-blur-md rounded-2xl border border-white shadow-xl shadow-amber-900/5 p-4 sm:p-5 space-y-2.5 sm:space-y-3"
          style={{ animationDelay: '0.2s' }}>
          <Field label="姓名 / 昵称" required icon="fa-user" value={form.name} onChange={(v) => setForm((f: any) => ({ ...f, name: v }))} placeholder="方便顾问称呼您" delay="0.22s" />
          <Field label="手机号" icon="fa-phone" value={form.phone} onChange={(v) => setForm((f: any) => ({ ...f, phone: v }))} placeholder="用于专属权益到账提醒" delay="0.28s" />
          <Field label="企微昵称" icon="fa-comment-dots" value={form.wechat_nick} onChange={(v) => setForm((f: any) => ({ ...f, wechat_nick: v }))} placeholder="方便顾问第一时间识别您" delay="0.34s" />

          {error && (
            <div className="animate-fade-rise p-2.5 bg-rose-50 border border-rose-200/70 text-rose-600 text-xs rounded-lg flex items-center gap-2" style={{ animationDelay: '0.4s' }}>
              <i className="fa-solid fa-circle-exclamation text-rose-400" />{error}
            </div>
          )}

          <button type="submit" disabled={submitting}
            className="btn-cta w-full py-3 sm:py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-bold text-sm sm:text-base hover:shadow-lg hover:shadow-emerald-500/30 active:scale-[0.98] transition disabled:opacity-60 disabled:cursor-not-allowed mt-1 sm:mt-2">
            {submitting ? (
              <span className="flex items-center justify-center gap-2"><i className="fa-solid fa-circle-notch fa-spin" />领取中…</span>
            ) : (
              <span className="flex items-center justify-center gap-2"><i className="fa-solid fa-gift" />立即领取专属福利</span>
            )}
          </button>
          <p className="text-center text-[10px] text-slate-400 pt-1">提交即同意我们为您提供专属服务 · 信息仅用于客户关系管理</p>
        </form>

        {hasQr && qrCodeNum !== null && <StaffTrustCard qrCodeId={qrCodeNum} />}

        <div className="text-center mt-4 sm:mt-5 animate-fade-rise" style={{ animationDelay: '0.5s' }}>
          <div className="inline-flex items-center gap-3 text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><i className="fa-solid fa-shield-halved text-emerald-500" />信息安全加密</span>
            <span>·</span>
            <span className="flex items-center gap-1"><i className="fa-solid fa-lock text-amber-500" />不对外泄露</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============ 成功页 ============
function SuccessView({
  coupon, issue, customer, onMyCoupons, qrCodeNum
}: {
  coupon: CouponData | null; issue: ClaimResult['issue'] | null
  customer: { id: number; code: string; name: string }; onMyCoupons: () => void; qrCodeNum: number | null
}) {
  return (
    <div className="min-h-screen flex items-start justify-center py-6 sm:py-8 px-3 sm:px-4 relative z-10">
      <div className="w-full max-w-md">
        <div className="text-center animate-pop-in mb-5 sm:mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 shadow-xl shadow-emerald-500/30 animate-float">
            <i className="fa-solid fa-party-horn text-white text-2xl sm:text-3xl" />
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold mt-3 sm:mt-4 text-slate-900">领券成功！</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">欢迎您，<span className="font-semibold text-slate-700">{customer.name}</span></p>
        </div>

        {(coupon || issue) && (
          <div className="animate-pop-in card-gold rounded-2xl overflow-hidden mb-4" style={{ animationDelay: '0.15s' }}>
            <div className="flex items-stretch">
              <div className="coupon-notch flex items-center justify-center w-[42%] bg-gradient-to-br from-amber-50 via-amber-100 to-amber-200 py-4 sm:py-5">
                <div className="coupon-value font-display text-4xl sm:text-5xl leading-none">
                  {(coupon?.type === 'cash' || issue?.coupon_type === 'cash') ? (
                    <><span className="text-xl sm:text-2xl align-top mr-0.5">￥</span>{coupon?.value ?? issue?.value}</>
                  ) : (
                    <>{coupon?.value ?? issue?.value}<span className="text-base sm:text-lg ml-1">%</span></>
                  )}
                </div>
              </div>
              <div className="flex-1 py-3 sm:py-4 px-3 sm:px-4">
                <div className="font-bold text-slate-800 text-sm">{coupon?.name ?? issue?.coupon_name}</div>
                {(coupon?.min_order ?? issue?.min_order ?? 0) > 0 && (
                  <div className="text-[10px] text-slate-500 mt-0.5">满 ￥{coupon?.min_order ?? issue?.min_order} 可用</div>
                )}
                {issue && (
                  <div className="mt-1.5 pt-1.5 border-t border-amber-100">
                    <div className="text-[9px] text-slate-400">您的专属券码</div>
                    <div className="font-mono font-bold text-amber-700 text-sm tracking-wider">{issue.code}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2.5 animate-fade-rise" style={{ animationDelay: '0.3s' }}>
          <button onClick={onMyCoupons}
            className="btn-cta w-full py-3 sm:py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-bold text-sm sm:text-base hover:shadow-lg hover:shadow-emerald-500/30 active:scale-[0.98] transition">
            <i className="fa-solid fa-ticket mr-2" />查看我的全部券包
          </button>
        </div>

        {qrCodeNum !== null && <StaffTrustCard qrCodeId={qrCodeNum} />}
      </div>
    </div>
  )
}

// ============ 主组件 ============
export default function PublicCouponView({ qrCodeId, navigate }: Props) {
  const [step, setStep] = useState<'form' | 'claiming' | 'success' | 'error'>('form')
  const [form, setForm] = useState({ name: '', phone: '', wechat_nick: '' })
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null)
  const [coupon, setCoupon] = useState<CouponData | null>(null)
  const [error, setError] = useState('')

  const hasQr = !!qrCodeId
  const qrCodeNum = qrCodeId ? Number(qrCodeId) : null

  useEffect(() => {
    if (!qrCodeNum) return
    fetch(`/api/public/qrcodes/${qrCodeNum}/landing-url`)
      .then(r => r.json())
      .then(async (qr) => {
        if (qr.target_type === 'coupon' && qr.target_id) {
          try {
            const r2 = await fetch(`/api/public/coupons/${qr.target_id}`)
            const d = await r2.json()
            if (d.ok && d.id) setCoupon(d)
          } catch { /* ignore */ }
        }
      })
      .catch(() => {})
  }, [qrCodeNum])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hasQr) { setError('无效的活码链接'); setStep('error'); return }
    if (!form.name.trim()) { setError('请填写您的姓名/昵称'); return }
    setStep('claiming'); setError('')
    try {
      const scanRes = await fetch('/api/public/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_code_id: Number(qrCodeId), ...form })
      })
      const scanData: ScanResult = await scanRes.json()
      if (!scanData.ok) throw new Error(scanRes.statusText)
      setScanResult(scanData)
      if (scanData.target?.type === 'coupon') {
        const claimRes = await fetch('/api/public/coupons/claim', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qr_code_id: Number(qrCodeId), customer_code: scanData.customer.code })
        })
        const claimData = await claimRes.json()
        if (!claimRes.ok && claimRes.status !== 409) throw new Error(claimData.error || '领券失败')
        if (claimRes.ok) setClaimResult(claimData)
      }
      setStep('success')
    } catch (err: any) {
      setError(err.message || '操作失败，请重试')
      setStep('error')
    }
  }

  if (step === 'success' && scanResult) {
    return <SuccessView
      coupon={(coupon as any) ?? scanResult.target?.data ?? null}
      issue={claimResult?.issue ?? null}
      customer={scanResult.customer}
      onMyCoupons={() => navigate('my-coupons', { code: scanResult.customer.code })}
      qrCodeNum={qrCodeNum}
    />
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 relative z-10">
        <div className="text-center card-gold rounded-2xl p-8 max-w-sm">
          <div className="text-4xl mb-3">😢</div>
          <h2 className="font-display text-xl font-bold text-slate-800 mb-1">领券失败</h2>
          <p className="text-sm text-slate-500 mb-5">{error}</p>
          <button onClick={() => { setStep('form'); setError('') }}
            className="px-6 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-lg font-medium text-sm hover:shadow-md">
            重新尝试
          </button>
        </div>
      </div>
    )
  }

  return <CouponForm
    hasQr={hasQr} qrCodeNum={qrCodeNum} coupon={coupon}
    onSubmit={handleSubmit} submitting={step === 'claiming'}
    error={error} form={form} setForm={setForm}
  />
}
