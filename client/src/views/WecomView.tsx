import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { MODE_META, type BizMode, type SimulateEventPayload, type Staff, type WecomConfig, type WecomEvent, type WecomStatus } from '../types'
import { useToast } from '../components/ui/Toast'
import Empty from '../components/ui/Empty'
import { formatDateTime } from '../utils'

const inputCls =
  'w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none'

const STATUS_META: Record<WecomStatus, { label: string; logo: string; badge: string; desc: string }> = {
  unset: {
    label: '未配置',
    logo: 'bg-slate-100 text-slate-500',
    badge: 'bg-slate-100 text-slate-600',
    desc: '尚未对接企业微信，请完成下方配置'
  },
  connected: {
    label: '已连接',
    logo: 'bg-emerald-100 text-emerald-600',
    badge: 'bg-emerald-100 text-emerald-700',
    desc: '企业微信对接正常，客户变更事件将自动同步'
  },
  simulated: {
    label: '模拟模式',
    logo: 'bg-amber-100 text-amber-600',
    badge: 'bg-amber-100 text-amber-700',
    desc: '模拟模式运行中 · 未配置真实凭据，可用模拟面板体验完整闭环'
  }
}

const EVENT_TYPE_META: Record<string, { label: string; badge: string }> = {
  change_external_contact: { label: '客户变更', badge: 'bg-emerald-100 text-emerald-800' },
  simulate_scan: { label: '模拟扫码', badge: 'bg-blue-100 text-blue-800' },
  seas_convert: { label: '公海转正', badge: 'bg-amber-100 text-amber-800' }
}

function eventMeta(type: string): { label: string; badge: string } {
  return EVENT_TYPE_META[type] ?? { label: type, badge: 'bg-slate-100 text-slate-600' }
}

function dateStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function downloadText(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

interface ConfigForm {
  corp_id: string
  corp_secret: string
  callback_token: string
  encoding_aes_key: string
}

const EMPTY_CONFIG: ConfigForm = { corp_id: '', corp_secret: '', callback_token: '', encoding_aes_key: '' }

interface SimForm {
  changeType: SimulateEventPayload['changeType']
  name: string
  mode: BizMode
  staffId: string
  channel: string
  tags: string
}

const EMPTY_SIM: SimForm = { changeType: 'add', name: '', mode: 'retail', staffId: '', channel: '', tags: '' }

export default function WecomView() {
  const { showToast } = useToast()
  const [config, setConfig] = useState<WecomConfig | null>(null)
  const [events, setEvents] = useState<WecomEvent[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [form, setForm] = useState<ConfigForm>(EMPTY_CONFIG)
  const [simForm, setSimForm] = useState<SimForm>(EMPTY_SIM)
  const [savingConfig, setSavingConfig] = useState(false)
  const [testing, setTesting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [injecting, setInjecting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const formInitedRef = useRef(false)

  const status: WecomStatus = config?.status ?? 'unset'
  const statusMeta = STATUS_META[status]
  const callbackUrl = `${window.location.origin}/api/wecom/callback`

  const loadConfig = useCallback(() => {
    api.getWecomConfig().then(setConfig).catch(() => {})
  }, [])

  const loadEvents = useCallback(() => {
    api.getWecomEvents(50).then(setEvents).catch(() => {})
  }, [])

  useEffect(() => {
    loadConfig()
    loadEvents()
  }, [loadConfig, loadEvents])

  useEffect(() => {
    api.getStaff().then(setStaff).catch(() => {})
  }, [])

  useEffect(() => {
    if (config && !formInitedRef.current) {
      formInitedRef.current = true
      setForm({
        corp_id: config.corp_id,
        corp_secret: config.corp_secret,
        callback_token: config.callback_token ?? '',
        encoding_aes_key: config.encoding_aes_key ?? ''
      })
    }
  }, [config])

  const handleSaveConfig = () => {
    if (!form.corp_id.trim() || !form.corp_secret.trim()) {
      showToast('请填写企业ID与应用Secret', 'warning')
      return
    }
    setSavingConfig(true)
    api
      .saveWecomConfig({
        corp_id: form.corp_id.trim(),
        corp_secret: form.corp_secret.trim(),
        callback_token: form.callback_token.trim() || null,
        encoding_aes_key: form.encoding_aes_key.trim() || null
      })
      .then(cfg => {
        setConfig(cfg)
        showToast('企微应用凭据已保存', 'success')
      })
      .catch(e => showToast(e instanceof Error ? e.message : '保存失败', 'warning'))
      .finally(() => setSavingConfig(false))
  }

  const handleTest = () => {
    setTesting(true)
    api
      .testWecomConnect()
      .then(res => {
        showToast(res.message, res.ok ? 'success' : 'warning')
        loadConfig()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '测试失败', 'warning'))
      .finally(() => setTesting(false))
  }

  const handleSync = () => {
    setSyncing(true)
    api
      .syncWecomStaff()
      .then(res => {
        showToast(`已同步 ${res.synced} 位员工`, 'success')
        loadConfig()
        api.getStaff().then(setStaff).catch(() => {})
      })
      .catch(e => showToast(e instanceof Error ? e.message : '同步失败', 'warning'))
      .finally(() => setSyncing(false))
  }

  const handleCopy = () => {
    navigator.clipboard
      .writeText(callbackUrl)
      .then(() => showToast('回调地址已复制', 'success'))
      .catch(() => showToast('复制失败，请手动选择复制', 'warning'))
  }

  const handleSimulate = () => {
    if (!simForm.name.trim()) {
      showToast('请填写客户姓名', 'warning')
      return
    }
    setInjecting(true)
    api
      .simulateWecomEvent({
        changeType: simForm.changeType,
        name: simForm.name.trim(),
        staffId: simForm.staffId ? Number(simForm.staffId) : null,
        channel: simForm.channel.trim() || undefined,
        tags: simForm.tags.trim()
          ? simForm.tags
              .split(/[,，]/)
              .map(t => t.trim())
              .filter(Boolean)
          : undefined,
        mode: simForm.mode
      })
      .then(res => {
        showToast(res.customerId ? `${res.message}，新客户已入库` : res.message, 'success')
        loadEvents()
      })
      .catch(e => showToast(e instanceof Error ? e.message : '注入失败', 'warning'))
      .finally(() => setInjecting(false))
  }

  const handleExportBackup = () => {
    setExporting(true)
    api
      .exportBackup()
      .then(data => {
        downloadText(JSON.stringify(data, null, 2), `scrm-backup-${dateStamp()}.json`, 'application/json')
        showToast('全量 JSON 备份已导出', 'success')
      })
      .catch(e => showToast(e instanceof Error ? e.message : '导出失败', 'warning'))
      .finally(() => setExporting(false))
  }

  const handleExportCsv = (m: BizMode) => {
    setExporting(true)
    api
      .exportCustomersCsv(m)
      .then(csv => {
        downloadText(
          csv,
          `customers-${m === 'retail' ? 'retail' : 'biz'}-${dateStamp()}.csv`,
          'text/csv;charset=utf-8'
        )
        showToast(`${m === 'retail' ? 'C端' : 'B端'}客户明细已导出`, 'success')
      })
      .catch(e => showToast(e instanceof Error ? e.message : '导出失败', 'warning'))
      .finally(() => setExporting(false))
  }

  const sortedEvents = [...events].sort((a, b) => b.created_at.localeCompare(a.created_at))

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <span
            className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0 ${statusMeta.logo}`}
          >
            <i className="fa-solid fa-plug" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-slate-900 text-sm">企业微信对接状态</h3>
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${statusMeta.badge}`}>
                {statusMeta.label}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">{statusMeta.desc}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-slate-400">上次通讯录同步</div>
          <div className="text-xs font-semibold text-slate-700 mt-0.5">
            {config?.last_sync_at ? formatDateTime(config.last_sync_at) : '尚未同步'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center text-sm shrink-0">
              <i className="fa-solid fa-key" />
            </span>
            <div>
              <h4 className="font-bold text-slate-900 text-sm">企微应用凭据配置</h4>
              <p className="text-[11px] text-slate-400 mt-0.5">填写自建应用凭证，用于通讯录拉取与回调验签</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                企业ID <span className="text-rose-500">*</span>
              </label>
              <input
                value={form.corp_id}
                onChange={e => setForm(f => ({ ...f, corp_id: e.target.value }))}
                placeholder="例如：ww8a2f6c3d5e7b9a"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                应用Secret <span className="text-rose-500">*</span>
              </label>
              <input
                value={form.corp_secret}
                onChange={e => setForm(f => ({ ...f, corp_secret: e.target.value }))}
                placeholder="自建应用的凭证密钥"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">回调Token</label>
              <input
                value={form.callback_token}
                onChange={e => setForm(f => ({ ...f, callback_token: e.target.value }))}
                placeholder="接收消息配置中的 Token"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">EncodingAESKey</label>
              <input
                value={form.encoding_aes_key}
                onChange={e => setForm(f => ({ ...f, encoding_aes_key: e.target.value }))}
                placeholder="43位消息加解密密钥"
                className={inputCls}
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={handleSaveConfig}
              disabled={savingConfig}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
            >
              {savingConfig ? '保存中...' : '保存配置'}
            </button>
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 rounded-lg text-xs font-medium transition"
            >
              {testing ? '测试中...' : '测试连接'}
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-sm shrink-0">
                  <i className="fa-solid fa-address-book" />
                </span>
                <div className="min-w-0">
                  <h4 className="font-bold text-slate-900 text-sm">企微通讯录同步</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5 max-w-md">
                    一键拉取企业微信通讯录中的员工，同步后可在分配线索、指定群主等场景选用
                  </p>
                </div>
              </div>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-sm transition shrink-0"
              >
                <i className="fa-solid fa-arrows-rotate text-xs" />
                <span>{syncing ? '同步中...' : '同步企微通讯录'}</span>
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-link" />
              </span>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">回调配置说明</h4>
                <p className="text-[11px] text-slate-400 mt-0.5">在企微管理后台按下述三步完成接收消息配置</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 bg-slate-50 rounded p-2 border border-slate-100">
              <code className="font-mono text-[11px] text-slate-600 truncate">{callbackUrl}</code>
              <button
                onClick={handleCopy}
                title="复制回调地址"
                className="text-slate-400 hover:text-emerald-600 transition shrink-0 px-1"
              >
                <i className="fa-regular fa-copy" />
              </button>
            </div>
            <ol className="mt-3 space-y-2">
              {[
                '登录企业微信管理后台，进入「应用管理 → 自建应用」',
                '在「接收消息」页配置上述回调 URL，Token 与 EncodingAESKey 与上方配置保持一致',
                '保存后回到本页点击测试连接，验证链路是否打通'
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                  <span className="w-4 h-4 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center text-sm shrink-0">
            <i className="fa-solid fa-flask" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-slate-900 text-sm">模拟事件注入（演示全链路）</h4>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">DEMO</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              注入一条企微客户变更事件，体验事件回调 → 客户入库 → 自动打标的完整闭环
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">事件类型</label>
            <select
              value={simForm.changeType}
              onChange={e => setSimForm(f => ({ ...f, changeType: e.target.value as SimForm['changeType'] }))}
              className={inputCls}
            >
              <option value="add">新客户扫码添加(加微)</option>
              <option value="del_follow">客户删除了员工(流失)</option>
              <option value="del">员工删除客户</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              客户姓名 <span className="text-rose-500">*</span>
            </label>
            <input
              value={simForm.name}
              onChange={e => setSimForm(f => ({ ...f, name: e.target.value }))}
              placeholder="例如：沈亦舟"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">业务模式</label>
            <select
              value={simForm.mode}
              onChange={e => setSimForm(f => ({ ...f, mode: e.target.value as BizMode }))}
              className={inputCls}
            >
              {(Object.keys(MODE_META) as BizMode[]).map(m => (
                <option key={m} value={m}>
                  {MODE_META[m].shortLabel}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">负责员工</label>
            <select
              value={simForm.staffId}
              onChange={e => setSimForm(f => ({ ...f, staffId: e.target.value }))}
              className={inputCls}
            >
              <option value="">不指定（进入公海）</option>
              {staff.map(s => (
                <option key={s.id} value={String(s.id)}>
                  {s.name} ({s.role})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">渠道</label>
            <input
              value={simForm.channel}
              onChange={e => setSimForm(f => ({ ...f, channel: e.target.value }))}
              placeholder="活码渠道，如：包裹卡活码"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">自动标签</label>
            <input
              value={simForm.tags}
              onChange={e => setSimForm(f => ({ ...f, tags: e.target.value }))}
              placeholder="新客,包裹卡引流"
              className={inputCls}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            onClick={handleSimulate}
            disabled={injecting || status === 'unset'}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-sm transition"
          >
            <i className="fa-solid fa-bolt text-xs" />
            <span>{injecting ? '注入中...' : '注入事件'}</span>
          </button>
          {status === 'unset' && (
            <span className="text-[11px] text-amber-600">保存任意凭据进入模拟模式后即可注入事件</span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center text-sm shrink-0">
              <i className="fa-solid fa-tower-broadcast" />
            </span>
            <div className="min-w-0">
              <h4 className="font-bold text-slate-900 text-sm">企微事件流</h4>
              <p className="text-[11px] text-slate-400 mt-0.5">最近 50 条回调事件，按时间倒序</p>
            </div>
          </div>
          <button
            onClick={loadEvents}
            title="刷新事件流"
            className="text-slate-400 hover:text-emerald-600 transition shrink-0 px-1"
          >
            <i className="fa-solid fa-arrows-rotate" />
          </button>
        </div>
        {sortedEvents.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                  <th className="p-3.5 pl-4">时间</th>
                  <th className="p-3.5">事件类型</th>
                  <th className="p-3.5">变更类型</th>
                  <th className="p-3.5">ExternalUserID</th>
                  <th className="p-3.5 pr-4">关联员工</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {sortedEvents.map(ev => {
                  const meta = eventMeta(ev.event_type)
                  return (
                    <tr key={ev.id} className="hover:bg-slate-50/80 transition">
                      <td className="p-3.5 pl-4 whitespace-nowrap text-slate-500">{formatDateTime(ev.created_at)}</td>
                      <td className="p-3.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${meta.badge}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="p-3.5 whitespace-nowrap">{ev.change_type ?? '-'}</td>
                      <td className="p-3.5">
                        {ev.external_userid ? (
                          <span
                            className="font-mono text-[11px] text-slate-500 truncate inline-block max-w-[150px] align-middle"
                            title={ev.external_userid}
                          >
                            {ev.external_userid}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="p-3.5 pr-4 whitespace-nowrap">{ev.userid || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon="fa-solid fa-tower-broadcast"
            title="暂无企微事件"
            description="完成对接配置或注入模拟事件后，回调事件将实时展示在这里"
          />
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 custom-shadow p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center text-sm shrink-0">
            <i className="fa-solid fa-database" />
          </span>
          <div>
            <h4 className="font-bold text-slate-900 text-sm">数据备份与导出</h4>
            <p className="text-[11px] text-slate-400 mt-0.5">定期导出客户资产与配置备份，保障私域数据安全</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportBackup}
            disabled={exporting}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-sm transition"
          >
            <i className="fa-solid fa-file-export text-xs" />
            <span>导出全量 JSON 备份</span>
          </button>
          <button
            onClick={() => handleExportCsv('retail')}
            disabled={exporting}
            className="px-3.5 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
          >
            <i className="fa-solid fa-file-csv text-xs" />
            <span>导出C端客户CSV</span>
          </button>
          <button
            onClick={() => handleExportCsv('service')}
            disabled={exporting}
            className="px-3.5 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
          >
            <i className="fa-solid fa-file-csv text-xs" />
            <span>导出B端客户CSV</span>
          </button>
        </div>
      </div>
    </div>
  )
}
