import { useEffect, useState } from 'react'
import { api } from '../api'
import type { FollowUp, FollowUpSummary } from '../types'
import { useToast } from '../components/ui/Toast'

type TabKey = 'overdue' | 'today' | 'pending' | 'unassigned' | 'done'

interface Props { dataVersion?: number }

const TABS: { key: TabKey; label: string; badge?: keyof FollowUpSummary }[] = [
  { key: 'overdue', label: '⚠️ 已逾期', badge: 'overdue' },
  { key: 'today', label: '📅 今日待办', badge: 'today' },
  { key: 'pending', label: '📋 全部待处理', badge: 'pending' },
  { key: 'unassigned', label: '❓ 未指派', badge: 'unassigned' },
  { key: 'done', label: '✅ 已完成', badge: 'done' }
]

const TYPE_META: Record<string, { label: string; icon: string; color: string }> = {
  wechat: { label: '企微沟通', icon: 'fa-brands fa-weixin', color: 'text-emerald-600' },
  call: { label: '电话回访', icon: 'fa-solid fa-phone', color: 'text-blue-600' },
  visit: { label: '到店拜访', icon: 'fa-solid fa-store', color: 'text-purple-600' },
  gift: { label: '赠券/礼品', icon: 'fa-solid fa-gift', color: 'text-amber-600' },
  note: { label: '备注记录', icon: 'fa-solid fa-pen', color: 'text-slate-600' },
  sop_phone_call: { label: 'SOP 电话', icon: 'fa-solid fa-phone', color: 'text-rose-600' },
  sop_send_wechat: { label: 'SOP 企微', icon: 'fa-brands fa-weixin', color: 'text-emerald-600' },
  sop_gift_send: { label: 'SOP 寄礼', icon: 'fa-solid fa-gift', color: 'text-amber-600' },
  sop_invite_group: { label: 'SOP 拉群', icon: 'fa-solid fa-comments', color: 'text-indigo-600' }
}

function daysBetween(a: string, b: Date): number {
  const da = new Date(a.replace(' ', 'T'))
  return Math.floor((da.getTime() - b.getTime()) / 86400000)
}

function formatDue(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s.replace(' ', 'T'))
  const now = new Date()
  const diff = Math.floor((d.getTime() - now.getTime()) / 86400000)
  const hm = s.slice(5, 16)
  if (diff < 0) return `逾期 ${-diff} 天（${hm}）`
  if (diff === 0) return `今日 ${hm.slice(3)}`
  if (diff === 1) return `明日 ${hm.slice(3)}`
  return `${diff} 天后（${hm}）`
}

export default function FollowUpsView({ dataVersion }: Props) {
  const [tab, setTab] = useState<TabKey>('overdue')
  const [items, setItems] = useState<FollowUp[]>([])
  const [summary, setSummary] = useState<FollowUpSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const { showToast } = useToast()

  useEffect(() => {
    setLoading(true)
    const params: any = {}
    if (tab === 'overdue') { params.status = 'pending'; params.scope = 'overdue' }
    else if (tab === 'today') { params.status = 'pending'; params.scope = 'today' }
    else if (tab === 'pending') { params.status = 'pending' }
    else if (tab === 'done') { params.status = 'done' }
    else if (tab === 'unassigned') { params.status = 'pending' }

    Promise.all([
      api.getFollowUps(params),
      tab === 'overdue' || tab === 'today' || tab === 'pending'
        ? api.getFollowUpSummary()
        : Promise.resolve(null)
    ]).then(([list, sum]) => {
      let filtered: FollowUp[] = list
      if (tab === 'unassigned') filtered = list.filter(f => !f.staff_id)
      setItems(filtered)
      if (sum) setSummary(sum)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [tab, dataVersion])

  const handleAssign = async (id: number) => {
    try {
      const r = await api.assignFollowUp(id)
      if (r.ok) {
        showToast('✅ 已指派顾问 + 推企微', 'success')
        setItems(prev => prev.filter(x => x.id !== id))
      }
    } catch (e: any) {
      showToast(e?.message || "指派失败", "error" as any)
    }
  }

  const handleComplete = async (id: number) => {
    try {
      const r = await api.completeFollowUp(id)
      if (r.ok) {
        showToast('✅ 已标记完成', 'success')
        setItems(prev => prev.filter(x => x.id !== id))
        setSummary(s => s ? { ...s, pending: Math.max(0, (s.pending ?? 0) - 1), done: (s.done ?? 0) + 1 } : s)
      }
    } catch (e: any) {
      showToast(e?.message || "操作失败", "error" as any)
    }
  }

  const typeBadge = (t: string) => {
    const m = TYPE_META[t] || TYPE_META[t.replace('sop_', '')] || { label: t, icon: 'fa-solid fa-tag', color: 'text-slate-600' }
    return (
      <span className={`inline-flex items-center gap-1 text-xs ${m.color}`}>
        <i className={m.icon}></i>
        {m.label}
      </span>
    )
  }

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard icon="fa-triangle-exclamation" color="bg-rose-50 text-rose-600" label="已逾期" value={summary.overdue ?? 0} />
          <SummaryCard icon="fa-calendar-day" color="bg-amber-50 text-amber-600" label="今日待办" value={summary.today ?? 0} />
          <SummaryCard icon="fa-list-check" color="bg-blue-50 text-blue-600" label="待处理合计" value={summary.pending ?? 0} />
          <SummaryCard icon="fa-user-slash" color="bg-slate-50 text-slate-600" label="未指派" value={summary.unassigned ?? 0} />
        </div>
      )}

      {/* Tabs — 胶囊容器 + emerald 主色（全局基准） */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit flex-wrap">
        {TABS.map(t => {
          const active = tab === t.key
          const count = t.badge && summary ? (summary[t.badge] ?? 0) : undefined
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition ${
                active
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
              {count !== undefined && count > 0 && (
                <span className={`ml-1.5 inline-flex items-center justify-center min-w-[18px] h-4 px-1 text-[10px] font-semibold rounded-full ${
                  active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-slate-400"><i className="fa-solid fa-spinner fa-spin mr-2"></i>加载中…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <i className="fa-solid fa-check-circle text-4xl mb-3 text-emerald-300"></i>
          <div className="text-lg">没有待办 🎉</div>
          <div className="text-sm mt-1">SOP 执行 / 手动创建的跟进会出现在这里</div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(f => {
            const isOverdue = f.next_followup_at && new Date(f.next_followup_at.replace(' ', 'T')) < new Date() && !['已完成', '已取消'].includes(f.outcome || '')
            return (
              <div key={f.id} className={`bg-white rounded-xl border p-4 hover:shadow-md transition ${
                isOverdue ? 'border-rose-200 ring-1 ring-rose-100' : 'border-slate-200'
              }`}>
                <div className="flex items-start gap-4">
                  {/* type icon circle */}
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center text-lg shrink-0 ${
                    isOverdue ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                  }`}>
                    {typeBadge(f.type).props.children[0]}
                  </div>

                  {/* main content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800">{typeBadge(f.type).props.children[1]}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-sm text-slate-600 truncate max-w-[200px]">
                        客户：{f.customerName || `#${f.customer_id}`}
                        {f.customerNick && f.customerNick !== f.customerName && <span className="text-slate-400">（{f.customerNick}）</span>}
                      </span>
                      {f.staffName ? (
                        <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full">
                          <i className="fa-solid fa-user-tie mr-1"></i>{f.staffName}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full">
                          <i className="fa-solid fa-exclamation mr-1"></i>未指派
                        </span>
                      )}
                    </div>
                    <div className="text-slate-700 mt-1.5 text-sm leading-relaxed">{f.content}</div>
                    <div className="flex items-center gap-4 mt-2.5 text-xs text-slate-500">
                      <span className={isOverdue ? 'text-rose-600 font-medium' : ''}>
                        <i className="fa-regular fa-clock mr-1"></i>
                        {formatDue(f.next_followup_at)}
                      </span>
                      <span>
                        <i className="fa-regular fa-calendar mr-1"></i>
                        创建于 {f.created_at.slice(5, 16)}
                      </span>
                      {f.outcome && <span className="text-slate-400">状态: {f.outcome}</span>}
                    </div>
                  </div>

                  {/* actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {!['已完成', '已取消'].includes(f.outcome || '') && (
                      <>
                        {!f.staff_id && (
                          <button
                            onClick={() => handleAssign(f.id)}
                            className="text-xs px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg transition"
                            title="指派给对应顾问并推企微内部消息"
                          >
                            <i className="fa-solid fa-paper-plane mr-1"></i>指派
                          </button>
                        )}
                        <button
                          onClick={() => handleComplete(f.id)}
                          className="text-xs px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition"
                        >
                          <i className="fa-solid fa-check mr-1"></i>完成
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ icon, color, label, value }: { icon: string; color: string; label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <i className={icon}></i>
        </div>
        <div>
          <div className="text-xs text-slate-500">{label}</div>
          <div className="text-2xl font-bold text-slate-800">{value}</div>
        </div>
      </div>
    </div>
  )
}
