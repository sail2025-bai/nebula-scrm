export function formatMoney(value: number): string {
  return `￥${value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`
}

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  const diff = Date.now() - date.getTime()
  if (Number.isNaN(diff)) return iso
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 60) return `${days}天前`
  return date.toLocaleDateString('zh-CN')
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) return iso
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min}`
}

export function daysSince(iso: string): number {
  const date = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) return 0
  return Math.floor((Date.now() - date.getTime()) / 86400000)
}

const AVATAR_COLORS = [
  'from-emerald-500 to-teal-400',
  'from-blue-500 to-indigo-400',
  'from-purple-500 to-fuchsia-400',
  'from-amber-500 to-orange-400',
  'from-rose-500 to-pink-400',
  'from-cyan-500 to-sky-400'
]

export function avatarGradient(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export function avatarChar(name: string): string {
  return name ? name.charAt(0) : '?'
}

export function healthColor(health: string): string {
  if (health.includes('高危') || health.includes('预警')) return 'text-rose-600'
  if (health.includes('钻石') || health.includes('极度')) return 'text-emerald-600'
  if (health.includes('良好') || health.includes('活跃')) return 'text-emerald-600'
  if (health.includes('平稳')) return 'text-blue-600'
  return 'text-slate-600'
}

export function groupHealthColor(score: number): { text: string; label: string } {
  if (score >= 90) return { text: 'text-emerald-600', label: '极度活跃' }
  if (score >= 75) return { text: 'text-teal-600', label: '良好' }
  if (score >= 60) return { text: 'text-amber-600', label: '一般' }
  return { text: 'text-rose-600', label: '需干预' }
}
