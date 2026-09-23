interface EmptyProps {
  icon?: string
  title: string
  description?: string
}

export default function Empty({ icon = 'fa-regular fa-folder-open', title, description }: EmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-300 text-xl mb-3">
        <i className={icon} />
      </div>
      <div className="text-sm font-semibold text-slate-600">{title}</div>
      {description && <div className="text-xs text-slate-400 mt-1">{description}</div>}
    </div>
  )
}
