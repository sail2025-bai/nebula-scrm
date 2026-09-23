import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import type { BizMode, Customer, FollowUp, Order, Tag } from '../../types'
import { FOLLOWUP_TYPES, MODE_META, STAGE_META_BY_MODE } from '../../types'
import { formatDateTime, formatMoney, healthColor } from '../../utils'
import Avatar from '../ui/Avatar'
import Drawer from '../ui/Drawer'
import { useToast } from '../ui/Toast'
import CustomerFormModal from './CustomerFormModal'

const TYPE_DOTS: Record<FollowUp['type'], string> = {
  wechat: 'bg-emerald-500',
  call: 'bg-blue-500',
  visit: 'bg-purple-500',
  gift: 'bg-amber-500',
  note: 'bg-slate-400'
}

function parseTs(iso: string): number {
  const date = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

interface CustomerDrawerProps {
  customerId: number | null
  mode: BizMode
  onClose: () => void
  onChanged: () => void
}

export default function CustomerDrawer({ customerId, mode, onClose, onChanged }: CustomerDrawerProps) {
  const { showToast } = useToast()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [tagLibrary, setTagLibrary] = useState<Tag[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [addTagOpen, setAddTagOpen] = useState(false)
  const [customTag, setCustomTag] = useState('')
  const [fuType, setFuType] = useState<FollowUp['type']>('wechat')
  const [fuContent, setFuContent] = useState('')
  const [fuOutcome, setFuOutcome] = useState('')
  const [fuNext, setFuNext] = useState('')

  const fetchDetail = useCallback(
    async (id: number) => {
      try {
        const [c, fs, os] = await Promise.all([api.getCustomer(id), api.getFollowUps(id), api.getCustomerOrders(id).catch(() => [])])
        setCustomer(c)
        setFollowUps(fs)
        setOrders(os)
      } catch (e) {
        showToast((e as Error).message, 'warning')
      }
    },
    [showToast]
  )

  useEffect(() => {
    if (customerId === null) {
      setCustomer(null)
      setFollowUps([])
      setOrders([])
      setEditOpen(false)
      setAddTagOpen(false)
      setCustomTag('')
      setFuType('wechat')
      setFuContent('')
      setFuOutcome('')
      setFuNext('')
      return
    }
    setCustomer(null)
    setFollowUps([])
    fetchDetail(customerId)
  }, [customerId, fetchDetail])

  useEffect(() => {
    if (customerId === null) return
    api.getTags(mode).then(setTagLibrary).catch(() => {})
  }, [customerId, mode])

  const handleRemoveTag = async (tagName: string) => {
    if (!customer) return
    const remaining = customer.tags.map((t) => t.name).filter((n) => n !== tagName)
    try {
      await api.updateCustomer(customer.id, { tags: remaining })
      showToast(`已移除标签「${tagName}」`)
      await fetchDetail(customer.id)
      onChanged()
    } catch (e) {
      showToast((e as Error).message, 'warning')
    }
  }

  const handleAddTag = async (tagName: string) => {
    if (!customer) return
    const name = tagName.trim()
    if (!name) return
    if (customer.tags.some((t) => t.name === name)) return
    try {
      await api.updateCustomer(customer.id, { tags: [...customer.tags.map((t) => t.name), name] })
      showToast(`已添加标签「${name}」`)
      setCustomTag('')
      await fetchDetail(customer.id)
      onChanged()
    } catch (e) {
      showToast((e as Error).message, 'warning')
    }
  }

  const submitFollowUp = async () => {
    if (!customer) return
    const content = fuContent.trim()
    if (!content) {
      showToast('请填写跟进内容', 'warning')
      return
    }
    try {
      await api.createFollowUp({
        customer_id: customer.id,
        type: fuType,
        content,
        outcome: fuOutcome.trim() || undefined,
        next_followup_at: fuNext || null
      })
      showToast('跟进记录已保存')
      setFuType('wechat')
      setFuContent('')
      setFuOutcome('')
      setFuNext('')
      await fetchDetail(customer.id)
      onChanged()
    } catch (e) {
      showToast((e as Error).message, 'warning')
    }
  }

  const handleDeleteFollowUp = async (f: FollowUp) => {
    if (!customer) return
    if (!window.confirm('确定删除这条跟进记录吗？')) return
    try {
      await api.deleteFollowUp(f.id)
      showToast('跟进记录已删除')
      await fetchDetail(customer.id)
      onChanged()
    } catch (e) {
      showToast((e as Error).message, 'warning')
    }
  }

  const handleDeleteCustomer = async () => {
    if (!customer) return
    if (!window.confirm(`确定删除客户「${customer.name}」吗？该操作不可恢复`)) return
    try {
      await api.deleteCustomer(customer.id)
      showToast('客户档案已删除')
      onChanged()
      onClose()
    } catch (e) {
      showToast((e as Error).message, 'warning')
    }
  }

  const sortedFollowUps = [...followUps].sort((a, b) => parseTs(b.created_at) - parseTs(a.created_at))

  interface TimelineEntry {
    time: string
    title: string
    detail: string
    source: string
    color: string
    icon?: string
    amount?: number
    status_color?: string
  }
  const timeline: TimelineEntry[] = customer
    ? [
        {
          time: customer.created_at,
          title: `通过 ${customer.channel} 添加企微好友`,
          detail: '',
          source: customer.channel,
          color: 'bg-slate-400'
        },
        ...followUps.map((f) => ({
          time: f.created_at,
          title: f.content,
          detail: f.outcome ?? '',
          source: FOLLOWUP_TYPES[f.type].label,
          color: TYPE_DOTS[f.type]
        })),
        ...orders.map((o) => ({
          time: o.order_at,
          title: `${o.source_label || o.source} · ${o.product_name || '商品订单'}`,
          detail: `¥${o.paid_amount.toFixed(2)} · ${o.status_label || o.status} · 单号 ${o.order_no}${o.discount > 0 ? ' · 优惠 ¥' + o.discount.toFixed(2) : ''}${o.coupon_code ? ' · 券码 ' + o.coupon_code : ''}`,
          source: '订单',
          color: 'bg-amber-500',
          icon: 'fa-solid fa-cart-shopping',
          amount: o.paid_amount,
          status_color: o.status_color
        }))
      ].sort((a, b) => parseTs(b.time) - parseTs(a.time))
    : []

  const inputCls =
    'w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none transition'
  const selectCls = 'w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none'

  return (
    <Drawer open={customerId !== null} onClose={onClose}>
      {customerId !== null && !customer ? (
        <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
          <i className="fa-solid fa-circle-notch fa-spin mr-2" />
          正在加载客户画像...
        </div>
      ) : customer ? (
        <>
          <div className="p-4 sm:p-6 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar
                name={customer.name}
                url={customer.avatar}
                size="lg"
                className="border-2 border-white shadow-sm shrink-0"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-slate-900 text-base">{customer.name}</h3>
                  <span className="text-xs text-slate-400">({customer.gender})</span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STAGE_META_BY_MODE[mode][customer.stage].badge}`}
                  >
                    {STAGE_META_BY_MODE[mode][customer.stage].label}
                  </span>
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="truncate">
                    企微昵称: <span className="font-medium text-slate-700">{customer.wechat_nick || '--'}</span>
                  </span>
                  <span className="hidden sm:inline">·</span>
                  <span className="truncate">
                    专属导购: <span className="text-emerald-600 font-medium">{customer.staffName || '--'}</span>
                  </span>
                  {mode === 'service' && customer.company && (
                    <>
                      <span className="hidden sm:inline">·</span>
                      <span className="truncate">
                        公司: <span className="font-medium text-slate-700">{customer.company}</span>
                      </span>
                    </>
                  )}
                  {mode === 'service' && customer.position && (
                    <>
                      <span className="hidden sm:inline">·</span>
                      <span className="truncate">
                        职位: <span className="font-medium text-slate-700">{customer.position}</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setEditOpen(true)}
                className="hidden sm:flex px-2.5 py-1 border border-slate-300 hover:bg-white text-slate-600 rounded-lg text-[11px] font-medium transition items-center gap-1"
              >
                <i className="fa-solid fa-pen-to-square text-[10px]" />
                编辑资料
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg hover:bg-slate-200/80 flex items-center justify-center text-slate-400 hover:text-slate-700 transition"
              >
                <i className="fa-solid fa-xmark text-base" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-center">
                <div className="text-[11px] text-slate-400">{MODE_META[mode].metric1Label}</div>
                <div className="text-base font-bold text-slate-900 mt-0.5">{formatMoney(customer.spend)}</div>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-center">
                <div className="text-[11px] text-slate-400">{MODE_META[mode].metric2Label}</div>
                <div className="text-base font-bold text-slate-900 mt-0.5">{customer.orders} 次</div>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-center">
                <div className="text-[11px] text-slate-400">健康评估</div>
                <div className={`text-base font-bold mt-0.5 ${healthColor(customer.health)}`}>{customer.health}</div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">智能与业务标签 (Tags)</h4>
                <button
                  onClick={() => setAddTagOpen((v) => !v)}
                  className="text-xs text-emerald-600 hover:underline font-medium"
                >
                  + 添加标签
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {customer.tags.map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-medium"
                  >
                    {t.name}
                    <button
                      onClick={() => handleRemoveTag(t.name)}
                      className="text-emerald-400 hover:text-rose-500 transition"
                    >
                      <i className="fa-solid fa-xmark text-[9px]" />
                    </button>
                  </span>
                ))}
                {customer.tags.length === 0 && (
                  <span className="text-[11px] text-slate-400">暂无标签，点击右上角添加</span>
                )}
              </div>
              {addTagOpen && (
                <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="text-[10px] text-slate-400">点击标签库快速添加</div>
                  <div className="flex flex-wrap gap-1.5">
                    {tagLibrary
                      .filter((t) => !customer.tags.some((ct) => ct.name === t.name))
                      .map((t) => (
                        <button
                          key={t.id}
                          onClick={() => handleAddTag(t.name)}
                          className="px-2 py-0.5 rounded-full text-[11px] bg-white border border-slate-200 text-slate-600 hover:border-emerald-400 hover:text-emerald-600 transition"
                        >
                          {t.name}
                        </button>
                      ))}
                    {tagLibrary.filter((t) => !customer.tags.some((ct) => ct.name === t.name)).length === 0 && (
                      <span className="text-[11px] text-slate-400">标签库中的标签均已添加</span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={customTag}
                    onChange={(e) => setCustomTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddTag(customTag)
                      }
                    }}
                    placeholder="输入自定义标签后按回车添加"
                    className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">
                跟进记录 (Follow-ups)
              </h4>
              <div className="border border-slate-200 rounded-xl p-3 bg-white space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">跟进类型</label>
                    <select
                      value={fuType}
                      onChange={(e) => setFuType(e.target.value as FollowUp['type'])}
                      className={selectCls}
                    >
                      {Object.entries(FOLLOWUP_TYPES).map(([value, meta]) => (
                        <option key={value} value={value}>
                          {meta.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">下次跟进日期 (可选)</label>
                    <input
                      type="date"
                      value={fuNext}
                      onChange={(e) => setFuNext(e.target.value)}
                      className={selectCls}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    跟进内容 <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={2}
                    value={fuContent}
                    onChange={(e) => setFuContent(e.target.value)}
                    placeholder="记录本次沟通的关键信息..."
                    className={`${inputCls} leading-relaxed`}
                  />
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">跟进结果 (可选)</label>
                    <input
                      type="text"
                      value={fuOutcome}
                      onChange={(e) => setFuOutcome(e.target.value)}
                      placeholder="如：已同意试用新品小样"
                      className={inputCls}
                    />
                  </div>
                  <button
                    onClick={submitFollowUp}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition shrink-0"
                  >
                    <i className="fa-solid fa-plus mr-1" />
                    新增跟进
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {sortedFollowUps.map((f) => (
                  <div key={f.id} className="border border-slate-100 rounded-xl p-3 bg-slate-50/60">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold ${FOLLOWUP_TYPES[f.type].color}`}
                      >
                        <i className={FOLLOWUP_TYPES[f.type].icon} />
                        {FOLLOWUP_TYPES[f.type].label}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400">{formatDateTime(f.created_at)}</span>
                        <button
                          onClick={() => handleDeleteFollowUp(f)}
                          className="w-6 h-6 rounded-md flex items-center justify-center text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition"
                        >
                          <i className="fa-regular fa-trash-can text-[11px]" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-slate-700 mt-1.5 leading-relaxed">{f.content}</p>
                    {f.outcome && (
                      <span className="inline-flex mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                        结果: {f.outcome}
                      </span>
                    )}
                  </div>
                ))}
                {sortedFollowUps.length === 0 && (
                  <div className="text-[11px] text-slate-400 text-center py-3">暂无跟进记录</div>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">全渠道互动旅程</h4>
              <div className="relative pl-6 space-y-5 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                {timeline.map((e, i) => (
                  <div key={i} className="relative">
                    <div className={`absolute -left-6 top-1 w-2.5 h-2.5 rounded-full ${e.color} ring-4 ring-white`} />
                    <div className="text-xs font-semibold text-slate-800 line-clamp-1 flex items-center gap-1.5">
                      {e.icon && <i className={`${e.icon} text-[10px] text-amber-600`} />}
                      <span>{e.title}</span>
                      {e.amount !== undefined && (
                        <span className="ml-auto text-[11px] font-bold text-rose-600 shrink-0">¥{e.amount.toFixed(2)}</span>
                      )}
                    </div>
                    {e.detail && (
                      <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>{e.detail}</span>
                        {e.status_color && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${e.status_color}`}>
                            {e.detail.split('·').slice(0, 0).join()}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400 mt-1">
                      {formatDateTime(e.time)} · {e.source}
                    </div>
                  </div>
                ))}
                {timeline.length === 0 && (
                  <div className="text-[11px] text-slate-400">暂无互动旅程数据</div>
                )}
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={handleDeleteCustomer}
              className="mr-auto px-3 py-1.5 border border-rose-200 text-rose-600 hover:bg-rose-50 hover:border-rose-300 rounded-lg text-xs font-medium transition flex items-center gap-1.5"
            >
              <i className="fa-regular fa-trash-can" />
              <span>删除客户</span>
            </button>
            <button
              onClick={() => setEditOpen(true)}
              className="sm:hidden px-3 py-1.5 border border-slate-300 hover:bg-white text-slate-700 rounded-lg text-xs font-medium transition flex items-center gap-1.5"
            >
              <i className="fa-solid fa-pen-to-square text-[10px]" />
              <span>编辑资料</span>
            </button>
            <button
              onClick={() =>
                showToast(
                  mode === 'service'
                    ? `已为 ${customer.name} 开通为期 14 天的企业级 VIP 试用体验授权`
                    : `已成功为 ${customer.name} 下发满 300 减 50 专属代金券`,
                  'success'
                )
              }
              className="px-3 py-1.5 border border-slate-300 hover:bg-white text-slate-700 rounded-lg text-xs font-medium transition"
            >
              {MODE_META[mode].benefitBtn}
            </button>
            <button
              onClick={() => showToast('已唤起企微会话窗口', 'info')}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
            >
              <i className="fa-brands fa-weixin" />
              <span>发起企微会话</span>
            </button>
          </div>

          <CustomerFormModal
            open={editOpen}
            customer={customer}
            mode={mode}
            onClose={() => setEditOpen(false)}
            onSaved={() => {
              if (customerId !== null) fetchDetail(customerId)
              onChanged()
            }}
          />
        </>
      ) : null}
    </Drawer>
  )
}
