import { useEffect, useState } from 'react'
import { api } from '../api'
import type { BizMode, Tag } from '../types'
import { useToast } from '../components/ui/Toast'

interface Props {}

export default function TagLibraryView({}: Props) {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [cat, setCat] = useState('')
  const [name, setName] = useState('')
  const { showToast } = useToast()

  const load = async () => {
    setLoading(true)
    try { setTags(await api.getTags()) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const add = async () => {
    if (!name.trim()) { showToast('标签名称不能为空', 'warning'); return }
    try {
      await api.createTag(name.trim(), cat || '业务标签')
      showToast('✅ 已添加'); setName(''); setCat(''); await load()
    } catch (e: any) { showToast(e?.message || '添加失败', 'warning') }
  }
  const remove = async (t: Tag) => {
    if (!confirm(`删除标签「${t.name}」？已打该标签的客户不会被删除标签。`)) return
    try {
      await api.deleteTag(t.id); showToast('✅ 已删除'); await load()
    } catch (e: any) { showToast(e?.message || '删除失败', 'warning') }
  }

  const groups = tags.reduce((acc: Record<string, Tag[]>, t) => {
    (acc[t.category || '未分类'] = acc[t.category || '未分类'] || []).push(t)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">标签库</h2>
          <p className="text-xs text-slate-500 mt-0.5">共 {tags.length} 个标签</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-slate-500">标签名称</label>
          <input className="mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="例如：高客单价" value={name} onChange={e => setName(e.target.value)}/>
        </div>
        <div>
          <label className="text-xs text-slate-500">分类</label>
          <input className="mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="业务标签" value={cat} onChange={e => setCat(e.target.value)}/>
        </div>
        <button onClick={add} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm">
          <i className="fa-solid fa-plus mr-1"/>添加标签
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400"><i className="fa-solid fa-spinner fa-spin mr-2"/>加载中…</div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groups).map(([category, items]) => (
            <div key={category} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold text-slate-700 text-sm">{category} <span className="text-slate-400">({items.length})</span></div>
              </div>
              <div className="flex flex-wrap gap-2">
                {items.map(t => (
                  <div key={t.id} className="group flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full text-sm">
                    <span>{t.name}</span>
                    <span className="text-xs text-indigo-400">· {t.count ?? 0} 位客户</span>
                    <button onClick={() => remove(t)} className="opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-600 transition">
                      <i className="fa-solid fa-xmark text-xs"/>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
