import { useState, useEffect } from 'react'

interface Props {
  customerCode: string | null
  navigate: (page: string, extra?: Record<string, string>) => void
}

interface CouponIssue {
  id: number
  code: string
  status: 'pending' | 'used' | 'expired' | 'revoked'
  coupon_name: string
  type: 'cash' | 'percent' | 'gift'
  value: number
  min_order: number
  description: string
  expires_at: string
  issued_at: string
}

export default function PublicMyCouponsView({ customerCode, navigate }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [coupons, setCoupons] = useState<CouponIssue[]>([])
  const [customer, setCustomer] = useState<{ id: number; code: string; name: string } | null>(null)
  const [activeIssue, setActiveIssue] = useState<CouponIssue | null>(null)
  const [filter, setFilter] = useState<'all' | 'pending' | 'used'>('all')

  useEffect(() => {
    if (!customerCode) {
      setError('客户标识缺失，请从活码链接进入')
      setLoading(false)
      return
    }
    fetch(`/api/public/customer/${customerCode}/coupons`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || '加载失败')
        setCoupons(data.coupons)
        setCustomer(data.customer)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [customerCode])

  const filteredCoupons = coupons.filter((c) => {
    if (filter === 'all') return true
    if (filter === 'pending') return c.status === 'pending'
    if (filter === 'used') return c.status !== 'pending'
    return true
  })

  const pendingCount = coupons.filter((c) => c.status === 'pending').length
  const usedCount = coupons.filter((c) => c.status !== 'pending').length

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-400">加载中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-5xl mb-4">😢</div>
          <p className="text-slate-600 mb-4">{error}</p>
          <button onClick={() => navigate('coupon')} className="px-6 py-2 bg-orange-500 text-white rounded-xl">
            去领券
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4 pb-20">
      {/* 顶部欢迎区 */}
      <div className="max-w-md mx-auto mb-6 pt-8">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white text-2xl mb-3">
            🎁
          </div>
          <h1 className="text-2xl font-bold text-slate-800">我的券包</h1>
          {customer && <p className="text-slate-500 text-sm mt-1">Hi，{customer.name}</p>}
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 gap-3 mt-6">
          <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
            <div className="text-3xl font-bold text-orange-500">{pendingCount}</div>
            <div className="text-xs text-slate-400 mt-1">待使用</div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
            <div className="text-3xl font-bold text-slate-400">{usedCount}</div>
            <div className="text-xs text-slate-400 mt-1">已使用/过期</div>
          </div>
        </div>

        {/* 筛选 */}
        <div className="flex gap-2 mt-6">
          {(['all', 'pending', 'used'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-2 text-sm rounded-xl transition ${
                filter === f ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 shadow-sm'
              }`}
            >
              {f === 'all' ? '全部' : f === 'pending' ? '待使用' : '已使用'}
            </button>
          ))}
        </div>
      </div>

      {/* 券列表 */}
      <div className="max-w-md mx-auto space-y-4">
        {filteredCoupons.length === 0 && (
          <div className="text-center py-12 bg-white rounded-2xl shadow-sm">
            <div className="text-5xl mb-3">📭</div>
            <p className="text-slate-400 mb-4">暂无券</p>
            <button onClick={() => navigate('coupon')} className="px-6 py-2 bg-orange-500 text-white rounded-xl text-sm">
              去领一张
            </button>
          </div>
        )}

        {filteredCoupons.map((c) => (
          <CouponCard
            key={c.id}
            issue={c}
            onShow={() => c.status === 'pending' && setActiveIssue(c)}
            onShop={() => c.status === 'pending' && navigate('shop', { code: customerCode!, issue: String(c.id), coupon_code: c.code })}
          />
        ))}
      </div>

      {/* 核销码弹层 */}
      {activeIssue && (
        <ShowCodeModal issue={activeIssue} onClose={() => setActiveIssue(null)} />
      )}
    </div>
  )
}

function CouponCard({ issue, onShow, onShop }: { issue: CouponIssue; onShow: () => void; onShop?: () => void }) {
  const isPending = issue.status === 'pending'
  const expired = !isPending && issue.status === 'expired'
  const used = !isPending && issue.status === 'used'

  const valueText = issue.type === 'cash' ? `￥${issue.value}` : issue.type === 'percent' ? `${issue.value}%OFF` : `￥${issue.value}`
  const typeLabel = issue.type === 'cash' ? '立减券' : issue.type === 'percent' ? '折扣券' : '礼品券'

  return (
    <div
      className={`bg-white rounded-2xl p-5 shadow-sm relative overflow-hidden ${!isPending ? 'opacity-60' : ''}`}
      onClick={isPending ? onShow : undefined}
    >
      {/* 左侧颜色条 */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${isPending ? 'bg-gradient-to-b from-orange-400 to-rose-500' : 'bg-slate-300'}`} />

      <div className="flex items-center justify-between pl-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-600 rounded-full">{typeLabel}</span>
            {used && <span className="text-xs text-slate-400">已核销</span>}
            {expired && <span className="text-xs text-slate-400">已过期</span>}
          </div>
          <div className="text-sm text-slate-700 font-medium mb-2">{issue.coupon_name}</div>
          <div className="text-xs text-slate-400">
            {issue.min_order > 0 && `满￥${issue.min_order}可用 · `}
            有效期至 {issue.expires_at?.slice(0, 10)}
          </div>
        </div>

        <div className="text-right ml-4">
          <div className="text-3xl font-bold text-rose-500">{valueText}</div>
          {isPending && (
            <div className="text-xs text-orange-500 mt-1 font-medium">点击出示核销码 →</div>
          )}
        </div>
      </div>

      {/* 券码 + 去使用 */}
      {isPending && (
        <div className="mt-3 pt-3 border-t border-dashed border-slate-200">
          <div className="flex justify-between items-center mb-3">
            <div className="text-xs text-slate-400">券码</div>
            <div className="font-mono text-sm text-slate-700 tracking-wider">{issue.code}</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onShow() }}
              className="flex-1 py-2 text-xs border border-slate-200 rounded-xl hover:bg-slate-50"
            >
              出示核销码
            </button>
            {onShop && (
              <button
                onClick={(e) => { e.stopPropagation(); onShop() }}
                className="flex-1 py-2 text-xs bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl shadow-sm"
              >
                🛒 去商城使用
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// 核销码弹层：显示大二维码 + 券码字符串
function ShowCodeModal({ issue, onClose }: { issue: CouponIssue; onClose: () => void }) {
  // 用在线二维码生成（或者简单用 base64 画个假的，这里用 API 生成）
  const qrContent = issue.code
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrContent)}`

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-white rounded-3xl p-6 w-full max-w-sm text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs text-slate-400 mb-1">请向顾问出示核销码</div>
        <div className="text-lg font-bold text-slate-800 mb-4">{issue.coupon_name}</div>

        {/* 二维码 */}
        <div className="bg-slate-50 rounded-2xl p-4 mb-4">
          <img src={qrUrl} alt="核销码" className="w-48 h-48 mx-auto" />
        </div>

        {/* 券码字符串 */}
        <div className="bg-slate-100 rounded-xl p-3 mb-4">
          <div className="text-xs text-slate-400 mb-1">核销码（券码）</div>
          <div className="font-mono text-lg font-bold text-slate-800 tracking-widest">{issue.code}</div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 bg-slate-800 text-white rounded-xl font-medium"
        >
          关闭
        </button>
      </div>
    </div>
  )
}
