import { useState, type FormEvent } from 'react'
import { db } from '../../db'
import { deleteRule, saveRule } from '../../db/rules'
import { describeRule, RULE_FIELD_LABELS, RULE_MATCH_LABELS } from '../../lib/import/rules'
import type { Category, CategoryRule, RuleField, RuleMatch } from '../../types'
import { Button } from '../ui/Button'

interface Props {
  /** 不传表示新增 */
  rule?: CategoryRule
  categories: Category[]
  onDone: () => void
}

/** 新增 / 编辑分类规则：匹配字段 + 匹配方式 + 关键词 → 分类 */
export function RuleForm({ rule, categories, onDone }: Props) {
  const usable = categories.filter((c) => !c.archived || c.id === rule?.categoryId)
  const [field, setField] = useState<RuleField>(rule?.field ?? 'any')
  const [match, setMatch] = useState<RuleMatch>(rule?.match ?? 'contains')
  const [keyword, setKeyword] = useState(rule?.keyword ?? '')
  const [categoryId, setCategoryId] = useState<number | undefined>(rule?.categoryId ?? usable[0]?.id)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (categoryId === undefined) return setError('请选择分类')
    try {
      await saveRule(db, { ...rule, field, match, keyword, categoryId })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  async function handleDelete() {
    if (rule?.id === undefined || !confirm(`确定删除规则「${describeRule(rule)}」吗？`)) return
    await deleteRule(db, rule.id)
    onDone()
  }

  const group = (type: Category['type']) => usable.filter((c) => c.type === type)

  return (
    <form className="form" onSubmit={handleSubmit} aria-label={rule ? '编辑规则' : '新增规则'}>
      <div className="field-row">
        <label className="field">
          <span className="field-label">匹配字段</span>
          <select className="input" value={field} onChange={(e) => setField(e.target.value as RuleField)}>
            {(Object.keys(RULE_FIELD_LABELS) as RuleField[]).map((f) => (
              <option key={f} value={f}>
                {RULE_FIELD_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">匹配方式</span>
          <select className="input" value={match} onChange={(e) => setMatch(e.target.value as RuleMatch)}>
            {(Object.keys(RULE_MATCH_LABELS) as RuleMatch[]).map((m) => (
              <option key={m} value={m}>
                {RULE_MATCH_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="field-label">关键词</span>
        <input
          data-autofocus
          className="input"
          value={keyword}
          maxLength={40}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="如：星巴克"
          required
        />
      </label>
      <label className="field">
        <span className="field-label">归到分类</span>
        <select className="input" value={categoryId ?? ''} onChange={(e) => setCategoryId(Number(e.target.value))}>
          <optgroup label="支出">
            {group('expense').map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="收入">
            {group('income').map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <p className="t-caption text-tertiary">不区分大小写；规则只作用于与分类收支方向一致的流水，导入时优先于历史同商户和内置关键词。</p>
      {error && (
        <p className="form-error t-body-s" role="alert">
          {error}
        </p>
      )}
      <div className="manage-actions">
        {rule && (
          <Button variant="danger" onClick={() => void handleDelete()}>
            删除
          </Button>
        )}
        <Button type="submit" variant="primary">
          保存
        </Button>
      </div>
    </form>
  )
}
