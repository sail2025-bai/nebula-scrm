import { useState, useEffect } from 'react'
import { api } from '../../api'
import type { Product } from '../../types'

interface Props {
  productId: number | null
  customerCode: string | null
  navigate: (page: string, extra?: Record<string, string>) => void
}

export default function ProductDetailView({ productId, customerCode, navigate }: Props) {
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [toast, setToast] = useState('')
  const [activeTab, setActiveTab] = useState<'desc' | 'spec'>('desc')
  const [favorite, setFavorite] = useState(false)
  const [bounceCart, setBounceCart] = useState(false)

  useEffect(() => {
    if (!productId) {
      setErr('商品 ID 缺失')
      setLoading(false)
      return
    }
    const pid: number = productId
    let mounted = true
    async function load() {
      try {
        const p = await api.getProduct(pid)
        if (mounted) setProduct(p)
      } catch (e: any) {
        if (mounted) setErr(e.message || '商品不存在')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
  }, [productId])

  // 反查 customerId
  useEffect(() => {
    if (!customerCode) return
    fetch(`/api/public/customer/${customerCode}/coupons`)
      .then((r) => r.json())
      .then((d) => { if (d.customer) setCustomerId(d.customer.id) })
      .catch(() => {})
  }, [customerCode])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 1800)
  }

  const out = product?.stock === 0
  const maxQty = product?.stock || 0

  async function handleAddToCart() {
    if (!product || out) return
    if (!customerId) { showToast('客户信息缺失'); return }
    try {
      await api.addToCart(customerId, product.id, quantity)
      showToast(`已加入购物车 × ${quantity}`)
      setBounceCart(true)
      setTimeout(() => setBounceCart(false), 600)
    } catch (e: any) {
      showToast(e.message || '加购失败')
    }
  }

  async function handleBuyNow() {
    if (!product || out) return
    if (!customerId) { showToast('客户信息缺失'); return }
    try {
      await api.addToCart(customerId, product.id, quantity)
      showToast('跳转结算...')
      setTimeout(() => {
        const extra: Record<string, string> = {}
        if (customerCode) extra.code = customerCode
        navigate('shop', extra)
      }, 500)
    } catch (e: any) {
      showToast(e.message || '加购失败')
    }
  }

  function goBack() {
    const extra: Record<string, string> = {}
    if (customerCode) extra.code = customerCode
    navigate('shop', extra)
  }

  // === Loading / Error ===
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-emerald-50 flex items-center justify-center">
            <i className="fa-solid fa-spinner fa-spin text-2xl text-emerald-500" />
          </div>
          <div className="text-xs text-slate-500">商品加载中...</div>
        </div>
      </div>
    )
  }
  if (err || !product) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
        <div className="bg-white rounded-3xl p-8 text-center max-w-sm shadow-sm">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-rose-50 flex items-center justify-center">
            <i className="fa-solid fa-circle-exclamation text-2xl text-rose-400" />
          </div>
          <div className="text-sm text-slate-600 mb-5">{err || '商品不存在或已下架'}</div>
          <button
            onClick={goBack}
            className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-full text-sm font-medium shadow-sm hover:shadow-md transition"
          >
            <i className="fa-solid fa-arrow-left mr-1" />返回商城
          </button>
        </div>
      </div>
    )
  }

  const discount = product.original_price != null && product.original_price > product.price
  const stockLow = !out && product.stock > 0 && product.stock <= 10

  return (
    <div className="min-h-screen pb-32 bg-slate-50">
      {/* 商品图区 + 悬浮返回按钮 */}
      <div className="relative max-w-md mx-auto">
        <div className="aspect-square bg-gradient-to-br from-slate-50 to-slate-100 relative overflow-hidden">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-full object-cover transition-opacity duration-500"
              onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-200">
              <i className="fa-solid fa-image text-6xl" />
            </div>
          )}

          {/* 标签 */}
          {product.tag && (
            <span className="absolute top-4 left-4 px-3 py-1 bg-gradient-to-r from-amber-500 to-amber-400 text-white text-xs font-semibold rounded-full shadow-md">
              <i className="fa-solid fa-star mr-1 text-[10px]" />{product.tag}
            </span>
          )}

          {/* 返回按钮 */}
          <button
            onClick={goBack}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/85 backdrop-blur-md shadow-md flex items-center justify-center text-slate-700 hover:bg-white transition"
          >
            <i className="fa-solid fa-arrow-left text-sm" />
          </button>

          {out && (
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center">
              <div className="bg-white/95 rounded-2xl px-6 py-4 text-center shadow-lg">
                <i className="fa-solid fa-circle-xmark text-3xl text-rose-400 mb-2" />
                <div className="text-slate-700 font-semibold">暂时缺货</div>
                <div className="text-xs text-slate-400 mt-1">敬请期待补货</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 价格 + 名称卡片 */}
      <div className="max-w-md mx-auto px-4 -mt-3 relative z-10">
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-3xl font-bold text-emerald-600 leading-none">￥{product.price}</span>
            {discount && (
              <>
                <span className="text-sm text-slate-300 line-through">￥{product.original_price}</span>
                <span className="px-1.5 py-0.5 bg-amber-50 text-amber-600 text-[10px] font-semibold rounded">
                  省￥{(product.original_price! - product.price).toFixed(0)}
                </span>
              </>
            )}
          </div>
          <h1 className="text-base font-semibold text-slate-800 mt-3 leading-snug">{product.name}</h1>

          {/* 销量/库存/分类 一行 */}
          <div className="flex items-center gap-3 mt-3 text-[11px]">
            <div className="flex items-center gap-1 text-slate-500">
              <i className="fa-solid fa-fire text-amber-400" />
              销量 <span className="font-semibold text-slate-700">{product.sold}</span>
            </div>
            <div className="w-px h-3 bg-slate-200" />
            <div className={`flex items-center gap-1 ${out ? 'text-rose-500' : stockLow ? 'text-amber-500' : 'text-slate-500'}`}>
              <i className="fa-solid fa-box" />
              {out ? '已售罄' : stockLow ? `仅剩 ${product.stock} 件` : `库存 ${product.stock}`}
            </div>
            {product.category_name && (
              <>
                <div className="w-px h-3 bg-slate-200" />
                <div className="flex items-center gap-1 text-slate-500">
                  <i className="fa-solid fa-tag text-slate-400" />
                  {product.category_name}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 数量选择 */}
      {!out && (
        <div className="max-w-md mx-auto px-4 mt-3">
          <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between">
            <div>
              <span className="text-sm text-slate-600 font-medium">购买数量</span>
              {maxQty > 0 && (
                <span className="text-[10px] text-slate-400 ml-2">（库存 {maxQty}）</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                className="w-9 h-9 rounded-full bg-emerald-50 disabled:opacity-40 text-emerald-500 hover:bg-emerald-100 transition font-semibold flex items-center justify-center"
              >
                −
              </button>
              <span className="w-8 text-center text-base font-bold text-slate-800">{quantity}</span>
              <button
                onClick={() => setQuantity((q) => Math.min(maxQty || 99, q + 1))}
                disabled={maxQty > 0 && quantity >= maxQty}
                className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-white disabled:opacity-40 hover:shadow-md transition font-semibold flex items-center justify-center shadow-sm"
              >
                +
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 切换：详情 / 规格 */}
      <div className="max-w-md mx-auto px-4 mt-3">
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="flex border-b border-slate-100">
            <button
              onClick={() => setActiveTab('desc')}
              className={`flex-1 py-3 text-sm font-medium transition relative ${
                activeTab === 'desc' ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <i className="fa-solid fa-book-open mr-1 text-[11px]" />
              商品详情
              {activeTab === 'desc' && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-emerald-500 rounded-full" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('spec')}
              className={`flex-1 py-3 text-sm font-medium transition relative ${
                activeTab === 'spec' ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <i className="fa-solid fa-list mr-1 text-[11px]" />
              规格信息
              {activeTab === 'spec' && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-emerald-500 rounded-full" />
              )}
            </button>
          </div>

          <div className="p-4">
            {activeTab === 'desc' ? (
              product.description ? (
                <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {product.description}
                </div>
              ) : (
                <div className="text-sm text-slate-400 text-center py-4">
                  <i className="fa-solid fa-file-lines text-xl block mb-2 text-slate-300" />
                  暂无描述信息
                </div>
              )
            ) : (
              <div className="space-y-3">
                <Row label="商品名称" value={product.name} />
                <Row label="分类" value={product.category_name || '未分类'} />
                {product.sku && <Row label="SKU" value={product.sku} />}
                <Row label="商品价格" value={`￥${product.price}`} />
                {discount && <Row label="原价" value={`￥${product.original_price}`} />}
                <Row label="库存" value={out ? '已售罄' : `${product.stock} 件`} />
                <Row label="已售" value={`${product.sold} 件`} />
                <Row label="上架状态" value={product.active === 1 ? '在售中' : '已下架'} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底部固定操作栏 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-xl z-30">
        <div className="max-w-md mx-auto px-3 py-3 flex items-center gap-3">
          {/* 左：客服 + 收藏 */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => showToast('客服功能开发中')}
              className="w-12 h-12 flex flex-col items-center justify-center text-slate-500 hover:text-emerald-500 transition"
            >
              <i className="fa-solid fa-headset text-base" />
              <span className="text-[9px] mt-0.5">客服</span>
            </button>
            <button
              onClick={() => { setFavorite((f) => !f); showToast(favorite ? '已取消收藏' : '已收藏') }}
              className={`w-12 h-12 flex flex-col items-center justify-center transition ${
                favorite ? 'text-rose-500' : 'text-slate-500 hover:text-rose-400'
              }`}
            >
              <i className={`fa-${favorite ? 'solid' : 'regular'} fa-heart text-base`} />
              <span className="text-[9px] mt-0.5">收藏</span>
            </button>
            <button
              onClick={() => { const extra: Record<string, string> = {}; if (customerCode) extra.code = customerCode; navigate('shop', extra) }}
              className={`w-12 h-12 flex flex-col items-center justify-center text-slate-500 hover:text-emerald-500 transition relative ${
                bounceCart ? 'animate-[bounce_0.5s_ease]' : ''
              }`}
            >
              <i className="fa-solid fa-cart-shopping text-base" />
              <span className="text-[9px] mt-0.5">购物车</span>
            </button>
          </div>

          {/* 价格 + 操作按钮 */}
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-emerald-600">￥{product.price}</span>
              {discount && <span className="text-[10px] text-slate-300 line-through">￥{product.original_price}</span>}
            </div>
          </div>

          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleAddToCart}
              disabled={out}
              className="px-4 py-2.5 border-2 border-emerald-500 text-emerald-600 disabled:opacity-40 rounded-xl font-medium text-sm transition hover:bg-emerald-50"
            >
              加入购物车
            </button>
            <button
              onClick={handleBuyNow}
              disabled={out}
              className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 disabled:opacity-40 text-white rounded-xl font-medium text-sm shadow-sm hover:shadow-md transition"
            >
              立即购买
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 bg-slate-800/95 text-white text-sm px-5 py-2.5 rounded-full shadow-lg backdrop-blur">
          <i className="fa-solid fa-circle-check text-emerald-400 mr-1.5" />
          {toast}
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-700 font-medium text-right">{value}</span>
    </div>
  )
}
