import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { MODE_META, type BizMode, type Sop, type SopStep, type Coupon, type SopRun, type SopConditions, type ConditionField, type ConditionOperator, type Tag, type Staff, type WechatGroup } from '../types'
import { useToast } from '../components/ui/Toast'
import Empty from '../components/ui/Empty'
import Modal from '../components/ui/Modal'
import ConditionBuilder from '../components/sop/ConditionBuilder'

// === DSL 契约（与后端 sops.js 保持完全一致）===
const TRIGGER_OPTIONS: { value: string; label: string; icon: string; desc: string; needsDays?: boolean; needsMinSpend?: boolean }[] = [
  { value: 'add_friend', label: '加好友触发', icon: 'fa-solid fa-user-plus', desc: '企微好友通过验证后立即激活' },
  { value: 'first_purchase', label: '首购触发', icon: 'fa-solid fa-bag-shopping', desc: '客户完成首购后自动激活' },
  { value: 'days_inactive', label: 'N天未互动', icon: 'fa-solid fa-clock', desc: '客户超过 N 天未互动自动触发', needsDays: true },
  { value: 'high_value', label: '高消费客户', icon: 'fa-solid fa-gem', desc: '单笔消费 ≥ 阈值自动触发', needsMinSpend: true },
  { value: 'chat_join', label: '入群触发', icon: 'fa-solid fa-users', desc: '客户加入企微群后自动激活' },
  { value: 'churn_warning', label: '流失预警触发', icon: 'fa-solid fa-triangle-exclamation', desc: '客户进入流失预警阶段自动触发' },
  { value: 'custom', label: '自定义触发', icon: 'fa-solid fa-code', desc: '自定义描述触发条件' }
]

const ACTION_OPTIONS: { value: string; label: string; icon: string; typeLabel: string; }[] = [
  { value: 'send_wechat', label: '发送企微消息', icon: 'fa-brands fa-weixin', typeLabel: 'wechat' },
  { value: 'push_coupon', label: '推送优惠券', icon: 'fa-solid fa-ticket', typeLabel: 'wechat' },
  { value: 'invite_group', label: '拉入社群', icon: 'fa-solid fa-user-group', typeLabel: 'wechat' },
  { value: 'assign_staff', label: '分配顾问', icon: 'fa-solid fa-user-tie', typeLabel: 'note' },
  { value: 'send_sms', label: '短信通知', icon: 'fa-solid fa-mobile-screen', typeLabel: 'wechat' },
  { value: 'phone_call', label: '电话回访', icon: 'fa-solid fa-phone', typeLabel: 'call' },
  { value: 'gift_send', label: '寄送礼品', icon: 'fa-solid fa-gift', typeLabel: 'gift' },
  { value: 'note_mark', label: '打标签备注', icon: 'fa-solid fa-tags', typeLabel: 'note' }
]

const STEP_ICONS = [
  { icon: 'fa-solid fa-message', cls: 'text-emerald-600' },
  { icon: 'fa-solid fa-clock', cls: 'text-blue-600' },
  { icon: 'fa-solid fa-user-group', cls: 'text-purple-600' },
  { icon: 'fa-solid fa-gift', cls: 'text-amber-600' }
]
const METRIC_CLS = ['text-emerald-600 bg-emerald-50', 'text-blue-600 bg-blue-50', 'text-purple-600 bg-purple-50', 'text-amber-600 bg-amber-50']

const inputCls = 'w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none'

function conversionLabel(name: string): string {
  if (name.includes('唤醒')) return '唤醒成功率'
  if (name.includes('售后') || name.includes('关怀')) return '好评率'
  if (name.includes('退群') || name.includes('挽回')) return '挽回留存'
  return '转化率'
}

// 前端本地的条件→人类可读文案（编辑时实时预览用；保存后以后端 conditions_human 为准）
function conditionsToHuman(
  root: SopConditions | null | undefined,
  fields: ConditionField[],
  operators: Record<string, ConditionOperator[]>
): string | null {
  if (!root || !Array.isArray(root.rules) || root.rules.length === 0) return null
  const leafToText = (leaf: { field: string; op: string; value: unknown }): string => {
    const f = fields.find(x => x.value === leaf.field)
    const opLabel = operators[f?.type || 'string']?.find(o => o.value === leaf.op)?.label || leaf.op
    let v: unknown = leaf.value
    if (Array.isArray(v)) {
      const opts = f?.options || []
      v = v.map(x => opts.find(o => o.value === String(x))?.label ?? x).join(' 或 ')
    } else if (typeof v === 'string' && f?.options) {
      v = f.options.find(o => o.value === v)?.label || v
    }
    const unit = f?.units ? ` ${f.units}` : ''
    return `${f?.label || leaf.field} ${opLabel} ${v}${unit}`
  }
  const walk = (node: SopConditions, depth = 0): string => {
    const sep = node.op?.toUpperCase() === 'OR' ? ' 或者 ' : ' 并且 '
    const parts = node.rules.map(r =>
      Array.isArray((r as SopConditions).rules)
        ? walk(r as SopConditions, depth + 1)
        : leafToText(r as { field: string; op: string; value: unknown })
    )
    const text = parts.join(sep)
    return depth > 0 ? `(${text})` : text
  }
  return walk(root)
}

function ToggleSwitch({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className={`w-10 h-5 rounded-full relative transition-colors shrink-0 ${active ? 'bg-emerald-500' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${active ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

interface SopFormState {
  id?: number
  name: string
  trigger_type: string
  trigger_desc: string
  trigger_days: number
  trigger_min_spend: number
  trigger_channel: string
  mode: BizMode
  steps: SopStep[]
  conditions: SopConditions | null
}

const emptyForm: SopFormState = {
  name: '',
  trigger_type: 'days_inactive',
  trigger_desc: '',
  trigger_days: 30,
  trigger_min_spend: 500,
  trigger_channel: '',
  mode: 'retail',
  steps: [{ phase: '步骤1 · 立即', title: '', detail: '', metric: '待配置', action: 'send_wechat', delay_days: 0 }],
  conditions: null
}

export default function SopView({ mode }: { mode: BizMode }) {
  const { showToast } = useToast()
  const [sops, setSops] = useState<Sop[]>([])
  const [detail, setDetail] = useState<Sop | null>(null)

  // 表单状态
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SopFormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [previewCustomers, setPreviewCustomers] = useState<{ id: number; name: string; stage: string; channel: string }[]>([])
  const [previewTotal, setPreviewTotal] = useState(0)

  // 手动执行面板
  const [runOpen, setRunOpen] = useState(false)
  const [runLimit, setRunLimit] = useState(10)
  const [coupons, setCoupons] = useState<Coupon[]>([])
  useEffect(() => { api.getCoupons(mode).then(setCoupons).catch(() => {}) }, [mode])
  const [tags, setTags] = useState<Tag[]>([])
  useEffect(() => { api.getTags(mode).then(setTags).catch(() => {}) }, [mode])
  const [staffList, setStaffList] = useState<Staff[]>([])
  useEffect(() => { api.getStaff().then(setStaffList).catch(() => {}) }, [])
  const [groupList, setGroupList] = useState<WechatGroup[]>([])
  useEffect(() => { api.getGroups(mode).then(setGroupList).catch(() => {}) }, [mode])
  const [runningSop, setRunningSop] = useState<Sop | null>(null)
  const [runBusy, setRunBusy] = useState(false)

  // 运行历史
  const [runsOpen, setRunsOpen] = useState(false)
  const [sopRuns, setSopRuns] = useState<SopRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)

  // 条件构建器元数据
  const [condFields, setCondFields] = useState<ConditionField[]>([])
  const [condOperators, setCondOperators] = useState<Record<string, ConditionOperator[]>>({})
  useEffect(() => {
    api.getSopConditionMeta().then(m => { setCondFields(m.fields); setCondOperators(m.operators) }).catch(() => {})
  }, [])

  const load = useCallback(() => {
    api.getSops(mode).then(setSops).catch(() => {})
  }, [mode])

  useEffect(() => { load() }, [load])

  const handleToggle = async (sop: Sop) => {
    try {
      const updated = await api.toggleSop(sop.id)
      setSops(prev => prev.map(s => (s.id === updated.id ? updated : s)))
      setDetail(prev => (prev && prev.id === updated.id ? updated : prev))
      showToast(`「${updated.name}」${updated.active ? '已激活运行' : '已暂停'}`, updated.active ? 'success' : 'warning')
    } catch (e) { showToast(e instanceof Error ? e.message : '操作失败', 'warning') }
  }

  const openCreate = () => {
    setEditing({ ...emptyForm, mode })
    setPreviewCustomers([])
    setPreviewTotal(0)
    setFormOpen(true)
  }

  const openEdit = (sop: Sop) => {
    setEditing({
      id: sop.id,
      name: sop.name,
      trigger_type: sop.trigger_type,
      trigger_desc: sop.trigger_desc || '',
      trigger_days: sop.trigger_days || 30,
      trigger_min_spend: sop.trigger_min_spend || 500,
      trigger_channel: sop.trigger_channel || '',
      mode: sop.mode || mode,
      steps: sop.steps.length ? sop.steps : [{ phase: '步骤1 · 立即', title: '', detail: '', metric: '待配置', action: 'send_wechat', delay_days: 0 }],
      conditions: sop.conditions || null
    })
    setPreviewCustomers([])
    setPreviewTotal(0)
    setFormOpen(true)
  }

  // 新建/编辑时实时预估覆盖（调用 sop 预览接口；新建时走本地匹配）
  useEffect(() => {
    if (!editing) return
    if (editing.id) {
      api.previewSopCustomers(editing.id).then(r => { setPreviewCustomers(r.customers); setPreviewTotal(r.total) }).catch(() => {})
    }
  }, [editing?.id, formOpen])

  const handleSave = async () => {
    if (!editing) return
    const f = editing
    if (!f.name.trim()) return showToast('SOP 名称不能为空', 'warning')
    const validSteps = f.steps.filter(s => s.title?.trim())
    if (validSteps.length === 0) return showToast('至少需要 1 个完整步骤', 'warning')
    setSaving(true)
    try {
      const payload = {
        name: f.name.trim(),
        trigger_type: f.trigger_type,
        trigger_desc: f.trigger_desc.trim() || undefined,
        trigger_days: f.trigger_days,
        trigger_min_spend: f.trigger_min_spend,
        trigger_channel: f.trigger_channel?.trim() || undefined,
        mode: f.mode,
        steps: validSteps,
        conditions: f.conditions || null
      }
      const updated = f.id
        ? await api.updateSop(f.id, payload)
        : await api.createSop(payload)
      setFormOpen(false)
      showToast(`「${updated.name}」${f.id ? '已更新' : '已创建'}`, 'success')
      load()
      setDetail(updated)
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败', 'warning')
    } finally { setSaving(false) }
  }

  const handleClone = async (sop: Sop) => {
    try {
      const cloned = await api.cloneSop(sop.id)
      showToast(`已克隆「${cloned.name}」，默认暂停，请编辑后启用`, 'success')
      load()
    } catch (e) { showToast(e instanceof Error ? e.message : '克隆失败', 'warning') }
  }

  const handleDelete = async (sop: Sop) => {
    if (!window.confirm(`确定删除 SOP「${sop.name}」？执行日志会保留`)) return
    try { await api.deleteSop(sop.id); showToast('已删除', 'success'); load(); if (detail?.id === sop.id) setDetail(null) }
    catch (e) { showToast(e instanceof Error ? e.message : '删除失败', 'warning') }
  }

  const openRun = (sop: Sop) => { setRunningSop(sop); setRunLimit(10); setRunOpen(true) }
  const handleRun = async () => {
    if (!runningSop) return
    setRunBusy(true)
    try {
      const r = await api.runSop(runningSop.id, { limit: runLimit, triggered_by: '前端手动触发' })
      showToast(`执行成功：匹配 ${r.target_count} 位客户，下发 ${r.steps_per_customer} 步 SOP`, 'success')
      setRunOpen(false); setRunningSop(null); load()
    } catch (e) { showToast(e instanceof Error ? e.message : '执行失败', 'warning') }
    finally { setRunBusy(false) }
  }

  // DSL 内部：步骤增删改
  const addStep = () => {
    if (!editing) return
    const i = editing.steps.length + 1
    setEditing({
      ...editing,
      steps: [...editing.steps, { phase: `步骤${i} · 第${i}天`, title: '', detail: '', metric: '待配置', action: 'send_wechat', delay_days: i }]
    })
  }
  const updateStep = (idx: number, patch: Partial<SopStep>) => {
    if (!editing) return
    const steps = editing.steps.map((s, i) => i === idx ? { ...s, ...patch } : s)
    setEditing({ ...editing, steps })
  }
  const removeStep = (idx: number) => {
    if (!editing || editing.steps.length <= 1) return
    setEditing({ ...editing, steps: editing.steps.filter((_, i) => i !== idx) })
  }

  const featured = sops[0]
  const others = sops.slice(1)

  // 表单内实时预览匹配客户（根据 trigger_type 本地过滤）
  const livePreview = useMemo(() => {
    if (!editing) return null
    // 简化版：不调后端（新建时 sop 还不存在），只显示提示
    return null
  }, [editing])

  return (
    <div className="space-y-4">
      {/* 头部 + 新建按钮 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-bold text-slate-900 text-sm">自动化 SOP 运营工作流配置</h4>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium whitespace-nowrap">
              {MODE_META[mode].sopBadge}
            </span>
          </div>
          <p className="text-xs text-slate-500 hidden sm:block">{MODE_META[mode].sopDesc}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              setRunsOpen(true); setRunsLoading(true)
              try { setSopRuns(await api.getSopRuns(50)) } catch {}
              setRunsLoading(false)
            }}
            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
          >
            <i className="fa-solid fa-chart-simple text-xs" />
            <span>📊 运行历史</span>
          </button>
          <button
            onClick={openCreate}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-sm transition"
          >
            <i className="fa-solid fa-plus text-xs" />
            <span>新建自动化 SOP 规则</span>
          </button>
        </div>
      </div>

      {featured && (
        <div className={`bg-white rounded-2xl border border-slate-200/80 p-5 custom-shadow ${!featured.active ? 'opacity-60' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm shrink-0">
                <i className="fa-solid fa-route" />
              </span>
              <div className="min-w-0">
                <h5 className="font-bold text-slate-900 text-sm truncate">{featured.name}</h5>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-emerald-600 font-medium">{featured.trigger_desc}</span>
                  <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{featured.mode}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {featured.active ? (
                <span className="text-xs bg-emerald-50 text-emerald-700 font-medium px-2 py-0.5 rounded-full">已激活</span>
              ) : (
                <span className="text-xs bg-slate-100 text-slate-500 font-medium px-2 py-0.5 rounded-full">已暂停</span>
              )}
              <span className="text-xs text-slate-400 whitespace-nowrap">
                已跑通 {featured.run_count} 人次 | {conversionLabel(featured.name)} {featured.conversion}%
              </span>
            </div>
          </div>

          <div className="py-5 overflow-x-auto">
            <div className="flex items-center gap-4 min-w-[760px]">
              {featured.steps.map((step, i) => (
                <div key={i} className="flex items-center gap-4">
                  {i > 0 && <div className="text-slate-300 font-bold"><i className="fa-solid fa-arrow-right" /></div>}
                  <div className="w-60 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] bg-slate-200 text-slate-700 font-bold px-1.5 py-0.5 rounded">{step.phase}</span>
                      {step.action && <i className={`${ACTION_OPTIONS.find(a => a.value === step.action)?.icon || STEP_ICONS[i % STEP_ICONS.length].icon} ${STEP_ICONS[i % STEP_ICONS.length].cls} text-xs`} />}
                    </div>
                    <div className="text-xs font-bold text-slate-800">{step.title}</div>
                    <div className="text-[11px] text-slate-500 mt-1 truncate">{step.detail}</div>
                    <div className={`mt-3 text-[10px] p-1.5 rounded ${METRIC_CLS[i % METRIC_CLS.length]}`}>{step.metric}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-slate-100 text-xs">
            <span className="text-slate-400">支持根据客户画像、行为、标签自动触发 SOP 流转</span>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => openRun(featured)} disabled={!featured.active} className="px-3 py-1 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 text-amber-700 rounded-md font-medium transition">
                <i className="fa-solid fa-play text-[10px] mr-1" />手动执行
              </button>
              <button onClick={() => openEdit(featured)} className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-medium transition">编辑规则</button>
              <button onClick={() => handleClone(featured)} className="px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-md font-medium transition">克隆此方案</button>
              <ToggleSwitch active={featured.active === 1} onToggle={() => handleToggle(featured)} />
            </div>
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {others.map(sop => (
            <div key={sop.id} className={`bg-white p-4 rounded-xl border border-slate-200 hover:shadow-md transition ${!sop.active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-xs font-bold text-slate-800 truncate block">{sop.name}</span>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">{sop.trigger_desc}</p>
                </div>
                <span className={sop.active ? 'w-2 h-2 rounded-full bg-emerald-500 shrink-0 mt-1' : 'text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-medium shrink-0'}>
                  {sop.active ? '' : '已暂停'}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-emerald-600 font-medium">{conversionLabel(sop.name)} {sop.conversion}%</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setDetail(sop)} className="text-slate-400 hover:text-slate-600 transition">详情</button>
                  <button onClick={() => openEdit(sop)} className="text-slate-400 hover:text-slate-600 transition">编辑</button>
                  <ToggleSwitch active={sop.active === 1} onToggle={() => handleToggle(sop)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {sops.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow">
          <Empty icon="fa-solid fa-bolt-lightning" title="暂无 SOP 策略流" description="点击右上角「新建自动化 SOP 规则」开始配置" />
        </div>
      )}

      {/* 详情 Modal */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.name ?? ''}
        subtitle={detail ? `触发条件: ${detail.trigger_desc}` : undefined}
        footer={detail ? (
          <div className="flex items-center gap-2">
            <button onClick={() => openRun(detail)} disabled={!detail.active} className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 text-amber-700 rounded-lg text-xs font-medium transition">
              <i className="fa-solid fa-play text-[10px] mr-1" />手动执行
            </button>
            <button onClick={() => handleClone(detail)} className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium transition">克隆</button>
            <button onClick={() => { const s = detail; setDetail(null); openEdit(s) }} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition">编辑</button>
            <button onClick={() => handleDelete(detail)} className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-xs font-medium transition">删除</button>
            <ToggleSwitch active={detail.active === 1} onToggle={() => handleToggle(detail)} />
          </div>
        ) : null}
      >
        {detail && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-2 bg-slate-50 rounded-lg">
                <div className="text-lg font-bold text-slate-900">{detail.steps.length}</div>
                <div className="text-[10px] text-slate-500">执行步骤</div>
              </div>
              <div className="text-center p-2 bg-slate-50 rounded-lg">
                <div className="text-lg font-bold text-slate-900">{detail.run_count}</div>
                <div className="text-[10px] text-slate-500">累计执行</div>
              </div>
              <div className="text-center p-2 bg-slate-50 rounded-lg">
                <div className="text-lg font-bold text-slate-900">{detail.conversion}%</div>
                <div className="text-[10px] text-slate-500">{conversionLabel(detail.name)}</div>
              </div>
            </div>

            {/* 规则生效说明（自动生成） */}
            <div className="p-3 bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 rounded-lg">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 mb-1.5">
                <i className="fa-solid fa-wand-magic-sparkles" />
                <span>规则生效说明</span>
                <span className="text-[10px] text-slate-400 font-normal">（系统根据配置自动生成）</span>
              </div>
              <div className="text-xs text-slate-700 leading-relaxed space-y-1">
                <div>
                  <span className="text-slate-500">触发事件：</span>
                  <span className="font-semibold">{TRIGGER_OPTIONS.find(t => t.value === detail.trigger_type)?.label || detail.trigger_type}</span>
                </div>
                {detail.conditions_human && (
                  <div>
                    <span className="text-slate-500">且满足条件：</span>
                    <span className="font-semibold text-emerald-700">{detail.conditions_human}</span>
                  </div>
                )}
                {!detail.conditions_human && (
                  <div>
                    <span className="text-slate-500">额外条件：</span>
                    <span className="text-slate-400">（无 — 对所有命中触发事件的客户生效）</span>
                  </div>
                )}
              </div>
            </div>

            {detail.steps.map((step, i) => (
              <div key={i} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] bg-slate-200 text-slate-700 font-bold px-1.5 py-0.5 rounded">{step.phase}</span>
                  {step.action && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">{ACTION_OPTIONS.find(a => a.value === step.action)?.label || step.action}</span>}
                </div>
                <div className="text-xs font-bold text-slate-800">{step.title}</div>
                <div className="text-[11px] text-slate-500 mt-1">{step.detail}</div>
                <div className={`mt-2 text-[10px] p-1.5 rounded inline-block ${METRIC_CLS[i % METRIC_CLS.length]}`}>{step.metric}</div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* 新建/编辑表单 Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing?.id ? '编辑 SOP 规则' : '新建 SOP 规则'}
        subtitle="DSL 契约固化：触发类型 + 动作步骤 + 覆盖条件"
        maxWidth="max-w-3xl"
        footer={
          <>
            <button onClick={() => setFormOpen(false)} className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-white transition">取消</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition">
              {saving ? '保存中...' : (editing?.id ? '保存更新' : '立即创建')}
            </button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            {/* 基础信息 */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">SOP 名称</label>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="例如：新客48小时黄金首购转化SOP" className={inputCls} />
            </div>

            {/* 触发条件（DSL） */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">触发条件类型</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {TRIGGER_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setEditing({ ...editing, trigger_type: opt.value, trigger_desc: opt.desc })}
                    className={`text-left p-2.5 rounded-lg border transition ${
                      editing.trigger_type === opt.value
                        ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                        : 'border-slate-200 hover:border-emerald-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <i className={`${opt.icon} text-[11px] ${editing.trigger_type === opt.value ? 'text-emerald-600' : 'text-slate-400'}`} />
                      <span className="text-[11px] font-semibold text-slate-800">{opt.label}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 truncate">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 触发条件参数 */}
            <div className="grid grid-cols-2 gap-3">
              {TRIGGER_OPTIONS.find(o => o.value === editing.trigger_type)?.needsDays && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">未互动天数</label>
                  <input type="number" min={1} max={365} value={editing.trigger_days} onChange={e => setEditing({ ...editing, trigger_days: Number(e.target.value) })} className={inputCls} />
                </div>
              )}
              {TRIGGER_OPTIONS.find(o => o.value === editing.trigger_type)?.needsMinSpend && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">最低消费额（元）</label>
                  <input type="number" min={0} value={editing.trigger_min_spend} onChange={e => setEditing({ ...editing, trigger_min_spend: Number(e.target.value) })} className={inputCls} />
                </div>
              )}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">业务模式</label>
                <select value={editing.mode} onChange={e => setEditing({ ...editing, mode: e.target.value as BizMode })} className={inputCls}>
                  <option value="retail">C 端零售</option>
                  <option value="service">B 端企服</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">触发描述（自动填充可编辑）</label>
                <input value={editing.trigger_desc} onChange={e => setEditing({ ...editing, trigger_desc: e.target.value })} placeholder="自定义可读触发描述" className={inputCls} />
              </div>
            </div>

            {/* 匹配预览 */}
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-[11px] text-blue-700">
              <i className="fa-solid fa-circle-info mr-1" />
              匹配后端 DSL 引擎后可预估覆盖人数；保存后可在详情页点击「手动执行」真实下发给匹配客户并生成跟进记录。
            </div>

            {/* 可视化条件构建器（所有 SOP 都支持额外条件；custom 类型尤其依赖） */}
            {condFields.length > 0 && condOperators && (
              <div className="p-4 bg-gradient-to-br from-slate-50 to-emerald-50/30 border border-slate-200 rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                      <i className="fa-solid fa-filter text-emerald-500" />
                      可选：客户画像/行为精确匹配条件
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      留空表示在触发事件发生时对所有客户生效；配置后仅命中条件的客户会被执行 SOP
                      {editing.trigger_type === 'custom' && <span className="text-amber-600 font-medium">（自定义 SOP 建议必须配置）</span>}
                    </div>
                  </div>
                </div>
                <ConditionBuilder
                  value={editing.conditions}
                  onChange={(c) => setEditing({ ...editing, conditions: c })}
                  fields={condFields}
                  operators={condOperators}
                  humanText={conditionsToHuman(editing.conditions, condFields, condOperators)}
                />
              </div>
            )}

            {/* 步骤编辑器 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold text-slate-700">执行步骤（按延迟天数依次下发）</label>
                <button onClick={addStep} type="button" className="px-2.5 py-1 text-[10px] bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-medium rounded-md transition">
                  <i className="fa-solid fa-plus text-[10px] mr-1" />新增步骤
                </button>
              </div>
              <div className="space-y-2">
                {editing.steps.map((step, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] bg-slate-200 text-slate-700 font-bold px-1.5 py-0.5 rounded">步骤 {idx + 1}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500">延迟</span>
                        <input type="number" min={0} max={90} value={step.delay_days || 0} onChange={e => updateStep(idx, { delay_days: Number(e.target.value) })} className="w-14 p-1 text-[10px] bg-white border border-slate-200 rounded" />
                        <span className="text-[10px] text-slate-500">天</span>
                        {editing.steps.length > 1 && (
                          <button onClick={() => removeStep(idx)} className="text-[10px] text-rose-500 hover:text-rose-700 ml-1" title="删除">
                            <i className="fa-solid fa-trash" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input placeholder="阶段标题 例如 步骤1 · 立即" value={step.phase} onChange={e => updateStep(idx, { phase: e.target.value })} className={inputCls} />
                      <select value={step.action || 'send_wechat'} onChange={e => updateStep(idx, { action: e.target.value })} className={inputCls}>
                        {ACTION_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                      </select>
                      <input placeholder="步骤标题" value={step.title} onChange={e => updateStep(idx, { title: e.target.value })} className={inputCls} />
                      <input placeholder="预期指标 例如 送达率99%" value={step.metric} onChange={e => updateStep(idx, { metric: e.target.value })} className={inputCls} />
                      <input placeholder="执行说明/话术详情" value={step.detail} onChange={e => updateStep(idx, { detail: e.target.value })} className={`${inputCls} col-span-2`} />
                      {step.action === 'push_coupon' && (
                        <div className="col-span-2">
                          <label className="block text-[11px] text-slate-500 mb-1">选择要推送的优惠券 <span className="text-emerald-500">（选中后后端执行时真发券）</span></label>
                          <select value={step.coupon_id || ''} onChange={e => updateStep(idx, { coupon_id: e.target.value ? Number(e.target.value) : undefined })} className={inputCls}>
                            <option value="">— 不选（仅写文案）—</option>
                            {coupons.filter(c => c.active === 1).map(c => (
                              <option key={c.id} value={c.id}>#{c.id} {c.name} · {c.type === 'cash' ? '￥' : c.type === 'percent' ? '%' : ''}{c.value} · 库存 {c.total_stock - c.issued_count}/{c.total_stock}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {(step.action === 'note_mark' || step.action === 'add_tag') && (
                        <div className="col-span-2">
                          <label className="block text-[11px] text-slate-500 mb-1">
                            打标配置 <span className="text-emerald-500">（指定标签名，不存在会自动创建）</span>
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={step.tag_name || ''}
                              onChange={e => updateStep(idx, { tag_name: e.target.value })}
                              className={inputCls}
                            >
                              <option value="">— 选择已有标签 —</option>
                              {tags.map(t => (
                                <option key={t.id} value={t.name}>{t.name}{t.category ? ` · ${t.category}` : ''}</option>
                              ))}
                            </select>
                            <input
                              placeholder="或手动输入新标签名"
                              value={step.tag_name || ''}
                              onChange={e => updateStep(idx, { tag_name: e.target.value })}
                              className={inputCls}
                            />
                          </div>
                          {!step.tag_name && (
                            <p className="text-[10px] text-amber-500 mt-1">⚠️ 未指定标签名，后端会自动按步骤标题生成一个兜底标签</p>
                          )}
                        </div>
                      )}
                      {step.action === 'assign_staff' && (
                        <div className="col-span-2">
                          <label className="block text-[11px] text-slate-500 mb-1">
                            分配顾问 <span className="text-emerald-500">（指定顾问，不选则后端随机分配）</span>
                          </label>
                          <select
                            value={step.staff_id ?? ''}
                            onChange={e => updateStep(idx, { staff_id: e.target.value ? Number(e.target.value) : null })}
                            className={inputCls}
                          >
                            <option value="">— 自动分配（取首位顾问）—</option>
                            {staffList.map(s => (
                              <option key={s.id} value={s.id}>#{s.id} {s.name} · {s.role || ''}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {step.action === 'invite_group' && (
                        <div className="col-span-2">
                          <label className="block text-[11px] text-slate-500 mb-1">
                            拉入社群 <span className="text-emerald-500">（指定目标群，不选则写 intent 由顾问手动操作）</span>
                          </label>
                          <select
                            value={step.group_id ?? ''}
                            onChange={e => updateStep(idx, { group_id: e.target.value ? Number(e.target.value) : null })}
                            className={inputCls}
                          >
                            <option value="">— 不指定（降级为 intent）—</option>
                            {groupList.map(g => (
                              <option key={g.id} value={g.id}>#{g.id} {g.name} · {g.member_count || 0}人</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {step.action === 'send_wechat' && (
                        <div className="col-span-2">
                          <label className="block text-[11px] text-slate-500 mb-1">
                            企微消息模板（可选，用于统一话术）
                          </label>
                          <input
                            placeholder="留空则用步骤 detail 作为发送文案"
                            value={step.message_template || ''}
                            onChange={e => updateStep(idx, { message_template: e.target.value })}
                            className={inputCls}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* 手动执行 Modal */}
      <Modal
        open={runOpen}
        onClose={() => setRunOpen(false)}
        title={`手动执行 SOP：${runningSop?.name ?? ''}`}
        subtitle="将按触发条件匹配客户并生成跟进记录，可在客户详情里查看"
        maxWidth="max-w-md"
        footer={
          <>
            <button onClick={() => setRunOpen(false)} disabled={runBusy} className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-white transition disabled:opacity-50">取消</button>
            <button onClick={handleRun} disabled={runBusy || !runningSop} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition">
              {runBusy ? '执行中...' : '立即执行'}
            </button>
          </>
        }
      >
        {runningSop && (
          <div className="space-y-3">
            <div className="p-3 bg-slate-50 rounded-lg text-[11px]">
              <div className="font-bold text-slate-800 mb-1">SOP 概述</div>
              <div className="text-slate-500">触发：{runningSop.trigger_desc}</div>
              <div className="text-slate-500">步骤：{runningSop.steps.length} 步</div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">本次下发覆盖人数上限</label>
              <input type="number" min={1} max={500} value={runLimit} onChange={e => setRunLimit(Number(e.target.value))} className={inputCls} />
              <p className="text-[10px] text-slate-400 mt-1">会从匹配客户中取前 N 位生成跟进记录</p>
            </div>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-700">
              <i className="fa-solid fa-triangle-exclamation mr-1" />手动执行不会影响 SOP 激活状态，生成的跟进记录可在客户详情页查询。
            </div>
          </div>
        )}
      </Modal>

      {/* === 运行历史 Modal === */}
      <Modal open={runsOpen} onClose={() => setRunsOpen(false)} title="📊 SOP 运行历史（近 50 次）" maxWidth="max-w-3xl">
        {runsLoading ? (
          <div className="text-center py-8 text-slate-400 text-sm"><i className="fa-solid fa-spinner fa-spin mr-2" />加载中...</div>
        ) : sopRuns.length === 0 ? (
          <Empty title="暂无运行记录" description="SOP 被客户触发或调度器自动执行后会在此显示" />
        ) : (
          <div className="max-h-[420px] overflow-y-auto -mx-2">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white border-b border-slate-200">
                <tr className="text-slate-500">
                  <th className="text-left py-2 px-2 font-medium">时间</th>
                  <th className="text-left py-2 px-2 font-medium">SOP 名称</th>
                  <th className="text-left py-2 px-2 font-medium">触发来源</th>
                  <th className="text-right py-2 px-2 font-medium">目标</th>
                  <th className="text-right py-2 px-2 font-medium">成功</th>
                  <th className="text-left py-2 px-2 font-medium">动作</th>
                </tr>
              </thead>
              <tbody>
                {sopRuns.map(r => {
                  let outcome = null
                  try { outcome = r.outcome ? JSON.parse(r.outcome) : null } catch { outcome = null }
                  const triggers: Record<string, string> = {
                    'scheduler:inactive': '⏰ 调度器·N天未互动',
                    'public:add_friend': '📱 新客加好友',
                    'first_purchase': '🛒 首购触发',
                    'manual': '🖥️ 手动执行',
                    'E2E': '🧪 测试'
                  }
                  const triggerLabel = triggers[r.triggered_by] || r.triggered_by
                  const sopName = r.sop_name || `#${r.sop_id}`
                  const success = r.success_count >= r.target_count ? 'text-emerald-600' : 'text-amber-600'
                  const actionParts: string[] = []
                  if (outcome?.couponIssued) actionParts.push(`🎫 发券${outcome.couponIssued}`)
                  if (outcome?.tagApplied) actionParts.push(`🏷️ 打标${outcome.tagApplied}`)
                  if (outcome?.coupon_issued) actionParts.push(`🎫 发券${outcome.coupon_issued}`)
                  if (outcome?.steps_per_customer) actionParts.push(`📋 ${outcome.steps_per_customer}步`)
                  return (
                    <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="py-2 px-2 text-slate-500 whitespace-nowrap">{r.created_at?.replace('T',' ').slice(5,16)}</td>
                      <td className="py-2 px-2 text-slate-800 font-medium max-w-[160px] truncate" title={sopName}>{sopName}</td>
                      <td className="py-2 px-2 whitespace-nowrap">{triggerLabel}</td>
                      <td className="py-2 px-2 text-right text-slate-600">{r.target_count}</td>
                      <td className={`py-2 px-2 text-right font-semibold ${success}`}>{r.success_count}</td>
                      <td className="py-2 px-2 text-slate-500">{actionParts.join(' · ') || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  )
}
