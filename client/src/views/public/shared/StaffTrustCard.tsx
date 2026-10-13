import { useState, useEffect } from 'react'
import { staffAvatar } from '../../../utils/avatar'

interface StaffInfo { id: number; name: string; role: string; wecom_userid: string | null; avatar_url?: string | null }

export default function StaffTrustCard({ qrCodeId }: { qrCodeId: number }) {
  const [staff, setStaff] = useState<StaffInfo | null>(null)
  const [cta, setCta] = useState<string>('hybrid')
  const [avatarOk, setAvatarOk] = useState(true)

  useEffect(() => {
    fetch(`/api/public/qrcodes/${qrCodeId}/staff`)
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.staff) setStaff(d.staff)
        if (d.cta_type) setCta(d.cta_type)
      })
      .catch(() => {})
  }, [qrCodeId])

  // hybrid 模式才显示；add_staff 扫码直接加，target_page 纯落地页都不需要
  if (!staff || cta !== 'hybrid') return null

  const imgSrc = staffAvatar(staff, 160)
  const initial = staff.name.charAt(0)
  const badgeNo = `S${String(staff.id).padStart(4, '0')}`

  return (
    <div className="animate-fade-rise card-gold rounded-2xl p-3 sm:p-4 mt-4" style={{ animationDelay: '0.4s' }}>
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          {imgSrc && avatarOk ? (
            <img src={imgSrc} alt={staff.name}
              onError={() => setAvatarOk(false)}
              className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover border-2 border-white shadow-md animate-float" />
          ) : (
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-amber-400 via-rose-400 to-pink-400 text-white flex items-center justify-center text-xl sm:text-2xl font-bold font-display shadow-md animate-float">
              {initial}
            </div>
          )}
          <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 border-2 border-white flex items-center justify-center text-[8px] sm:text-[9px] text-white font-bold">✓</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800 text-sm sm:text-base">{staff.name}</span>
            <span className="text-[10px] sm:text-[11px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium border border-amber-200/70">专属顾问</span>
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
            <span className="text-amber-600">◆ {staff.role || '专属顾问'}</span>
            <span className="text-slate-300">|</span>
            <span>编号 {badgeNo}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] sm:text-xs text-emerald-600 font-semibold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            在线服务中
          </div>
          <div className="text-[9px] sm:text-[10px] text-slate-400 mt-0.5">9:00 – 22:00</div>
        </div>
      </div>
      <div className="mt-2 pt-2 sm:mt-3 sm:pt-3 border-t border-amber-100/70 text-[10px] sm:text-[11px] text-slate-500 leading-relaxed">
        已为您分配 <span className="text-amber-700 font-semibold">{staff.name}</span>。领券后顾问会第一时间为您送上
        <span className="text-rose-500 font-medium"> 专属福利提醒 </span>与
        <span className="text-rose-500 font-medium"> 一对一服务建议</span>。
      </div>
    </div>
  )
}
