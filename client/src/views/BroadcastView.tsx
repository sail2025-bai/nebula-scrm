import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { MODE_META, type BizMode, type Broadcast, type Segment, type Staff } from '../types'
import { useToast } from '../components/ui/Toast'
import Avatar from '../components/ui/Avatar'
import Empty from '../components/ui/Empty'
import Modal from '../components/ui/Modal'
import { formatRelativeTime } from '../utils'

interface BroadcastViewProps {
  mode: BizMode
  openSignal: number
  dataVersion: number
}

const DEFAULT_MESSAGE =
  '亲爱的 #{客户昵称}，秋季干燥换季敏感是不是又困扰你了？为你专属申请了一份【敏感肌修护小样尝鲜礼包】，点击下方链接即可0元免邮申领哦~'

const inputCls =
  'w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none'

export default function BroadcastView({ mode, openSignal, dataVersion }: BroadcastViewProps) {
  const { showToast } = useToast()
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '',
    type: '客户群发' as Broadcast['type'],
    audience: 'all',
    staff: 'all',
    message: DEFAULT_MESSAGE
  })

  const loadBroadcasts = useCallback(() => {
    api.getBroadcasts(mode).then(setBroadcasts).catch(() => {})
  }, [mode])

  useEffect(() => {
    loadBroadcasts()
  }, [loadBroadcasts, dataVersion])

  useEffect(() => {
    api.getSegments(mode).then(setSegments).catch(() => {})
    api.getStaff().then(setStaff).catch(() => {})
  }, [mode])

  useEffect(() => {
    if (openSignal > 0) setCreateOpen(true)
  }, [openSignal])

  const openCreate = () => {
    setForm({ title: '', type: '客户群发', audience: 'all', staff: 'all', message: DEFAULT_MESSAGE })
    setCreateOpen(true)
  }

  const handleSubmit = () => {
    if (!form.title.trim()) {
      showToast('请填写任务名称', 'warning')
      return
    }
    if (!form.message.trim()) {
      showToast('请填写推送文案', 'warning')
      return
    }
    const segment = segments.find(s => String(s.id) === form.audience)
    setSaving(true)
    api
      .createBroadcast({
        title: form.title.trim(),
        type: form.type,
        audience_desc: segment ? segment.name : '全部私域好友',
        message: form.message.trim(),
        conditions: segment ? segment.conditions : undefined,
        mode
      })
      .then(() => {
        setCreateOpen(false)
        showToast(`群发任务已创建并下发至${MODE_META[mode].staffWord}企微端`, 'success')
        loadBroadcasts()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '创建失败', 'warning'))
      .finally(() => setSaving(false))
  }

  return (
    <div className="space-y-4">
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 custom-shadow flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-bold text-slate-900 text-sm">精准群发与朋友圈宣发助手</h4>
          <p className="text-xs text-slate-400 mt-0.5">严格遵循企微官方频次限制规则，合规触达每一位高价值客户</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center gap-2 shadow-sm transition"
        >
          <i className="fa-solid fa-bullhorn text-xs" />
          <span>创建企微群发推送</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/80 custom-shadow overflow-hidden">
          <div className="p-4 border-b border-slate-100 font-bold text-sm text-slate-800">最近触达记录列表</div>
          {broadcasts.length ? (
            <div className="divide-y divide-slate-100 text-xs">
              {broadcasts.map(b => (
                <div key={b.id} className="p-4 hover:bg-slate-50 transition flex flex-wrap items-center justify-between gap-2 sm:gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 font-semibold rounded shrink-0 ${
                          b.type === '客户群发' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {b.type}
                      </span>
                      <span className="font-bold text-slate-900 truncate">{b.title}</span>
                    </div>
                    <div className="text-slate-400 mt-1 text-[11px] truncate">
                      推送范围: {b.audience_desc} | 覆盖 {b.target_count} 人
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-emerald-600 font-bold text-xs whitespace-nowrap">
                      {b.type === '客户群发' ? `${MODE_META[mode].staffWord}已发送 ${b.sent_rate}%` : `执行率 ${b.sent_rate}%`}
                    </div>
                    <div className="text-slate-400 text-[10px] mt-0.5">{formatRelativeTime(b.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon="fa-regular fa-paper-plane"
              title="暂无触达记录"
              description="创建第一条企微群发任务，合规触达你的高价值客户"
            />
          )}
        </div>

        <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
          <h5 className="font-bold text-slate-800 text-xs mb-3 flex items-center gap-2">
            <i className="fa-brands fa-weixin text-emerald-600" />
            官方企微触达配额规则
          </h5>
          <div className="space-y-3 text-xs text-slate-600">
            <div className="p-3 bg-white rounded-xl border border-slate-200/80">
              <div className="font-semibold text-slate-800">企业群发限制</div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                每位客户每个自然月最多接收企业群发 <b className="text-emerald-600">4次</b>。
              </p>
            </div>
            <div className="p-3 bg-white rounded-xl border border-slate-200/80">
              <div className="font-semibold text-slate-800">企业朋友圈限制</div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                企业每月可统一发表 <b className="text-emerald-600">4条</b>，员工个人每天发表{' '}
                <b className="text-emerald-600">3条</b>。
              </p>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建精准客户群发任务"
        subtitle={`创建后将分发至相关${MODE_META[mode].staffWord}的企业微信端，${MODE_META[mode].staffWord}一键确认即刻推送`}
        maxWidth="max-w-2xl"
        footer={
          <>
            <button
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-white transition"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
            >
              {saving ? '创建中...' : '确认创建并下发'}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            任务名称 <span className="text-rose-500">*</span>
          </label>
          <input
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="例如：【初秋换季】敏感肌专研精华专属尝鲜礼"
            className={inputCls}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">推送类型</label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value as Broadcast['type'] }))}
              className={inputCls}
            >
              <option value="客户群发">客户群发</option>
              <option value="企业朋友圈">企业朋友圈</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">目标受众筛选</label>
            <select
              value={form.audience}
              onChange={e => setForm(f => ({ ...f, audience: e.target.value }))}
              className={inputCls}
            >
              <option value="all">全部私域好友</option>
              {segments.map(s => (
                <option key={s.id} value={String(s.id)}>
                  {s.name} ({s.count} 人)
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">执行{MODE_META[mode].staffWord}人员</label>
          <select value={form.staff} onChange={e => setForm(f => ({ ...f, staff: e.target.value }))} className={inputCls}>
            <option value="all">对应客户专属跟进{MODE_META[mode].staffWord} (全员)</option>
            {staff.map(s => (
              <option key={s.id} value={String(s.id)}>
                {s.name} ({s.role})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            推送文案内容 (自动带入客户企微昵称变量)
          </label>
          <textarea
            rows={3}
            value={form.message}
            onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
            placeholder="支持 #{客户昵称} 变量，发送时将自动替换为客户企微昵称"
            className={`${inputCls} leading-relaxed resize-none`}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">企微端发送预览效果</label>
          <div className="bg-slate-100 p-4 rounded-xl flex items-start gap-3">
            <Avatar name="林晨" size="md" />
            <div className="max-w-md min-w-0">
              <div className="text-[10px] text-slate-400 mb-1">林晨 (美诺美妆资深{MODE_META[mode].staffWord})</div>
              <div className="bg-white p-3 rounded-2xl rounded-tl-none shadow-sm text-xs text-slate-800 leading-normal break-all">
                {form.message || '（暂未填写文案）'}
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
