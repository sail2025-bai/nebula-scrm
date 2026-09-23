import { useEffect, useState } from 'react'
import { useToast } from '../ui/Toast'
import { MODE_META, type BizMode } from '../../types'

export type ViewId = 'dashboard' | 'customers' | 'seas' | 'qrcodes' | 'segments' | 'groups' | 'sop' | 'coupons' | 'seckill' | 'broadcast' | 'wecom'

interface SidebarProps {
  current: ViewId
  onChange: (view: ViewId) => void
  mode: BizMode
  onModeChange: (mode: BizMode) => void
  userName?: string
  churnCount: number
  activeSop: number
  mobileOpen: boolean
  onMobileClose: () => void
}

const NAV_ITEMS: { id: ViewId; label: string; icon: string; badgeType?: 'live' | 'churn' | 'sop' }[] = [
  { id: 'dashboard', label: '运营监控仪表盘', icon: 'fa-solid fa-chart-pie', badgeType: 'live' },
  { id: 'customers', label: '客户资产 360°', icon: 'fa-solid fa-user-tag', badgeType: 'churn' },
  { id: 'seas', label: '线索公海', icon: 'fa-solid fa-water' },
  { id: 'qrcodes', label: '渠道活码', icon: 'fa-solid fa-qrcode' },
  { id: 'segments', label: '客户分群管理', icon: 'fa-solid fa-layer-group' },
  { id: 'groups', label: '企微社群矩阵运营', icon: 'fa-solid fa-comments' },
  { id: 'sop', label: 'SOP 自动化策略流', icon: 'fa-solid fa-bolt-lightning', badgeType: 'sop' },
  { id: 'coupons', label: '优惠券与发券中心', icon: 'fa-solid fa-tags' },
  { id: 'seckill', label: '限时秒杀与福利抢单', icon: 'fa-solid fa-bolt' },
  { id: 'broadcast', label: '精准触达与群发', icon: 'fa-solid fa-bullhorn' },
  { id: 'wecom', label: '企微对接中心', icon: 'fa-solid fa-plug' }
]

export default function Sidebar({
  current,
  onChange,
  mode,
  onModeChange,
  userName,
  churnCount,
  activeSop,
  mobileOpen,
  onMobileClose
}: SidebarProps) {
  const { showToast } = useToast()
  const [orgSubText, setOrgSubText] = useState<string>(MODE_META[mode].orgSub)

  // 根据后端真实企微对接状态和 staff 数量动态生成副标题
  useEffect(() => {
    const staffWord = MODE_META[mode].staffWord
    fetch('/api/health')
      .then(r => r.json())
      .then((d: { wecom: { status: string; corp_id_masked: string | null; token_ready: boolean }; counts: { staff: number } }) => {
        const { status, corp_id_masked, token_ready } = d.wecom
        const staffCount = d.counts?.staff ?? 0
        if (status === 'simulated' && !corp_id_masked) {
          setOrgSubText(token_ready ? `企微未完全启用 · 已登记 ${staffCount} 位${staffWord}` : `演示模式 · 已登记 ${staffCount} 位${staffWord}，待企微授权`)
        } else if (corp_id_masked) {
          setOrgSubText(`企微已接入 · 已授权 ${staffCount} 位${staffWord}`)
        } else {
          setOrgSubText(`企微对接中 · 已登记 ${staffCount} 位${staffWord}`)
        }
      })
      .catch(() => { /* 保持默认 */ })
  }, [mode])

  const triggerSync = () => {
    showToast('企微组织架构与客户变动增量同步完成！', 'success')
  }

  return (
    <aside
      className={`fixed md:static inset-y-0 left-0 z-50 w-64 max-w-[85vw] bg-white border-r border-slate-200 flex flex-col justify-between shrink-0 h-full transform transition-transform duration-300 ${
        mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
      } md:translate-x-0 md:shadow-none`}
    >
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="h-16 flex items-center px-6 border-b border-slate-100 gap-3 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-md shadow-emerald-200 shrink-0">
            <i className="fa-solid fa-users-viewfinder text-lg" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-slate-900 leading-none tracking-tight truncate">星云企微SCRM</h1>
            <span className="text-[11px] text-emerald-600 font-medium tracking-wide hidden sm:block">私域全链路增长引擎</span>
          </div>
          <button
            onClick={onMobileClose}
            className="md:hidden ml-auto w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 transition"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="p-4 space-y-2">
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-100/70 transition">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <span className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
                {MODE_META[mode].orgBadge}
              </span>
              <div className="truncate">
                <div className="text-xs font-semibold text-slate-800 truncate">{MODE_META[mode].orgName}</div>
                <div className="text-[10px] text-slate-400">{orgSubText}</div>
              </div>
            </div>
            <i className="fa-solid fa-chevron-down text-xs text-slate-400" />
          </div>

          <div className="bg-slate-100/90 p-1 rounded-xl flex border border-slate-200/60">
            {(['service', 'retail'] as BizMode[]).map((m) => {
              const active = mode === m
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    if (!active) onModeChange(m)
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 transition ${
                    active ? 'bg-white shadow-xs text-emerald-700 font-semibold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <i className={`${MODE_META[m].icon} text-[11px]`} />
                  <span className="text-[11px] whitespace-nowrap">{MODE_META[m].label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <nav className="px-3 space-y-1 pb-4">
          {NAV_ITEMS.map((item) => {
            const active = current === item.id
            return (
              <button
                key={item.id}
                onClick={() => onChange(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  active
                    ? 'text-emerald-700 bg-emerald-50'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <i className={`${item.icon} w-5 text-center ${active ? 'text-emerald-600' : 'text-slate-400'}`} />
                <span>{item.label}</span>
                {item.badgeType === 'live' && (
                  <span className="ml-auto text-[10px] bg-emerald-200/60 text-emerald-800 font-semibold px-2 py-0.5 rounded-full">实时</span>
                )}
                {item.badgeType === 'churn' && churnCount > 0 && (
                  <span className="ml-auto text-[10px] bg-amber-100 text-amber-700 font-medium px-1.5 py-0.5 rounded-full">{churnCount}预警</span>
                )}
                {item.badgeType === 'sop' && (
                  <span className="ml-auto text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full">{activeSop}运行中</span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-slate-100 shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <div className="relative">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-400 text-white font-bold text-sm flex items-center justify-center">
              {(userName ?? '运营人员').charAt(0)}
            </div>
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-wechat border-2 border-white rounded-full" />
          </div>
          <div className="overflow-hidden">
            <div className="text-xs font-semibold text-slate-900 truncate">{userName ?? '运营人员'}</div>
            <div className="text-[11px] text-emerald-600 flex items-center gap-1">
              <i className="fa-brands fa-weixin" /> 企微已联通
            </div>
          </div>
        </div>
        <button
          onClick={triggerSync}
          className="w-full py-1.5 px-3 bg-slate-100 hover:bg-slate-200/80 active:scale-95 text-slate-700 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition"
        >
          <i className="fa-solid fa-rotate text-slate-400 text-xs" />
          <span>同步企微通讯录与动态</span>
        </button>
      </div>
    </aside>
  )
}
