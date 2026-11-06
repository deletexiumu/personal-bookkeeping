import { FileCheck2 } from 'lucide-react'
import { useState } from 'react'
import { isNeutral, statusOf, summarizePreview, type CategorySource, type PreviewItem } from '../../lib/import/preview'
import { ruleFromRow } from '../../lib/import/rules'
import { normalizeText } from '../../lib/import/similarity'
import type { RowError } from '../../lib/import/table'
import { formatCents } from '../../lib/money'
import type { Category } from '../../types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

type Filter = 'all' | 'pending' | 'merge' | 'duplicate' | 'income'

const SOURCE_TEXT: Record<CategorySource, string> = {
  rule: '规则',
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

function describe(t: { date: string; source: string; merchant?: string; note?: string }): string {
  const what = t.merchant ?? t.note
  return `${shortDate(t.date)} ${t.source === 'import' ? '已导入的' : '手记的'}「${what ?? '无备注'}」`
}

function duplicateText(item: PreviewItem): string {
  if (item.mergeWith) return `可能与 ${describe(item.mergeWith)}是同一笔，勾选后合并`
  const dup = item.duplicateOf
  if (dup === 'batch') return '与本文件中前面的行相同'
  if (dup && item.refundDuplicate) return `这笔退款已并进 ${shortDate(dup.date)} 的「${dup.merchant ?? dup.note ?? '无备注'}」`
  if (!dup) return ''
  return `与 ${shortDate(dup.date)} ${dup.source === 'import' ? '已导入的' : '手记的'}一笔重复`
}

function refundText(item: PreviewItem): string {
  const r = item.refundOf
  if (!r) return ''
  const what = `${shortDate(r.purchase.date)} ${r.tx ? '已有' : '本文件'}的「${r.purchase.merchant ?? r.purchase.note ?? '无备注'}」`
  return r.full ? `退款，与 ${what}抵消，两条都不计收支` : `部分退款，从 ${what}里扣除`
}

function mergeText(item: PreviewItem): string {
  if (item.refundOf) return refundText(item)
  if (!item.mergeWith) return ''
  return `与 ${describe(item.mergeWith)}是同一笔，${item.mergeAsTransfer ? '合并为本人账户间的转账' : '合并为一条'}`
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
    if (filter === 'merge') return status === 'merge'
    if (filter === 'duplicate') return status === 'duplicate'
    if (filter === 'income') return item.row.type === 'income'
    return true
  })

  function patch(key: number, change: Partial<PreviewItem>) {
    onChange(items.map((i) => (i.key === key ? { ...i, ...change } : i)))
  }

  function setCategory(item: PreviewItem, value: string) {
    if (value === '') patch(item.key, { categoryId: undefined, categorySource: undefined, remember: false })
    else patch(item.key, { categoryId: Number(value), categorySource: 'manual' })
  }

  /** 勾选「记住」：入账时生成规则，并把本批次同商户、未手动改过的行改成同一分类 */
  function setRemember(item: PreviewItem, on: boolean) {
    const key = normalizeText(item.row.merchant ?? item.row.note)
    onChange(
      items.map((i) => {
        if (i.key === item.key) return { ...i, remember: on }
        const same = key && i.row.type === item.row.type && normalizeText(i.row.merchant ?? i.row.note) === key
        if (on && same && i.categorySource !== 'manual') return { ...i, categoryId: item.categoryId, categorySource: 'manual' }
        return i
      }),
    )
  }
  /** 合并候选改为单独入账，或改回合并 */
  function toggleMerge(item: PreviewItem) {
    if (item.mergeWith || item.refundOf) {
      const { mergeWith, weakMerge, mergeAsTransfer, transferPair, refundOf } = item
      patch(item.key, {
        mergeWith: undefined,
        weakMerge: undefined,
        mergeAsTransfer: undefined,
        transferPair: undefined,
        refundOf: undefined,
        declinedMerge: { mergeWith, weakMerge, mergeAsTransfer, transferPair, refundOf },
        selected: !transferPair,
      })
    } else if (item.declinedMerge) {
      patch(item.key, { ...item.declinedMerge, declinedMerge: undefined, selected: true })
    }
  }
  const rememberCount = items.filter((i) => i.remember && i.selected).length

  const allVisibleSelected = visible.length > 0 && visible.every((i) => i.selected)
  function toggleVisible() {
    const keys = new Set(visible.map((i) => i.key))
    onChange(items.map((i) => (keys.has(i.key) ? { ...i, selected: !allVisibleSelected } : i)))
  }

  const FILTERS: [Filter, string, number][] = [
    ['all', '全部', items.length],
    ['pending', '待处理', pending],
    ['merge', '合并', summary.merge],
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
          <span className="t-num-l text-brand">{summary.merge}</span>
          <span className="t-caption text-secondary">合并</span>
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
          // 不计收支的中性交易（零钱充值、余额宝转入等）不显示正负号
          const neutral = row.skipReason === '不计收支'
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
                  {status === 'merge' && <Badge tone="brand">{item.refundOf ? '退款' : '合并'}</Badge>}
                  {status === 'duplicate' && <Badge tone="warning">疑似重复</Badge>}
                  {status === 'uncategorized' && <Badge tone="expense">待分类</Badge>}
                  {status === 'ignored' && <Badge>{row.skipReason}</Badge>}
                  {status === 'new' && item.categorySource === 'rule' && item.rule && (
                    <Badge tone="brand">
                      规则：{item.rule.keyword}→{category?.name}
                    </Badge>
                  )}
                  {status === 'new' && item.categorySource && item.categorySource !== 'manual' && item.categorySource !== 'rule' && (
                    <Badge tone="brand">
                      {SOURCE_TEXT[item.categorySource]}：{category?.name}
                    </Badge>
                  )}
                  {row.type === 'income' && status !== 'ignored' && !item.transferPair && !item.refundOf && <Badge tone="income">收入</Badge>}
                </div>
                <span className="t-caption text-tertiary">
                  {shortDate(row.date)}
                  {row.time && ` ${row.time}`}
                  {row.merchant && row.note && ` · ${row.note}`}
                  {status === 'merge' && ` · ${mergeText(item)}`}
                  {status === 'duplicate' && ` · ${duplicateText(item)}`}
                  {status === 'ignored' && isNeutral(row) && ' · 勾选后按「不计收支」入账，不计入收支统计'}
                  {(((item.mergeWith || item.refundOf) && status !== 'ignored') || item.declinedMerge) && (
                    <>
                      {' · '}
                      <button type="button" className="link-button" onClick={() => toggleMerge(item)}>
                        {item.mergeWith || item.refundOf ? '不合并，单独入账' : '改回合并'}
                      </button>
                    </>
                  )}
                </span>
              </div>
              <span className="preview-category">
              {item.refundOf || (item.mergeWith && (item.mergeAsTransfer || item.mergeWith.categoryId !== undefined)) ? (
                <span className="t-caption text-tertiary">{item.refundOf ? '退款不分类' : item.mergeAsTransfer ? '转账不分类' : '沿用已有分类'}</span>
              ) : (
              <select
                className="input"
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
              )}
              {status !== 'merge' && item.categorySource === 'manual' && item.categoryId !== undefined && ruleFromRow(row, item.categoryId) && (
                <label className="check-field preview-remember t-caption" title={`以后${row.merchant ? '商户' : '备注'}包含「${row.merchant ?? row.note}」时自动归为${category?.name}`}>
                  <input type="checkbox" checked={!!item.remember} onChange={(e) => setRemember(item, e.target.checked)} />
                  记住
                </label>
              )}
              </span>
              <span className={`t-num-m preview-amount ${neutral ? 'text-secondary' : row.type === 'income' ? 'amount-income' : 'amount-expense'}`}>
                {neutral ? '' : row.type === 'income' ? '+' : '-'}
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
          {items.some((i) => i.selected && i.mergeWith) && (
            <p className="t-caption text-tertiary">其中 {items.filter((i) => i.selected && i.mergeWith).length} 条与已有流水合并，不新增</p>
          )}
          {summary.selectedUncategorized > 0 && (
            <p className="t-caption text-tertiary">{summary.selectedUncategorized} 条将以「未分类」入账</p>
          )}
          {rememberCount > 0 && <p className="t-caption text-tertiary">入账后记住 {rememberCount} 条分类规则</p>}
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
