import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { BizMode, QrCode, Staff, Tag } from '../types'
import { useToast } from '../components/ui/Toast'
import Empty from '../components/ui/Empty'
import Modal from '../components/ui/Modal'

interface QrCodeViewProps {

  dataVersion: number
  onChanged?: () => void
  prefill?: { target_type: 'coupon' | 'seckill'; target_id: number; suggestName?: string; ticket: number } | null
  onPrefillConsumed?: () => void
}

const CUSTOM_CHANNEL = '__custom__'

const SUBTITLE = '为不同获客渠道生成专属活码，客户扫码添加后自动打标签、自动归因渠道'

const inputCls =
  'w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none'

export default function QrCodeView({dataVersion, onChanged, prefill, onPrefillConsumed }: QrCodeViewProps) {
  const { showToast } = useToast()
  const [qrcodes, setQrcodes] = useState<QrCode[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [channels, setChannels] = useState<string[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '', channel: '', customChannel: '', staffId: '',
    autoTags: [] as string[], ctaType: 'hybrid' as 'hybrid' | 'target_page' | 'add_staff',
    targetType: '' as '' | 'coupon' | 'seckill', targetId: '' as string
  })
  const [coupons, setCoupons] = useState<{ id: number; name: string; type?: string; value?: number }[]>([])
  const [seckills, setSeckills] = useState<{ id: number; title: string; price?: number; stock?: number; sold?: number }[]>([])
  const [scanTarget, setScanTarget] = useState<QrCode | null>(null)
  const [scanName, setScanName] = useState('')
  const [scanning, setScanning] = useState(false)
  const [downloadTarget, setDownloadTarget] = useState<QrCode | null>(null)

  const pngUrl = (id: number) => `/api/public/qrcodes/${id}/png`
  const landingUrl = (q: QrCode) =>
    q.target_type === 'seckill' ? `/p/seckill?qr=${q.id}` : `/p/coupon?qr=${q.id}`

  const loadQrCodes = useCallback(() => {
    api.getQrCodes().then(setQrcodes).catch(() => {})
  }, [])

  useEffect(() => {
    loadQrCodes()
  }, [loadQrCodes, dataVersion])

  useEffect(() => {
    api.getStaff().then(setStaff).catch(() => {})
  }, [])

  useEffect(() => {
    api.getChannels().then(setChannels).catch(() => {})
    api.getTags().then(setTags).catch(() => {})
  }, [])

  useEffect(() => {
    // 加载可关联的优惠券和秒杀活动（给活码创建表单用）
    api.getCoupons().then(list => setCoupons(list.filter(c => c.active !== 0))).catch(() => {})
    api.getSeckills().then(list => setSeckills(list.filter(s => s.active === 1))).catch(() => {})
  }, [])

  // 监听 CouponView/SeckillView 传过来的 prefill：自动打开创建 Modal 并预填
  useEffect(() => {
    if (!prefill) return
    setForm(f => ({
      ...f,
      name: prefill.suggestName || f.name,
      targetType: prefill.target_type,
      targetId: String(prefill.target_id)
    }))
    setCreateOpen(true)
    showToast(`已预填：关联${prefill.target_type === 'coupon' ? '优惠券' : '秒杀'}活动`, 'info')
    onPrefillConsumed?.()
  }, [prefill?.ticket])

  const totalScans = qrcodes.reduce((sum, q) => sum + q.scan_count, 0)
  const activeCount = qrcodes.filter(q => q.active === 1).length
  const channelCount = new Set(qrcodes.map(q => q.channel)).size
  const avgScans = qrcodes.length ? Math.round(totalScans / qrcodes.length) : 0
  const activeRate = qrcodes.length ? Math.round((activeCount / qrcodes.length) * 100) : 0

  const openCreate = () => {
    setForm({ name: '', channel: '', customChannel: '', staffId: '', autoTags: [], ctaType: 'hybrid', targetType: '', targetId: '' })
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
        cta_type: form.ctaType,
        target_type: form.targetType || null,
        target_id: form.targetId ? Number(form.targetId) : null})
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

  const handleDelete = async (q: QrCode) => {
    if (!(await window.confirm(`确定删除活码「${q.name}」？删除后不可恢复`))) return
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
            <p className="text-xs text-slate-400 mt-0.5">{SUBTITLE}</p>
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
                          <button onClick={() => setDownloadTarget(q)} className="text-emerald-600 hover:underline">
                            下载活码
                          </button>
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
            placeholder="例如：小红书种草引流码或行业峰会名片回收码"
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

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            扫码后客户去哪？
            <span className="text-[10px] text-slate-400 font-normal ml-1">（CTA 模式）</span>
          </label>
          <div className="space-y-1.5">
            {([
              { v: 'hybrid', icon: '🎁', title: '落地页 + 顾问引导', desc: '先领券/秒杀，落地页底部显示专属顾问卡片（推荐）' },
              { v: 'add_staff', icon: '👤', title: '直接加顾问', desc: '扫码立刻添加指定企微员工为好友（需企微已连通）' },
              { v: 'target_page', icon: '📄', title: '纯活动落地页', desc: '仅领券/秒杀，不显示顾问卡片（老行为）' }
            ] as const).map(o => {
              const checked = form.ctaType === o.v
              return (
                <label
                  key={o.v}
                  className={`flex items-start gap-2.5 text-xs rounded-lg px-3 py-2.5 cursor-pointer border transition ${
                    checked
                      ? 'bg-emerald-50/80 border-emerald-300 text-emerald-800'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-emerald-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="ctaType"
                    checked={checked}
                    onChange={() => setForm(f => ({ ...f, ctaType: o.v }))}
                    className="mt-0.5 accent-emerald-600"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium flex items-center gap-1">
                      <span>{o.icon}</span>
                      <span>{o.title}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{o.desc}</div>
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        {/* 关联活动（选填）— 决定扫码落地页显示内容 */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            关联活动
            <span className="text-[10px] text-slate-400 font-normal ml-1">（选填，决定客户扫码看到什么）</span>
          </label>
          <div className="flex gap-1.5 mb-2">
            {([
              { v: '', label: '不关联' },
              { v: 'coupon', label: '关联优惠券' },
              { v: 'seckill', label: '关联秒杀' }
            ] as const).map(o => {
              const checked = form.targetType === o.v
              return (
                <button
                  key={o.v || 'none'}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, targetType: o.v, targetId: '' }))}
                  className={`flex-1 text-xs px-2 py-1.5 rounded-lg border transition ${
                    checked
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700 font-medium'
                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-emerald-200'
                  }`}
                >
                  {o.label}
                </button>
              )
            })}
          </div>

          {form.targetType === 'coupon' && (
            <select
              value={form.targetId}
              onChange={e => setForm(f => ({ ...f, targetId: e.target.value }))}
              className={inputCls}
            >
              <option value="">选择一张优惠券…</option>
              {coupons.length === 0 && <option disabled>暂无可用优惠券</option>}
              {coupons.map(c => (
                <option key={c.id} value={c.id}>
                  ￥{c.value} {c.name}
                </option>
              ))}
            </select>
          )}

          {form.targetType === 'seckill' && (
            <select
              value={form.targetId}
              onChange={e => setForm(f => ({ ...f, targetId: e.target.value }))}
              className={inputCls}
            >
              <option value="">选择一个秒杀活动…</option>
              {seckills.length === 0 && <option disabled>暂无可用秒杀活动</option>}
              {seckills.map(s => (
                <option key={s.id} value={s.id}>
                  ￥{s.price} {s.title}（剩余 {Math.max(0, (s.stock ?? 0) - (s.sold ?? 0))}）
                </option>
              ))}
            </select>
          )}

          {form.targetType && form.targetId && (
            <div className="mt-1.5 text-[11px] text-emerald-700 bg-emerald-50 rounded px-2 py-1">
              ✅ 客户扫码后 → 落地页将展示
              {form.targetType === 'coupon' ? '优惠券' : '秒杀活动'}详情
            </div>
          )}

          {!form.targetType && (
            <div className="text-[10px] text-slate-400 mt-1.5">
              不关联活动：扫码仅自动建档 + 打标签 + 加顾问
            </div>
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

      {/* === 活码下载预览弹窗 === */}
      <Modal
        open={downloadTarget !== null}
        onClose={() => setDownloadTarget(null)}
        title="下载活码二维码"
        subtitle={downloadTarget ? `${downloadTarget.name} · ${downloadTarget.channel}` : ''}
        maxWidth="max-w-md"
        footer={
          <>
            <button
              onClick={() => setDownloadTarget(null)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-white transition"
            >
              关闭
            </button>
            {downloadTarget && (
              <a
                href={pngUrl(downloadTarget.id)}
                download={`qrcode_${downloadTarget.id}_${downloadTarget.name}.png`}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition inline-flex items-center gap-1.5"
              >
                <i className="fa-solid fa-download" />
                <span>下载 PNG</span>
              </a>
            )}
          </>
        }
      >
        {downloadTarget && (
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-slate-50 to-emerald-50/40 border border-slate-200/80 rounded-xl p-6 flex items-center justify-center">
              <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-100">
                <img
                  src={pngUrl(downloadTarget.id)}
                  alt={`活码 ${downloadTarget.name}`}
                  className="w-48 h-48 block"
                  loading="lazy"
                />
              </div>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="text-slate-400 shrink-0 w-16">落地页</span>
                <code className="text-slate-700 bg-slate-50 px-2 py-1 rounded border border-slate-100 flex-1 break-all">
                  {typeof window !== 'undefined' ? window.location.origin : ''}
                  {landingUrl(downloadTarget)}
                </code>
              </div>
              {downloadTarget.target_type && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 shrink-0 w-16">关联活动</span>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700">
                    {downloadTarget.target_type === 'seckill' ? '秒杀活动' : '优惠券'}
                    {downloadTarget.target_id ? ` #${downloadTarget.target_id}` : '（未关联）'}
                  </span>
                </div>
              )}
              <div className="text-[10px] text-slate-400 leading-relaxed bg-slate-50 border border-slate-200/80 rounded-lg p-2.5">
                💡 客户扫码后会自动进入公开落地页，完成领券/秒杀后系统自动建档并打标签
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
