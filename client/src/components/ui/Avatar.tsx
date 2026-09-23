import { avatarChar, avatarGradient } from '../../utils'

interface AvatarProps {
  name: string
  url?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZES = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-12 h-12 text-lg'
}

export default function Avatar({ name, url, size = 'sm', className = '' }: AvatarProps) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className={`${SIZES[size]} rounded-full object-cover border border-slate-200 ${className}`}
      />
    )
  }
  return (
    <div
      className={`${SIZES[size]} rounded-full bg-gradient-to-tr ${avatarGradient(
        name
      )} text-white font-bold flex items-center justify-center shrink-0 select-none ${className}`}
    >
      {avatarChar(name)}
    </div>
  )
}
