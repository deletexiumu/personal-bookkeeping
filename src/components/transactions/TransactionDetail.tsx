import { X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { db } from '../../db'
import { setMerchantTags } from '../../db/tags'
import { updateTransaction, type TransactionPatch } from '../../db/transactions'
import { evaluateAmount, normalizeExpression } from '../../lib/expression'
import { formatCents } from '../../lib/money'
import { merchantOf } from '../../lib/merchant'
import { formatTags, normalizeTags } from '../../lib/tags'
import type { Account, Category, Transaction } from '../../types'
import { CategoryIcon } from '../CategoryIcon'
import { PlanLink } from '../plans/PlanLink'
import { TagPicker } from '../tags/TagPicker'
import { useTags } from '../tags/useTags'
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
  const [tags, setTags] = useState<string[]>(() => t.tags ?? [])
  // 勾选后，选的标签存为整个商户的标签（这一笔不再单独打标签，沿用商户标签）
  const [forMerchant, setForMerchant] = useState(false)
  const tagData = useTags()
  const [note, setNote] = useState(t.note ?? '')
  const [excluded, setExcluded] = useState(!!t.excluded)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const merchantKey = merchantOf({ merchant: merchant.trim() || undefined, goods: t.goods, note: note.trim() || undefined })
  const inheritedTags = tagData.resolve.merchantTags(merchantKey)

  // 归档的分类 / 账户不再可选，但这笔记录当前用的仍然显示
  const categoryOptions = categories.filter((c) => c.type === type && (!c.archived || c.id === t.categoryId))
  const accountOptions = accounts.filter(
    (a) => !a.archived || a.id === t.accountId || a.id === t.transferAccountId,
  )
  // 没有分类（导入时没认出来）或换了收支类型时显示「未分类」，不默认选第一个，免得一保存就被归到别的分类
  const selectedCategory = categoryOptions.some((c) => c.id === categoryId) ? categoryId : undefined

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
    // 原来就没分类的可以先保存别的改动（如标签、备注）；改了收支类型的要重新选分类
    if (!isTransfer && selectedCategory === undefined && (t.categoryId !== undefined || type !== t.type)) {
      setError('请选择分类')
      return
    }
    const tagList = normalizeTags(tags)
    const saveForMerchant = forMerchant && !!merchantKey && !!tagList
    const patch: TransactionPatch = {
      type,
      amount: result.cents,
      accountId,
      date,
      time: time || undefined,
      merchant: merchant.trim() || undefined,
      note: note.trim() || undefined,
      tags: saveForMerchant ? undefined : tagList,
      excluded: !isTransfer && excluded ? true : undefined,
      ...(isTransfer ? { transferAccountId: toAccountId } : { categoryId: selectedCategory }),
    }
    setSaving(true)
    try {
      await updateTransaction(db, t.id, patch)
      if (saveForMerchant) await setMerchantTags(db, merchantKey, tagList)
      setError('')
      setForMerchant(false)
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
                {selectedCategory === undefined && (
                  <option value="" disabled>
                    未分类
                  </option>
                )}
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
        {t.goods && (
          <div className="field">
            <span className="field-label">商品说明</span>
            <span className="tx-detail-goods t-body-m">{t.goods}</span>
          </div>
        )}
        <TagPicker
          value={tags}
          onChange={setTags}
          options={tagData.tags}
          placeholder={inheritedTags ? `沿用商户标签 ${formatTags(inheritedTags)}` : '还没有标签'}
        />
        {merchantKey && (
          <label className="check-field t-body-s" title="这个商户的流水都带上这些标签，包括以后导入的；单笔自己打了标签的以单笔为准">
            <input
              type="checkbox"
              checked={forMerchant}
              disabled={tags.length === 0}
              onChange={(e) => setForMerchant(e.target.checked)}
            />
            设为「{merchantKey}」的商户标签（同商户的都生效，含以后导入的）
          </label>
        )}
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
        {!isTransfer && <PlanLink transaction={t} />}
        <div className="field">
          <span className="field-label">来源</span>
          <div className="tx-detail-source t-caption text-tertiary">
            <SourceBadge source={t.source} />
            {t.importBatchId !== undefined && <span>批次 #{t.importBatchId}</span>}
          </div>
        </div>
        {(t.externalId || t.merchantOrderNo || t.payMethod) && (
          <dl className="tx-detail-bill t-caption">
            {t.externalId && (
              <>
                <dt className="text-tertiary">订单号</dt>
                <dd className="tx-detail-ref text-secondary">{t.externalId}</dd>
              </>
            )}
            {t.merchantOrderNo && (
              <>
                <dt className="text-tertiary">商户单号</dt>
                <dd className="tx-detail-ref text-secondary">{t.merchantOrderNo}</dd>
              </>
            )}
            {t.payMethod && (
              <>
                <dt className="text-tertiary">付款方式</dt>
                <dd className="text-secondary">{t.payMethod}</dd>
              </>
            )}
          </dl>
        )}
        {t.merged && t.merged.length > 0 && (
          <div className="field">
            <span className="field-label">合并的流水</span>
            <ul className="tx-detail-merged">
              {t.merged.map((m, i) => (
                <li key={i} className="t-caption text-secondary">
                  <span className="text-tertiary">{m.refund ? `退款 ${formatCents(m.amount ?? 0)} · ${m.label}` : m.label}</span> {m.date}
                  {m.time && ` ${m.time}`}
                  {m.account && ` · ${m.account}`}
                  {[m.merchant, m.note].filter(Boolean).length > 0 && ` · ${[m.merchant, m.note].filter(Boolean).join(' / ')}`}
                  {m.ref && <span className="tx-detail-ref text-tertiary"> · 单号 {m.ref}</span>}
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
