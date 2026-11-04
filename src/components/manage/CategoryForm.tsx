import { useState, type FormEvent } from 'react'
import { db } from '../../db'
import { deleteCategory, saveCategory } from '../../db/catalog'
import type { Category, CategoryType, Tone } from '../../types'
import { TonePreview } from '../CategoryIcon'
import { CATEGORY_ICONS, categoryVisual, TONES } from '../icons'
import { Button } from '../ui/Button'

interface Props {
  /** 不传表示新增 */
  category?: Category
  /** 新增时的收支类型 */
  type: CategoryType
  onDone: () => void
}

const TONE_LABEL: Record<Tone, string> = {
  orange: '橙',
  red: '红',
  blue: '蓝',
  cyan: '青',
  green: '绿',
  purple: '紫',
  gray: '灰',
}

/** 新增 / 编辑分类：名称、图标、颜色、归档；没有流水使用时可删除 */
export function CategoryForm({ category, type, onDone }: Props) {
  const initial = categoryVisual(category)
  const initialIcon = Object.entries(CATEGORY_ICONS).find(([, Icon]) => Icon === initial.icon)?.[0] ?? 'ellipsis'
  const [name, setName] = useState(category?.name ?? '')
  const [icon, setIcon] = useState(category?.icon ?? (category ? initialIcon : 'ellipsis'))
  const [color, setColor] = useState<Tone>(category?.color ?? (category ? initial.tone : 'blue'))
  const [archived, setArchived] = useState(category?.archived ?? false)
  const [error, setError] = useState('')
  const categoryType = category?.type ?? type

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      await saveCategory(db, { ...category, name, type: categoryType, icon, color, archived: archived || undefined })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  async function handleDelete() {
    if (category?.id === undefined || !confirm(`确定删除分类「${category.name}」吗？`)) return
    try {
      await deleteCategory(db, category.id)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} aria-label={category ? '编辑分类' : '新增分类'}>
      <div className="manage-preview">
        <TonePreview visual={{ icon: CATEGORY_ICONS[icon], tone: color }} size={48} />
        <span className="t-title-s">{name.trim() || '分类名称'}</span>
        <span className="t-caption text-tertiary">{categoryType === 'expense' ? '支出' : '收入'}</span>
      </div>
      <label className="field">
        <span className="field-label">名称</span>
        <input
          data-autofocus
          className="input"
          value={name}
          maxLength={12}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：宠物"
          required
        />
      </label>
      <fieldset className="field">
        <legend className="field-label">图标</legend>
        <div className="icon-grid">
          {Object.entries(CATEGORY_ICONS).map(([key, Icon]) => (
            <button
              key={key}
              type="button"
              className="icon-option"
              aria-label={`图标 ${key}`}
              aria-pressed={icon === key}
              onClick={() => setIcon(key)}
            >
              <Icon size={20} aria-hidden="true" />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend className="field-label">颜色</legend>
        <div className="tone-row">
          {TONES.map((tone) => (
            <button
              key={tone}
              type="button"
              className={`tone-option tone-${tone}`}
              aria-label={`${TONE_LABEL[tone]}色`}
              aria-pressed={color === tone}
              onClick={() => setColor(tone)}
            />
          ))}
        </div>
      </fieldset>
      {category && (
        <label className="check-field t-body-s">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          归档（不再出现在记一笔中，历史流水保留）
        </label>
      )}
      {error && (
        <p className="form-error t-body-s" role="alert">
          {error}
        </p>
      )}
      <div className="manage-actions">
        {category && (
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
