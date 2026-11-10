import { useState, type FormEvent } from 'react'
import { db } from '../../db'
import { deletePlan, savePlan, type PlanInput } from '../../db/plans'
import { today } from '../../lib/date'
import { formatCents, parseAmountToCents } from '../../lib/money'
import { DEFAULT_PLAN_WINDOW, MAX_PLAN_WINDOW, parsePlanKeywords, REPEAT_LABELS, repeatText } from '../../lib/plans'
import type { Account, Category, CategoryType, Plan, PlanRepeat } from '../../types'
import { CategoryIcon } from '../CategoryIcon'
import { TagPicker } from '../tags/TagPicker'
import { useTags } from '../tags/useTags'
import { Button } from '../ui/Button'
import { Segmented } from '../ui/Segmented'
import { useToast } from '../ui/toast-context'

interface Props {
  /** 不传表示新建；draft 用来预填（如从记一笔转过来） */
  plan?: Plan
  draft?: Partial<PlanInput>
  categories: Category[]
  accounts: Account[]
  onDone: () => void
}

function centsToInput(cents: number | undefined): string {
  return cents ? (cents / 100).toFixed(2).replace(/\.00$/, '') : ''
}

const REPEATS = Object.keys(REPEAT_LABELS) as PlanRepeat[]

/**
 * 新建 / 编辑预算账单：名称、收支、金额、分类、账户、重复规则，以及对实际账单时用的关键字和容差。
 * 保存后对开始日期以来已有的流水回溯匹配。
 */
export function PlanForm({ plan, draft, categories, accounts, onDone }: Props) {
  const toast = useToast()
  const base = plan ?? draft
  const { tags: tagOptions } = useTags()
  const [type, setType] = useState<CategoryType>(base?.type ?? 'expense')
  const [name, setName] = useState(base?.name ?? '')
  const [amount, setAmount] = useState(() => centsToInput(base?.amount))
  const [categoryId, setCategoryId] = useState<number | undefined>(base?.categoryId)
  const [accountId, setAccountId] = useState<number | undefined>(base?.accountId)
  const [startDate, setStartDate] = useState(base?.startDate ?? today())
  const [repeat, setRepeat] = useState<PlanRepeat>(base?.repeat ?? 'monthly')
  const [every, setEvery] = useState(String(base?.interval ?? 1))
  const [endDate, setEndDate] = useState(base?.endDate ?? '')
  const [keywords, setKeywords] = useState((base?.keywords ?? []).join(' '))
  const [tolerance, setTolerance] = useState(String(base?.tolerance ?? 0))
  const [windowDays, setWindowDays] = useState(String(base?.window ?? DEFAULT_PLAN_WINDOW))
  const [note, setNote] = useState(base?.note ?? '')
  const [tags, setTags] = useState<string[]>(base?.tags ?? [])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const categoryOptions = categories.filter((c) => c.type === type && (!c.archived || c.id === categoryId))
  const accountOptions = accounts.filter((a) => !a.archived || a.id === accountId)
  const category = categoryOptions.find((c) => c.id === categoryId)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const cents = parseAmountToCents(amount)
    if (cents === null) {
      setError('请输入正确的金额，最多两位小数')
      return
    }
    const everyN = Number(every)
    const tol = Number(tolerance)
    const win = Number(windowDays)
    if (repeat !== 'none' && (!Number.isInteger(everyN) || everyN < 1 || everyN > 99)) {
      setError('重复间隔应为 1–99 的整数')
      return
    }
    if (!Number.isFinite(tol) || tol < 0 || tol > 100) {
      setError('金额容差应在 0–100% 之间')
      return
    }
    if (!Number.isInteger(win) || win < 0 || win > MAX_PLAN_WINDOW) {
      setError(`日期容差应为 0–${MAX_PLAN_WINDOW} 天`)
      return
    }
    const input: PlanInput = {
      name,
      type,
      amount: cents,
      categoryId: category?.id,
      accountId,
      startDate,
      repeat,
      interval: everyN,
      endDate: endDate || undefined,
      keywords: parsePlanKeywords(keywords),
      tolerance: tol,
      window: win,
      note: note.trim() || undefined,
      tags,
    }
    setSaving(true)
    try {
      const { linked } = await savePlan(db, input, plan?.id, today())
      toast.show({
        message: `已保存预算「${name.trim()}」${linked > 0 ? `，${linked} 笔已有流水对上并转为实际` : ''}`,
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (plan?.id === undefined || !confirm(`确定删除预算「${plan.name}」吗？对应过它的流水会保留，只是不再关联。`)) return
    await deletePlan(db, plan.id)
    toast.show({ message: `已删除预算「${plan.name}」` })
    onDone()
  }

  const cents = parseAmountToCents(amount)
  const summary = repeatText({ repeat, interval: Number(every) || 1, startDate })

  return (
    <form className="form" onSubmit={handleSubmit} aria-label={plan ? '编辑预算账单' : '新建预算账单'}>
      <div className="manage-preview">
        <CategoryIcon category={category} size={48} />
        <span className="t-title-s">{name.trim() || '预算名称'}</span>
        <span className="t-caption text-tertiary">
          {summary}
          {cents !== null && ` · ${type === 'income' ? '+' : '-'}${formatCents(cents)}`}
        </span>
      </div>
      <Segmented<CategoryType>
        label="收支"
        value={type}
        onChange={(t) => {
          setType(t)
          setCategoryId(undefined)
        }}
        options={[
          { value: 'expense', label: '支出' },
          { value: 'income', label: '收入' },
        ]}
      />
      <div className="field-row">
        <label className="field">
          <span className="field-label">名称</span>
          <input
            data-autofocus
            className="input"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === 'income' ? '如：工资' : '如：房租'}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">每期金额（元）</span>
          <input className="input t-num-m" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span className="field-label">分类</span>
          <select className="input" value={category?.id ?? ''} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">不指定</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">账户</span>
          <select className="input" value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">不限</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span className="field-label">{repeat === 'none' ? '日期' : '第一期'}</span>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">重复</span>
          <select className="input" value={repeat} onChange={(e) => setRepeat(e.target.value as PlanRepeat)}>
            {REPEATS.map((r) => (
              <option key={r} value={r}>
                {REPEAT_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {repeat !== 'none' && (
        <div className="field-row">
          <label className="field">
            <span className="field-label">每隔（{REPEAT_LABELS[repeat].slice(1)}）</span>
            <input className="input t-num-m" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">结束日期</span>
            <input className="input" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
      )}
      <fieldset className="plan-match-fields">
        <legend className="t-caption text-tertiary">对实际账单</legend>
        <label className="field">
          <span className="field-label">关键字</span>
          <input
            className="input"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="商户或备注包含其一即对上，空格分隔，如：谢志英"
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field-label">金额容差（%）</span>
            <input className="input t-num-m" inputMode="decimal" value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">日期容差（天）</span>
            <input className="input t-num-m" inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
          </label>
        </div>
        <p className="t-caption text-tertiary">
          导入或记一笔时，同方向、日期和金额在容差内，且名称或关键字出现在商户 / 备注里的流水，自动转为这一期的实际；
          只有分类对得上的列为疑似，由你确认。水电这类金额不固定的可以把金额容差调大。
        </p>
      </fieldset>
      <label className="field">
        <span className="field-label">备注</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />
      </label>
      <TagPicker value={tags} onChange={setTags} options={tagOptions} />
      {error && (
        <p className="form-error t-body-s" role="alert">
          {error}
        </p>
      )}
      <div className="manage-actions">
        {plan && (
          <Button variant="danger" onClick={() => void handleDelete()}>
            删除
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={saving}>
          保存
        </Button>
      </div>
    </form>
  )
}
