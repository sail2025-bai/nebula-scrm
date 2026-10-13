import React, { Suspense, useCallback, useEffect, useState } from 'react'
import Sidebar, { type ViewId } from './components/layout/Sidebar'
import Header from './components/layout/Header'
import CustomerDrawer from './components/customers/CustomerDrawer'
import AuthView from './views/AuthView'

// 路由级代码分割：每个 view 独立 chunk，按需加载
const DashboardView = React.lazy(() => import('./views/DashboardView'))
const CustomersView = React.lazy(() => import('./views/CustomersView'))
const SegmentsView = React.lazy(() => import('./views/SegmentsView'))
const GroupsView = React.lazy(() => import('./views/GroupsView'))
const SopView = React.lazy(() => import('./views/SopView'))
const BroadcastView = React.lazy(() => import('./views/BroadcastView'))
const SeasView = React.lazy(() => import('./views/SeasView'))
const QrCodeView = React.lazy(() => import('./views/QrCodeView'))
const WecomView = React.lazy(() => import('./views/WecomView'))
const CouponView = React.lazy(() => import('./views/CouponView'))
const SeckillView = React.lazy(() => import('./views/SeckillView'))
const StaffView = React.lazy(() => import('./views/StaffView'))
const TagLibraryView = React.lazy(() => import('./views/TagLibraryView'))
const FollowUpsView = React.lazy(() => import('./views/FollowUpsView'))
const ProductView = React.lazy(() => import('./views/ProductView'))
const OrdersView = React.lazy(() => import('./views/OrdersView'))
import { api } from './api'
import type { AuthUser, DashboardStats } from './types'
import { ToastProvider } from './components/ui/Toast'
import { DialogProvider } from './components/ui/DialogProvider'

const TITLES: Record<ViewId, string> = {
  dashboard: '运营监控仪表盘',
  customers: '客户资产 360° 视图',
  followups: '今日待跟进',
  seas: '线索公海',
  qrcodes: '渠道活码',
  segments: '客户分群管理',
  groups: '企微社群矩阵运营',
  sop: 'SOP 自动化策略流',
  coupons: '优惠券与发券中心',
  seckill: '限时秒杀与福利抢单',
  broadcast: '精准触达与群发',
  staff: '员工管理',
  tags: '标签库管理',
  products: '商品与商城管理',
  orders: '订单管理',
  wecom: '企微对接中心'
}

function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem('scrm_auth')
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

function App() {
  const [view, setView] = useState<ViewId>('dashboard')
  const [search, setSearch] = useState('')
  const [drawerCustomerId, setDrawerCustomerId] = useState<number | null>(null)
  const [broadcastSignal, setBroadcastSignal] = useState(0)
  const [qrPrefill, setQrPrefill] = useState<{ target_type: 'coupon' | 'seckill'; target_id: number; suggestName?: string; ticket: number } | null>(null)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [dataVersion, setDataVersion] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(readStoredUser)

  useEffect(() => {
    if (!user) return
    api.getDashboardStats().then(setStats).catch(() => {})
  }, [dataVersion, user])

  const handleAuth = useCallback((authUser: AuthUser) => {
    localStorage.setItem('scrm_auth', JSON.stringify(authUser))
    setUser(authUser)
  }, [])

  const handleLogout = useCallback(() => {
    localStorage.removeItem('scrm_auth')
    setUser(null)
  }, [])

  const handleNav = useCallback((next: ViewId) => {
    setView(next)
    setSidebarOpen(false)
  }, [])

  const handleSearch = useCallback((value: string) => {
    setSearch(value)
    if (value.trim()) {
      setView('customers')
    }
  }, [])

  const handleNewBroadcast = useCallback(() => {
    setView('broadcast')
    setBroadcastSignal((s) => s + 1)
  }, [])

  const handleDataChange = useCallback(() => {
    setDataVersion((v) => v + 1)
  }, [])

  if (!user) {
    return <AuthView onAuth={handleAuth} />
  }

  return (
    <div className="h-screen supports-[height:100dvh]:h-[100dvh] flex overflow-hidden bg-slate-50 text-slate-800 font-sans">
      <div
        onClick={() => setSidebarOpen(false)}
        className={`md:hidden fixed inset-0 bg-slate-900/40 z-40 transition-opacity duration-300 ${
          sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <Sidebar
        current={view}
        onChange={handleNav}
        userName={user.name}
        churnCount={stats?.churnCount ?? 0}
        activeSop={stats?.activeSop ?? 0}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 overflow-hidden relative">
        <Header
          title={TITLES[view]}
          searchValue={search}
          onSearch={handleSearch}
          onNewBroadcast={handleNewBroadcast}
          onMenuClick={() => setSidebarOpen(true)}
          userName={user.name}
          onLogout={handleLogout}
        />

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
          <Suspense fallback={
            <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400">
              <i className="fa-solid fa-spinner fa-spin text-3xl text-indigo-400" />
              <span className="text-xs">模块加载中…</span>
            </div>
          }>
            {view === 'dashboard' && (
              <DashboardView onNavigate={setView} onOpenCustomer={setDrawerCustomerId} dataVersion={dataVersion} />
            )}
            {view === 'followups' && <FollowUpsView dataVersion={dataVersion} />}
            {view === 'customers' && (
              <CustomersView searchQuery={search} onOpenCustomer={setDrawerCustomerId} dataVersion={dataVersion} />
            )}
            {view === 'seas' && <SeasView dataVersion={dataVersion} onChanged={handleDataChange} />}
            {view === 'qrcodes' && <QrCodeView dataVersion={dataVersion} onChanged={handleDataChange} prefill={qrPrefill} onPrefillConsumed={() => setQrPrefill(null)} />}
            {view === 'wecom' && <WecomView />}
            {view === 'segments' && (
              <SegmentsView onOpenCustomer={setDrawerCustomerId} dataVersion={dataVersion} />
            )}
            {view === 'groups' && <GroupsView dataVersion={dataVersion} />}
            {view === 'sop' && <SopView />}
            {view === 'coupons' && <CouponView onPrefillQr={(p) => { setQrPrefill({ ...p, ticket: Date.now() }); setView('qrcodes') }} />}
            {view === 'seckill' && <SeckillView onPrefillQr={(p) => { setQrPrefill({ ...p, ticket: Date.now() }); setView('qrcodes') }} />}
            {view === 'products' && <ProductView dataVersion={dataVersion} />}
            {view === 'orders' && <OrdersView dataVersion={dataVersion} />}
            {view === 'staff' && <StaffView />}
            {view === 'tags' && <TagLibraryView />}
            {view === 'broadcast' && <BroadcastView openSignal={broadcastSignal} dataVersion={dataVersion} />}
          </Suspense>
        </div>
      </main>

      <CustomerDrawer
        customerId={drawerCustomerId}
        onClose={() => setDrawerCustomerId(null)}
        onChanged={handleDataChange}
      />
    </div>
  )
}

export default function AppRoot() {
  return (
    <DialogProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DialogProvider>
  )
}
