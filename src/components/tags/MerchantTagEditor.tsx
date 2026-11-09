import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { db } from '../../db'
import { setMerchantTags } from '../../db/tags'
import { Button } from '../ui/Button'
import { useToast } from '../ui/toast-context'
import { TagChips } from './TagChips'
import { TagPicker } from './TagPicker'
import { useTags } from './useTags'

interface Props {
  merchant: string
  /** 紧凑模式：先显示一行现有商户标签，点「编辑」再展开 */
  compact?: boolean
  onDone?: () => void
}

/** 给一个商户打标签：这个商户的流水（包括以后导入的）都带上，单笔自己打了标签的除外 */
export function MerchantTagEditor({ merchant, compact = false, onDone }: Props) {
  const toast = useToast()
  const { tags, resolve } = useTags()
  const current = resolve.merchantTags(merchant) ?? []
  const [editing, setEditing] = useState(!compact)
  const [draft, setDraft] = useState<string[] | null>(null)
  const value = draft ?? current
  const [saving, setSaving] = useState(false)

  async function save(next: string[]) {
    setSaving(true)
    try {
      await setMerchantTags(db, merchant, next)
      toast.show({ message: next.length ? `「${merchant}」已打上 ${next.map((t) => `#${t}`).join(' ')}` : `已取消「${merchant}」的商户标签` })
      setDraft(null)
      if (compact) setEditing(false)
      onDone?.()
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="merchant-tags-line t-body-s">
        <span className="text-secondary">商户标签</span>
        {current.length > 0 ? <TagChips tags={current} /> : <span className="text-tertiary">未设置</span>}
        <Button variant="ghost" size="sm" icon={<Pencil size={14} aria-hidden="true" />} onClick={() => setEditing(true)}>
          {current.length > 0 ? '修改' : '打标签'}
        </Button>
      </div>
    )
  }

  return (
    <div className="merchant-tags-editor">
      <TagPicker label={`「${merchant}」的商户标签`} value={value} onChange={setDraft} options={tags} />
      <p className="t-caption text-tertiary">这个商户的流水都会带上这些标签，包括以后导入的；单笔自己打了标签的以单笔为准。</p>
      <div className="merchant-tags-actions">
        {compact && (
          <Button
            size="sm"
            onClick={() => {
              setDraft(null)
              setEditing(false)
            }}
          >
            取消
          </Button>
        )}
        {current.length > 0 && (
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => void save([])}>
            取消商户标签
          </Button>
        )}
        <Button size="sm" variant="primary" disabled={saving || draft === null || value.length === 0} onClick={() => void save(value)}>
          保存
        </Button>
      </div>
    </div>
  )
}
