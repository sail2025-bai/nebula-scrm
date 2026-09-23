import { useEffect, useState } from 'react'
import { api } from '../../api'
import type { CustomerPayload } from '../../api'
import type { BizMode, Customer, Staff, Tag } from '../../types'
import { MODE_META, STAGE_META_BY_MODE } from '../../types'
import Modal from '../ui/Modal'
import { useToast } from '../ui/Toast'

interface CustomerFormModalProps {
  open: boolean
  customer: Customer | null
  mode: BizMode
  onClose: () => void
  onSaved: () => void
}

interface FormState {
  name: string
  wechat_nick: string
  gender: string
  phone: string
  channel: string
  stage: string
  staff_id: string
  spend: string
  orders: string
  company: string
  position: string
  intent_level: string
  notes: string
  tags: string[]
}

const EMPTY_FORM: FormState = {
  name: '',
  wechat_nick: '',
  gender: '女',
  phone: '',
  channel: '',
  stage: 'new',
  staff_id: '',
  spend: '0',
  orders: '0',
  company: '',
  position: '',
  intent_level: '',
  notes: '',
  tags: []
}

export default function CustomerFormModal({ open, customer, mode, onClose, onSaved }: CustomerFormModalProps) {
  const { showToast } = useToast()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [channels, setChannels] = useState<string[]>([])
  const [staffList, setStaffList] = useState<Staff[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [nameError, setNameError] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    if (customer) {
      setForm({
        name: customer.name,
        wechat_nick: customer.wechat_nick,
        gender: customer.gender,
        phone: customer.phone ?? '',
        channel: customer.channel,
        stage: customer.stage,
        staff_id: customer.staff_id === null ? '' : String(customer.staff_id),
        spend: String(customer.spend),
        orders: String(customer.orders),
        company: customer.company ?? '',
        position: customer.position ?? '',
        intent_level: customer.intent_level ?? '',
        notes: customer.notes ?? '',
        tags: customer.tags.map((t) => t.name)
      })
    } else {
      setForm({ ...EMPTY_FORM })
    }
    setNameError(false)
    setSubmitting(false)
  }, [open, customer])

  useEffect(() => {
    if (!open) return
    api
      .getChannels(mode)
      .then((list) => {
        setChannels(list)
        if (!customer && list.length > 0) {
          setForm((prev) => ({ ...prev, channel: prev.channel || list[0] }))
        }
      })
      .catch(() => {})
    api.getStaff().then(setStaffList).catch(() => {})
    api.getTags(mode).then(setAllTags).catch(() => {})
  }, [open, customer, mode])

  const toggleTag = (name: string) => {
    setForm((prev) => ({
      ...prev,
      tags: prev.tags.includes(name) ? prev.tags.filter((n) => n !== name) : [...prev.tags, name]
    }))
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setNameError(true)
      showToast('请填写客户姓名', 'warning')
      return
    }
    const payload: CustomerPayload = {
      name: form.name.trim(),
      wechat_nick: form.wechat_nick.trim(),
      gender: form.gender,
      phone: form.phone.trim() || null,
      channel: form.channel,
      stage: form.stage,
      staff_id: form.staff_id === '' ? null : Number(form.staff_id),
      spend: Number(form.spend) || 0,
      orders: Number(form.orders) || 0,
      notes: form.notes.trim() || null,
      tags: form.tags,
      customer_type: mode,
      ...(mode === 'service'
        ? {
            company: form.company.trim() || null,
            position: form.position.trim() || null,
            intent_level: form.intent_level || null
          }
        : {})
    }
    setSubmitting(true)
    try {
      if (customer) {
        await api.updateCustomer(customer.id, payload)
        showToast('客户档案已更新')
      } else {
        await api.createCustomer(payload)
        showToast('客户档案创建成功')
      }
      onSaved()
      onClose()
    } catch (e) {
      showToast((e as Error).message, 'warning')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none transition'
  const selectCls = 'w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none'
  const labelCls = 'block text-xs font-semibold text-slate-700 mb-1'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={customer ? '编辑客户档案' : '新建客户档案'}
      subtitle={customer ? `档案编号 ${customer.code}` : '完善客户基础资料与画像标签'}
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-white transition"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium disabled:opacity-50 transition"
          >
            {submitting ? '保存中...' : customer ? '保存修改' : '创建客户'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>
            客户姓名 <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => {
              setForm((prev) => ({ ...prev, name: e.target.value }))
              if (nameError) setNameError(false)
            }}
            placeholder="请输入客户姓名"
            className={`${inputCls} ${nameError ? 'border-rose-300 bg-rose-50/50 focus:border-rose-400' : ''}`}
          />
        </div>
        <div>
          <label className={labelCls}>企微昵称</label>
          <input
            type="text"
            value={form.wechat_nick}
            onChange={(e) => setForm((prev) => ({ ...prev, wechat_nick: e.target.value }))}
            placeholder="客户企业微信昵称"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>性别</label>
          <select
            value={form.gender}
            onChange={(e) => setForm((prev) => ({ ...prev, gender: e.target.value }))}
            className={selectCls}
          >
            <option value="女">女</option>
            <option value="男">男</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>手机号</label>
          <input
            type="text"
            value={form.phone}
            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
            placeholder="客户联系电话"
            className={inputCls}
          />
        </div>
        {mode === 'service' && (
          <>
            <div>
              <label className={labelCls}>公司名称</label>
              <input
                type="text"
                value={form.company}
                onChange={(e) => setForm((prev) => ({ ...prev, company: e.target.value }))}
                placeholder="客户所在公司全称"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>职位</label>
              <input
                type="text"
                value={form.position}
                onChange={(e) => setForm((prev) => ({ ...prev, position: e.target.value }))}
                placeholder="关键决策人职位"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>意向等级</label>
              <select
                value={form.intent_level}
                onChange={(e) => setForm((prev) => ({ ...prev, intent_level: e.target.value }))}
                className={selectCls}
              >
                <option value="A">A高意向</option>
                <option value="B">B培育中</option>
                <option value="C">C低意向</option>
              </select>
            </div>
          </>
        )}
        <div>
          <label className={labelCls}>渠道来源</label>
          <select
            value={form.channel}
            onChange={(e) => setForm((prev) => ({ ...prev, channel: e.target.value }))}
            className={selectCls}
          >
            {channels.map((ch) => (
              <option key={ch} value={ch}>
                {ch}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>生命周期</label>
          <select
            value={form.stage}
            onChange={(e) => setForm((prev) => ({ ...prev, stage: e.target.value }))}
            className={selectCls}
          >
            {Object.entries(STAGE_META_BY_MODE[mode]).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>专属导购</label>
          <select
            value={form.staff_id}
            onChange={(e) => setForm((prev) => ({ ...prev, staff_id: e.target.value }))}
            className={selectCls}
          >
            <option value="">暂不分配</option>
            {staffList.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name} ({s.role})
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{MODE_META[mode].spendLabel}（元）</label>
            <input
              type="number"
              min="0"
              value={form.spend}
              onChange={(e) => setForm((prev) => ({ ...prev, spend: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>{MODE_META[mode].ordersLabel}（次）</label>
            <input
              type="number"
              min="0"
              value={form.orders}
              onChange={(e) => setForm((prev) => ({ ...prev, orders: e.target.value }))}
              className={inputCls}
            />
          </div>
        </div>
      </div>

      <div>
        <label className={labelCls}>画像标签</label>
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((t) => {
            const active = form.tags.includes(t.name)
            return (
              <button
                type="button"
                key={t.id}
                onClick={() => toggleTag(t.name)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${
                  active
                    ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                {active && <i className="fa-solid fa-check mr-1 text-[9px]" />}
                {t.name}
              </button>
            )
          })}
          {allTags.length === 0 && <span className="text-[11px] text-slate-400">暂无可用标签</span>}
        </div>
      </div>

      <div>
        <label className={labelCls}>备注</label>
        <textarea
          rows={3}
          value={form.notes}
          onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
          placeholder="客户偏好、沟通注意事项等补充信息"
          className={`${inputCls} leading-relaxed`}
        />
      </div>
    </Modal>
  )
}
