import { useEffect, useState } from 'react'
import PublicCouponView from './views/public/PublicCouponView'
import PublicSeckillView from './views/public/PublicSeckillView'
import PublicMyCouponsView from './views/public/PublicMyCouponsView'
import PublicShopView from './views/public/PublicShopView'

// 公开页面路由：/p/[page]?qr=xxx&code=xxx  （无需运营登录）
// 客户扫活码后跳转到这里，通过 URL 参数关联活码/客户
function parseRoute() {
  const path = window.location.pathname.replace(/^\/p\//, '').split('/')[0] || 'coupon'
  const params = new URLSearchParams(window.location.search)
  return {
    page: path as 'coupon' | 'seckill' | 'my-coupons' | 'shop',
    qr: params.get('qr'),
    code: params.get('code'),
    issue: params.get('issue'),
    coupon_code: params.get('coupon_code')
  }
}

export default function PublicApp() {
  const [route, setRoute] = useState(parseRoute())

  useEffect(() => {
    const onPop = () => setRoute(parseRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = (page: string, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams()
    if (route.qr) params.set('qr', route.qr)
    if (route.code) params.set('code', route.code)
    Object.entries(extra).forEach(([k, v]) => params.set(k, v))
    const qs = params.toString()
    window.history.pushState({}, '', `/p/${page}${qs ? '?' + qs : ''}`)
    setRoute({ ...route, page: page as any, ...extra })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-rose-50 to-amber-50">
      {route.page === 'coupon' && <PublicCouponView qrCodeId={route.qr} navigate={navigate} />}
      {route.page === 'seckill' && <PublicSeckillView qrCodeId={route.qr} customerCode={route.code} navigate={navigate} />}
      {route.page === 'my-coupons' && <PublicMyCouponsView customerCode={route.code} navigate={navigate} />}
      {route.page === 'shop' && (
        <PublicShopView
          customerCode={route.code}
          preselectedIssueId={route.issue}
          preselectedCode={route.coupon_code}
          navigate={navigate}
        />
      )}
    </div>
  )
}
