import { useCallback, useEffect, useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
  type ChartData,
  type ChartOptions
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { api } from '../api'
import {
  FUNNEL_BY_MODE,
  MODE_META,
  STAGE_META_BY_MODE,
  type BizMode,
  type DashboardStats,
  type TrendData
} from '../types'
import type { ViewId } from '../components/layout/Sidebar'
import { useToast } from '../components/ui/Toast'
import Avatar from '../components/ui/Avatar'
import Empty from '../components/ui/Empty'
import { formatMoney } from '../utils'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)

const CHANNEL_COLORS = ['bg-slate-400', 'bg-teal-500', 'bg-emerald-500']

const chartOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      position: 'top',
      labels: { boxWidth: 12, boxHeight: 12, font: { size: 11 }, color: '#475569' }
    }
  },
  scales: {
    y: {
      grid: { color: '#f1f5f9' },
      border: { display: false },
      ticks: { font: { size: 11 }, color: '#94a3b8' }
    },
    x: {
      grid: { display: false },
      ticks: { font: { size: 11 }, color: '#94a3b8' }
    }
  }
}

interface DashboardViewProps {
  onNavigate: (v: ViewId) => void
  onOpenCustomer: (id: number) => void
  dataVersion: number
  mode: BizMode
}

interface MetricCardProps {
  label: string
  value: string
  unit?: string
  icon: string
  iconCls: string
  leftIcon?: string
  leftText: string
  leftCls: string
  rightText: string
}

function MetricCard({ label, value, unit, icon, iconCls, leftIcon, leftText, leftCls, rightText }: MetricCardProps) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200/80 custom-shadow card-hover">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <h3 className="text-2xl font-bold text-slate-900 mt-1.5">
            {value}
            {unit && <span className="text-xs font-normal text-slate-400 ml-0.5">{unit}</span>}
          </h3>
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-base ${iconCls}`}>
          <i className={icon} />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between text-xs">
        <span className={`font-semibold flex items-center gap-1 ${leftCls}`}>
          {leftIcon && <i className={leftIcon} />}
          {leftText}
        </span>
        <span className="text-slate-400">{rightText}</span>
      </div>
    </div>
  )
}

export default function DashboardView({ onNavigate, onOpenCustomer, dataVersion, mode }: DashboardViewProps) {
  const { showToast } = useToast()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [trend, setTrend] = useState<TrendData | null>(null)
  const [days, setDays] = useState(7)

  const loadStats = useCallback(() => {
    api.getDashboardStats(mode).then(setStats).catch(() => setStats(null))
  }, [mode])

  const loadTrend = useCallback(
    (d: number) => {
      api.getTrend(d, mode).then(setTrend).catch(() => setTrend(null))
    },
    [mode]
  )

  useEffect(() => {
    loadStats()
  }, [loadStats, dataVersion, mode])

  useEffect(() => {
    loadTrend(days)
  }, [loadTrend, days, mode])

  const handleComplete = async (id: string | number, name: string) => {
    const numId = Number(String(id).replace(/^fu_/, ''))
    try {
      await api.completeFollowUp(numId, '顾问已完成')
      setStats(prev =>
        prev ? { ...prev, pendingTasks: prev.pendingTasks.map(t => (t.id === id ? { ...t, done: true } : t)) } : prev
      )
      showToast(`「${name.slice(0, 20)}」已标记完成`, 'success')
    } catch (e) {
      showToast(e instanceof Error ? e.message : '标记失败', 'warning')
    }
  }

  const chartData: ChartData<'line'> | null = trend
    ? {
        labels: trend.labels,
        datasets: [
          {
            label: '每日净新增好友/线索',
            data: trend.added,
            borderColor: '#059669',
            backgroundColor: 'rgba(5,150,105,0.08)',
            fill: true,
            tension: 0.35,
            borderWidth: 2.5,
            pointRadius: 3,
            pointBackgroundColor: '#059669'
          },
          {
            label: '客户流失/停滞数',
            data: trend.churned,
            borderColor: '#f43f5e',
            fill: false,
            tension: 0.35,
            borderWidth: 1.8,
            borderDash: [5, 5],
            pointRadius: 3,
            pointBackgroundColor: '#f43f5e'
          }
        ]
      }
    : null

  const pending = stats?.pendingTasks ?? []
  const doneCount = pending.filter(t => t.done).length
  const fu = stats?.followupStats ?? { overdue: 0, todayDue: 0, future: 0 }
  const churnRisks = stats?.churnRisks ?? []
  const channelStats = stats?.channelStats ?? []
  const channelMax = Math.max(...channelStats.map(c => c.count), 1)
  const stageStats = stats?.stageStats ?? []
  const stageMax = Math.max(...stageStats.map(s => s.count), 1)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="企微私域总客户数"
          value={stats ? stats.totalCustomers.toLocaleString() : '—'}
          icon="fa-solid fa-address-book"
          iconCls="bg-emerald-50 text-emerald-600"
          leftIcon="fa-solid fa-arrow-trend-up"
          leftText={`+${stats?.weekGrowthRate ?? 0}%`}
          leftCls="text-emerald-600"
          rightText={`较上周净增 +${stats?.weekNetAdd ?? 0} 人`}
        />
        <MetricCard
          label="今日新增企微客户"
          value={stats ? String(stats.todayNew) : '—'}
          unit="人"
          icon="fa-solid fa-user-plus"
          iconCls="bg-blue-50 text-blue-600"
          leftText={`今日跟进 ${stats?.todayFollowups ?? 0} 次`}
          leftCls="text-blue-600"
          rightText="新客首购 SOP 已自动触达"
        />
        <MetricCard
          label="运营中企微社群"
          value={stats ? String(stats.totalGroups) : '—'}
          unit="个"
          icon="fa-solid fa-comments"
          iconCls="bg-purple-50 text-purple-600"
          leftText={`发言率 ${stats?.avgSpeakRate ?? 0}%`}
          leftCls="text-purple-600"
          rightText={`群成员累计 ${(stats?.groupMemberTotal ?? 0).toLocaleString()}`}
        />
        <MetricCard
          label={MODE_META[mode].revenueTitle}
          value={stats ? formatMoney(stats.monthSpend) : '—'}
          icon={MODE_META[mode].revenueIcon}
          iconCls="bg-amber-50 text-amber-600"
          leftText={`${MODE_META[mode].revenueSub1Label} ${stats ? formatMoney(stats.avgOrderValue) : '—'}`}
          leftCls="text-amber-600"
          rightText={`${MODE_META[mode].revenueSub2Label} ${stats?.repeatRate ?? 0}%`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 custom-shadow lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="min-w-0">
              <h4 className="font-bold text-slate-900 text-sm">近7日加微净增与流失趋势</h4>
              <p className="text-xs text-slate-400 hidden sm:block">{MODE_META[mode].trendDesc}</p>
            </div>
            <div className="flex gap-2">
              {[
                { label: '按日', value: 1 },
                { label: '近7天', value: 7 },
                { label: '近30天', value: 30 }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDays(opt.value)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                    days === opt.value ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-64">
            {chartData ? (
              <Line data={chartData} options={chartOptions} />
            ) : (
              <div className="h-full flex items-center justify-center text-slate-300">
                <i className="fa-solid fa-chart-line text-2xl" />
              </div>
            )}
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 custom-shadow flex flex-col justify-between">
          <div>
            <h4 className="font-bold text-slate-900 text-sm mb-1">渠道获客结构</h4>
            <p className="text-xs text-slate-400 mb-4">各引流触点客户来源占比</p>
            {channelStats.length ? (
              <div className="space-y-3 text-xs">
                {channelStats.map((cs, i) => (
                  <div key={cs.channel}>
                    <div className="flex justify-between mb-1">
                      <span className="font-medium text-slate-700">{cs.channel}</span>
                      <span className="text-slate-500">{cs.count} 人</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div
                        className={`${CHANNEL_COLORS[i % CHANNEL_COLORS.length]} h-full rounded-full`}
                        style={{ width: `${Math.max((cs.count / channelMax) * 100, 4)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty icon="fa-solid fa-chart-simple" title="暂无渠道数据" />
            )}
          </div>
          <div className="pt-4 mt-4 border-t border-slate-100">
            <h5 className="text-xs font-bold text-slate-900 mb-3">客户生命周期分布</h5>
            <div className="space-y-2.5">
              {stageStats.map(s => (
                <div key={s.stage} className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${STAGE_META_BY_MODE[mode][s.stage].dot}`} />
                  <span className="text-slate-600 w-20 shrink-0">{STAGE_META_BY_MODE[mode][s.stage].label}</span>
                  <div className="flex-1 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full"
                      style={{ width: `${Math.max((s.count / stageMax) * 100, 4)}%` }}
                    />
                  </div>
                  <span className="text-slate-500 font-medium w-12 text-right">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>覆盖 {(stats?.totalCustomers ?? 0).toLocaleString()} 位私域客户</span>
            <button onClick={() => onNavigate('sop')} className="text-emerald-600 font-medium hover:underline">
              优化转化SOP &rarr;
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 custom-shadow">
        <h4 className="font-bold text-slate-900 text-sm mb-1">{MODE_META[mode].funnelTitle}</h4>
        <p className="text-xs text-slate-400 mb-4">当前模式各阶段流转率</p>
        <div className="space-y-3.5">
          {FUNNEL_BY_MODE[mode].map((step) => (
            <div key={step.name}>
              <div className="flex flex-wrap items-center justify-between gap-1 mb-1 text-xs">
                <span className="font-medium text-slate-700">{step.name}</span>
                <span className="text-slate-500">{step.count}</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${step.color}`}
                  style={{ width: step.pct }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="pt-3 mt-4 border-t border-slate-100 text-xs text-slate-500 flex items-center justify-between gap-2">
          <span>
            <i className="fa-solid fa-arrow-trend-up text-emerald-500 mr-1" />
            {MODE_META[mode].funnelSummary}
          </span>
          <button onClick={() => onNavigate('sop')} className="text-emerald-600 font-medium hover:underline shrink-0">
            优化跟进SOP &rarr;
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 custom-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <h4 className="font-bold text-slate-900 text-sm">SOP 待跟进提醒</h4>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-medium">
              {fu.overdue > 0 && (
                <span className="px-2 py-0.5 bg-rose-50 text-rose-600 border border-rose-200 rounded">
                  <i className="fa-solid fa-triangle-exclamation mr-0.5" />逾期 {fu.overdue}
                </span>
              )}
              {fu.todayDue > 0 && (
                <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded">
                  <i className="fa-regular fa-clock mr-0.5" />今日 {fu.todayDue}
                </span>
              )}
              {fu.future > 0 && (
                <span className="px-2 py-0.5 bg-slate-50 text-slate-500 border border-slate-200 rounded">
                  <i className="fa-regular fa-calendar mr-0.5" />未来 {fu.future}
                </span>
              )}
            </div>
          </div>
          {pending.length ? (
            <div className="space-y-2.5">
              {pending.map(t => {
                const overdue = !t.done && !!t.overdue
                const icon = t.done
                  ? { icon: 'fa-solid fa-check', cls: 'bg-slate-200 text-slate-600' }
                  : overdue
                    ? { icon: 'fa-solid fa-bell', cls: 'bg-rose-100 text-rose-700' }
                    : { icon: 'fa-solid fa-bolt', cls: 'bg-emerald-100 text-emerald-700' }
                return (
                  <div
                    key={t.id}
                    className={`p-3 bg-slate-50 border rounded-xl flex flex-wrap items-center justify-between gap-2 transition ${
                      overdue
                        ? 'border-rose-200 bg-rose-50/40'
                        : t.done
                          ? 'border-slate-100 opacity-60'
                          : 'border-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs shrink-0 ${icon.cls}`}>
                        <i className={icon.icon} />
                      </div>
                      <div className="min-w-0">
                        <div className={`text-xs font-semibold text-slate-900 truncate ${t.done ? 'line-through' : ''}`}>{t.name}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                          {overdue && <span className="text-rose-600 font-medium">⚠ 已逾期</span>}
                          {!overdue && t.dueAt && <span className="text-slate-400">⏰ {t.dueAt}</span>}
                          <span className="text-slate-400">· {t.target}</span>
                        </div>
                      </div>
                    </div>
                    {t.done ? (
                      <span className="text-xs text-slate-400 font-medium px-2 py-1 bg-slate-100 rounded">已完成</span>
                    ) : (
                      <button
                        onClick={() => handleComplete(t.id, t.name)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                          overdue
                            ? 'bg-rose-600 hover:bg-rose-700 text-white'
                            : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        } active:scale-95 shrink-0`}
                      >
                        '标记完成'
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <Empty
              icon="fa-regular fa-clipboard-check"
              title="今日运营任务已全部完成"
              description="SOP 待办提醒将实时同步至看板"
            />
          )}
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 custom-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <h4 className="font-bold text-slate-900 text-sm">高危流失客户智能预警</h4>
            </div>
            <span className="text-xs text-rose-500 bg-rose-50 px-2 py-0.5 rounded font-medium">RFM监测模型</span>
          </div>
          {churnRisks.length ? (
            <div className="space-y-3">
              {churnRisks.map(c => {
                const isChurn = c.risk.includes('退群')
                return (
                  <div
                    key={c.id}
                    className={`flex flex-wrap items-center justify-between gap-2 p-3 border rounded-xl ${
                      isChurn ? 'border-rose-100 bg-rose-50/40' : 'border-amber-100 bg-amber-50/40'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={c.name} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900">
                          {c.name}
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded ml-1.5 font-medium ${
                              isChurn ? 'text-rose-600 bg-rose-100' : 'text-amber-600 bg-amber-100'
                            }`}
                          >
                            {c.risk}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">{c.detail}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => onOpenCustomer(c.id)}
                      className={`px-2.5 py-1 text-xs border bg-white rounded-lg transition shrink-0 ml-3 ${
                        isChurn
                          ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                          : 'border-amber-200 text-amber-700 hover:bg-amber-50'
                      }`}
                    >
                      {isChurn ? '紧急挽留' : '查看画像'}
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <Empty
              icon="fa-solid fa-shield-heart"
              title="暂无高危流失预警"
              description="RFM 模型持续监测客户活跃与消费异动"
            />
          )}
        </div>
      </div>
    </div>
  )
}
