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
  FUNNEL,
  MODE_META,
  STAGE_META,
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

export default function DashboardView({ onNavigate, onOpenCustomer, dataVersion}: DashboardViewProps) {
  const { showToast } = useToast()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [trend, setTrend] = useState<TrendData | null>(null)
  const [days, setDays] = useState(7)

  // === 历史日报 ===
  const [reports, setReports] = useState<{
    id: number; day: string;
    summary?: {
      customers_new?: number; customers_new_vs_prev?: number;
      orders_count?: number; orders_paid_count?: number; orders_amount?: number; orders_amount_vs_prev?: number;
      coupon_redeem?: number; sop_runs?: number; events_total?: number;
      chat_keyword_hits?: number; chat_need_reply?: number;
      loyal_count?: number; churn_count?: number;
      pending_broadcasts?: number; active_sops?: number;
    } | null;
    sop_top?: { name: string; trigger_type: string; success_count: number; target_count: number }[];
    channel_top?: { channel: string; n: number }[];
  }[]>([])
  const [reportDays, setReportDays] = useState(7)
  const [runningReport, setRunningReport] = useState(false)

  const loadStats = useCallback(() => {
    api.getDashboardStats().then(setStats).catch(() => setStats(null))
  }, [])

  const loadTrend = useCallback(
    (d: number) => {
      api.getTrend(d).then(setTrend).catch(() => setTrend(null))
    },
    [],
  )

  const loadReports = useCallback((d: number) => {
    api.getDailyReports(d)
      .then(r => setReports(r.rows))
      .catch(() => setReports([]))
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats, dataVersion])

  useEffect(() => {
    loadTrend(days)
  }, [loadTrend, days])

  useEffect(() => {
    loadReports(reportDays)
  }, [loadReports, reportDays])

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

  const handleRunReport = async () => {
    if (runningReport) return
    setRunningReport(true)
    try {
      const r = await api.runDailyReport()
      const newRows = [{ id: 0, day: r.day, summary: r.summary, sop_top: [], channel_top: [] }]
      setReports(prev => {
        const withoutDup = prev.filter(x => x.day !== r.day)
        return [...newRows, ...withoutDup].slice(0, reportDays)
      })
      showToast(`✅ ${r.day} 日报已生成`, 'success')
    } catch (e) {
      showToast(e instanceof Error ? e.message : '日报生成失败', 'warning')
    } finally {
      setRunningReport(false)
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
          label={MODE_META.revenueTitle}
          value={stats ? formatMoney(stats.monthSpend) : '—'}
          icon={MODE_META.revenueIcon}
          iconCls="bg-amber-50 text-amber-600"
          leftText={`${MODE_META.revenueSub1Label} ${stats ? formatMoney(stats.avgOrderValue) : '—'}`}
          leftCls="text-amber-600"
          rightText={`${MODE_META.revenueSub2Label} ${stats?.repeatRate ?? 0}%`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 custom-shadow lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="min-w-0">
              <h4 className="font-bold text-slate-900 text-sm">近7日加微净增与流失趋势</h4>
              <p className="text-xs text-slate-400 hidden sm:block">{MODE_META.trendDesc}</p>
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
                  <span className={`w-2 h-2 rounded-full shrink-0 ${STAGE_META[s.stage].dot}`} />
                  <span className="text-slate-600 w-20 shrink-0">{STAGE_META[s.stage].label}</span>
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
        <h4 className="font-bold text-slate-900 text-sm mb-1">{MODE_META.funnelTitle}</h4>
        <p className="text-xs text-slate-400 mb-4">当前模式各阶段流转率</p>
        <div className="space-y-3.5">
          {FUNNEL.map((step) => (
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
            {MODE_META.funnelSummary}
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

      {/* ===== 历史日报 ===== */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 custom-shadow">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h4 className="font-bold text-slate-900 text-sm">
              <i className="fa-solid fa-newspaper text-emerald-500 mr-1.5" />
              运营日报 · 历史 近{reportDays} 天
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">Scheduler 每天 08:00 自动跑，也可手动生成今日日报</p>
          </div>
          <div className="flex items-center gap-2">
            {[3, 7, 14, 30].map(d => (
              <button
                key={d}
                onClick={() => setReportDays(d)}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition ${
                  reportDays === d ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                近{d}天
              </button>
            ))}
            <button
              onClick={handleRunReport}
              disabled={runningReport}
              className="px-3 py-1 text-xs font-medium bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-md shadow-sm flex items-center gap-1.5 hover:opacity-90 disabled:opacity-60 transition"
            >
              <i className={`fa-solid ${runningReport ? 'fa-spinner fa-spin' : 'fa-bolt'}`} />
              {runningReport ? '生成中…' : '手动生成今日'}
            </button>
          </div>
        </div>

        {reports.length === 0 ? (
          <Empty icon="fa-solid fa-clipboard-list" title="暂无日报记录" description="点击「手动生成今日」即可出一份新日报" />
        ) : (
          <div className="space-y-2">
            {reports.map(r => {
              const s = r.summary || {}
              const hasSummary = !!r.summary
              return (
                <details
                  key={`${r.id}-${r.day}`}
                  className="group border border-slate-200 rounded-xl px-4 py-3 open:bg-slate-50/40 transition"
                >
                  <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-[11px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded border border-emerald-100">
                        {r.day}
                      </span>
                      {hasSummary ? (
                        <>
                          <span className="text-slate-500 text-xs truncate">
                            新客 <b className="text-slate-800">{s.customers_new ?? 0}</b> ·
                            订单 <b className="text-slate-800">{s.orders_count ?? 0}</b> ·
                            金额 <b className="text-rose-600">￥{s.orders_amount ?? 0}</b> ·
                            SOP 跑 <b className="text-indigo-600">{s.sop_runs ?? 0}</b> 次
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-400 text-xs italic">待补充详情</span>
                      )}
                    </div>
                    <i className="fa-solid fa-chevron-down text-slate-300 text-xs transition group-open:rotate-180" />
                  </summary>

                  {hasSummary && (
                    <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-2 text-xs">
                      <ReportMetric label="新客" value={s.customers_new ?? 0} delta={s.customers_new_vs_prev} />
                      <ReportMetric label="订单数" value={s.orders_count ?? 0} />
                      <ReportMetric label="已支付" value={s.orders_paid_count ?? 0} />
                      <ReportMetric label="订单金额" value={`￥${formatMoney(s.orders_amount ?? 0)}`} delta={s.orders_amount_vs_prev} />
                      <ReportMetric label="券核销" value={s.coupon_redeem ?? 0} />
                      <ReportMetric label="SOP 运行" value={s.sop_runs ?? 0} />
                      <ReportMetric label="事件总数" value={s.events_total ?? 0} />
                      <ReportMetric label="关键词命中" value={s.chat_keyword_hits ?? 0} />
                      <ReportMetric label="待回复" value={s.chat_need_reply ?? 0} />
                      <ReportMetric label="活跃 SOP" value={s.active_sops ?? 0} />
                      <ReportMetric label="待发群发" value={s.pending_broadcasts ?? 0} />
                      <ReportMetric label="高价值客户" value={s.loyal_count ?? 0} />
                      <ReportMetric label="流失预警" value={s.churn_count ?? 0} tone="warn" />
                    </div>
                  )}

                  {r.channel_top && r.channel_top.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100 text-xs">
                      <div className="text-slate-400 mb-1.5">渠道 TOP{Math.min(3, r.channel_top.length)}</div>
                      <div className="flex flex-wrap gap-2">
                        {r.channel_top.map((c, i) => (
                          <span key={c.channel} className="px-2 py-0.5 bg-slate-100 rounded text-slate-600">
                            {i + 1}. <b>{c.channel}</b> {c.n}人
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </details>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ReportMetric({ label, value, delta, tone }: {
  label: string; value: string | number; delta?: number; tone?: 'warn'
}) {
  const deltaCls = delta === undefined || delta === 0
    ? 'text-slate-400'
    : delta > 0 ? 'text-emerald-600' : 'text-rose-600'
  const arrow = delta === undefined || delta === 0 ? null : (delta > 0 ? '▲' : '▼')
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold ${tone === 'warn' ? 'text-rose-600' : 'text-slate-800'}`}>
        {value}
        {delta !== undefined && delta !== 0 && (
          <span className={`ml-1 text-[10px] font-medium ${deltaCls}`}>
            {arrow}{Math.abs(delta)}%
          </span>
        )}
      </span>
    </div>
  )
}
