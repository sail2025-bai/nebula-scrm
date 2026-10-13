import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { setDialogAPI } from '../../utils/dialog'

export interface DialogAPI {
  confirm: (message: string, title?: string) => Promise<boolean>
  prompt: (message: string, defaultValue?: string, title?: string) => Promise<string | null>
  alert: (message: string, title?: string) => Promise<void>
}

interface ConfirmState {
  kind: 'confirm'
  id: number
  message: string
  title: string
  resolve: (v: boolean) => void
}

interface PromptState {
  kind: 'prompt'
  id: number
  message: string
  title: string
  defaultValue: string
  resolve: (v: string | null) => void
}

interface AlertState {
  kind: 'alert'
  id: number
  message: string
  title: string
  resolve: () => void
}

type DialogState = ConfirmState | PromptState | AlertState | null

const DialogContext = createContext<DialogAPI | null>(null)

let nextId = 1

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const confirm = useCallback((message: string, title = '确认操作') => {
    return new Promise<boolean>(resolve => {
      const id = nextId++
      setState({ kind: 'confirm', id, message, title, resolve })
    })
  }, [])

  const prompt = useCallback((message: string, defaultValue = '', title = '请输入') => {
    return new Promise<string | null>(resolve => {
      const id = nextId++
      setState({ kind: 'prompt', id, message, title, defaultValue, resolve })
    })
  }, [])

  const alert = useCallback((message: string, title = '提示') => {
    return new Promise<void>(resolve => {
      const id = nextId++
      setState({ kind: 'alert', id, message, title, resolve })
    })
  }, [])

  // 挂载时把 API 注入全局（覆盖 window.confirm/prompt/alert）
  useEffect(() => {
    setDialogAPI({ confirm, prompt, alert })
  }, [confirm, prompt, alert])

  const close = () => setState(null)

  const handleConfirmYes = () => {
    if (state?.kind === 'confirm') state.resolve(true)
    close()
  }
  const handleConfirmNo = () => {
    if (state?.kind === 'confirm') state.resolve(false)
    close()
  }
  const handlePromptOk = () => {
    if (state?.kind === 'prompt') state.resolve(inputRef.current?.value ?? state.defaultValue)
    close()
  }
  const handlePromptCancel = () => {
    if (state?.kind === 'prompt') state.resolve(null)
    close()
  }
  const handleAlertOk = () => {
    if (state?.kind === 'alert') state.resolve()
    close()
  }

  return (
    <DialogContext.Provider value={{ confirm, prompt, alert }}>
      {children}
      {state && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div
            className="absolute inset-0"
            onClick={() => {
              if (state.kind === 'confirm') handleConfirmNo()
              else if (state.kind === 'prompt') handlePromptCancel()
              else handleAlertOk()
            }}
          />
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-100 overflow-hidden relative">
            <div className="p-5 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base">{state.title}</h3>
            </div>
            <div className="p-5">
              {state.kind === 'prompt' ? (
                <div className="space-y-3">
                  <p className="text-slate-600 text-sm whitespace-pre-wrap">{state.message}</p>
                  <input
                    ref={inputRef}
                    defaultValue={state.defaultValue}
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') handlePromptOk()
                      if (e.key === 'Escape') handlePromptCancel()
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              ) : (
                <p className="text-slate-600 text-sm whitespace-pre-wrap">{state.message}</p>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
              {state.kind === 'confirm' && (
                <>
                  <button
                    onClick={handleConfirmNo}
                    className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmYes}
                    className="px-4 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition font-medium"
                  >
                    确认
                  </button>
                </>
              )}
              {state.kind === 'prompt' && (
                <>
                  <button
                    onClick={handlePromptCancel}
                    className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition"
                  >
                    取消
                  </button>
                  <button
                    onClick={handlePromptOk}
                    className="px-4 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition font-medium"
                  >
                    确定
                  </button>
                </>
              )}
              {state.kind === 'alert' && (
                <button
                  onClick={handleAlertOk}
                  className="px-4 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition font-medium"
                >
                  好的
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  )
}

export function useDialog(): DialogAPI {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used inside DialogProvider')
  return ctx
}
