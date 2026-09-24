import { useState } from 'react'
import type { ConditionField, ConditionOperator, SopConditions } from '../../types'

interface Props {
  value: SopConditions | null
  onChange: (v: SopConditions | null) => void
  fields: ConditionField[]
  operators: Record<string, ConditionOperator[]>
  humanText?: string | null
}

const emptyRoot = (): SopConditions => ({ op: 'AND', rules: [] })

export default function ConditionBuilder({ value, onChange, fields, operators, humanText }: Props) {
  const root: SopConditions = value || emptyRoot()

  const handleRootChange = (next: SopConditions) => {
    // 如果清空了所有规则，允许为 null（表示无额外条件）
    if (next.rules.length === 0) {
      onChange(null)
    } else {
      onChange(next)
    }
  }

  const addLeaf = () => {
    const firstField = fields[0]
    const firstOp = firstField ? operators[firstField.type]?.[0] : null
    const next: SopConditions = {
      ...root,
      rules: [
        ...root.rules,
        { field: firstField?.value || '', op: firstOp?.value || '=', value: firstField?.type === 'number' ? 0 : '' }
      ]
    }
    handleRootChange(next)
  }

  const addGroup = () => {
    const next: SopConditions = {
      ...root,
      rules: [...root.rules, { op: 'OR', rules: [] }]
    }
    handleRootChange(next)
  }

  return (
    <div className="space-y-3">
      {/* 规则生效说明预览 */}
      {humanText && (
        <div className="p-3 bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 rounded-lg">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 mb-1">
            <i className="fa-solid fa-wand-magic-sparkles" />
            <span>规则生效说明（系统自动生成）</span>
          </div>
          <div className="text-xs text-slate-700 leading-relaxed">{humanText}</div>
        </div>
      )}

      {/* 根操作符切换 + 添加按钮 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-slate-500">所有条件</span>
        <OpSwitch value={root.op} onChange={op => handleRootChange({ ...root, op })} />
        <span className="text-[11px] text-slate-500">满足</span>
        <button
          onClick={addLeaf}
          type="button"
          className="px-2.5 py-1 text-[10px] bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-medium rounded-md transition"
        >
          <i className="fa-solid fa-plus text-[10px] mr-0.5" />条件
        </button>
        <button
          onClick={addGroup}
          type="button"
          className="px-2.5 py-1 text-[10px] bg-blue-100 hover:bg-blue-200 text-blue-700 font-medium rounded-md transition"
        >
          <i className="fa-solid fa-layer-group text-[10px] mr-0.5" />条件组（嵌套 OR）
        </button>
        {root.rules.length > 0 && (
          <button
            onClick={() => onChange(null)}
            type="button"
            className="ml-auto px-2 py-1 text-[10px] text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition"
          >
            清空全部
          </button>
        )}
      </div>

      {/* 规则列表 */}
      <div className="space-y-2 pl-1">
        {root.rules.length === 0 && (
          <div className="text-[11px] text-slate-400 p-3 bg-slate-50 border border-dashed border-slate-200 rounded-lg text-center">
            <i className="fa-solid fa-filter mr-1" />
            暂无额外条件 — SOP 将在触发事件发生时对所有客户生效
          </div>
        )}
        {root.rules.map((rule, i) => (
          <RuleRow
            key={i}
            rule={rule}
            fields={fields}
            operators={operators}
            depth={0}
            onPatch={(r) => {
              const next = { ...root, rules: root.rules.map((x, idx) => idx === i ? r : x) }
              handleRootChange(next)
            }}
            onRemove={() => {
              const next = { ...root, rules: root.rules.filter((_, idx) => idx !== i) }
              handleRootChange(next)
            }}
          />
        ))}
      </div>
    </div>
  )
}

// ========= 单行规则（叶子或子组） =========
function RuleRow({
  rule, fields, operators, depth, onPatch, onRemove
}: {
  rule: SopConditions | SopConditions['rules'][number]
  fields: ConditionField[]
  operators: Record<string, ConditionOperator[]>
  depth: number
  onPatch: (r: SopConditions | SopConditions['rules'][number]) => void
  onRemove: () => void
}) {
  const isGroup = Array.isArray((rule as SopConditions).rules)

  if (isGroup) {
    const group = rule as SopConditions
    return (
      <div className={`p-3 rounded-lg border ${depth === 0 ? 'border-blue-200 bg-blue-50/40' : 'border-purple-200 bg-purple-50/40'}`}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] bg-white text-slate-500 font-bold px-1.5 py-0.5 rounded border border-slate-200">
            组 {depth + 1}
          </span>
          <OpSwitch value={group.op} onChange={op => onPatch({ ...group, op })} size="sm" />
          <button
            onClick={() => onPatch({ ...group, rules: [...group.rules, { field: fields[0]?.value || '', op: '=', value: '' }] })}
            type="button"
            className="px-2 py-0.5 text-[10px] bg-white hover:bg-slate-50 text-slate-600 rounded border border-slate-200"
          >
            +条件
          </button>
          <button
            onClick={() => onPatch({ ...group, rules: [...group.rules, { op: group.op === 'AND' ? 'OR' : 'AND', rules: [] }] })}
            type="button"
            className="px-2 py-0.5 text-[10px] bg-white hover:bg-slate-50 text-slate-600 rounded border border-slate-200"
          >
            +子组
          </button>
          <button onClick={onRemove} type="button" className="ml-auto text-[10px] text-rose-500 hover:text-rose-700">
            <i className="fa-solid fa-trash" />
          </button>
        </div>
        <div className="space-y-1.5 pl-2 border-l-2 border-slate-200 ml-2">
          {group.rules.length === 0 && (
            <div className="text-[10px] text-slate-400 py-1">空子组 — 添加条件或嵌套子组</div>
          )}
          {group.rules.map((r, i) => (
            <RuleRow
              key={i}
              rule={r}
              fields={fields}
              operators={operators}
              depth={depth + 1}
              onPatch={(nr) => onPatch({ ...group, rules: group.rules.map((x, idx) => idx === i ? nr : x) })}
              onRemove={() => onPatch({ ...group, rules: group.rules.filter((_, idx) => idx !== i) })}
            />
          ))}
        </div>
      </div>
    )
  }

  // 叶子规则
  const leaf = rule as SopConditions['rules'][number] & { field: string; op: string }
  const field = fields.find(f => f.value === leaf.field) || fields[0]
  const availOps = (field && operators[field.type]) || []

  return (
    <div className="flex items-center gap-1.5 flex-wrap p-2 bg-white border border-slate-200 rounded-lg">
      {/* 字段 */}
      <select
        value={leaf.field}
        onChange={e => {
          const newField = fields.find(f => f.value === e.target.value)
          const newOp = newField ? operators[newField.type]?.[0]?.value || '=' : '='
          const defaultValue: string | number = newField?.type === 'number' ? 0 : ''
          onPatch({ field: e.target.value, op: newOp, value: defaultValue })
        }}
        className="text-xs p-1.5 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-emerald-500 focus:outline-none min-w-[110px]"
      >
        {fields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>

      {/* 操作符 */}
      <select
        value={leaf.op}
        onChange={e => onPatch({ ...leaf, op: e.target.value })}
        className="text-xs p-1.5 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-emerald-500 focus:outline-none min-w-[100px]"
      >
        {availOps.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {/* 值输入（按 field.type 渲染） */}
      <ValueInput
        field={field}
        op={leaf.op}
        value={leaf.value}
        onChange={(v) => onPatch({ ...leaf, value: v })}
      />

      {/* 单位 */}
      {field?.units && (
        <span className="text-[10px] text-slate-400">{field.units}</span>
      )}

      {/* 删除 */}
      <button onClick={onRemove} type="button" className="ml-auto text-slate-400 hover:text-rose-500 transition" title="删除条件">
        <i className="fa-solid fa-xmark text-xs" />
      </button>
    </div>
  )
}

// ========= 值输入 =========
function ValueInput({ field, op, value, onChange }: {
  field?: ConditionField
  op: string
  value: string | number | (string | number)[]
  onChange: (v: string | number | (string | number)[]) => void
}) {
  const inputCls = 'text-xs p-1.5 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-emerald-500 focus:outline-none min-w-[100px]'

  // in / not_in → 多选
  if (op === 'in' || op === 'not_in') {
    const opts = field?.options || []
    const currentArr = Array.isArray(value) ? value : []
    if (opts.length) {
      return (
        <select
          multiple
          value={currentArr.map(String)}
          onChange={e => {
            const selected = Array.from(e.target.selectedOptions).map(o => o.value)
            onChange(selected)
          }}
          className={`${inputCls} h-[60px] min-w-[140px]`}
        >
          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    }
  }

  // 枚举单选
  if (field?.type === 'enum' && field.options) {
    return (
      <select
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value)}
        className={inputCls}
      >
        <option value="">— 请选择 —</option>
        {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }

  // 数字
  if (field?.type === 'number') {
    return (
      <input
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className={inputCls}
        placeholder="数值"
      />
    )
  }

  // 字符串（包含/不包含）
  return (
    <input
      type="text"
      value={String(value ?? '')}
      onChange={e => onChange(e.target.value)}
      className={inputCls}
      placeholder={field?.hint || '输入值'}
    />
  )
}

// ========= AND/OR 切换开关 =========
function OpSwitch({ value, onChange, size = 'md' }: { value: 'AND' | 'OR'; onChange: (v: 'AND' | 'OR') => void; size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-[11px] px-2.5 py-1'
  return (
    <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => onChange('AND')}
        className={`${cls} font-semibold transition ${value === 'AND' ? 'bg-emerald-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
      >
        全部满足
      </button>
      <button
        type="button"
        onClick={() => onChange('OR')}
        className={`${cls} font-semibold transition ${value === 'OR' ? 'bg-blue-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
      >
        任一满足
      </button>
    </div>
  )
}
