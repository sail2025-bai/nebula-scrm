import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { MODE_META, type AuthUser, type BizMode } from '../types'

const MODE_OPTIONS: { value: BizMode; icon: string; iconColor: string; desc: string }[] = [
  { value: 'retail', icon: 'fa-solid fa-cart-shopping', iconColor: 'text-emerald-600', desc: '个人消费者 · 会员运营 · 电商零售' },
  { value: 'service', icon: 'fa-solid fa-briefcase', iconColor: 'text-blue-600', desc: '企业客户 · 销售线索 · 大客户商机' }
]

const inputClass =
  'w-full pl-9 pr-3 py-2.5 text-sm bg-slate-100 border border-transparent rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none transition'

/** 检查当前是否处于企微侧边栏环境：URL 带 code 参数 */
function detectSidebarCode(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  return code && code.length > 0 ? code : null
}

/** 判断是否运行在企微 WebView 内（User-Agent 含 wxwork 关键字） */
function isInWecomWebview(): boolean {
  if (typeof navigator === 'undefined') return false
  return /wxwork/i.test(navigator.userAgent)
}

export default function AuthView({ onAuth }: { onAuth: (user: AuthUser) => void }) {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [sidebarBusy, setSidebarBusy] = useState(false)

  const [loginAccount, setLoginAccount] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [name, setName] = useState('')
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [businessMode, setBusinessMode] = useState<BizMode | null>(null)

  const sidebarCode = useMemo(() => detectSidebarCode(), [])
  const inWecom = useMemo(() => isInWecomWebview(), [])

  // 自动侧边栏登录：在企微内 + URL 带 code → 静默登录
  useEffect(() => {
    if (sidebarCode && inWecom) {
      handleSidebarLogin(sidebarCode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarCode, inWecom])

  const switchTab = (next: 'login' | 'register') => {
    setTab(next)
    setApiError('')
    setErrors({})
  }

  const fillDemo = () => {
    setLoginAccount('admin')
    setLoginPassword('admin123')
    switchTab('login')
  }

  const handleLogin = async () => {
    const next: Record<string, string> = {}
    if (!loginAccount.trim()) next.loginAccount = '请输入账号'
    if (!loginPassword) next.loginPassword = '请输入密码'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setLoading(true)
    setApiError('')
    try {
      const { user } = await api.login({ account: loginAccount.trim(), password: loginPassword })
      onAuth(user)
    } catch (err) {
      setApiError(err instanceof Error ? err.message : '登录失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = '请输入姓名'
    if (!account.trim()) next.account = '请输入账号'
    if (!password) next.password = '请输入密码'
    else if (password.length < 6) next.password = '密码长度至少 6 位'
    if (!confirmPassword) next.confirmPassword = '请再次输入密码'
    else if (password !== confirmPassword) next.confirmPassword = '两次输入的密码不一致'
    if (!businessMode) next.businessMode = '请选择业务模式'
    setErrors(next)
    if (Object.keys(next).length > 0 || !businessMode) return
    setLoading(true)
    setApiError('')
    try {
      const { user } = await api.register({
        name: name.trim(),
        account: account.trim(),
        password,
        businessMode
      })
      onAuth(user)
    } catch (err) {
      setApiError(err instanceof Error ? err.message : '注册失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const handleSidebarLogin = async (code: string, forceSimulate = false) => {
    setSidebarBusy(true)
    setApiError('')
    try {
      const payload = forceSimulate ? { code: 'SIM_' + Date.now().toString(36) } : { code }
      const res = await api.wxlogin(payload)
      onAuth(res.user)
    } catch (err) {
      setApiError(err instanceof Error ? err.message : '企微侧边栏登录失败')
    } finally {
      setSidebarBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl p-6 sm:p-8">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 text-white flex items-center justify-center shadow-md shadow-emerald-200">
            <i className="fa-solid fa-users-viewfinder text-xl" />
          </div>
          <h1 className="mt-3 text-lg font-bold text-slate-900 tracking-tight">星云企微SCRM</h1>
          <p className="mt-1 text-xs text-slate-400 tracking-wide">私域全链路增长引擎</p>
        </div>

        {/* 企微侧边栏登录入口 */}
        <div className="mt-5 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-xs">
                <i className="fa-brands fa-weixin" />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-900">企微侧边栏一键登录</div>
                <div className="text-[10px] text-slate-500">
                  {inWecom
                    ? '检测到企微 WebView，正在静默登录...'
                    : '在企微工作台侧边栏内打开可免密登录'}
                </div>
              </div>
            </div>
            {sidebarCode && inWecom && (
              <span className="text-[10px] bg-emerald-600 text-white px-2 py-0.5 rounded-full animate-pulse">
                自动
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={sidebarBusy}
              onClick={() => {
                if (sidebarCode) handleSidebarLogin(sidebarCode)
                else handleSidebarLogin('', true)
              }}
              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition active:scale-[0.98]"
            >
              {sidebarBusy ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin" />
                  <span>企微登录中...</span>
                </>
              ) : (
                <>
                  <i className="fa-solid fa-right-to-bracket" />
                  <span>{sidebarCode ? '使用企微身份登录' : '模拟企微侧边栏登录'}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                const w = window.open(
                  `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(
                    '请在企微对接中心配置 CORP_ID'
                  )}&redirect_uri=${encodeURIComponent(window.location.origin)}&response_type=code&scope=snsapi_base&agentid=0&state=STATE#wechat_redirect`,
                  '_blank'
                )
                if (!w) setApiError('请允许弹窗以便跳转企微授权')
              }}
              className="px-3 py-2 bg-white border border-emerald-300 text-emerald-700 text-xs font-medium rounded-lg hover:bg-emerald-50 transition"
              title="配置真实 CORP_ID 后跳企微授权"
            >
              <i className="fa-solid fa-arrow-up-right-from-square" />
            </button>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-[10px] text-slate-400">或使用账号密码</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        <div className="mt-4 bg-slate-100 p-1 rounded-xl flex">
          <button
            type="button"
            onClick={() => switchTab('login')}
            className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-medium transition ${
              tab === 'login' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            登录
          </button>
          <button
            type="button"
            onClick={() => switchTab('register')}
            className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-medium transition ${
              tab === 'register' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            注册
          </button>
        </div>

        {apiError && (
          <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 text-xs">
            <i className="fa-solid fa-circle-exclamation shrink-0" />
            <span>{apiError}</span>
          </div>
        )}

        {tab === 'login' ? (
          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              handleLogin()
            }}
          >
            <div>
              <label className="block mb-1.5 text-xs font-medium text-slate-600">账号</label>
              <div className="relative">
                <i className="fa-solid fa-user absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                <input
                  type="text"
                  value={loginAccount}
                  onChange={(e) => setLoginAccount(e.target.value)}
                  placeholder="请输入登录账号"
                  className={inputClass}
                />
              </div>
              {errors.loginAccount && <p className="mt-1 text-xs text-rose-600">{errors.loginAccount}</p>}
            </div>
            <div>
              <label className="block mb-1.5 text-xs font-medium text-slate-600">密码</label>
              <div className="relative">
                <i className="fa-solid fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="请输入登录密码"
                  className={inputClass}
                />
              </div>
              {errors.loginPassword && <p className="mt-1 text-xs text-rose-600">{errors.loginPassword}</p>}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2 shadow-sm transition active:scale-95"
            >
              {loading && <i className="fa-solid fa-spinner fa-spin" />}
              {loading ? '正在登录...' : '登录工作台'}
            </button>
          </form>
        ) : (
          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              handleRegister()
            }}
          >
            <div>
              <label className="block mb-1.5 text-xs font-medium text-slate-600">姓名</label>
              <div className="relative">
                <i className="fa-solid fa-id-card absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="请输入真实姓名"
                  className={inputClass}
                />
              </div>
              {errors.name && <p className="mt-1 text-xs text-rose-600">{errors.name}</p>}
            </div>
            <div>
              <label className="block mb-1.5 text-xs font-medium text-slate-600">账号</label>
              <div className="relative">
                <i className="fa-solid fa-user absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                <input
                  type="text"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="请设置登录账号"
                  className={inputClass}
                />
              </div>
              {errors.account && <p className="mt-1 text-xs text-rose-600">{errors.account}</p>}
            </div>
            <div>
              <label className="block mb-1.5 text-xs font-medium text-slate-600">密码</label>
              <div className="relative">
                <i className="fa-solid fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 6 位字符"
                  className={inputClass}
                />
              </div>
              {errors.password && <p className="mt-1 text-xs text-rose-600">{errors.password}</p>}
            </div>
            <div>
              <label className="block mb-1.5 text-xs font-medium text-slate-600">确认密码</label>
              <div className="relative">
                <i className="fa-solid fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="请再次输入密码"
                  className={inputClass}
                />
              </div>
              {errors.confirmPassword && <p className="mt-1 text-xs text-rose-600">{errors.confirmPassword}</p>}
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-600">选择业务模式</div>
              <p className="mb-2 text-[10px] text-slate-400">决定进入系统后的默认视图，注册后可随时切换</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {MODE_OPTIONS.map((opt) => {
                  const selected = businessMode === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setBusinessMode(opt.value)}
                      className={`text-left p-3 rounded-xl border transition ${
                        selected
                          ? 'border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-500'
                          : 'border-slate-200 hover:border-emerald-300'
                      }`}
                    >
                      <i className={`${opt.icon} ${opt.iconColor} text-sm`} />
                      <div className="mt-2 text-xs font-semibold text-slate-800">{MODE_META[opt.value].label}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400">{opt.desc}</div>
                    </button>
                  )
                })}
              </div>
              {errors.businessMode && <p className="mt-1 text-xs text-rose-600">{errors.businessMode}</p>}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2 shadow-sm transition active:scale-95"
            >
              {loading && <i className="fa-solid fa-spinner fa-spin" />}
              {loading ? '正在注册...' : '注册并进入工作台'}
            </button>
          </form>
        )}

        <div className="mt-6 pt-4 border-t border-slate-100 text-center">
          <button type="button" onClick={fillDemo} className="text-xs text-slate-400 hover:text-emerald-600 transition">
            演示账号 admin / admin123
          </button>
        </div>
      </div>
    </div>
  )
}
