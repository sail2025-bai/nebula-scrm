import { useCallback, useEffect, useState } from 'react'
import Sidebar, { type ViewId } from './components/layout/Sidebar'
import Header from './components/layout/Header'
import CustomerDrawer from './components/customers/CustomerDrawer'
import AuthView from './views/AuthView'
import DashboardView from './views/DashboardView'
import CustomersView from './views/CustomersView'
import SegmentsView from './views/SegmentsView'
import GroupsView from './views/GroupsView'
import SopView from './views/SopView'
import BroadcastView from './views/BroadcastView'
import SeasView from './views/SeasView'
import QrCodeView from './views/QrCodeView'
import WecomView from './views/WecomView'
import CouponView from './views/CouponView'
import SeckillView from './views/SeckillView'
import { api } from './api'
import { MODE_META, type AuthUser, type BizMode, type DashboardStats } from './types'
import { ToastProvider, useToast } from './components/ui/Toast'

const TITLES: Record<ViewId, string> = {
  dashboard: '运营监控仪表盘',
  customers: '客户资产 360° 视图',
  seas: '线索公海',
  qrcodes: '渠道活码',
  segments: '客户分群管理',
  groups: '企微社群矩阵运营',
  sop: 'SOP 自动化策略流',
  coupons: '优惠券与发券中心',
  seckill: '限时秒杀与福利抢单',
  broadcast: '精准触达与群发',
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
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [dataVersion, setDataVersion] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(readStoredUser)
  const [mode, setMode] = useState<BizMode>(() => user?.businessMode ?? 'retail')
  const { showToast } = useToast()

  useEffect(() => {
    if (!user) return
    api.getDashboardStats(mode).then(setStats).catch(() => {})
  }, [mode, dataVersion, user])

  const handleAuth = useCallback((authUser: AuthUser) => {
    localStorage.setItem('scrm_auth', JSON.stringify(authUser))
    setUser(authUser)
    setMode(authUser.businessMode)
  }, [])

  const handleLogout = useCallback(() => {
    localStorage.removeItem('scrm_auth')
    setUser(null)
  }, [])

  const handleModeChange = useCallback(
    (next: BizMode) => {
      setMode(next)
      setDataVersion((v) => v + 1)
      showToast(`已切换至【${MODE_META[next].label}】`)
    },
    [showToast]
  )

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
        mode={mode}
        onModeChange={handleModeChange}
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
          mode={mode}
          onModeChange={handleModeChange}
        />

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
          {view === 'dashboard' && (
            <DashboardView mode={mode} onNavigate={setView} onOpenCustomer={setDrawerCustomerId} dataVersion={dataVersion} />
          )}
          {view === 'customers' && (
            <CustomersView mode={mode} searchQuery={search} onOpenCustomer={setDrawerCustomerId} dataVersion={dataVersion} />
          )}
          {view === 'seas' && <SeasView mode={mode} dataVersion={dataVersion} onChanged={handleDataChange} />}
          {view === 'qrcodes' && <QrCodeView mode={mode} dataVersion={dataVersion} onChanged={handleDataChange} />}
          {view === 'wecom' && <WecomView />}
          {view === 'segments' && (
            <SegmentsView mode={mode} onOpenCustomer={setDrawerCustomerId} dataVersion={dataVersion} />
          )}
          {view === 'groups' && <GroupsView mode={mode} dataVersion={dataVersion} />}
          {view === 'sop' && <SopView mode={mode} />}
          {view === 'coupons' && <CouponView mode={mode} />}
          {view === 'seckill' && <SeckillView mode={mode} />}
          {view === 'broadcast' && <BroadcastView mode={mode} openSignal={broadcastSignal} dataVersion={dataVersion} />}
        </div>
      </main>

      <CustomerDrawer
        mode={mode}
        customerId={drawerCustomerId}
        onClose={() => setDrawerCustomerId(null)}
        onChanged={handleDataChange}
      />
    </div>
  )
}

export default function AppRoot() {
  return (
    <ToastProvider>
      <App />
    </ToastProvider>
  )
}
