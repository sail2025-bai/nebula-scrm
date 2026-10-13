// 头像解析：真实 URL → UI Avatars（用名字生成彩色头像）→ 空字符串让调用方 fallback 首字母
// UI Avatars CDN 可达（https://ui-avatars.com），gravatar 在国内不可用

function encodeName(name: string): string {
  return encodeURIComponent(name.trim() || 'U')
}

export function resolveAvatar(emailOrUrl: string | null | undefined, size = 120): string {
  if (!emailOrUrl) return ''
  // 已经是完整 URL → 直接用
  if (/^https?:\/\//.test(emailOrUrl)) return emailOrUrl
  return ''
}

// 生成 UI Avatars（根据名字自动生成彩色字母头像，国内可达）
export function uiAvatar(name: string | null | undefined, size = 128, bg?: string): string {
  if (!name) return ''
  const bgColor = bg || 'f59e0b'
  const fg = 'ffffff'
  return `https://ui-avatars.com/api/?name=${encodeName(name)}&background=${bgColor}&color=${fg}&size=${size}&bold=true&rounded=true&format=svg`
}

// 从 Staff 拿到最佳头像
export function staffAvatar(
  staff: { avatar_url?: string | null; wecom_userid?: string | null; name?: string } | null,
  size = 128,
  bgColor?: string
): string {
  if (!staff) return ''
  // 1. 真实 URL（运营上传的头像）
  if (staff.avatar_url) {
    const a = resolveAvatar(staff.avatar_url, size)
    if (a) return a
  }
  // 2. 用 name 生成 UI Avatars
  if (staff.name) return uiAvatar(staff.name, size, bgColor)
  return ''
}
