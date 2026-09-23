import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import {
  MODE_META,
  STAGE_META_BY_MODE,
  type BizMode,
  type Customer,
  type Segment,
  type SegmentConditions,
  type Stage,
  type Tag
} from '../types'
import { useToast } from '../components/ui/Toast'
import Avatar from '../components/ui/Avatar'
import Empty from '../components/ui/Empty'
import Modal from '../components/ui/Modal'
import { formatMoney, formatRelativeTime } from '../utils'

interface SegmentsViewProps {
  mode: BizMode
  onOpenCustomer: (id: number) => void
  dataVersion: number
}

interface SegmentForm {
  name: string
  description: string
  stage: string
  tags: string[]
  channels: string[]
  minSpend: string
  maxDaysInactive: string
}

const EMPTY_FORM: SegmentForm = {
  name: '',
  description: '',
  stage: '',
  tags: [],
  channels: [],
  minSpend: '',
  maxDaysInactive: ''
}

const inputCls =
  'w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none'

function conditionChips(c: SegmentConditions, mode: BizMode): string[] {
  const chips: string[] = []
  if (c.stage) chips.push(STAGE_META_BY_MODE[mode][c.stage].label)
  ;(c.tags ?? []).forEach(t => chips.push(t))
  ;(c.channels ?? []).forEach(ch => chips.push(ch))
  if (c.minSpend) chips.push(`${MODE_META[mode].spendLabel}≥￥${c.minSpend}`)
  if (c.maxDaysInactive) chips.push(`${c.maxDaysInactive}天未互动`)
  return chips
}

function toggleItem(arr: string[], item: string): string[] {
  return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]
}

export default function SegmentsView({ mode, onOpenCustomer, dataVersion }: SegmentsViewProps) {
  const { showToast } = useToast()
  const [segments, setSegments] = useState<Segment[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [channels, setChannels] = useState<string[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Segment | null>(null)
  const [form, setForm] = useState<SegmentForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [membersOf, setMembersOf] = useState<Segment | null>(null)
  const [members, setMembers] = useState<Customer[]>([])
  const [membersTotal, setMembersTotal] = useState(0)
  const [membersLoading, setMembersLoading] = useState(false)

  const loadSegments = useCallback(() => {
    api.getSegments(mode).then(setSegments).catch(() => {})
  }, [mode])

  useEffect(() => {
    loadSegments()
  }, [loadSegments, dataVersion])

  useEffect(() => {
    api.getTags(mode).then(setTags).catch(() => {})
    api.getChannels(mode).then(setChannels).catch(() => {})
  }, [mode])

  useEffect(() => {
    setForm(EMPTY_FORM)
    setEditing(null)
    setFormOpen(false)
    setMembersOf(null)
  }, [mode])

  useEffect(() => {
    if (!membersOf) return
    setMembersLoading(true)
    api
      .getCustomers({ segment: String(membersOf.id), mode, pageSize: 8 })
      .then(res => {
        setMembers(res.items)
        setMembersTotal(res.total)
      })
      .catch(() => {
        setMembers([])
        setMembersTotal(0)
      })
      .finally(() => setMembersLoading(false))
  }, [membersOf])

  const openForm = (segment: Segment | null) => {
    setEditing(segment)
    setForm(
      segment
        ? {
            name: segment.name,
            description: segment.description,
            stage: segment.conditions.stage ?? '',
            tags: segment.conditions.tags ?? [],
            channels: segment.conditions.channels ?? [],
            minSpend: segment.conditions.minSpend != null ? String(segment.conditions.minSpend) : '',
            maxDaysInactive:
              segment.conditions.maxDaysInactive != null ? String(segment.conditions.maxDaysInactive) : ''
          }
        : EMPTY_FORM
    )
    setFormOpen(true)
  }

  const handleSubmit = () => {
    if (!form.name.trim()) {
      showToast('请填写分群名称', 'warning')
      return
    }
    const conditions: SegmentConditions = {}
    if (form.stage) conditions.stage = form.stage as Stage
    if (form.tags.length) conditions.tags = form.tags
    if (form.channels.length) conditions.channels = form.channels
    conditions.minSpend = form.minSpend ? Number(form.minSpend) : null
    conditions.maxDaysInactive = form.maxDaysInactive ? Number(form.maxDaysInactive) : null
    setSaving(true)
    const request = editing
      ? api.updateSegment(editing.id, form.name.trim(), form.description.trim(), conditions)
      : api.createSegment(form.name.trim(), form.description.trim(), conditions, mode)
    request
      .then(() => {
        setFormOpen(false)
        showToast(editing ? '分群规则已更新，成员实时重算' : '智能分群创建成功', 'success')
        loadSegments()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '保存失败', 'warning'))
      .finally(() => setSaving(false))
  }

  const handleDelete = (segment: Segment) => {
    if (!window.confirm(`确定删除分群「${segment.name}」？删除后不可恢复`)) return
    api
      .deleteSegment(segment.id)
      .then(() => {
        showToast('分群已删除', 'success')
        loadSegments()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '删除失败', 'warning'))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-bold text-slate-900 text-sm">智能客户分群</h4>
          <p className="text-xs text-slate-500">基于生命周期、标签、渠道与消费行为动态圈选目标客户</p>
        </div>
        <button
          onClick={() => openForm(null)}
          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-sm transition"
        >
          <i className="fa-solid fa-plus text-xs" />
          <span>新建智能分群</span>
        </button>
      </div>

      {segments.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {segments.map(s => (
            <div key={s.id} className="bg-white p-5 rounded-2xl border border-slate-200/80 custom-shadow card-hover flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center text-sm shrink-0">
                    <i className="fa-solid fa-layer-group" />
                  </span>
                  <h4 className="font-bold text-slate-900 text-sm truncate">{s.name}</h4>
                </div>
                <span className="text-[10px] text-slate-400 shrink-0">{formatRelativeTime(s.created_at)}创建</span>
              </div>
              <p className="text-xs text-slate-500 mt-2 line-clamp-2">{s.description}</p>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-2xl font-bold text-slate-900">{s.count.toLocaleString()}</span>
                <span className="text-xs text-slate-400">位成员</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {conditionChips(s.conditions, mode).map((chip, i) => (
                  <span
                    key={`${chip}-${i}`}
                    className="text-[10px] px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-600"
                  >
                    {chip}
                  </span>
                ))}
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-1.5">
                <button
                  onClick={() => setMembersOf(s)}
                  className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium transition"
                >
                  查看成员
                </button>
                <button
                  onClick={() => openForm(s)}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition"
                >
                  编辑
                </button>
                <button
                  onClick={() => handleDelete(s)}
                  className="ml-auto px-2.5 py-1 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-medium transition"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow">
          <Empty
            icon="fa-solid fa-layer-group"
            title="暂无智能分群"
            description="点击右上角「新建智能分群」创建第一条动态圈选规则"
          />
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? '编辑智能分群' : '新建智能分群'}
        subtitle="分群条件将实时动态计算符合特征的客户"
        footer={
          <>
            <button
              onClick={() => setFormOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-white transition"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
            >
              {saving ? '保存中...' : editing ? '保存修改' : '创建分群'}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            分群名称 <span className="text-rose-500">*</span>
          </label>
          <input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="例如：高客单敏感肌复购客群"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">分群描述</label>
          <input
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="一句话描述该分群的运营用途"
            className={inputCls}
          />
        </div>
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
          <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <i className="fa-solid fa-filter text-emerald-600" />
            圈选条件构建器
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">生命周期阶段</label>
            <select
              value={form.stage}
              onChange={e => setForm(f => ({ ...f, stage: e.target.value }))}
              className={inputCls}
            >
              <option value="">全部阶段</option>
              {(Object.keys(STAGE_META_BY_MODE[mode]) as Stage[]).map(st => (
                <option key={st} value={st}>
                  {STAGE_META_BY_MODE[mode][st].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">客户标签（多选）</label>
            <div className="flex flex-wrap gap-1.5">
              {tags.length ? (
                tags.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setForm(f => ({ ...f, tags: toggleItem(f.tags, t.name) }))}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                      form.tags.includes(t.name)
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-600 hover:border-emerald-300'
                    }`}
                  >
                    {t.name}
                  </button>
                ))
              ) : (
                <span className="text-[11px] text-slate-400">暂无可用标签</span>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">引流渠道（多选）</label>
            <div className="flex flex-wrap gap-1.5">
              {channels.length ? (
                channels.map(ch => (
                  <button
                    key={ch}
                    onClick={() => setForm(f => ({ ...f, channels: toggleItem(f.channels, ch) }))}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                      form.channels.includes(ch)
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-600 hover:border-emerald-300'
                    }`}
                  >
                    {ch}
                  </button>
                ))
              ) : (
                <span className="text-[11px] text-slate-400">暂无可用渠道</span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {MODE_META[mode].spendLabel} ≥
              </label>
              <input
                type="number"
                min={0}
                value={form.minSpend}
                onChange={e => setForm(f => ({ ...f, minSpend: e.target.value }))}
                placeholder="不限"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">X 天未互动</label>
              <input
                type="number"
                min={0}
                value={form.maxDaysInactive}
                onChange={e => setForm(f => ({ ...f, maxDaysInactive: e.target.value }))}
                placeholder="不限"
                className={inputCls}
              />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!membersOf}
        onClose={() => setMembersOf(null)}
        title={`分群成员：${membersOf?.name ?? ''}`}
        subtitle={membersOf ? `实时圈选 ${membersTotal} 位客户，展示前 ${members.length} 位` : undefined}
      >
        {membersLoading ? (
          <div className="py-10 text-center text-xs text-slate-400">
            <i className="fa-solid fa-circle-notch fa-spin mr-1.5" />
            正在实时计算分群成员...
          </div>
        ) : members.length ? (
          <div className="space-y-1">
            {members.map(m => (
              <div
                key={m.id}
                onClick={() => onOpenCustomer(m.id)}
                className="flex items-center justify-between p-2.5 hover:bg-slate-50 rounded-lg cursor-pointer transition"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={m.name} url={m.avatar} />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-800 truncate">
                      {m.name}
                      <span className="text-[11px] text-slate-400 font-normal ml-1.5">{m.wechat_nick}</span>
                    </div>
                    <span
                      className={`inline-block text-[10px] px-1.5 py-0.5 rounded mt-0.5 ${
                        STAGE_META_BY_MODE[mode][m.stage].badge
                      }`}
                    >
                      {STAGE_META_BY_MODE[mode][m.stage].label}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <div className="text-xs font-bold text-slate-700">{formatMoney(m.spend)}</div>
                  <div className="text-[10px] text-slate-400">{MODE_META[mode].spendLabel}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="fa-solid fa-user-slash" title="该分群暂无成员" description="调整圈选条件以扩大覆盖范围" />
        )}
      </Modal>
    </div>
  )
}
