import { ChevronRight, Sheet, Sparkles, TriangleAlert } from 'lucide-react'
import { FIELD_LABELS, FIELD_ORDER, type FieldKey } from '../../lib/import/fields'
import { classify, matchAccount } from '../../lib/import/preview'
import type { SniffResult } from '../../lib/import/sniff'
import { mappingProblems, type AmountSign, type ColumnMapping, type ParseResult } from '../../lib/import/table'
import { formatCents } from '../../lib/money'
import type { Account, Category, CategoryRule } from '../../types'
import { CategoryIcon } from '../CategoryIcon'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

const FORMAT_TEXT = { 'utf-8': 'UTF-8 编码', gbk: 'GBK 编码（已自动转换）', xlsx: 'Excel 工作簿', pdf: 'PDF 文档' } as const

const STATUS_BADGE = {
  matched: { tone: 'income', text: '已匹配' },
  confirm: { tone: 'warning', text: '需确认' },
  skip: { tone: 'neutral', text: '跳过' },
} as const

interface Props {
  fileName: string
  sniff: SniffResult
  mapping: ColumnMapping[]
  parsed: ParseResult
  amountSign: AmountSign
  accountId: number | undefined
  categories: Category[]
  accounts: Account[]
  merchantHistory: Map<string, number>
  busy: boolean
  rules: CategoryRule[]
  saveTemplate: boolean
  templateName: string
  onSaveTemplateChange: (on: boolean) => void
  onTemplateNameChange: (name: string) => void
  onMappingChange: (col: number, field: FieldKey) => void
  onHeaderRowChange: (row: number) => void
  onAmountSignChange: (sign: AmountSign) => void
  onAccountChange: (id: number) => void
  onBack: () => void
  onNext: () => void
}

function shortDate(date: string, time?: string) {
  const [, m, d] = date.split('-')
  return `${m}/${d}${time ? ` ${time}` : ''}`
}

/** 第 3 步：字段映射（D03）。左侧逐列映射，右侧实时预览解析结果。 */
export function MappingStep(props: Props) {
  const { sniff, mapping, parsed, categories, accounts } = props
  const { table } = sniff
  const matched = mapping.filter((m) => m.field !== 'ignore').length
  const confirm = mapping.flatMap((m, i) => (m.status === 'confirm' ? [table.headers[i]] : []))
  const problems = mappingProblems(mapping)
  const fields = new Set(mapping.map((m) => m.field))
  const signMatters = fields.has('amount') && !fields.has('direction')
  const defaultAccount = props.accountId ?? accounts[0]?.id ?? 0
  const sample = (col: number) => table.rows.find((r) => r.cells[col])?.cells[col] ?? ''
  const headerChoices = Math.min(sniff.lines.length, 40)

  return (
    <div className="import-layout">
      <section className="card import-card">
        <header className="file-head">
          <span className="cat-icon tone-orange" style={{ width: 40, height: 40 }} aria-hidden="true">
            <Sheet size={20} />
          </span>
          <div className="file-meta">
            <h2 className="t-body-m-strong">{props.fileName}</h2>
            <p className="t-caption text-tertiary">
              {FORMAT_TEXT[sniff.format]}
              {table.headerRow > 0 && ` · 跳过前 ${table.headerRow} 行说明`} · {table.rows.length} 行数据 · {table.headers.length} 列
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={props.onBack}>
            重新选择
          </Button>
        </header>

        <p className={`import-banner t-body-s ${confirm.length > 0 ? 'import-banner-warning' : ''}`}>
          <Sparkles size={16} aria-hidden="true" />
          {sniff.template ? `已按「${sniff.template.name}」模板匹配 ${matched} / ${table.headers.length} 列` : `已自动匹配 ${matched} / ${table.headers.length} 列`}
          {confirm.length > 0 ? `，请确认标黄的「${confirm.join('」「')}」映射。` : '。'}
        </p>

        <div className="map-options">
          <label className="field">
            <span className="field-label t-caption">表头所在行</span>
            <select
              className="input"
              value={table.headerRow}
              onChange={(e) => props.onHeaderRowChange(Number(e.target.value))}
            >
              {Array.from({ length: headerChoices }, (_, i) => (
                <option key={i} value={i}>
                  第 {i + 1} 行{sniff.lines[i]?.[0] ? `：${sniff.lines[i][0].slice(0, 12)}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label t-caption">入账账户（文件里没有账户列或对不上时）</span>
            <select className="input" value={defaultAccount} onChange={(e) => props.onAccountChange(Number(e.target.value))}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {signMatters && (
            <label className="field">
              <span className="field-label t-caption">金额正负</span>
              <select
                className="input"
                value={props.amountSign}
                onChange={(e) => props.onAmountSignChange(e.target.value as AmountSign)}
              >
                <option value="negative-expense">负数为支出</option>
                <option value="positive-expense">正数为支出（常见于信用卡）</option>
              </select>
            </label>
          )}
        </div>

        <div className="map-table" role="table" aria-label="字段映射">
          <div className="map-row map-head t-caption text-tertiary" role="row">
            <span role="columnheader">文件列</span>
            <span role="columnheader">示例值</span>
            <span aria-hidden="true" />
            <span role="columnheader">映射到</span>
            <span role="columnheader">状态</span>
          </div>
          {table.headers.map((header, col) => {
            const m = mapping[col]
            const badge = STATUS_BADGE[m.status]
            return (
              <div key={col} className="map-row" role="row" data-status={m.status}>
                <span className="t-body-m-strong map-header" role="cell">
                  {header}
                </span>
                <span className="t-body-s text-secondary map-sample" role="cell">
                  {sample(col) || '（空）'}
                </span>
                <ChevronRight size={16} aria-hidden="true" className="text-tertiary map-arrow" />
                <span role="cell" className="map-field">
                  <select
                    className="input map-select"
                    aria-label={`「${header}」映射到`}
                    value={m.field}
                    onChange={(e) => props.onMappingChange(col, e.target.value as FieldKey)}
                  >
                    {FIELD_ORDER.map((f) => (
                      <option key={f} value={f}>
                        {FIELD_LABELS[f]}
                      </option>
                    ))}
                  </select>
                </span>
                <span role="cell" className="map-status">
                  <Badge tone={badge.tone}>{badge.text}</Badge>
                </span>
              </div>
            )
          })}
        </div>

        <div className="template-save">
          <label className="check-field t-body-s">
            <input type="checkbox" checked={props.saveTemplate} onChange={(e) => props.onSaveTemplateChange(e.target.checked)} />
            保存为模板，下次自动识别
          </label>
          {props.saveTemplate && (
            <input
              className="input template-name"
              aria-label="模板名称"
              maxLength={20}
              value={props.templateName}
              onChange={(e) => props.onTemplateNameChange(e.target.value)}
            />
          )}
        </div>
      </section>

      <aside className="card import-card import-live" aria-label="实时预览">
        <header className="import-live-head">
          <h2 className="t-title-s">实时预览</h2>
          <Badge tone={parsed.errors.length > 0 ? 'warning' : 'income'}>
            解析成功 {parsed.rows.length} / {table.rows.length}
          </Badge>
        </header>
        <p className="t-caption text-tertiary">修改左侧映射，这里即时刷新解析结果。</p>
        {problems.length > 0 && (
          <p className="form-error t-body-s" role="alert">
            <TriangleAlert size={16} aria-hidden="true" /> {problems.join('；')}
          </p>
        )}
        <ul className="live-list">
          {parsed.rows.slice(0, 5).map((row) => {
            const hit = classify(row, { categories, rules: props.rules, merchantHistory: props.merchantHistory })
            const category = categories.find((c) => c.id === hit?.categoryId)
            const account = accounts.find((a) => a.id === matchAccount(row.accountName, accounts, defaultAccount))
            return (
              <li key={row.line} className="live-row">
                <CategoryIcon category={category} size={32} />
                <div className="tx-main">
                  <span className="t-body-m">{row.merchant ?? row.note ?? '（无备注）'}</span>
                  <span className="t-caption text-tertiary">
                    {shortDate(row.date, row.time)} · {account?.name ?? '未知账户'} · {category?.name ?? '待分类'}
                  </span>
                </div>
                <span className={`t-num-m ${row.type === 'income' ? 'amount-income' : 'amount-expense'}`}>
                  {row.type === 'income' ? '+' : '-'}
                  {formatCents(row.amount)}
                </span>
              </li>
            )
          })}
        </ul>
        {parsed.errors.length > 0 && (
          <p className="t-caption text-warning">
            {parsed.errors.length} 行无法解析，将跳过（第 {parsed.errors.slice(0, 5).map((e) => e.line).join('、')}
            {parsed.errors.length > 5 ? ' 等' : ''} 行：{parsed.errors[0].reason}）
          </p>
        )}
        <div className="import-actions">
          <Button onClick={props.onBack}>上一步</Button>
          <Button
            variant="primary"
            disabled={problems.length > 0 || parsed.rows.length === 0 || props.busy}
            onClick={props.onNext}
          >
            下一步：预览 {parsed.rows.length} 条
          </Button>
        </div>
      </aside>
    </div>
  )
}
