import { Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { MAX_TAG_LENGTH, parseTags } from '../../lib/tags'
import type { Tag } from '../../types'

interface Props {
  value: readonly string[]
  onChange: (tags: string[]) => void
  /** 标签目录，点选即可 */
  options: readonly Tag[]
  label?: string
  /** 没选任何标签时的提示（如「沿用商户标签 #游戏」） */
  placeholder?: string
}

/**
 * 选标签：点目录里的标签切换选中，也可以输入新标签回车添加（多个用空格分隔）。
 * 不在目录里的（如刚输入的新标签）排在后面，也照常显示。
 */
export function TagPicker({ value, onChange, options, label = '标签', placeholder }: Props) {
  const inputId = useId()
  const [draft, setDraft] = useState('')
  const selected = new Set(value)
  // 按目录顺序，不在目录里的排在后面；选中时不挪位置，免得点错
  const names = [...new Set([...options.map((o) => o.name), ...value])]

  const toggle = (name: string) => onChange(selected.has(name) ? value.filter((v) => v !== name) : [...value, name])

  function addDraft() {
    const added = parseTags(draft).map((t) => t.slice(0, MAX_TAG_LENGTH))
    if (added.length === 0) return
    onChange([...new Set([...value, ...added])])
    setDraft('')
  }

  return (
    <div className="field tag-picker">
      <label className="field-label" htmlFor={inputId}>
        {label}
        {value.length === 0 && placeholder && <span className="tag-picker-hint text-tertiary"> · {placeholder}</span>}
      </label>
      <div className="tag-chips tag-picker-options" role="group" aria-label={`${label}：点选切换`}>
        {names.map((name) => (
          <button
            key={name}
            type="button"
            className="tag-chip"
            aria-pressed={selected.has(name)}
            onClick={() => toggle(name)}
          >
            #{name}
          </button>
        ))}
      </div>
      <div className="tag-picker-add">
        <input
          id={inputId}
          className="input"
          value={draft}
          placeholder="新标签，回车添加"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            addDraft()
          }}
        />
        <button type="button" className="btn btn-secondary btn-md" onClick={addDraft} disabled={!draft.trim()} aria-label="添加标签">
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
