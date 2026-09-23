import { useState, useEffect } from 'react'

interface Props {
  customerCode: string | null
  preselectedIssueId?: string | null  // 从券包点"去使用"带过来的
  preselectedCode?: string | null
  navigate: (page: string, extra?: Record<string, string>) => void
}

interface CouponItem {
  issue_id: number
  code: string
  coupon_name: string
  type: string
  value: number
  min_order: number
  effective: boolean
  reason: string
  saved_amount: number
  expires_at: string
}

const PRODUCTS = [
  { id: 1, name: '🌰 高山有机板栗 500g', price: 78, original: 99, desc: '安徽金寨原产地', tag: '热卖' },
  { id: 2, name: '🍵 明前龙井特级 100g', price: 288, original: 388, desc: '西湖产区明前采摘', tag: '新品' },
  { id: 3, name: '🍯 新疆野生蜂蜜 250g', price: 128, original: 168, desc: '无添加自然结晶', tag: '' },
  { id: 4, name: '🐟 舟山带鱼礼盒 2kg', price: 199, original: 299, desc: '深海捕捞冷链直发', tag: '限时' },
  { id: 5, name: '🥮 苏式月饼礼盒 8枚', price: 158, original: 228, desc: '传统工艺中秋限定', tag: '中秋' },
  { id: 6, name: '🫒 特级初榨橄榄油 750ml', price: 168, original: 228, desc: '西班牙进口酸度≤0.3%', tag: '' },
]

export default function PublicShopView({ customerCode, preselectedIssueId, preselectedCode, navigate }: Props) {
  const [cart, setCart] = useState<Record<number, number>>({})
  const [coupons, setCoupons] = useState<CouponItem[]>([])
  const [selectedCoupon, setSelectedCoupon] = useState<CouponItem | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [step, setStep] = useState<'shop' | 'checkout' | 'success'>('shop')
  const [loading, setLoading] = useState(false)
  const [orderResult, setOrderResult] = useState<any>(null)
  const [error, setError] = useState('')

  // 自动勾选从券包带过来的券
  useEffect(() => {
    if (!customerCode) return
    // 先拿客户信息用于展示
    fetch(`/api/public/customer/${customerCode}/coupons`)
      .then(r => r.json())
      .then(data => { if (data.customer) setCustomerName(data.customer.name) })
      .catch(() => {})

    // 初始化购物车
    setCart({ 1: 1 })
  }, [customerCode])

  const cartTotal = Object.entries(cart).reduce((sum, [pid, qty]) => {
    const p = PRODUCTS.find(pr => pr.id === Number(pid))
    return sum + (p ? p.price * qty : 0)
  }, 0)

  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0)

  // 选商品后刷新可用券
  useEffect(() => {
    if (!customerCode || cartTotal <= 0) return
    fetch(`/api/ext/customer/${customerCode}/coupons?amount=${cartTotal}`)
      .then(r => r.json())
      .then(data => {
        const list = data.coupons || []
        setCoupons(list)
        // 预选中从券包带过来的券
        if (preselectedIssueId) {
          const match = list.find((c: any) => String(c.issue_id) === String(preselectedIssueId))
          if (match && match.effective) setSelectedCoupon(match)
        } else if (preselectedCode) {
          const match = list.find((c: any) => c.code === preselectedCode)
          if (match && match.effective) setSelectedCoupon(match)
        }
      })
      .catch(() => setCoupons([]))
  }, [cartTotal, customerCode, preselectedIssueId, preselectedCode])

  const finalTotal = selectedCoupon ? Math.max(0, cartTotal - selectedCoupon.saved_amount) : cartTotal

  function addToCart(id: number) {
    setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }))
  }
  function removeFromCart(id: number) {
    setCart((c) => {
      const nc = { ...c }
      const cur = nc[id] || 0
      if (cur <= 1) delete nc[id]
      else nc[id] = cur - 1
      return nc
    })
  }

  // 结算 → 调 ext/order-place 自动核销
  async function handlePlaceOrder() {
    if (!customerCode) { setError('客户信息缺失'); return }
    if (cartTotal <= 0) { setError('请先选购商品'); return }
    setLoading(true); setError('')
    try {
      const body: any = {
        customer_code: customerCode,
        order_no: `SHOP_${Date.now()}`,
        order_amount: cartTotal,
        channel: '微商城模拟'
      }
      if (selectedCoupon) body.issue_id = selectedCoupon.issue_id
      const res = await fetch('/api/ext/order-place', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '下单失败')
      setOrderResult(data)
      setStep('success')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // === 成功页 ===
  if (step === 'success' && orderResult) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-6 text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-4xl">✓</div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">下单成功！</h2>
          <p className="text-slate-500 text-sm mb-4">订单号 {orderResult.order_no}</p>

          <div className="bg-slate-50 rounded-2xl p-5 mb-6 space-y-2 text-left">
            <div className="flex justify-between text-sm"><span className="text-slate-500">订单金额</span><span>￥{orderResult.order_amount}</span></div>
            {orderResult.coupon_used && (
              <>
                <div className="flex justify-between text-sm text-emerald-600">
                  <span>优惠券抵扣</span>
                  <span>-￥{orderResult.saved_amount}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>使用券</span>
                  <span className="font-mono">{orderResult.coupon_used.code}</span>
                </div>
              </>
            )}
            <div className="border-t pt-2 flex justify-between font-bold">
              <span>实付金额</span>
              <span className="text-2xl text-rose-500">￥{orderResult.final_pay_amount}</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => navigate('shop', { code: customerCode! })} className="flex-1 py-3 border border-slate-200 rounded-xl text-sm">
              继续购物
            </button>
            <button onClick={() => navigate('my-coupons', { code: customerCode! })} className="flex-1 py-3 bg-slate-800 text-white rounded-xl text-sm">
              查看我的券包 →
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mt-4">
            优惠券已自动核销，回到券包可以看到状态变化
          </p>
        </div>
      </div>
    )
  }

  // === 结算页 ===
  if (step === 'checkout') {
    return (
      <div className="min-h-screen p-4 pb-32">
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-2 mb-4">
            <button onClick={() => setStep('shop')} className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center">←</button>
            <h1 className="text-xl font-bold text-slate-800">确认订单</h1>
          </div>

          {/* 收货信息 */}
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">📍</div>
              <div className="flex-1">
                <div className="font-medium">{customerName || '客户'}</div>
                <div className="text-xs text-slate-400">模拟地址 · 直接下单即可</div>
              </div>
            </div>
          </div>

          {/* 商品清单 */}
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-3">
            <div className="text-xs text-slate-400 mb-3">商品清单</div>
            <div className="space-y-3">
              {Object.entries(cart).map(([pid, qty]) => {
                const p = PRODUCTS.find(pr => pr.id === Number(pid))!
                return (
                  <div key={pid} className="flex justify-between items-center">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-slate-400 mt-0.5">￥{p.price} × {qty}</div>
                    </div>
                    <div className="text-sm font-bold">￥{(p.price * qty).toFixed(0)}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 优惠券选择 */}
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-3">
            <div className="text-xs text-slate-400 mb-3">可用优惠券（{coupons.filter(c => c.effective).length} 张）</div>
            {coupons.length === 0 ? (
              <div className="text-xs text-slate-400 py-2">暂无可用券</div>
            ) : (
              <div className="space-y-2">
                {coupons.map((c) => {
                  const selected = selectedCoupon?.issue_id === c.issue_id
                  return (
                    <button
                      key={c.issue_id}
                      onClick={() => c.effective && setSelectedCoupon(selected ? null : c)}
                      disabled={!c.effective}
                      className={`w-full text-left p-3 rounded-xl border transition ${
                        selected ? 'border-emerald-500 bg-emerald-50' : c.effective ? 'border-slate-200 hover:border-slate-300' : 'border-slate-100 opacity-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium">{c.coupon_name}</div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {c.type === 'cash' ? `￥${c.value}立减` : `${c.value}%折扣`}
                            {c.min_order > 0 && ` · 满￥${c.min_order}可用`}
                          </div>
                        </div>
                        <div className="text-right">
                          {c.effective ? (
                            <div className="text-emerald-500 font-bold text-sm">省￥{c.saved_amount}</div>
                          ) : (
                            <div className="text-xs text-slate-400">未达门槛</div>
                          )}
                          {selected && <div className="text-xs text-emerald-500 mt-1">✓ 已选</div>}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {error && <div className="bg-rose-50 text-rose-600 text-sm p-3 rounded-xl mb-3">{error}</div>}

          {/* 结算页底部固定的确认栏 */}
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-xl">
            <div className="max-w-md mx-auto p-3 flex items-center gap-3">
              <div className="flex-1">
                <div className="text-xs text-slate-400">
                  应付 {selectedCoupon && <span className="text-emerald-500">已减￥{selectedCoupon.saved_amount}</span>}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-rose-500">￥{finalTotal.toFixed(2)}</span>
                  {selectedCoupon && <span className="text-xs text-slate-300 line-through">￥{cartTotal}</span>}
                </div>
              </div>
              <button
                onClick={handlePlaceOrder}
                disabled={loading}
                className="px-6 py-3 bg-gradient-to-r from-rose-500 to-orange-500 text-white rounded-xl font-medium disabled:opacity-50"
              >
                {loading ? '下单中...' : '确认下单'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // === 商城页 ===
  return (
    <div className="min-h-screen pb-32">
      {/* 顶部 */}
      <div className="bg-gradient-to-br from-rose-500 via-orange-500 to-amber-400 text-white p-4 pt-8 pb-6 shadow-lg">
        <div className="max-w-md mx-auto">
          <div className="text-xs opacity-80 mb-1">🎁 欢迎光临模拟商城</div>
          <h1 className="text-2xl font-bold mb-1">
            {customerName ? `${customerName}的专属小店` : '私域会员商城'}
          </h1>
          <div className="text-xs opacity-90">下单带券自动抵扣 · 核销实时到账</div>
        </div>
      </div>

      {/* 商品列表 */}
      <div className="max-w-md mx-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          {PRODUCTS.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl overflow-hidden shadow-sm">
              <div className="aspect-square bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-5xl relative">
                {p.name.split(' ')[0]}
                {p.tag && (
                  <span className="absolute top-2 right-2 px-2 py-0.5 bg-rose-500 text-white text-[10px] rounded-full">{p.tag}</span>
                )}
              </div>
              <div className="p-3">
                <div className="text-xs text-slate-700 font-medium truncate">{p.name.split(' ').slice(1).join(' ')}</div>
                <div className="text-[10px] text-slate-400 mt-0.5 mb-2">{p.desc}</div>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-lg font-bold text-rose-500">￥{p.price}</span>
                  {p.original && <span className="text-[10px] text-slate-300 line-through">￥{p.original}</span>}
                </div>
                <div className="flex items-center justify-between">
                  {cart[p.id] ? (
                    <div className="flex items-center gap-2">
                      <button onClick={() => removeFromCart(p.id)} className="w-6 h-6 bg-slate-100 rounded-full text-sm">-</button>
                      <span className="text-sm font-medium w-4 text-center">{cart[p.id]}</span>
                      <button onClick={() => addToCart(p.id)} className="w-6 h-6 bg-rose-500 text-white rounded-full text-sm">+</button>
                    </div>
                  ) : (
                    <button onClick={() => addToCart(p.id)} className="px-3 py-1 bg-rose-500 text-white text-xs rounded-full">加入</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 底部购物车栏 */}
      {cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-xl">
          <div className="max-w-md mx-auto p-3 flex items-center gap-3">
            <div className="flex-1">
              <div className="text-xs text-slate-400">共 {cartCount} 件</div>
              <div className="flex items-baseline gap-1">
                {selectedCoupon && <span className="text-xs text-emerald-500">已减￥{selectedCoupon.saved_amount}</span>}
                <span className="text-xl font-bold text-rose-500">￥{finalTotal}</span>
                {selectedCoupon && <span className="text-xs text-slate-300 line-through">￥{cartTotal}</span>}
              </div>
            </div>
            <button
              onClick={() => setStep('checkout')}
              className="px-6 py-3 bg-gradient-to-r from-rose-500 to-orange-500 text-white rounded-xl font-medium"
            >
              去结算 →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
