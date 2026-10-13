import { useState, useEffect, useMemo } from 'react'
import { api } from '../../api'
import type { Address, Cart, Category, Product } from '../../types'

interface Props {
  customerCode: string | null
  preselectedIssueId?: string | null
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

export default function PublicShopView({ customerCode, preselectedIssueId, preselectedCode, navigate }: Props) {
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [cart, setCart] = useState<Cart | null>(null)
  const [coupons, setCoupons] = useState<CouponItem[]>([])
  const [selectedCoupon, setSelectedCoupon] = useState<CouponItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [activeCat, setActiveCat] = useState<number | 'all'>('all')
  const [keyword, setKeyword] = useState('')
  const [step, setStep] = useState<'shop' | 'cart' | 'checkout' | 'success'>('shop')
  const [orderResult, setOrderResult] = useState<any>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutErr, setCheckoutErr] = useState('')
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState<string>('')
  const [showPaySheet, setShowPaySheet] = useState(false)

  // === 地址相关（checkout 用）===
  const [addresses, setAddresses] = useState<Address[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null)
  const [showNewAddress, setShowNewAddress] = useState(false)
  const [newAddress, setNewAddress] = useState<Partial<Address>>({ name: '', phone: '', province: '', city: '', district: '', detail: '', is_default: 0 })

  // === 初始化：拿 customerId + 商品列表 + 分类 ===
  useEffect(() => {
    let mounted = true
    async function init() {
      if (!customerCode) return
      try {
        // 拿 customer 基础信息（含 id）
        const cRes = await fetch(`/api/public/customer/${customerCode}/coupons`).then((r) => r.json())
        if (cRes.customer) {
          setCustomerId(cRes.customer.id)
          setCustomerName(cRes.customer.name)
        }
      } catch {}

      try {
        const [pRes, catRes] = await Promise.all([
          api.getProducts(),
          api.getCategories(),
        ])
        if (mounted) {
          setProducts(pRes.items.filter((p) => p.active === 1))
          setCategories(catRes.items)
        }
      } catch (e: any) {
        if (mounted) setLoadErr(e.message || '商品加载失败')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    init()
    return () => { mounted = false }
  }, [customerCode])

  // 拿购物车
  useEffect(() => {
    if (!customerId) return
    api.getCart(customerId).then(setCart).catch(() => {})
  }, [customerId, step === 'cart'])

  // 选商品后刷新可用券
  const cartTotal = cart ? cart.total : 0
  useEffect(() => {
    if (!customerCode || cartTotal <= 0) return
    fetch(`/api/ext/customer/${customerCode}/coupons?amount=${cartTotal}`)
      .then((r) => r.json())
      .then((data) => {
        const list: CouponItem[] = data.coupons || []
        setCoupons(list)
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

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (activeCat !== 'all' && p.category_id !== activeCat) return false
      if (keyword.trim()) {
        const q = keyword.trim().toLowerCase()
        if (!p.name.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [products, activeCat, keyword])

  const finalTotal = selectedCoupon ? Math.max(0, cartTotal - selectedCoupon.saved_amount) : cartTotal
  const cartCount = cart?.count ?? 0

  // === 加购 ===
  async function handleAddToCart(productId: number, quantity = 1) {
    if (!customerId) {
      alert('客户信息缺失，请从正确入口进入')
      return
    }
    try {
      await api.addToCart(customerId, productId, quantity)
      const c = await api.getCart(customerId)
      setCart(c)
    } catch (e: any) {
      alert(e.message || '加购失败')
    }
  }

  async function handleUpdateCartItem(cartId: number, quantity: number) {
    if (!customerId) return
    try {
      if (quantity === 0) await api.removeCartItem(cartId)
      else await api.updateCartItem(cartId, quantity)
      const c = await api.getCart(customerId)
      setCart(c)
    } catch (e: any) {
      alert(e.message || '更新失败')
    }
  }

  async function handleClearCart() {
    if (!customerId) return
    if (!window.confirm('清空购物车？')) return
    await api.clearCart(customerId)
    setCart({ items: [], total: 0, count: 0 })
  }

  // === 进 checkout step 时拉取地址 ===
  useEffect(() => {
    if (step !== 'checkout' || !customerId) return
    api.getAddressesByCustomer(customerId).then((list) => {
      setAddresses(list)
      if (list.length > 0) {
        const def = list.find((a) => a.is_default === 1)
        setSelectedAddressId(def ? def.id : list[0].id)
      } else {
        setSelectedAddressId(null)
        setShowNewAddress(true)
      }
    }).catch(() => setAddresses([]))
  }, [step, customerId])

  // === 顶部公告轮播（必须在所有条件 return 之前，否则 React hooks 顺序炸）===
  const announcements = [
    { icon: 'fa-gift', text: '新人首单立减 ￥20' },
    { icon: 'fa-coins', text: '下单自动累计积分' },
    { icon: 'fa-bolt', text: '限时秒杀进行中' },
  ]
  const [annIdx, setAnnIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setAnnIdx((i) => (i + 1) % announcements.length), 3000)
    return () => clearInterval(t)
  }, [announcements.length])

  // === 结算 ===
  // === 拉起微信支付（真实微信环境用 WeixinJSBridge，非微信弹底部 sheet）===
  async function invokeWechatPay(jsapi: any, orderNo: string, amount: number): Promise<void> {
    setPaying(true); setPayError('')
    const isWechat = typeof window !== 'undefined' &&
      /MicroMessenger/i.test((window.navigator as any).userAgent)

    if (isWechat && !jsapi.isMock) {
      // 真实微信环境：拉起 WeixinJSBridge.invoke
      const params = {
        appId: jsapi.appId, timeStamp: jsapi.timeStamp, nonceStr: jsapi.nonceStr,
        package: jsapi.package, signType: jsapi.signType, paySign: jsapi.paySign,
      }
      return new Promise<void>((resolve, reject) => {
        const invoke = () => {
          ;(window as any).WeixinJSBridge.invoke('getBrandWCPayRequest', params, (res: any) => {
            if (res.err_msg === 'get_brand_wcpay_request:ok') {
              resolve()
            } else if (res.err_msg === 'get_brand_wcpay_request:cancel') {
              reject(new Error('用户取消支付'))
            } else {
              reject(new Error('支付失败'))
            }
          })
        }
        if ((window as any).WeixinJSBridge) {
          invoke()
        } else {
          document.addEventListener('WeixinJSBridgeReady', invoke, false)
        }
      }).finally(() => setPaying(false))
    } else {
      // 非微信环境（demo/PC 浏览器）：弹底部支付 sheet，等用户点"确认支付"
      setShowPaySheet(true)
      return new Promise<void>((resolve, reject) => {
        ;(window as any).__payResolve = resolve
        ;(window as any).__payReject = reject
      }).finally(() => setPaying(false))
    }
  }

  async function handlePlaceOrder() {
    if (!customerCode) { setCheckoutErr('客户信息缺失'); return }
    if (!cart || cartTotal <= 0) { setCheckoutErr('请先选购商品'); return }
    if (!selectedAddressId) { setCheckoutErr('请选择收货地址'); return }
    setCheckoutLoading(true); setCheckoutErr(''); setPayError('')
    try {
      const body: any = {
        customer_code: customerCode,
        order_no: `SHOP_${Date.now()}`,
        order_amount: cartTotal,
        channel: '微商城',
        address_id: selectedAddressId,
        items: cart.items.map((it) => ({
          product_id: it.product.id,
          quantity: it.quantity,
          price: it.product.price,
        })),
        clear_cart: true,
      }
      if (selectedCoupon) body.issue_id = selectedCoupon.issue_id
      const res = await fetch('/api/ext/order-place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '下单失败')
      if (customerId) {
        await api.clearCart(customerId)
        setCart({ items: [], total: 0, count: 0 })
      }

      setOrderResult(data)

      if (data.pay_required) {
        // 调微信 JSAPI 统一下单
        const payRes = await fetch('/api/pay/wechat/jsapi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_no: data.order_no }),
        })
        if (!payRes.ok) {
          const pj = await payRes.json().catch(() => ({}))
          throw new Error(pj.error || '微信支付下单失败')
        }
        const payData = await payRes.json()
        if (!payData.jsapi) throw new Error('微信支付返回数据异常')

        // 调拉起支付
        await invokeWechatPay(payData.jsapi, data.order_no, data.final_pay_amount || 0)
        setStep('success')
      } else {
        // 0 元订单直接成功
        setStep('success')
      }
    } catch (e: any) {
      setCheckoutErr('')
      setPayError(e.message || '支付失败')
    } finally {
      setCheckoutLoading(false)
    }
  }

  // === 跳商品详情 ===
  function openProductDetail(productId: number) {
    const extra: Record<string, string> = { product_id: String(productId) }
    if (customerCode) extra.code = customerCode
    navigate('product', extra)
  }

  // === 底部导航：仅 shop/cart/checkout 显示 ===
  function BottomNav() {
    if (step === 'success') return null
    const current = step === 'checkout' ? 'cart' : step
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-2xl z-40">
        <div className="max-w-md mx-auto grid grid-cols-4">
          <NavTab
            icon="fa-bag-shopping"
            label="商城"
            active={current === 'shop'}
            onClick={() => setStep('shop')}
          />
          <NavTab
            icon="fa-cart-shopping"
            label="购物车"
            active={current === 'cart'}
            onClick={() => setStep('cart')}
            badge={cartCount > 0 ? cartCount : undefined}
          />
          <NavTab
            icon="fa-tags"
            label="我的券"
            active={false}
            onClick={() => customerCode && navigate('my-coupons', { code: customerCode })}
          />
          <NavTab
            icon="fa-user"
            label="我的"
            active={false}
            onClick={() => customerCode && navigate('my-orders', { code: customerCode })}
          />
        </div>
      </div>
    )
  }

  function NavTab({ icon, label, active, onClick, badge }: { icon: string; label: string; active: boolean; onClick: () => void; badge?: number }) {
    return (
      <button
        onClick={onClick}
        className={`flex flex-col items-center justify-center py-2.5 gap-0.5 transition-all ${
          active ? 'text-emerald-500' : 'text-slate-400 hover:text-slate-600'
        }`}
      >
        <div className="relative">
          <i className={`fa-solid ${icon} ${active ? 'scale-110' : ''} transition-transform text-lg`} />
          {badge != null && badge > 0 && (
            <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </div>
        <span className={`text-[10px] ${active ? 'font-semibold' : ''}`}>{label}</span>
      </button>
    )
  }

  // === 成功页 ===
  if (step === 'success' && orderResult) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-emerald-50 to-white">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-6 text-center">
          <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-5xl shadow-lg animate-[bounce_0.6s_ease-in-out]">
            ✓
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-1">下单成功！</h2>
          <p className="text-slate-500 text-xs mb-6">订单号 <span className="font-mono">{orderResult.order_no}</span></p>

          <div className="bg-slate-50 rounded-2xl p-5 mb-6 space-y-2.5 text-left">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">订单金额</span>
              <span className="text-slate-700">￥{Number(orderResult.order_amount).toFixed(2)}</span>
            </div>
            {orderResult.coupon_used && (
              <>
                <div className="flex justify-between text-sm text-emerald-600">
                  <span><i className="fa-solid fa-tags mr-1" />优惠券抵扣</span>
                  <span>-￥{Number(orderResult.saved_amount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>使用券</span>
                  <span className="font-mono">{orderResult.coupon_used.code}</span>
                </div>
              </>
            )}
            <div className="border-t border-slate-200 pt-3 flex justify-between items-center">
              <span className="text-sm text-slate-500">实付金额</span>
              <span className="text-2xl font-bold text-emerald-600">￥{Number(orderResult.final_pay_amount).toFixed(2)}</span>
            </div>
          </div>

          <p className="text-xs text-slate-400 text-center mb-5">
            <i className="fa-brands fa-weixin text-emerald-500 mr-1"></i>
            支付方式：微信支付 · {orderResult.pay_required ? '已完成支付' : '0 元订单'}
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => { setStep('shop'); if (customerCode) navigate('shop', { code: customerCode }) }}
              className="flex-1 py-3 border border-emerald-200 rounded-xl text-sm font-medium text-emerald-600 hover:bg-emerald-50 transition"
            >
              继续逛逛
            </button>
            <button
              onClick={() => customerCode && navigate('my-orders', { code: customerCode })}
              className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl text-sm font-medium shadow-sm hover:shadow-md transition"
            >
              查看订单 →
            </button>
          </div>
        </div>
      </div>
    )
  }

  // === 购物车页 ===
  if (step === 'cart') {
    return (
      <div className="min-h-screen pb-32">
        <div className="max-w-md mx-auto p-4">
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => setStep('shop')}
              className="w-9 h-9 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-600 hover:bg-slate-50 transition"
            >
              <i className="fa-solid fa-chevron-left text-sm" />
            </button>
            <h1 className="text-xl font-bold text-slate-800">我的购物车</h1>
            <span className="text-xs text-slate-400 ml-auto">{cartCount} 件商品</span>
          </div>

          {cartCount === 0 ? (
            <div className="bg-white rounded-3xl shadow-sm p-12 text-center">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-emerald-50 flex items-center justify-center">
                <i className="fa-solid fa-cart-shopping text-3xl text-emerald-400" />
              </div>
              <div className="text-slate-700 font-medium mb-1">购物车空空如也</div>
              <div className="text-xs text-slate-400 mb-6">去挑选心仪的商品吧</div>
              <button
                onClick={() => setStep('shop')}
                className="px-8 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-full text-sm font-medium shadow-sm hover:shadow-md transition"
              >
                <i className="fa-solid fa-bag-shopping mr-1" />去逛逛
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {cart?.items.map((it) => (
                  <div key={it.cart_id} className="bg-white rounded-2xl p-3 flex gap-3 shadow-sm hover:shadow-md transition-all duration-200">
                    <div className="w-20 h-20 rounded-xl bg-slate-50 overflow-hidden shrink-0">
                      {it.product.image_url ? (
                        <img src={it.product.image_url} className="w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-300">
                          <i className="fa-solid fa-image" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800 line-clamp-2">{it.product.name}</div>
                      <div className="text-emerald-600 font-bold mt-1">￥{it.product.price}</div>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleUpdateCartItem(it.cart_id, it.quantity - 1)}
                            className="w-7 h-7 bg-emerald-50 rounded-full text-sm text-emerald-500 hover:bg-emerald-100 transition font-medium"
                          >−</button>
                          <span className="text-sm font-medium w-5 text-center text-slate-800">{it.quantity}</span>
                          <button
                            onClick={() => handleUpdateCartItem(it.cart_id, it.quantity + 1)}
                            className="w-7 h-7 bg-emerald-500 text-white rounded-full text-sm hover:bg-emerald-600 transition font-medium shadow-sm"
                          >+</button>
                        </div>
                        <div className="text-xs text-slate-400">小计 <span className="text-emerald-600 font-semibold">￥{(it.product.price * it.quantity).toFixed(2)}</span></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button onClick={handleClearCart} className="mt-3 text-xs text-slate-400 hover:text-rose-500 transition ml-auto block">
                <i className="fa-solid fa-trash-can mr-1" />清空购物车
              </button>

              {/* 优惠券选择 */}
              {cartTotal > 0 && (
                <div className="bg-white rounded-2xl p-4 shadow-sm mt-4">
                  <div className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1">
                    <i className="fa-solid fa-tags text-amber-500" />
                    可用优惠券 <span className="text-xs text-slate-400 font-normal">({coupons.filter((c) => c.effective).length} 张)</span>
                  </div>
                  {coupons.length === 0 ? (
                    <div className="text-xs text-slate-400 py-3 text-center bg-amber-50/50 rounded-xl">
                      <i className="fa-solid fa-gift mr-1 text-amber-400" />暂无可用券，去看看我的券包吧
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {coupons.map((c) => {
                        const selected = selectedCoupon?.issue_id === c.issue_id
                        return (
                          <button
                            key={c.issue_id}
                            onClick={() => c.effective && setSelectedCoupon(selected ? null : c)}
                            disabled={!c.effective}
                            className={`w-full text-left rounded-xl overflow-hidden transition-all duration-200 ${
                              selected
                                ? 'ring-2 ring-emerald-500 shadow-md'
                                : c.effective
                                  ? 'hover:shadow-md'
                                  : 'opacity-50'
                            }`}
                          >
                            <div className={`flex ${c.effective ? 'bg-gradient-to-r from-amber-400 to-amber-300' : 'bg-slate-100'}`}>
                              <div className={`w-20 shrink-0 flex flex-col items-center justify-center py-3 text-white ${c.effective ? '' : 'opacity-50'}`}>
                                <div className="text-[10px] opacity-80">
                                  {c.type === 'cash' ? '立减' : '折扣'}
                                </div>
                                <div className="text-xl font-bold leading-none">
                                  {c.type === 'cash' ? `￥${c.value}` : `${c.value}%`}
                                </div>
                              </div>
                              <div className={`flex-1 p-3 border-l-2 border-dashed ${c.effective ? 'border-white/60 bg-white/95' : 'border-slate-200 bg-white'}`}>
                                <div className="flex items-center justify-between">
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-slate-800 truncate">{c.coupon_name}</div>
                                    <div className="text-[11px] text-slate-400 mt-0.5">
                                      {c.type === 'cash' ? `￥${c.value}立减` : `${c.value}%折扣`}
                                      {c.min_order > 0 && ` · 满￥${c.min_order}可用`}
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0 ml-2">
                                    {c.effective ? (
                                      <div className="text-emerald-600 font-bold text-sm">-￥{c.saved_amount}</div>
                                    ) : (
                                      <div className="text-[10px] text-slate-400">未达门槛</div>
                                    )}
                                    {selected && <div className="text-[10px] text-emerald-600 mt-0.5 font-semibold">✓ 已选</div>}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部结算栏 */}
        {cartCount > 0 && (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-xl z-50">
            <div className="max-w-md mx-auto px-3 py-3 pb-[72px] flex items-center gap-3">
              <div className="flex-1">
                <div className="text-xs text-slate-400">
                  应付 {selectedCoupon && <span className="text-emerald-500">已减￥{selectedCoupon.saved_amount}</span>}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-emerald-600">￥{finalTotal.toFixed(2)}</span>
                  {selectedCoupon && <span className="text-xs text-slate-300 line-through">￥{cartTotal}</span>}
                </div>
              </div>
              <button
                onClick={() => { setCheckoutErr(''); setStep('checkout') }}
                disabled={checkoutLoading}
                className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-medium disabled:opacity-50 shadow-sm hover:shadow-md transition"
              >
                {checkoutLoading ? '下单中...' : '去结算'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // === Checkout（地址选择 + 确认下单）===
  if (step === 'checkout') {
    const selectedAddr = addresses.find((a) => a.id === selectedAddressId)
    const canSubmit = !!selectedAddressId && cartCount > 0

    async function handleAddAddress() {
      if (!customerId) return
      if (!newAddress.name || !newAddress.detail) { alert('请填写收货人姓名和详细地址'); return }
      try {
        const a = await api.createAddress({
          customer_id: customerId,
          name: newAddress.name!,
          phone: newAddress.phone || '',
          province: newAddress.province || '',
          city: newAddress.city || '',
          district: newAddress.district || '',
          detail: newAddress.detail!,
          is_default: newAddress.is_default ? 1 : 0,
        })
        setAddresses((prev) => {
          const next = [...prev, a]
          if (newAddress.is_default) next.forEach((x) => { if (x.id !== a.id) x.is_default = 0 })
          return next
        })
        if (newAddress.is_default) {
          setAddresses((prev) => prev.map((x) => x.id === a.id ? { ...x, is_default: 1 } : { ...x, is_default: 0 }))
        }
        setSelectedAddressId(a.id)
        setShowNewAddress(false)
        setNewAddress({ name: '', phone: '', province: '', city: '', district: '', detail: '', is_default: 0 })
      } catch (e: any) { alert(e.message || '新增地址失败') }
    }

    async function handleSetDefault(id: number) {
      if (!customerId) return
      await api.updateAddress(id, { is_default: 1 })
      setAddresses((prev) => prev.map((a) => a.id === id ? { ...a, is_default: 1 } : { ...a, is_default: 0 }))
    }

    async function handleDeleteAddress(id: number) {
      if (!customerId) return
      if (!window.confirm('确定删除这个地址吗？')) return
      await api.deleteAddress(id)
      setAddresses((prev) => prev.filter((a) => a.id !== id))
      if (selectedAddressId === id) {
        const remaining = addresses.filter((a) => a.id !== id)
        const def = remaining.find((a) => a.is_default === 1)
        setSelectedAddressId(def ? def.id : remaining[0]?.id ?? null)
      }
    }

    return (
      <div className="min-h-screen pb-32">
        <div className="max-w-md mx-auto p-4">
          <div className="flex items-center gap-2 mb-4">
            <button onClick={() => setStep('cart')} className="w-9 h-9 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-600 hover:bg-slate-50 transition">
              <i className="fa-solid fa-chevron-left text-sm" />
            </button>
            <h1 className="text-xl font-bold text-slate-800">确认订单</h1>
          </div>

          {checkoutErr && (
            <div className="bg-rose-50 text-rose-600 text-sm p-3 rounded-xl mb-3 flex items-center gap-2">
              <i className="fa-solid fa-circle-exclamation" />
              {checkoutErr}
            </div>
          )}

          {/* 地址列表 */}
          <div className="bg-white rounded-2xl shadow-sm p-3 mb-3">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <i className="fa-solid fa-location-dot text-emerald-500" />
                收货地址
              </div>
              {!showNewAddress && (
                <button onClick={() => setShowNewAddress(true)}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-0.5">
                  <i className="fa-solid fa-plus" />新增
                </button>
              )}
            </div>

            {addresses.length === 0 && !showNewAddress && (
              <div className="text-center py-6 text-slate-400 text-sm">
                <i className="fa-solid fa-location-dot text-2xl mb-2 block text-slate-300" />
                暂无收货地址，请先添加
              </div>
            )}

            <div className="space-y-2.5">
              {addresses.map((a) => {
                const selected = selectedAddressId === a.id
                return (
                  <label
                    key={a.id}
                    className={`block relative cursor-pointer p-3 rounded-xl border-2 transition-all duration-200 ${
                      selected
                        ? 'border-emerald-500 bg-emerald-50/60 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name="address"
                      className="absolute opacity-0 pointer-events-none"
                      checked={selected}
                      onChange={() => setSelectedAddressId(a.id)}
                    />
                    {selected && (
                      <div className="absolute left-0 top-3 bottom-3 w-1 bg-emerald-500 rounded-r" />
                    )}
                    <div className="flex items-start gap-2.5">
                      <div className={`w-4 h-4 mt-1 rounded-full border-2 shrink-0 flex items-center justify-center ${
                        selected ? 'border-emerald-500' : 'border-slate-300'
                      }`}>
                        {selected && <div className="w-2 h-2 rounded-full bg-emerald-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-semibold text-slate-800">{a.name}</span>
                          {a.phone && <span className="text-slate-500">{a.phone}</span>}
                          {a.is_default === 1 && (
                            <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] rounded font-medium">默认</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                          {[a.province, a.city, a.district].filter(Boolean).join(' ')} {a.detail}
                        </div>
                        {a.is_default !== 1 && selected && (
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSetDefault(a.id) }}
                            className="text-[10px] text-emerald-600 hover:text-emerald-700 mt-1 font-medium"
                          >
                            设为默认
                          </button>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteAddress(a.id) }}
                        className="text-slate-300 hover:text-rose-400 transition"
                        title="删除"
                      >
                        <i className="fa-solid fa-trash-can text-xs" />
                      </button>
                    </div>
                  </label>
                )
              })}
            </div>

            {/* 新增地址表单 */}
            {showNewAddress && (
              <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-2">
                <div className="text-xs font-medium text-slate-600 flex items-center justify-between">
                  <span><i className="fa-solid fa-plus text-emerald-500 mr-1" />新增收货地址</span>
                  <button onClick={() => setShowNewAddress(false)} className="text-slate-400 hover:text-slate-600">
                    <i className="fa-solid fa-xmark text-xs" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={newAddress.name || ''}
                    onChange={(e) => setNewAddress({ ...newAddress, name: e.target.value })}
                    placeholder="收货人姓名"
                    className="h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                  <input
                    value={newAddress.phone || ''}
                    onChange={(e) => setNewAddress({ ...newAddress, phone: e.target.value })}
                    placeholder="联系电话"
                    className="h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    value={newAddress.province || ''}
                    onChange={(e) => setNewAddress({ ...newAddress, province: e.target.value })}
                    placeholder="省"
                    className="h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                  <input
                    value={newAddress.city || ''}
                    onChange={(e) => setNewAddress({ ...newAddress, city: e.target.value })}
                    placeholder="市"
                    className="h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                  <input
                    value={newAddress.district || ''}
                    onChange={(e) => setNewAddress({ ...newAddress, district: e.target.value })}
                    placeholder="区/县"
                    className="h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
                <input
                  value={newAddress.detail || ''}
                  onChange={(e) => setNewAddress({ ...newAddress, detail: e.target.value })}
                  placeholder="详细地址（街道、门牌等）"
                  className="w-full h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!newAddress.is_default}
                    onChange={(e) => setNewAddress({ ...newAddress, is_default: e.target.checked ? 1 : 0 })}
                    className="accent-emerald-500"
                  />
                  设为默认地址
                </label>
                <button
                  onClick={handleAddAddress}
                  className="w-full py-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white text-xs font-medium rounded-lg transition shadow-sm"
                >
                  保存地址
                </button>
              </div>
            )}
          </div>

          {/* 已选地址快捷展示 */}
          {selectedAddr && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3 text-xs">
              <div className="flex items-start gap-2">
                <i className="fa-solid fa-check text-emerald-500 mt-0.5" />
                <div>
                  <span className="font-semibold text-slate-700">{selectedAddr.name}</span>
                  {selectedAddr.phone && <span className="text-slate-500 ml-1.5">{selectedAddr.phone}</span>}
                  <div className="text-slate-500 mt-0.5">
                    {[selectedAddr.province, selectedAddr.city, selectedAddr.district].filter(Boolean).join(' ')} {selectedAddr.detail}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 商品概览 */}
          <div className="bg-white rounded-2xl shadow-sm p-3 mb-3">
            <div className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
              <i className="fa-solid fa-box text-emerald-500" />
              商品清单 <span className="text-xs text-slate-400 font-normal">({cartCount} 件)</span>
            </div>
            <div className="space-y-2">
              {cart?.items.map((it) => (
                <div key={it.cart_id} className="flex gap-2 items-center">
                  <div className="w-10 h-10 rounded-lg bg-slate-50 shrink-0 overflow-hidden">
                    {it.product.image_url ? (
                      <img src={it.product.image_url} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300 text-[10px]">
                        <i className="fa-solid fa-image" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-xs text-slate-700 truncate">{it.product.name}</div>
                  <div className="text-[11px] text-slate-400">×{it.quantity}</div>
                  <div className="text-xs font-bold text-emerald-600 w-16 text-right">￥{(it.product.price * it.quantity).toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 优惠券 */}
          {selectedCoupon && (
            <div className="bg-gradient-to-r from-amber-50 to-amber-100/50 border border-amber-200 rounded-xl p-3 mb-3 text-xs">
              <div className="flex items-center justify-between">
                <div className="text-amber-700 font-medium">
                  <i className="fa-solid fa-tags mr-1.5" />
                  已选：{selectedCoupon.coupon_name}（省￥{selectedCoupon.saved_amount}）
                </div>
                <button onClick={() => setSelectedCoupon(null)} className="text-slate-400 hover:text-slate-600 transition">
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
            </div>
          )}

          {/* 金额汇总 */}
          <div className="bg-white rounded-2xl shadow-sm p-4 space-y-2 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>商品金额</span>
              <span className="text-slate-700">￥{cartTotal.toFixed(2)}</span>
            </div>
            {selectedCoupon && (
              <div className="flex justify-between text-emerald-600">
                <span>优惠券抵扣</span>
                <span>-￥{selectedCoupon.saved_amount.toFixed(2)}</span>
              </div>
            )}
            <div className="pt-2 border-t border-slate-100 flex justify-between items-center">
              <span className="text-slate-600 font-medium">实付金额</span>
              <span className="text-xl font-bold text-emerald-600">￥{finalTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* 底部提交栏 */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-xl z-50">
          <div className="max-w-md mx-auto px-3 py-3 pb-[72px] flex items-center gap-3">
            <div className="flex-1">
              <div className="text-xs text-slate-400">实付</div>
              <div className="text-2xl font-bold text-emerald-600">￥{finalTotal.toFixed(2)}</div>
            </div>
            <button
              onClick={handlePlaceOrder}
              disabled={!canSubmit || checkoutLoading}
              className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 disabled:opacity-50 text-white rounded-xl font-medium shadow-sm hover:shadow-md transition"
            >
              {checkoutLoading ? '提交中...' : '提交订单'}
            </button>
          </div>
        </div>

        {/* === 微信支付底部 sheet（非微信环境显示） === */}
        {showPaySheet && orderResult?.pay_required && (
          <div
            className="fixed inset-0 z-[100] flex items-end bg-black/40 pointer-events-auto"
            onClick={() => {
              setShowPaySheet(false)
              ;(window as any).__payReject?.('用户取消')
            }}
          >
            <div
              className="relative z-10 w-full max-w-md mx-auto bg-white rounded-t-3xl p-6 pb-8 animate-[slideUp_0.25s_ease] pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 顶部标题栏 */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <i className="fa-brands fa-weixin text-emerald-500 text-2xl"></i>
                  <span className="text-lg font-semibold text-slate-800">微信支付</span>
                  <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">模拟</span>
                </div>
                <button
                  onClick={() => {
                    setShowPaySheet(false)
                    ;(window as any).__payReject?.('用户取消')
                  }}
                  className="text-slate-400 text-lg w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center"
                >
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>

              {/* 金额展示 */}
              <div className="text-center py-4 mb-5">
                <p className="text-xs text-slate-400 mb-1">支付金额</p>
                <p className="text-4xl font-bold text-slate-900">
                  <span className="text-xl align-top mr-0.5">￥</span>
                  {Number(orderResult.final_pay_amount).toFixed(2)}
                </p>
              </div>

              {/* 支付方式 */}
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center">
                    <i className="fa-solid fa-wallet text-white"></i>
                  </div>
                  <div>
                    <p className="font-medium text-slate-800">零钱</p>
                    <p className="text-[11px] text-slate-400">可用余额充足，优先支付</p>
                  </div>
                </div>
                <div className="w-5 h-5 rounded-full border-2 border-emerald-500 flex items-center justify-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                </div>
              </div>

              {/* 确认支付按钮 */}
              <button
                onClick={async () => {
                  try {
                    setPaying(true); setPayError('')
                    await fetch('/api/pay/wechat/mock-success', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ order_no: orderResult.order_no }),
                    })
                    setShowPaySheet(false)
                    ;(window as any).__payResolve?.()
                    setStep('success')
                  } catch (e: any) {
                    setPayError(e.message || '支付失败')
                  } finally {
                    setPaying(false)
                  }
                }}
                disabled={paying}
                className="relative z-20 w-full py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-2xl font-semibold shadow-lg shadow-emerald-500/30 hover:shadow-xl transition-all disabled:opacity-60 pointer-events-auto cursor-pointer"
              >
                {paying ? (
                  <><i className="fa-solid fa-spinner fa-spin mr-2"></i>支付中...</>
                ) : (
                  <>确认支付 ￥{Number(orderResult.final_pay_amount).toFixed(2)}</>
                )}
              </button>

              {payError && <p className="mt-3 text-center text-sm text-rose-500">{payError}</p>}
              <p className="mt-4 text-center text-[11px] text-slate-400">
                本页面支持 PC 浏览器模拟支付 · 真实微信内自动拉起支付
              </p>
            </div>
          </div>
        )}
      </div>
    )
  }

  // === 商城首页 ===
  const CAT_ICONS: Record<string, string> = {
    'all': 'fa-bag-shopping',
  }
  const KEYWORDS_FOR_ICONS: Record<string, string> = {
    '食品': 'fa-apple-whole',
    '生鲜': 'fa-apple-whole',
    '茶叶': 'fa-wine-glass',
    '酒水': 'fa-wine-glass',
    '家居': 'fa-couch',
    '生活': 'fa-couch',
    '礼盒': 'fa-gift',
    '节令': 'fa-gift',
  }
  function getCatIcon(name: string): string {
    for (const [kw, ic] of Object.entries(KEYWORDS_FOR_ICONS)) {
      if (name.includes(kw)) return ic
    }
    return 'fa-tag'
  }

  return (
    <div className="min-h-screen pb-28">
      {/* 顶部 Banner */}
      <div className="bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 text-white pt-6 pb-8 shadow-lg">
        <div className="max-w-md mx-auto px-4">
          {/* 活动公告条 */}
          <div className="bg-white/20 backdrop-blur-sm rounded-full px-3 py-1.5 mb-3 flex items-center gap-2 text-[11px] overflow-hidden">
            <i className="fa-solid fa-bullhorn shrink-0" />
            <div key={annIdx} className="flex items-center gap-1.5 w-full animate-[fadeIn_0.4s_ease]">
              <i className={`fa-solid ${announcements[annIdx].icon}`} />
              <span className="truncate">{announcements[annIdx].text}</span>
            </div>
          </div>

          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight">逸云会员商城</h1>
              <div className="text-[11px] opacity-90 mt-0.5">私域专属 · 正品保障 · 极速发货</div>
            </div>
            {customerName && (
              <div className="text-[10px] opacity-75 shrink-0">
                {customerName}
              </div>
            )}
          </div>

          {/* 搜索 */}
          <div className="mt-4 relative">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400 text-xs" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索商品..."
              className="w-full pl-9 pr-3 py-2.5 bg-white rounded-full text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-white/50 shadow-sm"
            />
          </div>
        </div>
      </div>

      {/* 分类 chips */}
      <div className="max-w-md mx-auto px-4 pt-4 -mt-4">
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
          <button
            onClick={() => setActiveCat('all')}
            className={`shrink-0 px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 flex items-center gap-1.5 ${
              activeCat === 'all'
                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-emerald-300 hover:text-emerald-600'
            }`}
          >
            <i className="fa-solid fa-bag-shopping text-[11px]" />
            全部商品
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCat(c.id)}
              className={`shrink-0 px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 flex items-center gap-1.5 ${
                activeCat === c.id
                  ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200 scale-[1.02]'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-emerald-300 hover:text-emerald-600'
              }`}
            >
              <i className={`fa-solid ${getCatIcon(c.name)} text-[11px]`} />
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* 商品列表 */}
      <div className="max-w-md mx-auto p-4">
        {loading ? (
          <div className="bg-white rounded-3xl p-12 text-center">
            <i className="fa-solid fa-spinner fa-spin text-3xl text-emerald-400" />
            <div className="text-xs mt-3 text-slate-500">商品加载中...</div>
          </div>
        ) : loadErr ? (
          <div className="bg-rose-50 text-rose-600 text-sm p-4 rounded-2xl text-center">{loadErr}</div>
        ) : filteredProducts.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-slate-100 flex items-center justify-center">
              <i className="fa-solid fa-box text-2xl text-slate-300" />
            </div>
            <div className="text-sm text-slate-500">暂无商品</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredProducts.map((p) => {
              const out = p.stock === 0
              const discount = p.original_price != null && p.original_price > p.price
              return (
                <div
                  key={p.id}
                  onClick={() => openProductDetail(p.id)}
                  className="bg-white rounded-2xl overflow-hidden shadow-sm cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                >
                  <div className="aspect-square bg-gradient-to-br from-slate-50 to-slate-100 relative overflow-hidden">
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        className="w-full h-full object-cover transition-opacity duration-300"
                        onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-200">
                        <i className="fa-solid fa-image text-4xl" />
                      </div>
                    )}
                    {p.tag && (
                      <span className="absolute top-2 right-2 px-2 py-0.5 bg-gradient-to-r from-amber-500 to-amber-400 text-white text-[10px] font-semibold rounded-full shadow-sm">
                        {p.tag}
                      </span>
                    )}
                    {p.sold > 0 && (
                      <span className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/40 text-white text-[9px] rounded backdrop-blur-sm">
                        已售 {p.sold}
                      </span>
                    )}
                    {out && (
                      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center">
                        <span className="px-3 py-1 bg-white/95 text-slate-600 text-xs font-semibold rounded-full shadow-sm">
                          <i className="fa-solid fa-circle-xmark text-rose-400 mr-1" />暂时缺货
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="text-sm font-semibold text-slate-800 truncate">{p.name}</div>
                    {p.category_name && (
                      <div className="text-[10px] text-slate-400 mt-0.5">{p.category_name}</div>
                    )}
                    <div className="flex items-baseline gap-1 mt-1.5">
                      <span className="text-lg font-bold text-emerald-600">￥{p.price}</span>
                      {discount && (
                        <span className="text-[11px] text-slate-300 line-through">￥{p.original_price}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="text-[10px] text-slate-400">
                        {p.sold > 0 ? `月销 ${p.sold}` : `库存 ${p.stock}`}
                      </div>
                      {!out && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAddToCart(p.id) }}
                          className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-sm hover:shadow-md hover:scale-110 transition-all duration-200 flex items-center justify-center"
                          title="加入购物车"
                        >
                          <i className="fa-solid fa-plus text-[11px]" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
