import { useEffect, useState } from 'react'
import { api } from '../api'
import type { BizMode, Staff } from '../types'
import { useToast } from '../components/ui/Toast'


export default function StaffView() {
  const [list, setList] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Staff | null>(null)
  const [form, setForm] = useState({ name: '', role: '', wecom_userid: '', avatar_url: '' })
  const { showToast } = useToast()

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.getStaff()
      setList(data)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const openNew = () => {
    setEditing(null); setForm({ name: '', role: '顾问', wecom_userid: '', avatar_url: '' })
    setFormOpen(true)
  }
  const openEdit = (s: Staff) => {
    setEditing(s); setForm({ name: s.name, role: s.role, wecom_userid: s.wecom_userid || '', avatar_url: s.avatar_url || '' })
    setFormOpen(true)
  }

  const submit = async () => {
    if (!form.name.trim()) { showToast('请填写姓名', 'warning'); return }
    try {
      if (editing) {
        await api.updateStaff(editing.id, form)
        showToast('✅ 已更新')
      } else {
        await api.createStaff(form)
        showToast('✅ 已添加')
      }
      setFormOpen(false); await load()
    } catch (e: any) { showToast(e?.message || '操作失败', 'warning') }
  }

  const remove = async (s: Staff) => {
    if (!confirm(`确定删除「${s.name}」？`)) return
    try {
      await api.deleteStaff(s.id)
      showToast('✅ 已删除'); await load()
    } catch (e: any) { showToast(e?.message || '删除失败', 'warning') }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const r = await api.syncWecomStaff()
      showToast(`✅ 从企微同步了 ${r.synced} 位员工${r.mode === 'simulated' ? '（模拟模式）' : ''}`, 'success')
      await load()
    } catch (e: any) {
      showToast(e?.message || '同步失败', 'warning')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">员工管理</h2>
          <p className="text-xs text-slate-500 mt-0.5">共 {list.length} 位员工 · 企微自动同步中</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-3 py-1.5 bg-white border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 text-slate-600 text-xs rounded-lg flex items-center gap-1.5 transition disabled:opacity-60"
            title="从企微通讯录一键同步（模拟模式可用）"
          >
            <i className={`fa-solid fa-arrows-rotate text-xs ${syncing ? 'fa-spin' : ''}`}/>
            {syncing ? '同步中…' : '从企微同步'}
          </button>
          <button onClick={openNew} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg flex items-center gap-1.5">
            <i className="fa-solid fa-plus text-xs"/> 新增员工
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400"><i className="fa-solid fa-spinner fa-spin mr-2"/>加载中…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map(s => (
            <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition">
              <div className="flex items-start gap-3">
                {s.avatar_url ? (
                  <img src={s.avatar_url} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-white flex items-center justify-center font-bold text-lg shrink-0">
                    {s.name.charAt(0)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 truncate">{s.name}</div>
                  <div className="text-xs text-slate-500">
                    {s.position && s.position !== s.role ? (
                      <>{s.position} <span className="text-slate-300">·</span> <span className="text-slate-400">{s.role}</span></>
                    ) : s.role}
                  </div>
                  {s.wecom_userid && <div className="text-xs text-emerald-600 mt-0.5"><i className="fa-brands fa-weixin mr-1"/>企微: {s.wecom_userid}</div>}
                </div>
              </div>
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100 text-xs">
                <span className="text-slate-600"><b className="text-indigo-600">{s.customer_count ?? 0}</b> 客户</span>
                <span className="text-slate-600"><b className="text-amber-600">{s.pending_followups ?? 0}</b> 待办</span>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => openEdit(s)} className="text-slate-400 hover:text-indigo-600"><i className="fa-solid fa-pen"/></button>
                  <button onClick={() => remove(s)} className="text-slate-400 hover:text-rose-600"><i className="fa-solid fa-trash"/></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setFormOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800 mb-4">{editing ? '编辑员工' : '新增员工'}</h3>
            <div className="space-y-3">
              <div><label className="text-xs text-slate-500">姓名 *</label><input className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></div>
              <div><label className="text-xs text-slate-500">角色</label><input className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}/></div>
              <div><label className="text-xs text-slate-500">企微 userid（可选）</label><input className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" value={form.wecom_userid} onChange={e => setForm({ ...form, wecom_userid: e.target.value })}/></div>
              <div><label className="text-xs text-slate-500">头像 URL（可选）</label><input className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" value={form.avatar_url} onChange={e => setForm({ ...form, avatar_url: e.target.value })}/></div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setFormOpen(false)} className="px-4 py-1.5 border border-slate-200 rounded-lg text-sm">取消</button>
              <button onClick={submit} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-sm">{editing ? '保存' : '添加'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
