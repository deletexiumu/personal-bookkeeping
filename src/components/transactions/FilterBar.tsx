import { Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { isFilterEmpty, SOURCE_LABEL, type TransactionFilter } from '../../lib/filter'
import type { Account, Category, TransactionSource, TransactionType } from '../../types'
import { Kbd } from '../ui/Badge'

interface Props {
  filter: TransactionFilter
  onChange: (filter: TransactionFilter) => void
  categories: Category[]
  accounts: Account[]
  /** 筛选后的笔数 */
  count: number
}

const TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'transfer', label: '转账' },
]

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** 明细工具栏（D01）：搜索（⌘K / Ctrl+K 或 /）+ 类型、账户、分类、来源筛选 */
export function FilterBar({ filter, onChange, categories, accounts, count }: Props) {
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing = target && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)
      const isShortcut = (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)
      if (!isShortcut || document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const set = (patch: Partial<TransactionFilter>) => onChange({ ...filter, ...patch })
  const numberOrUndefined = (value: string) => (value === '' ? undefined : Number(value))
  const categoryOptions = categories.filter((c) => !filter.type || filter.type === c.type)

  return (
    <div className="filter-bar" role="search">
      <label className="search-field">
        <Search size={16} aria-hidden="true" className="text-tertiary" />
        <input
          ref={searchRef}
          type="search"
          aria-label="搜索备注、商户、分类、标签、金额"
          placeholder="搜索备注、商户、金额"
          value={filter.query ?? ''}
          onChange={(e) => set({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            set({ query: '' })
            e.currentTarget.blur()
          }}
        />
        <Kbd>{isMac ? '⌘K' : 'Ctrl K'}</Kbd>
      </label>
      <div className="filter-selects">
        <select
          className="filter-select"
          aria-label="类型"
          data-active={filter.type ? '' : undefined}
          value={filter.type ?? ''}
          onChange={(e) => {
            const type = (e.target.value || undefined) as TransactionType | undefined
            const keepCategory = categories.find((c) => c.id === filter.categoryId)?.type === type
            set({ type, categoryId: keepCategory ? filter.categoryId : undefined })
          }}
        >
          <option value="">全部类型</option>
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          aria-label="账户"
          data-active={filter.accountId !== undefined ? '' : undefined}
          value={filter.accountId ?? ''}
          onChange={(e) => set({ accountId: numberOrUndefined(e.target.value) })}
        >
          <option value="">全部账户</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          aria-label="分类"
          data-active={filter.categoryId !== undefined ? '' : undefined}
          value={filter.categoryId ?? ''}
          disabled={filter.type === 'transfer'}
          onChange={(e) => set({ categoryId: numberOrUndefined(e.target.value) })}
        >
          <option value="">全部分类</option>
          {categoryOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          aria-label="来源"
          data-active={filter.source ? '' : undefined}
          value={filter.source ?? ''}
          onChange={(e) => set({ source: (e.target.value || undefined) as TransactionSource | undefined })}
        >
          <option value="">全部来源</option>
          {(Object.keys(SOURCE_LABEL) as TransactionSource[]).map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </select>
        {!isFilterEmpty(filter) && (
          <button type="button" className="filter-clear t-body-s" onClick={() => onChange({})}>
            <X size={14} aria-hidden="true" />
            清除筛选
          </button>
        )}
        <span className="filter-count t-caption text-tertiary" aria-live="polite">
          共 {count} 笔
        </span>
      </div>
    </div>
  )
}
