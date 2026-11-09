import { useLiveQuery } from 'dexie-react-hooks'
import { CircleCheck, Hash, Plus, Store } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { PageHeader } from '../components/layout/AppShell'
import { ManageRow } from '../components/manage/ManageRow'
import { MerchantTagEditor } from '../components/tags/MerchantTagEditor'
import { TagAssignDialog } from '../components/tags/TagAssignDialog'
import { TagChips } from '../components/tags/TagChips'
import { TagPicker } from '../components/tags/TagPicker'
import { useTags } from '../components/tags/useTags'
import { makeLookup, type Lookup } from '../components/transactions/display'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { Segmented } from '../components/ui/Segmented'
import { useToast } from '../components/ui/toast-context'
import { db } from '../db'
import { addTag, deleteTag, moveTag, renameTag, setMerchantTags } from '../db/tags'
import { merchantOf } from '../lib/merchant'
import { formatCents } from '../lib/money'
import { untaggedGroups, type TagResolver, type UntaggedGroup } from '../lib/tags'
import type { Account, Category, Tag, TagRule, Transaction } from '../types'

interface Props {
  categories: Category[]
  accounts: Account[]
}

type Tab = 'untagged' | 'merchants' | 'tags'

/** 待标注列表一次显示多少组 */
const PAGE = 30

/**
 * 标签页：
 * - 待标注：还没有标签的收支按商户归组，整组打成商户标签（以后导入的同商户也生效），或勾选几笔单独打
 * - 商户标签：哪些商户打了什么标签
 * - 标签：内置和自建的标签目录，改名 / 删除会同步到流水和商户标签
 */
export function TagsPage({ categories, accounts }: Props) {
  const { tags, rules, resolve } = useTags()
  const transactions = useLiveQuery(() => db.transactions.toArray(), [], [] as Transaction[])
  const lookup = useMemo(() => makeLookup(categories, accounts, resolve), [categories, accounts, resolve])
  const groups = useMemo(() => untaggedGroups(transactions, resolve), [transactions, resolve])
  const untaggedCount = groups.reduce((n, g) => n + g.rows.length, 0)
  const [tab, setTab] = useState<Tab>('untagged')

  return (
    <div className="page tags-page">
      <PageHeader title="标签" />
      <Segmented<Tab>
        label="标签页面"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'untagged', label: `待标注 ${untaggedCount}` },
          { value: 'merchants', label: `商户标签 ${rules.length}` },
          { value: 'tags', label: `标签 ${tags.length}` },
        ]}
      />
      {tab === 'untagged' && <UntaggedPanel groups={groups} count={untaggedCount} tags={tags} lookup={lookup} />}
      {tab === 'merchants' && <MerchantPanel transactions={transactions} tags={tags} rules={rules} />}
      {tab === 'tags' && <TagCatalogPanel tags={tags} transactions={transactions} resolve={resolve} />}
    </div>
  )
}

function UntaggedPanel({
  groups,
  count,
  tags,
  lookup,
}: {
  groups: UntaggedGroup[]
  count: number
  tags: Tag[]
  lookup: Lookup
}) {
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState<UntaggedGroup>()
  const total = groups.reduce((sum, g) => sum + g.expense + g.income, 0)

  if (groups.length === 0) {
    return (
      <section className="card empty-state">
        <CircleCheck size={40} aria-hidden="true" />
        <p className="t-body-m text-secondary">所有收支都有标签了</p>
        <p className="t-body-s text-tertiary">以后导入的账单，打过商户标签的会自动带上。</p>
      </section>
    )
  }

  return (
    <>
      <p className="t-body-s text-secondary">
        还有 {count} 笔收支没有标签，共 {formatCents(total)}，按商户归在 {groups.length} 组。给商户打标签后，这个商户以后导入的账单也会自动带上。
      </p>
      <ul className="card manage-list" aria-label="待标注的商户">
        {groups.slice(0, limit).map((g) => (
          <ManageRow
            key={g.merchant ?? ''}
            label={g.merchant ?? '没有商户的流水'}
            icon={
              <span className="tag-row-icon" aria-hidden="true">
                <Store size={18} />
              </span>
            }
            title={g.merchant ?? '没有商户和备注'}
            subtitle={`${g.rows.length} 笔 · 最近 ${g.lastDate}`}
            value={
              <span className="tag-group-amount t-num-s">
                {g.expense > 0 && <span className="amount-expense">-{formatCents(g.expense)}</span>}
                {g.income > 0 && <span className="amount-income">+{formatCents(g.income)}</span>}
              </span>
            }
            onOpen={() => setOpen(g)}
          />
        ))}
      </ul>
      {groups.length > limit && (
        <Button block onClick={() => setLimit((n) => n + PAGE)}>
          再显示 {Math.min(PAGE, groups.length - limit)} 组（共 {groups.length} 组）
        </Button>
      )}
      {open && <TagAssignDialog key={open.merchant ?? ''} group={open} tags={tags} lookup={lookup} onClose={() => setOpen(undefined)} />}
    </>
  )
}

function MerchantPanel({ transactions, tags, rules }: { transactions: Transaction[]; tags: Tag[]; rules: TagRule[] }) {
  const toast = useToast()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [merchantDraft, setMerchantDraft] = useState('')
  const [tagDraft, setTagDraft] = useState<string[]>([])
  // 各商户的笔数，同时作为新增时的商户候选（按笔数从多到少）
  const merchantCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of transactions) {
      const m = merchantOf(t)
      if (m) counts.set(m, (counts.get(m) ?? 0) + 1)
    }
    return counts
  }, [transactions])
  const suggestions = useMemo(
    () =>
      [...merchantCounts]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 200)
        .map(([m]) => m),
    [merchantCounts],
  )

  function openNew() {
    setMerchantDraft('')
    setTagDraft([])
    setEditing('new')
  }

  async function saveNew(e: FormEvent) {
    e.preventDefault()
    try {
      await setMerchantTags(db, merchantDraft, tagDraft)
      toast.show({ message: `已给「${merchantDraft.trim()}」打上商户标签` })
      setEditing(null)
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : '保存失败' })
    }
  }

  return (
    <>
      <div className="tags-toolbar">
        <p className="t-body-s text-secondary">商户（没有商户时按备注）完全一致的流水都会带上商户标签，包括以后导入的。</p>
        <Button variant="primary" icon={<Plus size={18} aria-hidden="true" />} onClick={openNew}>
          新增商户标签
        </Button>
      </div>
      {rules.length === 0 ? (
        <section className="card empty-state t-body-s">
          <p>还没有商户标签。在「待标注」里给商户打标签，或在流水详情里勾选「设为商户标签」。</p>
        </section>
      ) : (
        <ul className="card manage-list" aria-label="商户标签">
          {rules.map((r) => (
            <ManageRow
              key={r.id}
              label={`商户 ${r.merchant} 的标签`}
              icon={
                <span className="tag-row-icon" aria-hidden="true">
                  <Store size={18} />
                </span>
              }
              title={r.merchant}
              subtitle={<TagChips tags={r.tags} />}
              value={<span className="t-caption text-tertiary">{merchantCounts.get(r.merchant) ?? 0} 笔</span>}
              onOpen={() => setEditing(r.merchant)}
            />
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} title={editing === 'new' ? '新增商户标签' : '商户标签'} onClose={() => setEditing(null)}>
        {editing === 'new' && (
          <form className="tag-assign" onSubmit={saveNew}>
            <label className="field">
              <span className="field-label">商户（或备注）</span>
              <input
                className="input"
                list="tag-merchant-suggestions"
                value={merchantDraft}
                onChange={(e) => setMerchantDraft(e.target.value)}
                placeholder="如：西山居万宝楼"
                data-autofocus
              />
              <datalist id="tag-merchant-suggestions">
                {suggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <TagPicker value={tagDraft} onChange={setTagDraft} options={tags} />
            <div className="tag-assign-actions">
              <Button onClick={() => setEditing(null)}>取消</Button>
              <Button type="submit" variant="primary" disabled={!merchantDraft.trim() || tagDraft.length === 0}>
                保存
              </Button>
            </div>
          </form>
        )}
        {editing !== null && editing !== 'new' && (
          <MerchantTagEditor key={editing} merchant={editing} onDone={() => setEditing(null)} />
        )}
      </Dialog>
    </>
  )
}

function TagCatalogPanel({
  tags,
  transactions,
  resolve,
}: {
  tags: Tag[]
  transactions: Transaction[]
  resolve: TagResolver
}) {
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<Tag | null>(null)
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 每个标签实际用在多少笔流水上（含沿用商户标签的）
  const usage = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of transactions) for (const tag of resolve(t)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return counts
  }, [transactions, resolve])

  async function add(e: FormEvent) {
    e.preventDefault()
    try {
      await addTag(db, draft)
      setDraft('')
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : '添加失败' })
    }
  }

  function open(tag: Tag) {
    setEditing(tag)
    setName(tag.name)
    setConfirmDelete(false)
  }

  async function rename(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    try {
      await renameTag(db, editing.id!, name)
      toast.show({ message: '已改名，流水和商户标签里的也一并改了' })
      setEditing(null)
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : '保存失败' })
    }
  }

  async function remove() {
    if (!editing) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    await deleteTag(db, editing.id!)
    toast.show({ message: `已删除 #${editing.name}` })
    setEditing(null)
  }

  return (
    <>
      <form className="tags-toolbar" onSubmit={add}>
        <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="新标签名，如：装修" aria-label="新标签名" />
        <Button type="submit" variant="primary" icon={<Plus size={18} aria-hidden="true" />} disabled={!draft.trim()}>
          新建标签
        </Button>
      </form>
      {tags.length === 0 ? (
        <section className="card empty-state t-body-s">
          <p>还没有标签。</p>
        </section>
      ) : (
        <ul className="card manage-list" aria-label="标签">
          {tags.map((tag, i) => (
            <ManageRow
              key={tag.id}
              label={`标签 ${tag.name}`}
              icon={
                <span className="tag-row-icon" aria-hidden="true">
                  <Hash size={18} />
                </span>
              }
              title={tag.name}
              value={<span className="t-caption text-tertiary">{usage.get(tag.name) ?? 0} 笔</span>}
              onOpen={() => open(tag)}
              onMoveUp={i > 0 ? () => void moveTag(db, tag.id!, -1) : undefined}
              onMoveDown={i < tags.length - 1 ? () => void moveTag(db, tag.id!, 1) : undefined}
            />
          ))}
        </ul>
      )}
      <p className="t-caption text-tertiary">
        标签与分类互补：分类说「是哪类开销」，标签说「具体花在哪」，比如万宝楼是 #游戏、转给房东的是 #房租。
      </p>
      <Dialog open={editing !== null} title="编辑标签" onClose={() => setEditing(null)}>
        {editing && (
          <form className="tag-assign" onSubmit={rename}>
            <label className="field">
              <span className="field-label">名称</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
            </label>
            <p className="t-caption text-tertiary">
              用在 {usage.get(editing.name) ?? 0} 笔流水上。改名会一并改掉流水和商户标签里的；改成已有的名字会合并两个标签。
            </p>
            <div className="tag-assign-actions">
              <Button variant="danger" onClick={() => void remove()}>
                {confirmDelete ? '确认删除' : '删除'}
              </Button>
              <Button type="submit" variant="primary" disabled={!name.trim() || name.trim() === editing.name}>
                保存
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  )
}
