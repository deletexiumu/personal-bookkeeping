import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/layout/AppShell'
import { CategoryIcon } from '../components/CategoryIcon'
import { ManageRow } from '../components/manage/ManageRow'
import { RuleForm } from '../components/manage/RuleForm'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { db } from '../db'
import { listRules, moveRule } from '../db/rules'
import { describeRule } from '../lib/import/rules'
import type { Category, CategoryRule } from '../types'

/** 规则：导入时按商户 / 备注关键词自动分类，按顺序匹配 */
export function RulesPage({ categories }: { categories: Category[] }) {
  const rules = useLiveQuery(() => listRules(db), [], [])
  const [editing, setEditing] = useState<CategoryRule | 'new' | null>(null)
  const byId = new Map(categories.map((c) => [c.id, c]))

  return (
    <div className="page">
      <PageHeader
        title="规则"
        actions={
          <Button variant="primary" icon={<Plus size={18} aria-hidden="true" />} onClick={() => setEditing('new')}>
            新增规则
          </Button>
        }
      />
      {rules.length === 0 ? (
        <section className="card empty-state t-body-s">
          <p>还没有规则。导入预览中改分类时勾选「记住」，或在这里新增。</p>
        </section>
      ) : (
        <ul className="card manage-list" aria-label="分类规则">
          {rules.map((rule, i) => {
            const category = byId.get(rule.categoryId)
            return (
              <ManageRow
                key={rule.id}
                label={`规则 ${describeRule(rule)}`}
                icon={<CategoryIcon category={category} />}
                title={describeRule(rule)}
                subtitle={`→ ${category ? `${category.type === 'income' ? '收入' : '支出'} · ${category.name}` : '分类已删除'}`}
                onOpen={() => setEditing(rule)}
                onMoveUp={i > 0 ? () => void moveRule(db, rule.id!, -1) : undefined}
                onMoveDown={i < rules.length - 1 ? () => void moveRule(db, rule.id!, 1) : undefined}
              />
            )
          })}
        </ul>
      )}
      <p className="t-caption text-tertiary">导入时从上到下匹配，第一条命中的规则生效；优先级高于文件里的分类、历史同商户和内置关键词。</p>
      <Dialog open={editing !== null} title={editing === 'new' ? '新增规则' : '编辑规则'} onClose={() => setEditing(null)}>
        {editing !== null && (
          <RuleForm rule={editing === 'new' ? undefined : editing} categories={categories} onDone={() => setEditing(null)} />
        )}
      </Dialog>
    </div>
  )
}
