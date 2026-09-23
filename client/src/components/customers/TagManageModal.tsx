import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import type { BizMode, Tag } from '../../types'
import Modal from '../ui/Modal'
import { useToast } from '../ui/Toast'

const CATEGORIES = ['智能标签', '业务标签', '渠道标签']

const CATEGORY_CLS: Record<string, string> = {
  智能标签: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  业务标签: 'bg-blue-50 text-blue-700 border-blue-200',
  渠道标签: 'bg-amber-50 text-amber-700 border-amber-200'
}

interface TagManageModalProps {
  open: boolean
  mode: BizMode
  onClose: () => void
  onChanged: () => void
}

export default function TagManageModal({ open, mode, onClose, onChanged }: TagManageModalProps) {
  const { showToast } = useToast()
  const [tags, setTags] = useState<Tag[]>([])
  const [categoryFilter, setCategoryFilter] = useState('')
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('智能标签')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState('智能标签')

  const fetchTags = useCallback(async () => {
    try {
      setTags(await api.getTags(mode))
    } catch (e) {
      showToast((e as Error).message, 'warning')
    }
  }, [showToast, mode])

  useEffect(() => {
    if (open) fetchTags()
  }, [open, fetchTags])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) {
      showToast('请输入标签名称', 'warning')
      return
    }
    if (tags.some((t) => t.name === name)) {
      showToast('该标签已存在', 'warning')
      return
    }
    try {
      await api.createTag(name, newCategory, mode)
      showToast(`标签「${name}」创建成功`)
      setNewName('')
      await fetchTags()
      onChanged()
    } catch (e) {
      showToast((e as Error).message, 'warning')
    }
  }

  const startEdit = (tag: Tag) => {
    setEditingId(tag.id)
    setEditName(tag.name)
    setEditCategory(tag.category)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName('')
  }

  const saveEdit = async () => {
    if (editingId === null) return
    const name = editName.trim()
    if (!name) {
      showToast('标签名称不能为空', 'warning')
      return
    }
    try {
      await api.updateTag(editingId, name, editCategory)
      showToast('标签已更新')
      setEditingId(null)
      await fetchTags()
      onChanged()
    } catch (e) {
      showToast((e as Error).message, 'warning')
    }
  }

  const handleDelete = async (tag: Tag) => {
    if (!window.confirm(`确定删除标签「${tag.name}」吗？`)) return
    try {
      await api.deleteTag(tag.id)
      showToast(`标签「${tag.name}」已删除`)
      await fetchTags()
      onChanged()
    } catch (e) {
      showToast((e as Error).message, 'warning')
    }
  }

  const filtered = categoryFilter ? tags.filter((t) => t.category === categoryFilter) : tags

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="标签库管理"
      subtitle="统一维护智能 / 业务 / 渠道标签体系"
      maxWidth="max-w-lg"
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleCreate()
            }
          }}
          placeholder="新标签名称"
          className="flex-1 text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none"
        />
        <select
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          className="text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          onClick={handleCreate}
          className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center gap-1 transition shrink-0"
        >
          <i className="fa-solid fa-plus text-[10px]" />
          添加
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-600">
        <span className="text-slate-400">分类筛选:</span>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none"
        >
          <option value="">全部分类</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="ml-auto text-slate-400">共 {filtered.length} 个标签</span>
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
              <th className="p-3">标签名称</th>
              <th className="p-3">分类</th>
              <th className="p-3 text-center">关联客户</th>
              <th className="p-3 pr-4 text-center">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {filtered.map((t) =>
              editingId === t.id ? (
                <tr key={t.id} className="bg-emerald-50/40">
                  <td className="p-3">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full text-xs p-1.5 bg-white border border-emerald-300 rounded-lg focus:outline-none"
                    />
                  </td>
                  <td className="p-3">
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="text-xs p-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3 text-center text-slate-400">{t.count ?? 0} 位</td>
                  <td className="p-3 pr-4">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={saveEdit}
                        title="保存"
                        className="w-6 h-6 rounded-md flex items-center justify-center text-emerald-600 hover:bg-emerald-100 transition"
                      >
                        <i className="fa-solid fa-check text-[11px]" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        title="取消"
                        className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-100 transition"
                      >
                        <i className="fa-solid fa-xmark text-[11px]" />
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={t.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="p-3 font-medium text-slate-800">{t.name}</td>
                  <td className="p-3">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                        CATEGORY_CLS[t.category] ?? 'bg-slate-50 text-slate-600 border-slate-200'
                      }`}
                    >
                      {t.category}
                    </span>
                  </td>
                  <td className="p-3 text-center text-slate-500">{t.count ?? 0} 位</td>
                  <td className="p-3 pr-4">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => startEdit(t)}
                        title="编辑标签"
                        className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition"
                      >
                        <i className="fa-solid fa-pen text-[11px]" />
                      </button>
                      <button
                        onClick={() => handleDelete(t)}
                        title="删除标签"
                        className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                      >
                        <i className="fa-regular fa-trash-can text-[11px]" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-8 text-center text-xs text-slate-400">该分类下暂无标签</div>
        )}
      </div>
    </Modal>
  )
}
