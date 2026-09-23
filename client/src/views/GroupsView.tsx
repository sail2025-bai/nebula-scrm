import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { BizMode, Staff, WechatGroup, WecomEvent } from '../types'
import { useToast } from '../components/ui/Toast'
import Empty from '../components/ui/Empty'
import Modal from '../components/ui/Modal'
import { groupHealthColor } from '../utils'

interface GroupsViewProps {
  mode: BizMode
  dataVersion: number
}

const inputCls =
  'w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none'

function groupIcon(score: number): { icon: string; cls: string } {
  if (score >= 90) return { icon: 'fa-solid fa-users', cls: 'bg-emerald-100 text-emerald-700' }
  if (score < 60) return { icon: 'fa-solid fa-triangle-exclamation', cls: 'bg-amber-100 text-amber-700' }
  return { icon: 'fa-solid fa-users', cls: 'bg-teal-100 text-teal-700' }
}

function messageStyle(count: number): { cls: string; suffix: string } {
  if (count >= 200) return { cls: 'text-emerald-600', suffix: '' }
  if (count >= 50) return { cls: 'text-slate-700', suffix: '' }
  return { cls: 'text-amber-600', suffix: ' (较冷清)' }
}

const EVENT_META: Record<string, { icon: string; color: string; label: string }> = {
  create_chat: { icon: 'fa-solid fa-comments', color: 'text-emerald-600 bg-emerald-50', label: '创建客户群' },
  chat_member_add: { icon: 'fa-solid fa-user-plus', color: 'text-blue-600 bg-blue-50', label: '成员入群' },
  chat_member_del: { icon: 'fa-solid fa-user-minus', color: 'text-amber-600 bg-amber-50', label: '成员退群' },
  dismiss_chat: { icon: 'fa-solid fa-flag', color: 'text-rose-600 bg-rose-50', label: '群解散' },
  add_external_contact: { icon: 'fa-solid fa-user-plus', color: 'text-emerald-600 bg-emerald-50', label: '加好友' },
  del_follow_user: { icon: 'fa-solid fa-user-slash', color: 'text-amber-600 bg-amber-50', label: '删除跟进人' },
  del_external_contact: { icon: 'fa-solid fa-user-xmark', color: 'text-rose-600 bg-rose-50', label: '删除联系人' }
}

interface GroupMember {
  id: number
  group_id: number
  external_userid: string
  name: string | null
}

export default function GroupsView({ mode, dataVersion }: GroupsViewProps) {
  const { showToast } = useToast()
  const [groups, setGroups] = useState<WechatGroup[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: '', ownerId: '' })
  const [saving, setSaving] = useState(false)

  // 群事件 & 详情抽屉
  const [events, setEvents] = useState<WecomEvent[]>([])
  const [detailGroup, setDetailGroup] = useState<WechatGroup | null>(null)
  const [detailMembers, setDetailMembers] = useState<GroupMember[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  // 模拟群事件弹窗
  const [simOpen, setSimOpen] = useState(false)
  const [simEvent, setSimEvent] = useState('create_chat')
  const [simChatId, setSimChatId] = useState('')
  const [simChatName, setSimChatName] = useState('模拟企微群')
  const [simExternalUid, setSimExternalUid] = useState('')
  const [simMemberName, setSimMemberName] = useState('')
  const [simBusy, setSimBusy] = useState(false)

  const loadGroups = useCallback(() => {
    api.getGroups(mode).then(setGroups).catch(() => {})
  }, [mode])

  const loadEvents = useCallback(() => {
    api.getGroupEvents(30, false).then(setEvents).catch(() => {})
  }, [])

  useEffect(() => {
    loadGroups()
  }, [loadGroups, dataVersion])

  useEffect(() => {
    loadEvents()
  }, [dataVersion, simOpen])

  useEffect(() => {
    api.getStaff().then(setStaff).catch(() => {})
  }, [])

  const openDetail = async (g: WechatGroup) => {
    setDetailGroup(g)
    setDetailLoading(true)
    try {
      if (g.wecomChatId) {
        // 有企微 chat_id 的群，加载成员
        const members = await api.getGroupMembers(g.id)
        setDetailMembers(members as unknown as GroupMember[])
      } else {
        setDetailMembers([])
      }
    } catch {
      setDetailMembers([])
    } finally {
      setDetailLoading(false)
    }
  }

  const totalMembers = groups.reduce((sum, g) => sum + g.member_count, 0)
  const totalMessages = groups.reduce((sum, g) => sum + g.today_messages, 0)
  const hotGroups = groups.filter(g => g.today_messages >= 100).length
  const avgMembers = groups.length ? Math.round(totalMembers / groups.length) : 0
  const wecomSynced = groups.filter(g => g.wecomChatId && !g.dismissed).length
  const dismissed = groups.filter(g => g.dismissed).length

  const handleCreate = () => {
    if (!form.name.trim() || !form.ownerId) {
      showToast('请填写群名称并选择群主', 'warning')
      return
    }
    setSaving(true)
    api
      .createGroup(form.name.trim(), Number(form.ownerId), mode)
      .then(() => {
        setCreateOpen(false)
        showToast('社群创建成功，新群 SOP 已自动挂载', 'success')
        loadGroups()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '创建失败', 'warning'))
      .finally(() => setSaving(false))
  }

  const handleDelete = (group: WechatGroup) => {
    if (!window.confirm(`确定删除社群「${group.name}」？删除后不可恢复`)) return
    api
      .deleteGroup(group.id)
      .then(() => {
        showToast('社群已删除', 'success')
        loadGroups()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '删除失败', 'warning'))
  }

  const handleSimulateGroupEvent = async () => {
    setSimBusy(true)
    try {
      const res = await api.simulateGroupEvent({
        event: simEvent,
        chatId: simChatId || undefined,
        chatName: simChatName || undefined,
        externalUserid: simExternalUid || undefined,
        memberName: simMemberName || undefined
      })
      showToast(res.message || '模拟成功', 'success')
      setSimOpen(false)
      loadGroups()
      loadEvents()
    } catch (e) {
      showToast(e instanceof Error ? e.message : '模拟失败', 'warning')
    } finally {
      setSimBusy(false)
    }
  }

  const latestGroupEvents = events.filter(e => e.event_type === 'group_event').slice(0, 10)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80">
          <div className="text-xs text-slate-400">企微群总数</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {groups.length}
            <span className="text-xs font-normal text-emerald-600 ml-1">+{hotGroups} 今日消息破百</span>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200/80">
          <div className="text-xs text-slate-400">企微同步中</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {wecomSynced} <span className="text-xs font-normal text-slate-500">个群已连企微</span>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200/80">
          <div className="text-xs text-slate-400">成员总数 / 均值</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {totalMembers.toLocaleString()} <span className="text-xs font-normal text-slate-500">/{avgMembers}人</span>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200/80">
          <div className="text-xs text-slate-400">群事件 / 今日</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {events.filter(e => {
              const t = e.created_at
              if (!t) return false
              const d = new Date(t).toDateString()
              return d === new Date().toDateString() && e.event_type === 'group_event'
            }).length}
            {dismissed > 0 && <span className="text-xs font-normal text-rose-500 ml-2">{dismissed} 已解散</span>}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-bold text-sm text-slate-900">活跃社群矩阵看板</h4>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setSimChatId('')
                setSimChatName('模拟企微群')
                setSimExternalUid('')
                setSimMemberName('')
                setSimOpen(true)
              }}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-sm transition"
            >
              <i className="fa-solid fa-plug text-xs" />
              <span>模拟群事件</span>
            </button>
            <button
              onClick={() => {
                setForm({ name: '', ownerId: '' })
                setCreateOpen(true)
              }}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-sm transition"
            >
              <i className="fa-solid fa-plus text-xs" />
              <span>新建社群</span>
            </button>
          </div>
        </div>
        {groups.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                  <th className="p-3.5 pl-4">企微社群名称</th>
                  <th className="p-3.5">企微 ChatID</th>
                  <th className="p-3.5">群主 / 管理员</th>
                  <th className="p-3.5">群成员人数</th>
                  <th className="p-3.5">今日消息数</th>
                  <th className="p-3.5">自动SOP状态</th>
                  <th className="p-3.5">健康指数</th>
                  <th className="p-3.5 pr-4 text-center">快捷操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {groups.map(g => {
                  const icon = groupIcon(g.health_score)
                  const ratio = g.capacity > 0 ? g.member_count / g.capacity : 0
                  const health = groupHealthColor(g.health_score)
                  const msg = messageStyle(g.today_messages)
                  return (
                    <tr key={g.id} className={`hover:bg-slate-50/80 transition ${g.dismissed ? 'opacity-60' : ''}`}>
                      <td className="p-3.5 pl-4 font-semibold text-slate-800">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-6 h-6 rounded-md flex items-center justify-center text-xs shrink-0 ${icon.cls}`}
                          >
                            <i className={icon.icon} />
                          </span>
                          <span className="truncate max-w-[200px]">{g.name}</span>
                          {g.wecomChatId && (
                            <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium shrink-0">企微</span>
                          )}
                          {g.dismissed && (
                            <span className="text-[9px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-medium shrink-0">已解散</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3.5">
                        {g.wecomChatId ? (
                          <code className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono max-w-[140px] truncate inline-block">
                            {g.wecomChatId}
                          </code>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="p-3.5">
                        <div className="text-slate-700">{g.ownerName}</div>
                        <div className="text-[10px] text-slate-400">{g.owner_role}</div>
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-2">
                          <span className="whitespace-nowrap">
                            {g.member_count}/{g.capacity}
                          </span>
                          <span className="w-12 bg-slate-200 h-1.5 rounded-full overflow-hidden inline-block">
                            <span
                              className={`${ratio >= 0.95 ? 'bg-amber-500' : 'bg-emerald-500'} h-full block`}
                              style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                            />
                          </span>
                        </div>
                      </td>
                      <td className={`p-3.5 font-medium whitespace-nowrap ${msg.cls}`}>
                        {g.today_messages} 条{msg.suffix}
                      </td>
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700 font-medium whitespace-nowrap">
                          {g.sop_status}
                        </span>
                      </td>
                      <td className="p-3.5">
                        <span className={`text-xs font-bold whitespace-nowrap ${health.text}`}>
                          {g.health_score} 分 ({health.label})
                        </span>
                      </td>
                      <td className="p-3.5 pr-4 text-center">
                        <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                          <button
                            onClick={() => openDetail(g)}
                            className="text-emerald-600 hover:underline"
                          >
                            群详情
                          </button>
                          {g.health_score < 60 && (
                            <button
                              onClick={() => showToast(`已向「${g.name}」派发互动红包唤醒任务`, 'success')}
                              className="text-amber-600 hover:underline"
                            >
                              红包唤醒
                            </button>
                          )}
                          <button onClick={() => handleDelete(g)} className="text-slate-400 hover:text-rose-600 hover:underline">
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon="fa-solid fa-comments"
            title="暂无企微社群"
            description="点击右上角「新建社群」或「模拟群事件」创建第一个社群"
          />
        )}
      </div>

      {/* 群事件时间线 */}
      <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h4 className="font-bold text-sm text-slate-900">客户群事件实时时间线</h4>
          <button
            onClick={() => loadEvents()}
            className="text-xs text-slate-500 hover:text-emerald-600 transition flex items-center gap-1"
          >
            <i className="fa-solid fa-rotate text-[10px]" /> 刷新
          </button>
        </div>
        <div className="p-4 max-h-[360px] overflow-y-auto">
          {latestGroupEvents.length > 0 ? (
            <div className="relative">
              <div className="absolute left-[15px] top-1 bottom-1 w-px bg-slate-200" />
              {latestGroupEvents.map((ev) => {
                const meta = EVENT_META[ev.change_type || 'unknown'] || { icon: 'fa-solid fa-circle-info', color: 'text-slate-500 bg-slate-50', label: ev.change_type || ev.event_type }
                let detailText = ''
                try {
                  const p = JSON.parse(ev.payload || '{}')
                  detailText = (p.chatName || p.name || p.member?.name || ev.external_userid || ev.change_type) + (p.member?.userid ? ` (${p.member.userid})` : '')
                } catch {}
                return (
                  <div key={ev.id} className="relative pl-10 pb-4 last:pb-0">
                    <div className={`absolute left-0 top-0 w-8 h-8 rounded-full ${meta.color.split(' ')[1]} flex items-center justify-center`}>
                      <i className={`${meta.icon} text-xs ${meta.color.split(' ')[0]}`} />
                    </div>
                    <div className="text-xs font-semibold text-slate-800">
                      {meta.label}
                      <span className="text-[10px] text-slate-400 font-normal ml-2">{ev.created_at}</span>
                    </div>
                    {detailText && <div className="text-[11px] text-slate-500 mt-0.5">{detailText}</div>}
                  </div>
                )
              })}
            </div>
          ) : (
            <Empty
              icon="fa-solid fa-timeline"
              title="暂无群事件"
              description="点击上方「模拟群事件」按钮触发企微客户群事件，即可在此时间线实时展示"
            />
          )}
        </div>
      </div>

      {/* 新建社群 Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建企微社群"
        subtitle="创建后将自动挂载新群 7 日 SOP 并开启健康度巡检"
        maxWidth="max-w-md"
        footer={
          <>
            <button
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-white transition"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
            >
              {saving ? '创建中...' : '确认创建'}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            群名称 <span className="text-rose-500">*</span>
          </label>
          <input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="例如：【美诺美妆】VIP护肤打卡交流群"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            群主（企微员工）<span className="text-rose-500">*</span>
          </label>
          <select
            value={form.ownerId}
            onChange={e => setForm(f => ({ ...f, ownerId: e.target.value }))}
            className={inputCls}
          >
            <option value="">请选择群主</option>
            {staff.map(s => (
              <option key={s.id} value={String(s.id)}>
                {s.name} ({s.role})
              </option>
            ))}
          </select>
        </div>
      </Modal>

      {/* 模拟群事件 Modal */}
      <Modal
        open={simOpen}
        onClose={() => setSimOpen(false)}
        title="模拟企微客户群事件"
        subtitle="模拟企微回调推送，用于联调客户群事件闭环"
        maxWidth="max-w-md"
        footer={
          <>
            <button
              onClick={() => setSimOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-white transition"
            >
              取消
            </button>
            <button
              onClick={handleSimulateGroupEvent}
              disabled={simBusy}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
            >
              {simBusy ? '发送中...' : '触发事件'}
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">事件类型</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: 'create_chat', label: '创建客户群', icon: 'fa-solid fa-comments' },
              { v: 'chat_member_add', label: '成员入群', icon: 'fa-solid fa-user-plus' },
              { v: 'chat_member_del', label: '成员退群', icon: 'fa-solid fa-user-minus' },
              { v: 'dismiss_chat', label: '群解散', icon: 'fa-solid fa-flag' }
            ].map(opt => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setSimEvent(opt.v)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition ${
                  simEvent === opt.v
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                    : 'border-slate-200 text-slate-600 hover:border-blue-300'
                }`}
              >
                <i className={`${opt.icon} text-xs`} />
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {(simEvent === 'create_chat' || simEvent === 'chat_member_add') && (
          <div className="mt-3">
            <label className="block text-xs font-semibold text-slate-700 mb-1">群名称</label>
            <input
              value={simChatName}
              onChange={e => setSimChatName(e.target.value)}
              placeholder="模拟企微群"
              className={inputCls}
            />
          </div>
        )}

        {(simEvent === 'chat_member_add' || simEvent === 'chat_member_del' || simEvent === 'dismiss_chat') && (
          <div className="mt-3">
            <label className="block text-xs font-semibold text-slate-700 mb-1">企微 ChatID（留空自动生成/匹配）</label>
            <input
              value={simChatId}
              onChange={e => setSimChatId(e.target.value)}
              placeholder="wrSIM123456 或留空"
              className={inputCls}
            />
          </div>
        )}

        {(simEvent === 'chat_member_add' || simEvent === 'chat_member_del') && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">成员外部ID</label>
              <input
                value={simExternalUid}
                onChange={e => setSimExternalUid(e.target.value)}
                placeholder="wmSIM123456"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">成员昵称</label>
              <input
                value={simMemberName}
                onChange={e => setSimMemberName(e.target.value)}
                placeholder="张三"
                className={inputCls}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* 群详情 Modal */}
      <Modal
        open={!!detailGroup}
        onClose={() => setDetailGroup(null)}
        title={`社群详情：${detailGroup?.name || ''}`}
        subtitle={detailGroup?.wecomChatId ? `企微 ChatID：${detailGroup.wecomChatId}` : '手动创建的社群'}
        maxWidth="max-w-xl"
        footer={
          <button
            onClick={() => setDetailGroup(null)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-medium transition"
          >
            关闭
          </button>
        }
      >
        {detailGroup && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <div className="text-lg font-bold text-slate-900">{detailGroup.member_count}</div>
                <div className="text-[10px] text-slate-500">成员数</div>
              </div>
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <div className="text-lg font-bold text-slate-900">{detailGroup.today_messages}</div>
                <div className="text-[10px] text-slate-500">今日消息</div>
              </div>
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <div className="text-lg font-bold text-slate-900">{detailGroup.health_score}</div>
                <div className="text-[10px] text-slate-500">健康度</div>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center justify-between">
                <span>企微群成员（{detailMembers.length}）</span>
                {detailGroup.wecomChatId && (
                  <span className="text-[10px] text-slate-400">由企微群事件实时同步</span>
                )}
              </div>
              {detailLoading ? (
                <div className="text-xs text-slate-400 text-center py-4">加载中...</div>
              ) : detailMembers.length > 0 ? (
                <div className="max-h-[240px] overflow-y-auto border border-slate-100 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left p-2 pl-3">成员昵称</th>
                        <th className="text-left p-2 pr-3">企微 ExternalUserID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detailMembers.map(m => (
                        <tr key={m.id} className="hover:bg-slate-50">
                          <td className="p-2 pl-3 font-medium text-slate-800">{m.name || '未命名成员'}</td>
                          <td className="p-2 pr-3 font-mono text-[10px] text-slate-500">{m.external_userid}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-xs text-slate-400 text-center py-4 border border-dashed border-slate-200 rounded-lg">
                  {detailGroup.wecomChatId ? '暂无企微同步成员' : '非企微同步群，暂无成员数据'}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
