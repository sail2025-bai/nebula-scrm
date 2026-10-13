import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { Category, Product } from '../types'
import { useToast } from '../components/ui/Toast'
import Empty from '../components/ui/Empty'
import Modal from '../components/ui/Modal'

interface Props { dataVersion?: number }

type FilterTab = 'all' | 'active' | 'inactive'

const PAGE_SIZE = 12

/** 生成分页数字按钮数组，中间折叠为省略号（对齐 CustomersView 风格） */
function buildPageItems(current: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1)
  if (current <= 3) return [1, 2, 3, 4, '...', totalPages]
  if (current >= totalPages - 2) return [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  return [1, '...', current - 1, current, current + 1, '...', totalPages]
}

const DEFAULT_PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="#f1f5f9"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#94a3b8" font-size="40">无图</text></svg>`
  )

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '-'
  return `¥${Number(n).toFixed(Number(n) % 1 === 0 ? 0 : 2)}`
}

export default function ProductView({ dataVersion }: Props) {
  const toast = useToast()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')
  const [selectedCat, setSelectedCat] = useState<number | 'all'>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [showCatModal, setShowCatModal] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [page, setPage] = useState(1)

  const defaultForm = useMemo<ProductForm>(
    () => ({
      name: '',
      price: 0,
      original_price: null,
      category_id: null,
      stock: 0,
      description: '',
      image_url: '',
      images: [],
      tag: '',
      sku: '',
      active: 1,
    }),
    []
  )

  const [form, setForm] = useState<ProductForm>(defaultForm)

  async function load() {
    setLoading(true)
    try {
      const [pRes, cRes] = await Promise.all([
        api.getProducts({ all: 1 }),
        api.getCategories(),
      ])
      setProducts(pRes.items)
      setCategories(cRes.items)
    } catch (e: any) {
      toast.showToast(e.message || '加载失败', 'warning')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [dataVersion])

  // 筛选
  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (filter === 'active' && p.active !== 1) return false
      if (filter === 'inactive' && p.active !== 0) return false
      if (selectedCat !== 'all' && p.category_id !== selectedCat) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        if (!p.name.toLowerCase().includes(q) && !p.tag.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [products, filter, search, selectedCat])

  // 筛选/分类/搜索变化时重置到第 1 页
  useEffect(() => { setPage(1) }, [filter, selectedCat, search])

  // 客户端分页
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = buildPageItems(safePage, totalPages)
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const totals = useMemo(() => ({
    total: products.length,
    active: products.filter((p) => p.active === 1).length,
    stock: products.reduce((s, p) => s + (p.stock || 0), 0),
    sold: products.reduce((s, p) => s + (p.sold || 0), 0),
  }), [products])

  // 表单处理
  function openCreate() {
    setEditing(null)
    setForm(defaultForm)
    setShowCreate(true)
  }
  function openEdit(p: Product) {
    setEditing(p)
    setForm({
      name: p.name,
      price: p.price,
      original_price: p.original_price,
      category_id: p.category_id,
      stock: p.stock,
      description: p.description || '',
      image_url: p.image_url || '',
      images: p.images || [],
      tag: p.tag || '',
      sku: p.sku || '',
      active: p.active,
    })
    setShowCreate(true)
  }

  /** 上传商品主图到服务器，返回 /uploads/xxx.png 路径 */
  async function handleUploadImage(file: File) {
    if (!/^image\//.test(file.type)) {
      toast.showToast('只能上传图片文件', 'warning')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.showToast('图片不能超过 5MB', 'warning')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload/image', { method: 'POST', body: fd })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || '上传失败')
      }
      const data = await res.json()
      setForm((f) => ({ ...f, image_url: data.url }))
      toast.showToast('图片上传成功', 'success')
    } catch (e: any) {
      toast.showToast(e.message || '上传失败', 'warning')
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit() {
    if (!form.name.trim()) return toast.showToast('商品名称必填', 'warning')
    if (!form.price || form.price <= 0) return toast.showToast('价格必须大于 0', 'warning')
    try {
      if (editing) {
        await api.updateProduct(editing.id, form)
        toast.showToast('已更新', 'success')
      } else {
        await api.createProduct(form)
        toast.showToast('已创建', 'success')
      }
      setShowCreate(false)
      load()
    } catch (e: any) {
      toast.showToast(e.message || '操作失败', 'warning')
    }
  }

  async function handleToggle(p: Product) {
    try {
      await api.toggleProduct(p.id)
      toast.showToast(p.active === 1 ? '已下架' : '已上架', 'success')
      load()
    } catch (e: any) {
      toast.showToast(e.message || '操作失败', 'warning')
    }
  }

  async function handleDelete(id: number) {
    if (!(await window.confirm('确认删除该商品？该操作不可恢复'))) return
    try {
      await api.deleteProduct(id)
      toast.showToast('已删除', 'success')
      load()
    } catch (e: any) {
      toast.showToast(e.message || '删除失败', 'warning')
    }
  }

  async function handleCreateCategory() {
    if (!newCatName.trim()) return toast.showToast('分类名称必填', 'warning')
    try {
      await api.createCategory({ name: newCatName.trim() })
      setNewCatName('')
      setShowCatModal(false)
      load()
    } catch (e: any) {
      toast.showToast(e.message || '创建失败', 'warning')
    }
  }

  async function handleDeleteCategory(id: number) {
    if (!(await window.confirm('确认删除此分类？该分类下商品的 category_id 将置空'))) return
    try {
      await api.deleteCategory(id)
      load()
    } catch (e: any) {
      toast.showToast(e.message || '删除失败', 'warning')
    }
  }

  return (
    <div className="space-y-4">
      {/* 顶部操作栏 + 统计 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-500">
          管理商城的全部商品与分类，运营中可预览客户在 H5 端看到的样子
        </div>
        <button
          onClick={() => {
            const base = window.location.origin
            // 用第一个客户 C1069 作为默认预览身份（运营演示场景固定）
            window.open(`${base}/p/shop?code=C1069`, '_blank', 'noopener,noreferrer')
          }}
          className="px-3.5 py-2 bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600 text-white rounded-lg shadow-sm text-sm font-medium flex items-center gap-2 transition"
        >
          <i className="fa-solid fa-mobile-screen" />
          H5 预览商城
          <i className="fa-solid fa-arrow-up-right-from-square text-[10px]" />
        </button>
      </div>

      {/* 统计卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="商品总数" value={totals.total} icon="fa-box" color="emerald" />
        <StatCard label="上架中" value={totals.active} icon="fa-circle-check" color="sky" />
        <StatCard label="总库存" value={totals.stock.toLocaleString()} icon="fa-box-archive" color="amber" />
        <StatCard label="累计销量" value={totals.sold.toLocaleString()} icon="fa-bolt" color="rose" />
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        {/* 左侧：分类 */}
        <div className="md:w-56 shrink-0 space-y-2">
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-3 py-2.5 flex items-center justify-between border-b border-slate-100">
              <span className="text-xs font-semibold text-slate-600">商品分类</span>
              <button
                onClick={() => setShowCatModal(true)}
                className="text-[11px] text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
              >
                <i className="fa-solid fa-plus" /> 新建
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto py-1">
              {/* 全部商品 */}
              <button
                onClick={() => setSelectedCat('all')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition ${
                  selectedCat === 'all'
                    ? 'bg-emerald-50 text-emerald-700 font-medium border-l-2 border-emerald-500'
                    : 'text-slate-600 hover:bg-slate-50 border-l-2 border-transparent'
                }`}
              >
                <i className="fa-solid fa-boxes-stacked w-4 text-center text-emerald-500" />
                <span className="flex-1 text-left truncate">全部商品</span>
                <span className="text-[11px] text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-100 tabular-nums">
                  {products.length}
                </span>
              </button>

              <div className="my-1 mx-3 h-px bg-slate-100" />

              {/* 分类列表 */}
              {categories.map((c) => {
                const count = products.filter((p) => p.category_id === c.id).length
                const active = selectedCat === c.id
                return (
                  <div key={c.id} className="group relative">
                    <button
                      onClick={() => setSelectedCat(c.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition ${
                        active
                          ? 'bg-emerald-50 text-emerald-700 font-medium border-l-2 border-emerald-500'
                          : 'text-slate-600 hover:bg-slate-50 border-l-2 border-transparent'
                      }`}
                    >
                      {c.icon ? (
                        <i className={`${c.icon} w-4 text-center ${active ? 'text-emerald-500' : 'text-slate-400'}`} />
                      ) : (
                        <i className="fa-solid fa-tag w-4 text-center text-slate-400" />
                      )}
                      <span className="flex-1 text-left truncate">{c.name}</span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded tabular-nums ${
                        active ? 'bg-white text-emerald-600 border border-emerald-200' : 'text-slate-400 bg-slate-50'
                      }`}>
                        {count}
                      </span>
                    </button>
                    {/* 悬浮时显示删除按钮 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteCategory(c.id) }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 hover:bg-rose-100 text-rose-400 hover:text-rose-600 w-6 h-6 rounded-md flex items-center justify-center transition"
                      title="删除分类"
                    >
                      <i className="fa-solid fa-trash text-[11px]" />
                    </button>
                  </div>
                )
              })}

              {categories.length === 0 && (
                <div className="px-3 py-6 text-center text-[11px] text-slate-400">
                  <i className="fa-solid fa-tags block mb-1 text-slate-300 text-base" />
                  还没有分类，点右上角「新建」添加
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右侧：商品区 */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* 过滤 + 搜索 + 新建 */}
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex gap-1 bg-white rounded-lg p-1 border border-slate-200 shadow-sm">
              {(['all', 'active', 'inactive'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-sm rounded-md transition ${
                    filter === f ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {f === 'all' ? '全部' : f === 'active' ? '上架中' : '已下架'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索商品名/标签"
                  className="pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-emerald-400 focus:outline-none w-48"
                />
              </div>
              <button
                onClick={openCreate}
                className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-lg shadow-sm hover:shadow-md transition text-sm font-medium flex items-center gap-2"
              >
                <i className="fa-solid fa-plus" /> 新建商品
              </button>
            </div>
          </div>

          {/* 商品网格 */}
          {loading ? (
            <div className="bg-white rounded-xl p-12 text-center text-slate-400">
              <i className="fa-solid fa-spinner fa-spin text-2xl" />
            </div>
          ) : filtered.length === 0 ? (
            <Empty title="暂无商品" description={'点击右上角"新建商品"开始创建你的商城产品库'} />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {paged.map((p) => (
                  <ProductCard
                    key={p.id}
                    p={p}
                    onEdit={() => openEdit(p)}
                    onToggle={() => handleToggle(p)}
                    onDelete={() => handleDelete(p.id)}
                    onPreview={() => window.open(`${window.location.origin}/p/product?product_id=${p.id}&code=C1069`, '_blank', 'noopener,noreferrer')}
                  />
                ))}
              </div>

              {/* 分页控件 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-slate-400">
                    显示 {(safePage - 1) * PAGE_SIZE + 1} – {Math.min(safePage * PAGE_SIZE, filtered.length)}，
                    共 <span className="font-medium text-slate-600">{filtered.length}</span> 个商品
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={safePage <= 1}
                      className="px-2.5 py-1 text-xs rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      <i className="fa-solid fa-chevron-left" />
                    </button>
                    {pageItems.map((it, idx) =>
                      it === '...' ? (
                        <span key={`dot-${idx}`} className="px-2 text-xs text-slate-300 select-none">…</span>
                      ) : (
                        <button
                          key={it}
                          onClick={() => setPage(it)}
                          className={`min-w-[28px] px-2 py-1 text-xs rounded-md transition ${
                            it === safePage
                              ? 'bg-emerald-500 text-white shadow-sm'
                              : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {it}
                        </button>
                      )
                    )}
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage >= totalPages}
                      className="px-2.5 py-1 text-xs rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      <i className="fa-solid fa-chevron-right" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 商品编辑/新建 Modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title={editing ? `编辑商品 · ${editing.name}` : '新建商品'}
        maxWidth="max-w-2xl"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="商品名称" required className="col-span-2">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="如：有机高山板栗 500g"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-emerald-400 focus:outline-none"
            />
          </Field>
          <Field label="分类">
            <select
              value={form.category_id ?? ''}
              onChange={(e) =>
                setForm({ ...form, category_id: e.target.value ? Number(e.target.value) : null })
              }
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-emerald-400 focus:outline-none bg-white"
            >
              <option value="">未分类</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="SKU">
            <input
              value={form.sku ?? ''}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              placeholder="可选"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </Field>
          <Field label="价格 (元)" required>
            <input
              type="number"
              step="0.01"
              min={0}
              value={form.price || ''}
              onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </Field>
          <Field label="原价 (划线价)">
            <input
              type="number"
              step="0.01"
              min={0}
              value={form.original_price ?? ''}
              onChange={(e) =>
                setForm({ ...form, original_price: e.target.value ? Number(e.target.value) : null })
              }
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </Field>
          <Field label="库存">
            <input
              type="number"
              min={0}
              value={form.stock || ''}
              onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </Field>
          <Field label="标签">
            <input
              value={form.tag || ''}
              onChange={(e) => setForm({ ...form, tag: e.target.value })}
              placeholder="如：热卖/新品/限时"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </Field>
          <Field label="商品主图" className="col-span-2">
            <div className="flex gap-3 items-start">
              {/* 预览卡片 */}
              <div
                className={`relative w-28 h-28 rounded-lg border-2 border-dashed overflow-hidden shrink-0 flex items-center justify-center transition ${
                  uploading ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'
                }`}
              >
                {uploading ? (
                  <div className="text-center text-slate-400">
                    <i className="fa-solid fa-spinner fa-spin text-xl text-emerald-400" />
                    <div className="text-[11px] mt-1">上传中…</div>
                  </div>
                ) : form.image_url ? (
                  <>
                    <img
                      src={form.image_url}
                      alt="商品主图"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const el = e.target as HTMLImageElement
                        el.style.visibility = 'hidden'
                        el.parentElement!.classList.add('bg-slate-100')
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, image_url: '' })}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 hover:bg-black/70 text-white text-[10px] flex items-center justify-center"
                      title="移除图片"
                    >
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </>
                ) : (
                  <div className="text-center text-slate-300">
                    <i className="fa-solid fa-cloud-arrow-up text-2xl" />
                    <div className="text-[10px] mt-1">暂无图片</div>
                  </div>
                )}
              </div>

              {/* 上传操作 */}
              <div className="flex-1 space-y-2">
                <label
                  className={`inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer transition ${
                    uploading
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm'
                  }`}
                >
                  <i className="fa-solid fa-cloud-arrow-up" />
                  {uploading ? '上传中…' : form.image_url ? '重新上传' : '上传图片'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleUploadImage(f)
                      e.target.value = ''
                    }}
                  />
                </label>
                <div className="text-[11px] text-slate-400 leading-relaxed">
                  支持 JPG / PNG / WEBP / GIF / SVG，单张不超过 5MB。
                  <br />
                  或 <span className="text-emerald-600 cursor-pointer underline" onClick={() => {
                    const v = prompt('粘贴图片 URL（https:// 开头）：')
                    if (v && v.trim()) setForm({ ...form, image_url: v.trim() })
                  }}>粘贴外部 URL</span>
                </div>
                {form.image_url && (
                  <div className="text-[11px] text-slate-400 truncate max-w-full bg-slate-50 rounded px-2 py-1">
                    {form.image_url}
                  </div>
                )}
              </div>
            </div>
          </Field>
          <Field label="商品描述" className="col-span-2">
            <textarea
              value={form.description || ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              placeholder="商品卖点、规格、原产地等信息"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </Field>
          <Field label="状态" className="col-span-2">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={form.active === 1}
                  onChange={() => setForm({ ...form, active: 1 })}
                  className="text-emerald-500"
                />
                <span className="text-sm">立即上架</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={form.active === 0}
                  onChange={() => setForm({ ...form, active: 0 })}
                  className="text-emerald-500"
                />
                <span className="text-sm">先下架保存</span>
              </label>
            </div>
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => setShowCreate(false)}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm shadow-sm hover:bg-emerald-600"
          >
            {editing ? '保存修改' : '创建商品'}
          </button>
        </div>
      </Modal>

      {/* 新建分类 Modal */}
      <Modal
        open={showCatModal}
        onClose={() => setShowCatModal(false)}
        title="新建商品分类"
        maxWidth="max-w-sm"
      >
        <Field label="分类名称" required>
          <input
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            placeholder="如：休闲食品 / 茶叶"
            autoFocus
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-emerald-400 focus:outline-none"
          />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => setShowCatModal(false)}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm"
          >
            取消
          </button>
          <button
            onClick={handleCreateCategory}
            className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm shadow-sm hover:bg-emerald-600"
          >
            创建
          </button>
        </div>
      </Modal>
    </div>
  )
}

// === 组件 ===

interface ProductForm {
  name: string
  price: number
  original_price: number | null
  category_id: number | null
  stock: number
  description: string
  image_url: string
  images: string[]
  tag: string
  sku: string | null
  active: number
}

function Field({
  label,
  required,
  children,
  className = '',
}: {
  label: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-xs text-slate-500 mb-1">
        {label} {required && <span className="text-rose-400">*</span>}
      </label>
      {children}
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string
  value: number | string
  icon: string
  color: string
}) {
  const colors: Record<string, string> = {
    emerald: 'from-emerald-400 to-teal-500',
    sky: 'from-sky-400 to-blue-500',
    amber: 'from-amber-400 to-orange-500',
    rose: 'from-rose-400 to-pink-500',
  }
  return (
    <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colors[color]} flex items-center justify-center text-white shadow-sm`}
        >
          <i className={`fa-solid ${icon} text-sm`} />
        </div>
        <div>
          <div className="text-xs text-slate-400">{label}</div>
          <div className="text-lg font-bold text-slate-800">{value}</div>
        </div>
      </div>
    </div>
  )
}

function ProductCard({
  p,
  onEdit,
  onToggle,
  onDelete,
  onPreview,
}: {
  p: Product
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
  onPreview: () => void
}) {
  const out = p.stock === 0
  return (
    <div
      className={`bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition overflow-hidden ${
        p.active === 0 ? 'opacity-60' : ''
      }`}
    >
      <div className="relative aspect-square bg-gradient-to-br from-slate-100 to-slate-200 overflow-hidden">
        {p.image_url ? (
          <img
            src={p.image_url}
            alt={p.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.visibility = 'hidden'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl text-slate-300">
            <i className="fa-solid fa-image" />
          </div>
        )}
        {p.tag && (
          <span className="absolute top-2 left-2 px-2 py-0.5 bg-gradient-to-r from-rose-500 to-orange-500 text-white text-[10px] rounded-full shadow">
            {p.tag}
          </span>
        )}
        {out && (
          <span className="absolute top-2 right-2 px-2 py-0.5 bg-slate-700 text-white text-[10px] rounded-full">
            缺货
          </span>
        )}
        {p.active === 0 && (
          <div className="absolute inset-0 bg-slate-900/40 flex items-center justify-center">
            <span className="px-3 py-1 bg-white/90 text-slate-700 text-xs font-semibold rounded-full">已下架</span>
          </div>
        )}
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <div className="text-sm font-medium text-slate-800 line-clamp-2 leading-snug flex-1">
            {p.name}
          </div>
          {p.category_name && (
            <span className="text-[10px] text-slate-400 shrink-0 bg-slate-50 px-1.5 py-0.5 rounded">
              {p.category_name}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-base font-bold text-rose-500">{fmtPrice(p.price)}</span>
          {p.original_price != null && p.original_price > p.price && (
            <span className="text-[10px] text-slate-300 line-through">{fmtPrice(p.original_price)}</span>
          )}
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>库存 {p.stock}</span>
          <span>销量 {p.sold}</span>
        </div>
        <div className="flex gap-1.5 pt-1">
          <button
            onClick={onPreview}
            title="H5 预览"
            className="px-2 py-1.5 text-xs rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-sky-500 transition"
          >
            <i className="fa-solid fa-eye" />
          </button>
          <button
            onClick={onEdit}
            className="flex-1 py-1.5 text-xs rounded-md border border-slate-200 hover:bg-slate-50 transition"
          >
            编辑
          </button>
          <button
            onClick={onToggle}
            className={`flex-1 py-1.5 text-xs rounded-md transition ${
              p.active === 1
                ? 'border border-amber-200 text-amber-600 hover:bg-amber-50'
                : 'border border-emerald-200 text-emerald-600 hover:bg-emerald-50'
            }`}
          >
            {p.active === 1 ? '下架' : '上架'}
          </button>
          <button
            onClick={onDelete}
            className="flex-1 py-1.5 text-xs rounded-md border border-rose-200 text-rose-500 hover:bg-rose-50 transition"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  )
}
