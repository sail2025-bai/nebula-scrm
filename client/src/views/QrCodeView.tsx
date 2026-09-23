import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { BizMode, QrCode, Staff, Tag } from '../types'
import { useToast } from '../components/ui/Toast'
import Empty from '../components/ui/Empty'
import Modal from '../components/ui/Modal'

interface QrCodeViewProps {
  mode: BizMode
  dataVersion: number
  onChanged?: () => void
}

const CUSTOM_CHANNEL = '__custom__'

const SUBTITLE: Record<BizMode, string> = {
  retail: '为不同获客渠道生成专属活码，客户扫码添加后自动打标签、自动归因渠道',
  service: '为官网、展会等 B 端触点生成活码，留资线索自动入库并打上意向标签'
}

const inputCls =
  'w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none'

export default function QrCodeView({ mode, dataVersion, onChanged }: QrCodeViewProps) {
  const { showToast } = useToast()
  const [qrcodes, setQrcodes] = useState<QrCode[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [channels, setChannels] = useState<string[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', channel: '', customChannel: '', staffId: '', autoTags: [] as string[] })
  const [scanTarget, setScanTarget] = useState<QrCode | null>(null)
  const [scanName, setScanName] = useState('')
  const [scanning, setScanning] = useState(false)

  const loadQrCodes = useCallback(() => {
    api.getQrCodes(mode).then(setQrcodes).catch(() => {})
  }, [mode])

  useEffect(() => {
    loadQrCodes()
  }, [loadQrCodes, dataVersion])

  useEffect(() => {
    api.getStaff().then(setStaff).catch(() => {})
  }, [])

  useEffect(() => {
    api.getChannels(mode).then(setChannels).catch(() => {})
    api.getTags(mode).then(setTags).catch(() => {})
  }, [mode])

  const totalScans = qrcodes.reduce((sum, q) => sum + q.scan_count, 0)
  const activeCount = qrcodes.filter(q => q.active === 1).length
  const channelCount = new Set(qrcodes.map(q => q.channel)).size
  const avgScans = qrcodes.length ? Math.round(totalScans / qrcodes.length) : 0
  const activeRate = qrcodes.length ? Math.round((activeCount / qrcodes.length) * 100) : 0

  const openCreate = () => {
    setForm({ name: '', channel: '', customChannel: '', staffId: '', autoTags: [] })
    setCreateOpen(true)
  }

  const handleCreate = () => {
    const channel = form.channel === CUSTOM_CHANNEL ? form.customChannel.trim() : form.channel
    if (!form.name.trim() || !channel) {
      showToast('请填写活码名称并选择获客渠道', 'warning')
      return
    }
    setSaving(true)
    api
      .createQrCode({
        name: form.name.trim(),
        channel,
        staff_id: form.staffId ? Number(form.staffId) : null,
        auto_tags: form.autoTags,
        mode
      })
      .then(() => {
        setCreateOpen(false)
        showToast('活码创建成功', 'success')
        loadQrCodes()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '创建失败', 'warning'))
      .finally(() => setSaving(false))
  }

  const handleToggle = (q: QrCode) => {
    api
      .updateQrCode(q.id, { active: q.active === 1 ? 0 : 1 })
      .then(() => {
        showToast(q.active === 1 ? `活码「${q.name}」已停用` : `活码「${q.name}」已启用`, 'success')
        loadQrCodes()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '操作失败', 'warning'))
  }

  const handleDelete = (q: QrCode) => {
    if (!window.confirm(`确定删除活码「${q.name}」？删除后不可恢复`)) return
    api
      .deleteQrCode(q.id)
      .then(() => {
        showToast('活码已删除', 'success')
        loadQrCodes()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '删除失败', 'warning'))
  }

  const openScan = (q: QrCode) => {
    setScanTarget(q)
    setScanName('')
  }

  const handleScan = () => {
    if (!scanTarget) return
    setScanning(true)
    api
      .scanQrCode(scanTarget.id, { name: scanName.trim() || undefined })
      .then(res => {
        setScanTarget(null)
        showToast(res.message, 'success')
        loadQrCodes()
        onChanged?.()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '扫码模拟失败', 'warning'))
      .finally(() => setScanning(false))
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80">
          <div className="text-xs text-slate-400">活码总数</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {qrcodes.length} <span className="text-xs font-normal text-slate-500">覆盖 {channelCount} 个获客渠道</span>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200/80">
          <div className="text-xs text-slate-400">累计扫码入库存客</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {totalScans.toLocaleString()} <span className="text-xs font-normal text-slate-500">均值 {avgScans} 次/码</span>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200/80">
          <div className="text-xs text-slate-400">启用中</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {activeCount} <span className="text-xs font-normal text-emerald-600">启用率 {activeRate}%</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="font-bold text-sm text-slate-900">渠道活码矩阵</h4>
            <p className="text-xs text-slate-400 mt-0.5">{SUBTITLE[mode]}</p>
          </div>
          <button
            onClick={openCreate}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-sm transition"
          >
            <i className="fa-solid fa-plus text-xs" />
            <span>新建活码</span>
          </button>
        </div>
        {qrcodes.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                  <th className="p-3.5 pl-4">活码</th>
                  <th className="p-3.5">渠道</th>
                  <th className="p-3.5">负责员工</th>
                  <th className="p-3.5">自动标签</th>
                  <th className="p-3.5">扫码入库</th>
                  <th className="p-3.5">状态</th>
                  <th className="p-3.5 pr-4 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {qrcodes.map(q => {
                  const staffRole = q.staff_id ? staff.find(s => s.id === q.staff_id)?.role : null
                  return (
                    <tr key={q.id} className="hover:bg-slate-50/80 transition">
                      <td className="p-3.5 pl-4">
                        <div className="flex items-center gap-2.5">
                          <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                            <i className="fa-solid fa-qrcode" />
                          </span>
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-800 truncate max-w-[180px]">{q.name}</div>
                            <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">模拟活码</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 whitespace-nowrap">{q.channel}</span>
                      </td>
                      <td className="p-3.5">
                        {q.staffName ? (
                          <div>
                            <div className="text-slate-700 whitespace-nowrap">{q.staffName}</div>
                            <div className="text-[10px] text-slate-400">{staffRole ?? '企微员工'}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400">未指定</span>
                        )}
                      </td>
                      <td className="p-3.5">
                        {q.auto_tags.length ? (
                          <div className="flex items-center flex-wrap gap-1">
                            {q.auto_tags.slice(0, 2).map(t => (
                              <span
                                key={t}
                                className="px-1.5 py-0.5 rounded text-[10px] bg-teal-50 text-teal-700 whitespace-nowrap"
                              >
                                {t}
                              </span>
                            ))}
                            {q.auto_tags.length > 2 && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-500 whitespace-nowrap">
                                +{q.auto_tags.length - 2}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="p-3.5 font-medium text-slate-700 whitespace-nowrap">{q.scan_count} 人</td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <button
                            onClick={() => handleToggle(q)}
                            className={`relative w-9 h-5 rounded-full transition ${
                              q.active === 1 ? 'bg-emerald-500' : 'bg-slate-300'
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                                q.active === 1 ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>
                          <span className={`text-[10px] font-medium ${q.active === 1 ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {q.active === 1 ? '启用' : '停用'}
                          </span>
                        </div>
                      </td>
                      <td className="p-3.5 pr-4 text-center">
                        <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                          <button onClick={() => openScan(q)} className="text-emerald-600 hover:underline">
                            模拟扫码
                          </button>
                          <button onClick={() => handleToggle(q)} className="text-slate-500 hover:text-slate-700 hover:underline">
                            {q.active === 1 ? '停用' : '启用'}
                          </button>
                          <button onClick={() => handleDelete(q)} className="text-slate-400 hover:text-rose-600 hover:underline">
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon="fa-solid fa-qrcode"
            title="暂无渠道活码"
            description="点击右上角「新建活码」为第一个获客渠道生成专属二维码"
          />
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建渠道活码"
        subtitle="客户扫码添加后自动打上所选标签并归因到该渠道"
        maxWidth="max-w-md"
        footer={
          <>
            <button
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-white transition"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
            >
              {saving ? '创建中...' : '确认创建'}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            活码名称 <span className="text-rose-500">*</span>
          </label>
          <input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder={mode === 'retail' ? '例如：小红书种草引流码' : '例如：行业峰会名片回收码'}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            获客渠道 <span className="text-rose-500">*</span>
          </label>
          <select
            value={form.channel}
            onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}
            className={inputCls}
          >
            <option value="">请选择获客渠道</option>
            {channels.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={CUSTOM_CHANNEL}>自定义渠道…</option>
          </select>
          {form.channel === CUSTOM_CHANNEL && (
            <input
              value={form.customChannel}
              onChange={e => setForm(f => ({ ...f, customChannel: e.target.value }))}
              placeholder="请输入自定义渠道名称"
              className={`${inputCls} mt-2`}
            />
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">负责员工（企微客服）</label>
          <select
            value={form.staffId}
            onChange={e => setForm(f => ({ ...f, staffId: e.target.value }))}
            className={inputCls}
          >
            <option value="">不指定（随机分配）</option>
            {staff.map(s => (
              <option key={s.id} value={String(s.id)}>
                {s.name} ({s.role})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">自动标签</label>
          {tags.length ? (
            <div className="grid grid-cols-2 gap-1.5">
              {tags.map(t => {
                const checked = form.autoTags.includes(t.name)
                return (
                  <label
                    key={t.id}
                    className={`flex items-center gap-2 text-xs rounded-lg px-2.5 py-2 cursor-pointer border transition ${
                      checked
                        ? 'bg-emerald-50/80 border-emerald-300 text-emerald-800'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-emerald-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          autoTags: e.target.checked
                            ? [...f.autoTags, t.name]
                            : f.autoTags.filter(x => x !== t.name)
                        }))
                      }
                      className="accent-emerald-600"
                    />
                    <span className="truncate">{t.name}</span>
                  </label>
                )
              })}
            </div>
          ) : (
            <div className="text-xs text-slate-400">暂无可用标签</div>
          )}
        </div>
      </Modal>

      <Modal
        open={scanTarget !== null}
        onClose={() => setScanTarget(null)}
        title="模拟扫码添加"
        subtitle={scanTarget ? `活码：${scanTarget.name} · ${scanTarget.channel}` : ''}
        maxWidth="max-w-md"
        footer={
          <>
            <button
              onClick={() => setScanTarget(null)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-white transition"
            >
              取消
            </button>
            <button
              onClick={handleScan}
              disabled={scanning}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
            >
              {scanning ? '模拟中...' : '确认模拟扫码'}
            </button>
          </>
        }
      >
        <p className="text-xs text-slate-500 leading-relaxed bg-slate-50 border border-slate-200/80 rounded-lg p-3">
          模拟一位客户扫描该活码添加企业微信，系统将自动创建客户档案、打上活码标签并归因渠道
        </p>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">客户姓名</label>
          <input
            value={scanName}
            onChange={e => setScanName(e.target.value)}
            placeholder="留空则随机生成"
            className={inputCls}
          />
        </div>
      </Modal>
    </div>
  )
}
