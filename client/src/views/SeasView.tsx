import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { BizMode, SeasLead, SeasLeadStatus, Staff } from '../types'
import { useToast } from '../components/ui/Toast'
import Empty from '../components/ui/Empty'
import Modal from '../components/ui/Modal'
import { formatDateTime } from '../utils'

interface SeasViewProps {
  mode: BizMode
  dataVersion: number
  onChanged?: () => void
}

const inputCls =
  'w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none'

const STATUS_META: Record<SeasLeadStatus, { label: string; badge: string }> = {
  pending: { label: '待领取', badge: 'bg-amber-100 text-amber-800' },
  claimed: { label: '已领取', badge: 'bg-blue-100 text-blue-800' },
  converted: { label: '已转正', badge: 'bg-emerald-100 text-emerald-800' }
}

export default function SeasView({ mode, dataVersion, onChanged }: SeasViewProps) {
  const { showToast } = useToast()
  const [leads, setLeads] = useState<SeasLead[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [assignOf, setAssignOf] = useState<SeasLead | null>(null)
  const [assignStaffId, setAssignStaffId] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  const loadLeads = useCallback(() => {
    api.getSeasLeads(mode).then(setLeads).catch(() => {})
  }, [mode])

  useEffect(() => {
    loadLeads()
  }, [loadLeads, dataVersion])

  useEffect(() => {
    api.getStaff().then(setStaff).catch(() => {})
  }, [])

  useEffect(() => {
    setAssignOf(null)
    setAssignStaffId('')
    setImportOpen(false)
    setImportText('')
  }, [mode])

  const pendingCount = leads.filter(l => l.status === 'pending').length
  const claimedCount = leads.filter(l => l.status === 'claimed').length
  const convertedCount = leads.filter(l => l.status === 'converted').length

  const openAssign = (lead: SeasLead) => {
    setAssignStaffId('')
    setAssignOf(lead)
  }

  const handleClaim = () => {
    if (!assignOf) return
    if (!assignStaffId) {
      showToast('请选择要分配的顾问', 'warning')
      return
    }
    setClaiming(true)
    api
      .claimSeasLead(assignOf.id, Number(assignStaffId))
      .then(() => {
        setAssignOf(null)
        showToast('线索已分配给顾问，进入跟进流程', 'success')
        loadLeads()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '分配失败', 'warning'))
      .finally(() => setClaiming(false))
  }

  const handleConvert = (lead: SeasLead) => {
    setBusyId(lead.id)
    api
      .convertSeasLead(lead.id)
      .then(() => {
        showToast('线索已转入客户资产库', 'success')
        onChanged?.()
        loadLeads()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '转正失败', 'warning'))
      .finally(() => setBusyId(null))
  }

  const handleReturn = (lead: SeasLead) => {
    setBusyId(lead.id)
    api
      .returnSeasLead(lead.id)
      .then(() => {
        showToast('线索已退回公海池', 'success')
        loadLeads()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '退回失败', 'warning'))
      .finally(() => setBusyId(null))
  }

  const handleDelete = (lead: SeasLead) => {
    if (!window.confirm(`确定删除线索「${lead.name}」？删除后不可恢复`)) return
    setBusyId(lead.id)
    api
      .deleteSeasLead(lead.id)
      .then(() => {
        showToast('线索已删除', 'success')
        loadLeads()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '删除失败', 'warning'))
      .finally(() => setBusyId(null))
  }

  const handleImport = () => {
    const lines = importText
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
    if (!lines.length) {
      showToast('请至少输入一条线索', 'warning')
      return
    }
    setImporting(true)
    api
      .importSeasLeads({ lines, mode })
      .then(res => {
        setImportOpen(false)
        showToast(`成功导入 ${res.imported} 条${res.failed ? `，${res.failed} 条格式有误被跳过` : ''}`, 'success')
        loadLeads()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '导入失败', 'warning'))
      .finally(() => setImporting(false))
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center text-base shrink-0">
            <i className="fa-solid fa-inbox" />
          </span>
          <div>
            <div className="text-xs text-slate-400">待领取</div>
            <div className="text-2xl font-bold text-slate-900 leading-tight">{pendingCount}</div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-base shrink-0">
            <i className="fa-solid fa-user-check" />
          </span>
          <div>
            <div className="text-xs text-slate-400">已领取</div>
            <div className="text-2xl font-bold text-slate-900 leading-tight">{claimedCount}</div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-base shrink-0">
            <i className="fa-solid fa-circle-check" />
          </span>
          <div>
            <div className="text-xs text-slate-400">已转正</div>
            <div className="text-2xl font-bold text-slate-900 leading-tight">{convertedCount}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
            <i className="fa-solid fa-water" />
          </span>
          <div className="min-w-0">
            <h4 className="font-bold text-slate-900 text-sm">线索公海池</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              {mode === 'service'
                ? '未分配的企业线索，领取或分配给顾问跟进后可转入客户库'
                : '未承接的消费者线索，认领后转入客户库统一运营'}
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            setImportText('')
            setImportOpen(true)
          }}
          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-sm transition shrink-0"
        >
          <i className="fa-solid fa-file-import text-xs" />
          <span>批量导入线索</span>
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow overflow-hidden">
        {leads.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                  <th className="p-3.5 pl-4">线索信息</th>
                  <th className="p-3.5">渠道</th>
                  <th className="p-3.5">来源</th>
                  <th className="p-3.5">状态</th>
                  <th className="p-3.5">负责人</th>
                  <th className="p-3.5">领取时间</th>
                  <th className="p-3.5 pr-4 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {leads.map(l => {
                  const meta = STATUS_META[l.status]
                  return (
                    <tr key={l.id} className="hover:bg-slate-50/80 transition">
                      <td className="p-3.5 pl-4">
                        <div className="font-semibold text-slate-800">{l.name}</div>
                        <div className="text-[10px] text-slate-400">{l.phone || l.wechat_nick || '暂无联系方式'}</div>
                        {mode === 'service' && l.company && (
                          <div className="text-[10px] text-slate-400 mt-0.5">{l.company}</div>
                        )}
                      </td>
                      <td className="p-3.5 whitespace-nowrap">{l.channel || '-'}</td>
                      <td className="p-3.5 whitespace-nowrap text-slate-500">{l.source || '-'}</td>
                      <td className="p-3.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${meta.badge}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="p-3.5 whitespace-nowrap">{l.ownerName || '-'}</td>
                      <td className="p-3.5 whitespace-nowrap text-slate-500">
                        {l.claimed_at ? formatDateTime(l.claimed_at) : '-'}
                      </td>
                      <td className="p-3.5 pr-4">
                        <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                          {l.status === 'pending' && (
                            <button onClick={() => openAssign(l)} className="text-emerald-600 hover:underline">
                              分配
                            </button>
                          )}
                          {l.status === 'claimed' && (
                            <>
                              <button
                                onClick={() => handleConvert(l)}
                                disabled={busyId === l.id}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
                              >
                                转正入库
                              </button>
                              <button
                                onClick={() => handleReturn(l)}
                                disabled={busyId === l.id}
                                className="text-amber-600 hover:underline disabled:opacity-50"
                              >
                                退回
                              </button>
                            </>
                          )}
                          {l.status === 'converted' && <span className="text-xs text-slate-400">已入库</span>}
                          <button
                            onClick={() => handleDelete(l)}
                            disabled={busyId === l.id}
                            title="删除线索"
                            className="text-slate-400 hover:text-rose-600 transition disabled:opacity-50"
                          >
                            <i className="fa-solid fa-trash-can" />
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
            icon="fa-solid fa-water"
            title="公海池暂无线索"
            description="点击「批量导入线索」沉淀第一批待分配线索"
          />
        )}
      </div>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="批量导入线索"
        subtitle={`每行一条线索，将导入至${mode === 'service' ? 'B端' : 'C端'}公海池`}
        footer={
          <>
            <button
              onClick={() => setImportOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-white transition"
            >
              取消
            </button>
            <button
              onClick={handleImport}
              disabled={importing}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
            >
              {importing ? '导入中...' : '开始导入'}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            线索明细 <span className="text-rose-500">*</span>
          </label>
          <textarea
            rows={8}
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder={'每行一条线索，字段用逗号分隔：\n姓名,公司,手机,渠道\n示例：沈亦舟,杭州临溪网络科技,13800001111,官网表单留资'}
            className={`${inputCls} font-mono leading-relaxed resize-y`}
          />
          <p className="text-[11px] text-slate-400 mt-1.5">至少填写姓名，公司为 B 端线索建议填写</p>
        </div>
      </Modal>

      <Modal
        open={!!assignOf}
        onClose={() => setAssignOf(null)}
        title="分配线索"
        subtitle={assignOf ? `将「${assignOf.name}」分配给顾问后即进入已领取状态` : undefined}
        maxWidth="max-w-md"
        footer={
          <>
            <button
              onClick={() => setAssignOf(null)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-white transition"
            >
              取消
            </button>
            <button
              onClick={handleClaim}
              disabled={claiming}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
            >
              {claiming ? '分配中...' : '确认分配'}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            选择顾问 <span className="text-rose-500">*</span>
          </label>
          <select value={assignStaffId} onChange={e => setAssignStaffId(e.target.value)} className={inputCls}>
            <option value="">请选择顾问</option>
            {staff.map(s => (
              <option key={s.id} value={String(s.id)}>
                {s.name} ({s.role})
              </option>
            ))}
          </select>
        </div>
      </Modal>
    </div>
  )
}
