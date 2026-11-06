import { X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { db } from '../../db'
import { updateTransaction, type TransactionPatch } from '../../db/transactions'
import { evaluateAmount, normalizeExpression } from '../../lib/expression'
import { formatTags, parseTags } from '../../lib/tags'
import type { Account, Category, Transaction } from '../../types'
import { CategoryIcon } from '../CategoryIcon'
import { Button, IconButton } from '../ui/Button'
import { Kbd } from '../ui/Badge'
import { useToast } from '../ui/toast-context'
import { amountClass, signedAmount, titleOf, type Lookup } from './display'
import { SourceBadge } from './SourceBadge'

interface Props {
  transaction: Transaction
  categories: Category[]
  accounts: Account[]
  lookup: Lookup
  onClose: () => void
  onDelete: (t: Transaction) => void
  /** 在右侧面板中显示时带标题栏；在弹窗中显示时由弹窗提供标题 */
  variant: 'panel' | 'dialog'
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

/**
 * 流水详情与编辑（D01 右侧面板 / 移动端弹窗）。
 * ⌘S / Ctrl+S 保存，Esc 关闭；支出和收入可以互换，转账可改转出 / 转入账户。
 */
export function TransactionDetail({ transaction: t, categories, accounts, lookup, onClose, onDelete, variant }: Props) {
  const toast = useToast()
  const formRef = useRef<HTMLFormElement>(null)
  const isTransfer = t.type === 'transfer'
  const [type, setType] = useState(t.type)
  const [amount, setAmount] = useState(() => centsToInput(t.amount))
  const [categoryId, setCategoryId] = useState(t.categoryId)
  const [accountId, setAccountId] = useState(t.accountId)
  const [toAccountId, setToAccountId] = useState(t.transferAccountId)
  const [date, setDate] = useState(t.date)
  const [time, setTime] = useState(t.time ?? '')
  const [merchant, setMerchant] = useState(t.merchant ?? '')
  const [tags, setTags] = useState(() => formatTags(t.tags))
  const [note, setNote] = useState(t.note ?? '')
  const [excluded, setExcluded] = useState(!!t.excluded)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // 归档的分类 / 账户不再可选，但这笔记录当前用的仍然显示
  const categoryOptions = categories.filter((c) => c.type === type && (!c.archived || c.id === t.categoryId))
  const accountOptions = accounts.filter(
    (a) => !a.archived || a.id === t.accountId || a.id === t.transferAccountId,
  )
  const selectedCategory = categoryOptions.some((c) => c.id === categoryId) ? categoryId : categoryOptions[0]?.id

  // ⌘S / Ctrl+S 保存
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // 面板模式下，记一笔弹窗打开时不抢快捷键
      if (variant === 'panel' && document.querySelector('[role="dialog"]')) return
      if (e.key.toLowerCase() === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        formRef.current?.requestSubmit()
      } else if (e.key === 'Escape' && variant === 'panel') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, variant])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (t.id === undefined) return
    const result = evaluateAmount(amount)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (isTransfer && accountId === toAccountId) {
      setError('转出和转入账户不能相同')
      return
    }
    if (!isTransfer && selectedCategory === undefined) {
      setError('请选择分类')
      return
    }
    const tagList = parseTags(tags)
    const patch: TransactionPatch = {
      type,
      amount: result.cents,
      accountId,
      date,
      time: time || undefined,
      merchant: merchant.trim() || undefined,
      note: note.trim() || undefined,
      tags: tagList.length > 0 ? tagList : undefined,
      excluded: !isTransfer && excluded ? true : undefined,
      ...(isTransfer ? { transferAccountId: toAccountId } : { categoryId: selectedCategory }),
    }
    setSaving(true)
    try {
      await updateTransaction(db, t.id, patch)
      setError('')
      toast.show({ message: '已保存' })
      if (variant === 'dialog') onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const accountSelect = (label: string, value: number | undefined, onChange: (id: number) => void) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <select className="input" value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))}>
        {accountOptions.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <form ref={formRef} className={`tx-detail tx-detail-${variant}`} onSubmit={handleSubmit} aria-label="流水详情">
      {variant === 'panel' && (
        <header className="tx-detail-header">
          <h2 className="t-title-s">流水详情</h2>
          <IconButton label="关闭详情" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
      )}

      <div className="tx-detail-summary">
        <CategoryIcon category={lookup.category(t.categoryId)} transfer={isTransfer} size={44} />
        <div>
          <p className={`t-num-l ${amountClass(t)}`}>{signedAmount(t)}</p>
          <p className="t-caption text-tertiary">{titleOf(t, lookup)}</p>
        </div>
      </div>

      <div className="tx-detail-fields">
        {!isTransfer && (
          <div className="segmented" role="radiogroup" aria-label="收支类型">
            {(['expense', 'income'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={type === value}
                className="segmented-item"
                onClick={() => setType(value)}
              >
                {value === 'expense' ? '支出' : '收入'}
              </button>
            ))}
          </div>
        )}
        <label className="field">
          <span className="field-label">金额（元）</span>
          <input
            className="input t-num-m"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(normalizeExpression(e.target.value))}
          />
        </label>
        {isTransfer ? (
          <div className="field-row">
            {accountSelect('转出账户', accountId, setAccountId)}
            {accountSelect('转入账户', toAccountId, setToAccountId)}
          </div>
        ) : (
          <div className="field-row">
            <label className="field">
              <span className="field-label">分类</span>
              <select className="input" value={selectedCategory ?? ''} onChange={(e) => setCategoryId(Number(e.target.value))}>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {accountSelect('账户', accountId, setAccountId)}
          </div>
        )}
        <div className="field-row">
          <label className="field">
            <span className="field-label">日期</span>
            <input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">时间</span>
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="field-label">商户</span>
          <input className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="如：盒马鲜生" />
        </label>
        <label className="field">
          <span className="field-label">标签</span>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#家庭 #周末" />
        </label>
        <label className="field">
          <span className="field-label">备注</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {!isTransfer && (
          <label className="check-field t-body-s" title="本人账户之间挪钱等：不计入收入、支出、预算和分析；钱包账单导入的也不计入账户余额">
            <input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} />
            不计收支（本人账户间挪钱等）
          </label>
        )}
        <div className="field">
          <span className="field-label">来源</span>
          <div className="tx-detail-source t-caption text-tertiary">
            <SourceBadge source={t.source} />
            {t.importBatchId !== undefined && <span>批次 #{t.importBatchId}</span>}
          </div>
        </div>
        {t.externalId && (
          <div className="field">
            <span className="field-label">交易单号</span>
            <span className="tx-detail-ref t-caption text-tertiary">{t.externalId}</span>
          </div>
        )}
        {t.merged && t.merged.length > 0 && (
          <div className="field">
            <span className="field-label">合并的流水</span>
            <ul className="tx-detail-merged">
              {t.merged.map((m, i) => (
                <li key={i} className="t-caption text-secondary">
                  <span className="text-tertiary">{m.label}</span> {m.date}
                  {m.time && ` ${m.time}`}
                  {m.account && ` · ${m.account}`}
                  {[m.merchant, m.note].filter(Boolean).length > 0 && ` · ${[m.merchant, m.note].filter(Boolean).join(' / ')}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {error && (
        <p className="form-error t-body-s" role="alert">
          {error}
        </p>
      )}

      <div className="tx-detail-actions">
        <Button variant="danger" onClick={() => onDelete(t)}>
          删除
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          保存
          <Kbd>{isMac ? '⌘S' : 'Ctrl S'}</Kbd>
        </Button>
      </div>
    </form>
  )
}
