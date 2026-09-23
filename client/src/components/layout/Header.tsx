import { useState } from 'react'

interface HeaderProps {
  title: string
  searchValue: string
  onSearch: (value: string) => void
  onNewBroadcast: () => void
  onMenuClick: () => void
  userName?: string
  onLogout?: () => void
}

export default function Header({
  title,
  searchValue,
  onSearch,
  onNewBroadcast,
  onMenuClick,
  userName,
  onLogout
}: HeaderProps) {
  const [value, setValue] = useState(searchValue)

  const handleInput = (v: string) => {
    setValue(v)
    onSearch(v)
  }

  return (
    <header className="h-14 md:h-16 bg-white border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between shrink-0 z-10 gap-2">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          className="md:hidden w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition shrink-0"
        >
          <i className="fa-solid fa-bars text-sm" />
        </button>
        <span className="font-bold text-base md:text-lg text-slate-800 truncate">{title}</span>
        <span className="hidden lg:inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
          企微Webhook就绪
        </span>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <div className="relative hidden sm:block w-44 lg:w-64">
          <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
          <input
            type="text"
            value={value}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="输入客户名、手机号、群聊..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-100 border border-transparent rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none transition"
          />
        </div>

        <button
          onClick={onNewBroadcast}
          className="px-2.5 sm:px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center gap-2 shadow-sm transition active:scale-95"
        >
          <i className="fa-solid fa-paper-plane text-xs" />
          <span className="hidden sm:inline">新建群发任务</span>
        </button>

        <button className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100 relative transition">
          <i className="fa-regular fa-bell text-sm" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full" />
        </button>

        {userName && (
          <div className="hidden sm:flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <i className="fa-solid fa-user text-xs" />
            </div>
            <span className="text-xs text-slate-600 truncate max-w-[90px]">{userName}</span>
          </div>
        )}

        <button
          title="退出登录"
          onClick={onLogout}
          className="w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-rose-600 flex items-center justify-center transition"
        >
          <i className="fa-solid fa-right-from-bracket text-sm" />
        </button>
      </div>
    </header>
  )
}
