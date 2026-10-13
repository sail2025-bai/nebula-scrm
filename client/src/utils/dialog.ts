import type { DialogAPI } from '../components/ui/DialogProvider'

// 全局对话框 API —— 由 DialogProvider 在挂载时注入
// 所有 window.confirm/prompt/alert 被替换为 Promise 版本
let _api: DialogAPI | null = null

export function setDialogAPI(api: DialogAPI) {
  _api = api
  // 同步覆盖浏览器原生 API（sandboxed iframe 中原生会抛 prompt() is not supported）
  const win = window as unknown as {
    confirm: (m: string) => Promise<boolean>
    prompt: (m: string, d?: string) => Promise<string | null>
    alert: (m: string) => Promise<void>
  }
  win.confirm = (m: string) => api.confirm(m)
  win.prompt = (m: string, d?: string) => api.prompt(m, d)
  win.alert = (m: string) => api.alert(m)
  ;(win as unknown as { __dialog: DialogAPI }).__dialog = api
}

export function dialog(): DialogAPI {
  if (!_api) throw new Error('DialogProvider not mounted')
  return _api
}
