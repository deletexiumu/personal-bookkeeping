import { FileCheck2 } from 'lucide-react'
import { useState } from 'react'
import { statusOf, summarizePreview, type CategorySource, type PreviewItem } from '../../lib/import/preview'
import type { RowError } from '../../lib/import/table'
import { formatCents } from '../../lib/money'
import type { Category } from '../../types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

type Filter = 'all' | 'pending' | 'duplicate' | 'income'

const SOURCE_TEXT: Record<CategorySource, string> = {
  file: '文件分类',
  history: '同商户',
  keyword: '关键词',
  manual: '手动',
}

interface Props {
  fileName: string
  sourceName: string
  items: PreviewItem[]
  errors: RowError[]
  categories: Category[]
  busy: boolean
  onChange: (items: PreviewItem[]) => void
  onBack: () => void
  onCommit: () => void
}

function shortDate(date: string) {
  const [, m, d] = date.split('-')
  return `${m}/${d}`
}

function duplicateText(item: PreviewItem): string {
  const dup = item.duplicateOf
  if (dup === 'batch') return '与本文件中前面的行相同'
  if (!dup) return ''
  return `与 ${shortDate(dup.date)} ${dup.source === 'import' ? '已导入的' : '手记的'}一笔重复`
}

/** 第 4 步：预览确认（M05）。可勾选、改分类；疑似重复和忽略的行默认不勾选。 */
export function PreviewStep({ fileName, sourceName, items, errors, categories, busy, onChange, onBack, onCommit }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const summary = summarizePreview(items)
  const dates = items.map((i) => i.row.date).sort()
  const income = items.filter((i) => i.row.type === 'income').length
  const pending = summary.duplicate + summary.uncategorized

  const visible = items.filter((item) => {
    const status = statusOf(item)
    if (filter === 'pending') return status === 'duplicate' || status === 'uncategorized'
    if (filter === 'duplicate') return status === 'duplicate'
    if (filter === 'income') return item.row.type === 'income'
    return true
  })

  function patch(key: number, change: Partial<PreviewItem>) {
    onChange(items.map((i) => (i.key === key ? { ...i, ...change } : i)))
  }

  function setCategory(item: PreviewItem, value: string) {
    if (value === '') patch(item.key, { categoryId: undefined, categorySource: undefined })
    else patch(item.key, { categoryId: Number(value), categorySource: 'manual' })
  }

  const allVisibleSelected = visible.length > 0 && visible.every((i) => i.selected)
  function toggleVisible() {
    const keys = new Set(visible.map((i) => i.key))
    onChange(items.map((i) => (keys.has(i.key) ? { ...i, selected: !allVisibleSelected } : i)))
  }

  const FILTERS: [Filter, string, number][] = [
    ['all', '全部', items.length],
    ['pending', '待处理', pending],
    ['duplicate', '重复', summary.duplicate],
    ['income', '收入', income],
  ]

  return (
    <div className="preview-page">
      <section className="card import-card file-head">
        <span className="cat-icon tone-green" style={{ width: 40, height: 40 }} aria-hidden="true">
          <FileCheck2 size={20} />
        </span>
        <div className="file-meta">
          <h2 className="t-body-m-strong">{fileName}</h2>
          <p className="t-caption text-tertiary">
            {sourceName} · {items.length} 条{dates.length > 0 && ` · ${shortDate(dates[0])} – ${shortDate(dates.at(-1)!)}`}
            {errors.length > 0 && ` · ${errors.length} 行无法解析已跳过`}
          </p>
        </div>
      </section>

      <section className="card preview-summary" aria-label="导入汇总">
        <div className="preview-kpi">
          <span className="t-num-l text-income">{summary.new}</span>
          <span className="t-caption text-secondary">新增</span>
        </div>
        <div className="preview-kpi">
          <span className="t-num-l text-warning">{summary.duplicate}</span>
          <span className="t-caption text-secondary">疑似重复</span>
        </div>
        <div className="preview-kpi">
          <span className="t-num-l text-expense">{summary.uncategorized}</span>
          <span className="t-caption text-secondary">待分类</span>
        </div>
        <div className="preview-kpi">
          <span className="t-num-l text-tertiary">{summary.ignored}</span>
          <span className="t-caption text-secondary">忽略</span>
        </div>
      </section>

      <div className="preview-toolbar">
        <div className="chip-row" role="group" aria-label="筛选">
          {FILTERS.map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              className="filter-chip"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label} {count}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={toggleVisible} disabled={visible.length === 0}>
          {allVisibleSelected ? '取消全选' : '全选'}
        </Button>
      </div>

      <ul className="card preview-list" aria-label="待导入流水">
        {visible.map((item) => {
          const { row } = item
          const status = statusOf(item)
          const title = row.merchant ?? row.note ?? '（无备注）'
          const category = categories.find((c) => c.id === item.categoryId)
          const options = categories.filter((c) => c.type === row.type && !c.archived)
          return (
            <li key={item.key} className="preview-row" data-status={status}>
              <input
                type="checkbox"
                className="preview-check"
                checked={item.selected}
                aria-label={`选择 ${title}`}
                onChange={(e) => patch(item.key, { selected: e.target.checked })}
              />
              <div className="preview-main">
                <div className="preview-title">
                  <span className="t-body-m">{title}</span>
                  {status === 'duplicate' && <Badge tone="warning">疑似重复</Badge>}
                  {status === 'uncategorized' && <Badge tone="expense">待分类</Badge>}
                  {status === 'ignored' && <Badge>{row.skipReason}</Badge>}
                  {status === 'new' && item.categorySource && item.categorySource !== 'manual' && (
                    <Badge tone="brand">
                      {SOURCE_TEXT[item.categorySource]}：{category?.name}
                    </Badge>
                  )}
                  {row.type === 'income' && <Badge tone="income">收入</Badge>}
                </div>
                <span className="t-caption text-tertiary">
                  {shortDate(row.date)}
                  {row.time && ` ${row.time}`}
                  {row.merchant && row.note && ` · ${row.note}`}
                  {status === 'duplicate' && ` · ${duplicateText(item)}`}
                </span>
              </div>
              <select
                className="input preview-category"
                aria-label={`「${title}」的分类`}
                value={item.categoryId ?? ''}
                onChange={(e) => setCategory(item, e.target.value)}
              >
                <option value="">未分类</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className={`t-num-m preview-amount ${row.type === 'income' ? 'text-income' : ''}`}>
                {row.type === 'income' ? '+' : '-'}
                {formatCents(row.amount)}
              </span>
            </li>
          )
        })}
        {visible.length === 0 && <li className="empty-state t-body-s">没有符合条件的流水</li>}
      </ul>

      <footer className="card preview-footer">
        <div>
          <p className="t-body-m-strong">已选 {summary.selected} 条</p>
          {summary.selectedUncategorized > 0 && (
            <p className="t-caption text-tertiary">{summary.selectedUncategorized} 条将以「未分类」入账</p>
          )}
        </div>
        <div className="import-actions">
          <Button onClick={onBack}>上一步</Button>
          <Button variant="primary" disabled={summary.selected === 0 || busy} onClick={onCommit}>
            确认导入
          </Button>
        </div>
      </footer>
    </div>
  )
}
