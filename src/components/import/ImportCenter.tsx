import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, CircleHelp, Link2, Sheet, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { hrefOf } from '../../app/router'
import { db } from '../../db'
import { listImportBatches } from '../../db/imports'
import { deleteImportTemplate, listImportTemplates } from '../../db/rules'
import { FIELD_LABELS } from '../../lib/import/fields'
import type { ImportBatch, ImportSource } from '../../types'
import { TonePreview } from '../CategoryIcon'
import { Badge } from '../ui/Badge'
import { Button, IconButton } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { RevertDialog } from './RevertDialog'
import { SOURCES, sourceOf, type SourceDef } from './sources'

function formatStamp(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 导入中心（M04）：来源卡片、自动记账入口、导入记录 */
export function ImportCenter({ onStart }: { onStart: (source: ImportSource) => void }) {
  const batches = useLiveQuery(() => listImportBatches(db), [], [])
  const templates = useLiveQuery(() => listImportTemplates(db), [], [])
  const [guide, setGuide] = useState<SourceDef | null>(null)
  const [reverting, setReverting] = useState<ImportBatch | null>(null)

  return (
    <>
      <section className="import-hero">
        <h2 className="t-title-m">把账单交给我</h2>
        <p className="t-body-s text-secondary">自动识别格式 → 字段映射 → 去重 → 智能分类，确认后才入账。</p>
      </section>

      <section className="import-section" aria-labelledby="import-sources">
        <h2 id="import-sources" className="t-title-s">
          选择来源
        </h2>
        <ul className="source-grid">
          {SOURCES.map((source) => {
            const available = !source.upcoming
            return (
              <li key={source.id} className="card source-card" data-disabled={available ? undefined : ''}>
                <button
                  type="button"
                  className="source-open"
                  disabled={!available}
                  onClick={() => available && onStart(source.id as ImportSource)}
                >
                  <TonePreview visual={{ icon: source.icon, tone: source.tone }} />
                  <span className="t-body-m-strong">{source.name}</span>
                  <span className="t-caption text-tertiary">{source.hint}</span>
                </button>
                {source.upcoming && (
                  <span className="source-badge">
                    <Badge>{source.upcoming}</Badge>
                  </span>
                )}
                <IconButton label={`${source.name}导出教程`} className="source-help" onClick={() => setGuide(source)}>
                  <CircleHelp size={18} />
                </IconButton>
              </li>
            )
          })}
        </ul>
        <a href={hrefOf('api')} className="card source-auto">
          <TonePreview visual={{ icon: Link2, tone: 'blue' }} />
          <span className="source-auto-text">
            <span className="t-body-m-strong">自动记账</span>
            <span className="t-caption text-tertiary">开放接口 / iOS 快捷指令 / Webhook</span>
          </span>
          <ChevronRight size={18} aria-hidden="true" className="text-tertiary" />
        </a>
      </section>

      <section className="import-section" aria-labelledby="import-history">
        <h2 id="import-history" className="t-title-s">
          导入记录
        </h2>
        {batches.length === 0 ? (
          <p className="card import-empty t-body-s text-tertiary">还没有导入过账单。导入后可以在这里整批撤销。</p>
        ) : (
          <ul className="card manage-list">
            {batches.map((batch) => {
              const source = sourceOf(batch.source)
              const reverted = batch.status === 'reverted'
              return (
                <li key={batch.id} className="manage-row batch-row">
                  <TonePreview visual={{ icon: source.icon, tone: source.tone }} size={36} />
                  <div className="manage-main">
                    <span className="t-body-m">
                      {source.name} · {batch.fileName}
                    </span>
                    <span className="t-caption text-tertiary">
                      {formatStamp(batch.createdAt)} · {batch.rowCount} 条，入账 {batch.importedCount}{batch.mergedCount ? `，合并 ${batch.mergedCount}` : ''}
                    </span>
                  </div>
                  {reverted ? (
                    <Badge>已撤销</Badge>
                  ) : (
                    <>
                      <Badge tone="income">已入账</Badge>
                      <Button size="sm" variant="ghost" onClick={() => setReverting(batch)} aria-label={`撤销导入 ${batch.fileName}`}>
                        撤销
                      </Button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {templates.length > 0 && (
        <section className="import-section" aria-labelledby="import-templates">
          <h2 id="import-templates" className="t-title-s">
            我的映射模板
          </h2>
          <ul className="card manage-list">
            {templates.map((t) => (
              <li key={t.id} className="manage-row batch-row">
                <TonePreview visual={{ icon: Sheet, tone: 'orange' }} size={36} />
                <div className="manage-main">
                  <span className="t-body-m">{t.name}</span>
                  <span className="t-caption text-tertiary">
                    {t.headers.length} 列 · {t.columns.filter((c) => c !== 'ignore').map((c) => FIELD_LABELS[c].replace(/（.*）/, '')).join('、')}
                  </span>
                </div>
                <IconButton
                  label={`删除模板 ${t.name}`}
                  onClick={() => {
                    if (confirm(`确定删除模板「${t.name}」吗？`)) void deleteImportTemplate(db, t.id!)
                  }}
                >
                  <Trash2 size={18} />
                </IconButton>
              </li>
            ))}
          </ul>
          <p className="t-caption text-tertiary">表头与模板一致的文件会自动套用映射，跳过字段映射这一步。</p>
        </section>
      )}

      <Dialog open={guide !== null} title={`${guide?.name ?? ''} · 导出教程`} onClose={() => setGuide(null)}>
        <ol className="guide-list t-body-m">
          {guide?.guide.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Dialog>
      <RevertDialog batch={reverting} onClose={() => setReverting(null)} />
    </>
  )
}
