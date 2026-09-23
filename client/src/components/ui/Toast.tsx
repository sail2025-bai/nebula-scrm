import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type ToastType = 'success' | 'warning' | 'info'

interface ToastState {
  message: string
  type: ToastType
  visible: boolean
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

const ICONS: Record<ToastType, string> = {
  success: 'fa-solid fa-circle-check text-emerald-400',
  warning: 'fa-solid fa-triangle-exclamation text-amber-400',
  info: 'fa-solid fa-circle-info text-blue-400'
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>({ message: '', type: 'success', visible: false })

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    setToast({ message, type, visible: true })
    window.setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }))
    }, 2600)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        className={`fixed bottom-5 right-5 z-[100] transform transition-all duration-300 pointer-events-none flex items-center gap-2.5 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-xl text-xs font-medium ${
          toast.visible ? 'translate-y-0 opacity-100' : 'translate-y-20 opacity-0'
        }`}
      >
        <i className={ICONS[toast.type]} />
        <span>{toast.message}</span>
      </div>
    </ToastContext.Provider>
  )
}
