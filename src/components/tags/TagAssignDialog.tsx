import { useState } from 'react'
import { db } from '../../db'
import { setMerchantTags, setTransactionTags } from '../../db/tags'
import { formatTags, type UntaggedGroup } from '../../lib/tags'
import type { Tag } from '../../types'
import { amountClass, signedAmount, titleOf, type Lookup } from '../transactions/display'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Segmented } from '../ui/Segmented'
import { useToast } from '../ui/toast-context'
import { TagPicker } from './TagPicker'

interface Props {
  group: UntaggedGroup
  tags: Tag[]
  lookup: Lookup
  onClose: () => void
}

type Scope = 'merchant' | 'selected'

/**
 * 给待标注的一组流水打标签：整个商户（以后导入的同商户流水也带上），或只给勾选的几笔打单笔标签。
 * 没有商户也没有备注的只能逐笔打。
 */
export function TagAssignDialog({ group, tags, lookup, onClose }: Props) {
  const toast = useToast()
  const { merchant } = group
  const [scope, setScope] = useState<Scope>(merchant ? 'merchant' : 'selected')
  const [value, setValue] = useState<string[]>([])
  const [checked, setChecked] = useState(() => new Set(group.rows.map((t) => t.id!)))
  const [saving, setSaving] = useState(false)
  const title = merchant ? `给「${merchant}」打标签` : '给没有商户的流水打标签'
  const allChecked = checked.size === group.rows.length

  async function save() {
    setSaving(true)
    try {
      if (scope === 'merchant' && merchant) {
        await setMerchantTags(db, merchant, value)
        toast.show({ message: `「${merchant}」的 ${group.rows.length} 笔已打上 ${formatTags(value)}，以后导入的也会带上` })
      } else {
        await setTransactionTags(db, [...checked], value, 'add')
        toast.show({ message: `已给 ${checked.size} 笔打上 ${formatTags(value)}` })
      }
      onClose()
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  const toggle = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Dialog open title={title} onClose={onClose}>
      <div className="tag-assign">
        {merchant && (
          <Segmented<Scope>
            label="打标签的范围"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'merchant', label: `整个商户（${group.rows.length} 笔及以后的）` },
              { value: 'selected', label: '只标勾选的' },
            ]}
          />
        )}
        <TagPicker value={value} onChange={setValue} options={tags} />
        {scope === 'merchant' ? (
          <p className="t-caption text-tertiary">
            存为商户标签：这个商户现在和以后导入的流水都会带上；之后某一笔单独改了标签，以单笔为准。
          </p>
        ) : (
          <div className="tag-assign-rows">
            <label className="check-field t-body-s">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={() => setChecked(allChecked ? new Set() : new Set(group.rows.map((t) => t.id!)))}
              />
              全选（已选 {checked.size} / {group.rows.length} 笔）
            </label>
            <ul className="tag-assign-list" aria-label="要打标签的流水">
              {group.rows.map((t) => (
                <li key={t.id}>
                  <label className="tag-assign-row">
                    <input type="checkbox" checked={checked.has(t.id!)} onChange={() => toggle(t.id!)} />
                    <span className="tag-assign-main">
                      <span className="t-body-s">{titleOf(t, lookup)}</span>
                      <span className="t-caption text-tertiary">
                        {[t.date, t.time, merchant ? t.note : undefined].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className={`t-num-s ${amountClass(t)}`}>{signedAmount(t)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="tag-assign-actions">
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            disabled={saving || value.length === 0 || (scope === 'selected' && checked.size === 0)}
            onClick={() => void save()}
          >
            {scope === 'merchant' ? '设为商户标签' : `给 ${checked.size} 笔打标签`}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
