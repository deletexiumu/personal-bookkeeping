import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/layout/AppShell'
import { CategoryIcon } from '../components/CategoryIcon'
import { CategoryForm } from '../components/manage/CategoryForm'
import { ManageRow } from '../components/manage/ManageRow'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { db } from '../db'
import { moveItem } from '../db/catalog'
import { categoryUsage } from '../db/transactions'
import type { Category, CategoryType } from '../types'

/** 分类管理：支出 / 收入两组，新增 / 编辑图标颜色 / 归档 / 排序 */
export function CategoriesPage({ categories }: { categories: Category[] }) {
  const [type, setType] = useState<CategoryType>('expense')
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const usage = useLiveQuery(() => categoryUsage(db), [], new Map<number, number>())
  const ofType = categories.filter((c) => c.type === type)
  const active = ofType.filter((c) => !c.archived)
  const archived = ofType.filter((c) => c.archived)

  const row = (c: Category, list: Category[], index: number) => (
    <ManageRow
      key={c.id}
      label={`分类 ${c.name}`}
      icon={<CategoryIcon category={c} />}
      title={c.name}
      subtitle={`${usage.get(c.id!) ?? 0} 笔`}
      onOpen={() => setEditing(c)}
      onMoveUp={index > 0 ? () => void moveItem(db, 'categories', c.id!, -1) : undefined}
      onMoveDown={index >= 0 && index < list.length - 1 ? () => void moveItem(db, 'categories', c.id!, 1) : undefined}
    />
  )

  return (
    <div className="page">
      <PageHeader
        title="分类"
        actions={
          <Button variant="primary" icon={<Plus size={18} aria-hidden="true" />} onClick={() => setEditing('new')}>
            新增分类
          </Button>
        }
      />
      <div className="segmented manage-tabs" role="radiogroup" aria-label="收支类型">
        {(['expense', 'income'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            className="segmented-item"
            onClick={() => setType(t)}
          >
            {t === 'expense' ? '支出' : '收入'}
          </button>
        ))}
      </div>
      <ul className="card manage-list" aria-label={`${type === 'expense' ? '支出' : '收入'}分类`}>
        {active.map((c, i) => row(c, active, i))}
      </ul>
      {archived.length > 0 && (
        <section className="settings-group">
          <h2 className="t-caption text-tertiary settings-group-title">
            已归档 <Badge>{archived.length}</Badge>
          </h2>
          <ul className="card manage-list" aria-label="已归档分类">
            {archived.map((c) => row(c, archived, -1))}
          </ul>
        </section>
      )}
      <p className="t-caption text-tertiary">记一笔时分类按使用次数排序；这里的顺序决定次数相同时的先后。</p>
      <Dialog open={editing !== null} title={editing === 'new' ? '新增分类' : '编辑分类'} onClose={() => setEditing(null)}>
        {editing !== null && (
          <CategoryForm
            category={editing === 'new' ? undefined : editing}
            type={type}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
    </div>
  )
}
