import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { BizMode, Customer, DashboardStats, Staff, Stage, Tag, CouponIssue } from '../types'
import { INTENT_LEVEL_META, MODE_META, STAGE_META_BY_MODE } from '../types'
import { formatMoney, formatRelativeTime } from '../utils'
import Avatar from '../components/ui/Avatar'
import Empty from '../components/ui/Empty'
import Modal from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import CustomerFormModal from '../components/customers/CustomerFormModal'
import TagManageModal from '../components/customers/TagManageModal'

const PAGE_SIZE = 8

function buildPageItems(current: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  if (current <= 3) {
    return [1, 2, 3, 4, '...', totalPages]
  }
  if (current >= totalPages - 2) {
    return [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }
  return [1, '...', current - 1, current, current + 1, '...', totalPages]
}

interface CustomersViewProps {
  searchQuery: string
  onOpenCustomer: (id: number) => void
  dataVersion: number
  mode: BizMode
}

export default function CustomersView({ searchQuery, onOpenCustomer, dataVersion, mode }: CustomersViewProps) {
  const { showToast } = useToast()
  const [stage, setStage] = useState('')
  const [channel, setChannel] = useState('')
  const [staffId, setStaffId] = useState('')
  const [tag, setTag] = useState('')
  const [localSearch, setLocalSearch] = useState(searchQuery)
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<Customer[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [stageStats, setStageStats] = useState<DashboardStats['stageStats']>([])
  const [channels, setChannels] = useState<string[]>([])
  const [staffList, setStaffList] = useState<Staff[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [walletOpen, setWalletOpen] = useState<Customer | null>(null)
  const [walletLoading, setWalletLoading] = useState(false)
  const [walletCoupons, setWalletCoupons] = useState<CouponIssue[]>([])
  const [purchaseOpen, setPurchaseOpen] = useState<Customer | null>(null)
  const [purchaseAmount, setPurchaseAmount] = useState('100')
  const [purchaseCode, setPurchaseCode] = useState('')
  const [purchaseProcessing, setPurchaseProcessing] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [tagManageOpen, setTagManageOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchTagName, setBatchTagName] = useState('')
  const [batchSubmitting, setBatchSubmitting] = useState(false)

  const fetchCustomers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getCustomers({
        stage,
        channel,
        staff_id: staffId,
        tag,
        search: localSearch,
        mode,
        page,
        pageSize: PAGE_SIZE
      })
      setItems(res.items)
      setTotal(res.total)
    } catch (e) {
      showToast((e as Error).message, 'warning')
    } finally {
      setLoading(false)
    }
  }, [stage, channel, staffId, tag, localSearch, page, mode, showToast])

  const loadStats = useCallback(() => {
    api.getDashboardStats(mode).then((stats) => setStageStats(stats.stageStats)).catch(() => {})
  }, [mode])

  useEffect(() => {
    fetchCustomers()
  }, [fetchCustomers, dataVersion])

  useEffect(() => {
    loadStats()
  }, [loadStats, dataVersion])

  useEffect(() => {
    api.getChannels(mode).then(setChannels).catch(() => {})
    api.getStaff().then(setStaffList).catch(() => {})
    api.getTags(mode).then(setTags).catch(() => {})
  }, [mode])

  useEffect(() => {
    setLocalSearch(searchQuery)
    setPage(1)
  }, [searchQuery])

  const refreshAll = useCallback(() => {
    fetchCustomers()
    loadStats()
    api.getTags(mode).then(setTags).catch(() => {})
  }, [fetchCustomers, loadStats, mode])

  const stageFilters: { value: string; label: string }[] = [
    { value: '', label: '全部' },
    ...(['new', 'mature', 'loyal', 'churn'] as Stage[]).map((s) => ({
      value: s,
      label: STAGE_META_BY_MODE[mode][s].label
    }))
  ]

  const stageCount = (value: string): number => {
    if (value === '') {
      return stageStats.reduce((sum, item) => sum + item.count, 0)
    }
    return stageStats.find((item) => item.stage === value)?.count ?? 0
  }

  const pageIds = items.map((item) => item.id)
  const allChecked = pageIds.length > 0 && pageIds.every((id) => selected.has(id))

  const toggleAll = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) {
        pageIds.forEach((id) => next.add(id))
      } else {
        pageIds.forEach((id) => next.delete(id))
      }
      return next
    })
  }

  const toggleOne = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  const submitBatchTag = async () => {
    const name = batchTagName.trim()
    if (!name) {
      showToast('请输入标签名称', 'warning')
      return
    }
    setBatchSubmitting(true)
    try {
      const res = await api.batchTagCustomers(Array.from(selected), name)
      showToast(`已为 ${res.affected} 位客户添加标签「${name}」`)
      setBatchOpen(false)
      setBatchTagName('')
      setSelected(new Set())
      await fetchCustomers()
      loadStats()
      api.getTags(mode).then(setTags).catch(() => {})
    } catch (e) {
      showToast((e as Error).message, 'warning')
    } finally {
      setBatchSubmitting(false)
    }
  }

  const handleDelete = async (customer: Customer) => {
    if (!window.confirm(`确定删除客户「${customer.name}」的档案吗？该操作不可恢复`)) return
    try {
      await api.deleteCustomer(customer.id)
      showToast('客户档案已删除')
      fetchCustomers()
      loadStats()
    } catch (e) {
      showToast((e as Error).message, 'warning')
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)
  const pageItems = buildPageItems(page, totalPages)

  async function openWallet(c: Customer) {
    setWalletOpen(c); setWalletLoading(true); setWalletCoupons([])
    try {
      setWalletCoupons(await api.getCustomerCoupons(c.id))
    } finally { setWalletLoading(false) }
  }

  async function handleRedeemWallet(issue: CouponIssue) {
    if (!purchaseOpen) {
      const amt = prompt('输入核销的订单金额（元）', '100')
      if (!amt) return
      try {
        const r = await api.redeemCoupon({ issue_id: issue.id, order_no: `MANUAL_${Date.now()}`, order_amount: Number(amt) })
        showToast(`核销成功！立省 ￥${r.saved_amount}`, 'success')
        openWallet(walletOpen!)
      } catch(e:any) { showToast(e.message || '核销失败', 'warning') }
    }
  }

  async function handlePurchase() {
    if (!purchaseOpen) return
    const amt = Number(purchaseAmount)
    if (!amt || amt <= 0) return showToast('订单金额非法', 'warning')
    setPurchaseProcessing(true)
    try {
      const r = await api.recordPurchase(purchaseOpen.id, { order_no: `PURCHASE_${Date.now()}`, amount: amt, coupon_code: purchaseCode || undefined })
      // 后端目前只返回 { ok, order_id }，高级字段（new_spend / coupon / sop_triggered）留待后续补
      const displayAmount = r.amount ?? amt
      let msg = `下单成功！消费 ￥${displayAmount}`
      if (r.new_spend !== undefined) msg += `，累计消费 ￥${r.new_spend}`
      if (r.coupon) msg += ` · 券核减 ￥${r.coupon.saved}`
      if (r.was_first_purchase) msg += ' · 首单达成！'
      if (r.sop_triggered) msg += ` · 自动触发「${r.sop_triggered.name}」SOP，下发 ${r.sop_triggered.coupon_issued} 张券`
      showToast(msg, 'success')
      setPurchaseOpen(null); setPurchaseCode(''); setPurchaseAmount('100')
      fetchCustomers()
    } catch(e:any) { showToast(e.message || '下单失败', 'warning') }
    finally { setPurchaseProcessing(false) }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 custom-shadow space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="text-slate-400 font-medium">生命周期:</span>
            {stageFilters.map((f) => (
              <button
                key={f.value}
                onClick={() => {
                  setStage(f.value)
                  setPage(1)
                }}
                className={`px-2.5 py-1 rounded-md transition ${
                  stage === f.value
                    ? 'bg-emerald-50 text-emerald-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {f.label} ({stageCount(f.value).toLocaleString('zh-CN')})
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBatchOpen(true)}
              disabled={selected.size === 0}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i className="fa-solid fa-tags text-slate-500" />
              <span>批量打标签</span>
            </button>
            <button
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
            >
              <i className="fa-solid fa-plus text-xs" />
              <span>新建客户</span>
            </button>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">渠道来源:</span>
            <select
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value)
                setPage(1)
              }}
              className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none"
            >
              <option value="">全部渠道</option>
              {channels.map((ch) => (
                <option key={ch} value={ch}>
                  {ch}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400">企微所属员工:</span>
            <select
              value={staffId}
              onChange={(e) => {
                setStaffId(e.target.value)
                setPage(1)
              }}
              className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none"
            >
              <option value="">全部员工</option>
              {staffList.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name} ({s.role})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400">标签:</span>
            <select
              value={tag}
              onChange={(e) => {
                setTag(e.target.value)
                setPage(1)
              }}
              className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none"
            >
              <option value="">全部标签</option>
              {tags.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setTagManageOpen(true)}
              className="text-emerald-600 hover:underline font-medium flex items-center gap-1"
            >
              <i className="fa-solid fa-gear text-[10px]" />
              管理
            </button>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <span className="text-slate-400">
              已选中的客户: <b className="text-emerald-600 font-semibold">{selected.size}</b> 位
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                <th className="p-3.5 pl-4 w-8">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) => toggleAll(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                </th>
                <th className="p-3.5">客户基本资料</th>
                <th className="p-3.5">生命周期 / 价值等级</th>
                <th className="p-3.5">画像标签 (Tags)</th>
                <th className="p-3.5">引流渠道</th>
                <th className="p-3.5">{MODE_META[mode].valueColTitle}</th>
                <th className="p-3.5">最近私域互动</th>
                <th className="p-3.5 pr-4 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {!loading &&
                items.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => onOpenCustomer(c.id)}
                    className="hover:bg-slate-50/70 cursor-pointer transition-colors"
                  >
                    <td className="p-3.5 pl-4 align-middle">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => toggleOne(c.id, e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={c.name} url={c.avatar} />
                        <div>
                          <div className="font-semibold text-slate-900">{c.name}</div>
                          <div className="text-[11px] text-slate-400">{c.wechat_nick}</div>
                          {mode === 'service' && c.company && (
                            <div className="text-[10px] text-slate-400 truncate">{c.company}</div>
                          )}
                          <div className="text-[11px] text-slate-400">
                            顾问: <span className="text-slate-500">{c.staffName || '--'}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${STAGE_META_BY_MODE[mode][c.stage].badge}`}
                      >
                        {STAGE_META_BY_MODE[mode][c.stage].label}
                      </span>
                      {mode === 'service' && c.intent_level && INTENT_LEVEL_META[c.intent_level] && (
                        <span
                          className={`block mt-1 w-fit px-1.5 py-0.5 rounded text-[10px] font-medium ${INTENT_LEVEL_META[c.intent_level].badge}`}
                        >
                          {INTENT_LEVEL_META[c.intent_level].label}
                        </span>
                      )}
                    </td>
                    <td className="p-3.5">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((t) => (
                          <span key={t.id} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px]">
                            {t.name}
                          </span>
                        ))}
                        {c.tags.length > 3 && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 text-[10px]">
                            +{c.tags.length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5 text-slate-500">{c.channel}</td>
                    <td className="p-3.5 font-bold text-slate-900">{formatMoney(c.spend)}</td>
                    <td className="p-3.5 text-slate-500">{formatRelativeTime(c.last_active)}</td>
                    <td className="p-3.5 pr-4">
                      <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => openWallet(c)}
                          title="查看客户券包 / 手动核销"
                          className="px-2 py-1 rounded-md bg-amber-50 text-amber-700 hover:bg-amber-100 text-[11px] font-medium transition"
                        >
                          券包
                        </button>
                        <button
                          onClick={() => { setPurchaseOpen(c); setPurchaseCode(''); setPurchaseAmount('100') }}
                          title="模拟客户下单"
                          className="px-2 py-1 rounded-md bg-rose-50 text-rose-700 hover:bg-rose-100 text-[11px] font-medium transition"
                        >
                          下单
                        </button>
                        <button
                          onClick={() => onOpenCustomer(c.id)}
                          className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[11px] font-medium transition"
                        >
                          画像
                        </button>
                        <button
                          onClick={() => {
                            setEditing(c)
                            setFormOpen(true)
                          }}
                          className="px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 text-[11px] font-medium transition"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(c)}
                          title="删除客户"
                          className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                        >
                          <i className="fa-regular fa-trash-can text-[11px]" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {loading && (
          <div className="py-16 text-center text-xs text-slate-400">
            <i className="fa-solid fa-circle-notch fa-spin mr-2" />
            正在加载客户数据...
          </div>
        )}
        {!loading && items.length === 0 && (
          <Empty
            icon="fa-regular fa-address-book"
            title="未找到匹配的客户"
            description="请调整筛选条件，或点击右上角「新建客户」创建档案"
          />
        )}

        <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center items-start justify-between gap-3 text-xs text-slate-500">
          <div>
            显示第 {rangeStart} 至 {rangeEnd} 项客户（共 {total} 条）
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              上一页
            </button>
            {pageItems.map((p, i) =>
              typeof p === 'number' ? (
                <button
                  key={i}
                  onClick={() => setPage(p)}
                  className={`px-2.5 py-1 rounded font-medium transition ${
                    p === page ? 'bg-emerald-600 text-white' : 'border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {p}
                </button>
              ) : (
                <span key={i} className="px-1 text-slate-400">
                  ...
                </span>
              )
            )}
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              下一页
            </button>
          </div>
        </div>
      </div>

      <CustomerFormModal
        open={formOpen}
        customer={editing}
        mode={mode}
        onClose={() => setFormOpen(false)}
        onSaved={refreshAll}
      />
      <TagManageModal open={tagManageOpen} mode={mode} onClose={() => setTagManageOpen(false)} onChanged={refreshAll} />

      <Modal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        title="批量打标签"
        subtitle={`将为选中的 ${selected.size} 位客户统一添加标签`}
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setBatchOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-white transition"
            >
              取消
            </button>
            <button
              onClick={submitBatchTag}
              disabled={batchSubmitting}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium disabled:opacity-50 transition"
            >
              确认打标签
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">标签名称</label>
          <input
            type="text"
            value={batchTagName}
            onChange={(e) => setBatchTagName(e.target.value)}
            placeholder="输入要批量添加的标签名称"
            className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </Modal>

      {/* 客户券包 Modal */}
      <Modal
        open={!!walletOpen}
        onClose={() => setWalletOpen(null)}
        title={`${walletOpen?.name || ''} 的券包`}
        subtitle={walletOpen ? `客户 #${walletOpen.id} · 查看通过 SOP 发放/包裹卡领取的优惠券` : ''}
        maxWidth="max-w-lg"
      >
        {walletLoading ? (
          <div className="py-8 text-center text-slate-400 text-sm"><i className="fa-solid fa-spinner fa-spin mr-2" />加载中...</div>
        ) : walletCoupons.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm bg-slate-50 rounded-lg">
            <i className="fa-regular fa-ticket mr-2" />暂无券，可给客户配置 push_coupon SOP 或手动发放
          </div>
        ) : (
          <div className="space-y-2">
            {walletCoupons.map(it => {
              const active = it.status === 'pending'
              return (
                <div key={it.id} className={`border rounded-lg p-3 ${active ? 'border-amber-200 bg-gradient-to-r from-amber-50 to-white' : 'border-slate-200 bg-slate-50 opacity-60'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="font-semibold text-slate-800 text-sm">{it.coupon_name}</div>
                    <div className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${it.status === 'used' ? 'bg-rose-100 text-rose-600' : it.status === 'pending' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}>
                      {it.status === 'used' ? '已核销' : it.status === 'pending' ? '待使用' : it.status}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] text-slate-500">
                      券码 <span className="font-mono text-slate-700">{it.code}</span>
                      {it.source && <span className="ml-2 text-slate-400">· 来源 {it.source}</span>}
                    </div>
                    {active && (
                      <button
                        onClick={() => handleRedeemWallet(it)}
                        className="text-[11px] px-2 py-0.5 bg-rose-500 text-white rounded hover:bg-rose-600"
                      >
                        核销
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      {/* 模拟下单 Modal */}
      <Modal
        open={!!purchaseOpen}
        onClose={() => setPurchaseOpen(null)}
        title={`${purchaseOpen?.name || ''} · 模拟下单`}
        subtitle={purchaseOpen ? `客户 #${purchaseOpen.id} · 模拟外部订单系统对接，支持带券核销，首单自动触发 first_purchase SOP` : ''}
        maxWidth="max-w-md"
      >
        <div className="space-y-3">
          <div className="bg-slate-50 rounded-lg p-3 text-xs">
            <div className="flex justify-between"><span className="text-slate-500">当前订单数</span><span className="font-semibold">{purchaseOpen?.orders || 0}</span></div>
            <div className="flex justify-between mt-1"><span className="text-slate-500">累计消费</span><span className="font-semibold">￥{(purchaseOpen?.spend || 0).toFixed(0)}</span></div>
            <div className="flex justify-between mt-1"><span className="text-slate-500">当前阶段</span><span className="font-semibold">{STAGE_META_BY_MODE[mode]?.[purchaseOpen?.stage as Stage]?.label || purchaseOpen?.stage}</span></div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">订单金额（元）</label>
            <input type="number" step="0.01" min={0.01} value={purchaseAmount} onChange={e => setPurchaseAmount(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">优惠券码（可选，用券核销）</label>
            <input value={purchaseCode} onChange={e => setPurchaseCode(e.target.value.toUpperCase())} placeholder="CPXXXXXX"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setPurchaseOpen(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">取消</button>
          <button onClick={handlePurchase} disabled={purchaseProcessing}
            className="px-4 py-2 bg-gradient-to-r from-rose-500 to-orange-500 text-white rounded-lg text-sm shadow-sm hover:shadow-md disabled:opacity-50">
            {purchaseProcessing ? '提交中...' : '确认下单'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
