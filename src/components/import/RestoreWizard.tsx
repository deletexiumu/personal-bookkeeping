import { ArrowLeft, CircleCheck, DatabaseBackup } from 'lucide-react'
import { useState } from 'react'
import { hrefOf } from '../../app/router'
import { db } from '../../db'
import { planRestore, restoreBackup, type RestorePlan } from '../../db/backup'
import { BACKUP_TABLE_LABELS, BACKUP_TABLES, parseBackup, type ParsedBackup } from '../../lib/backup'
import { PageHeader } from '../layout/AppShell'
import { Button, IconButton } from '../ui/Button'
import { useToast } from '../ui/toast-context'
import { StepBar } from './StepBar'
import { UploadStep } from './UploadStep'

type Step = 'upload' | 'confirm' | 'done'

function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

function formatExportedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '未知时间'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 备份恢复：选择 JSON 备份 → 确认各表新增 / 覆盖数 → 按 ID 合并写入 */
export function RestoreWizard({ onExit }: { onExit: () => void }) {
  const toast = useToast()
  const [step, setStep] = useState<Step>('upload')
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedBackup | null>(null)
  const [plan, setPlan] = useState<RestorePlan | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleFile(file: File) {
    setError(null)
    try {
      const result = parseBackup(await readText(file))
      setFileName(file.name)
      setParsed(result)
      setPlan(await planRestore(db, result.backup))
      setStep('confirm')
    } catch (e) {
      setError(e instanceof Error ? e.message : '文件读取失败')
    }
  }

  async function confirm() {
    if (!parsed) return
    setBusy(true)
    try {
      setPlan(await restoreBackup(db, parsed.backup))
      setStep('done')
    } catch (e) {
      toast.show({ message: e instanceof Error ? `恢复失败：${e.message}` : '恢复失败' })
    } finally {
      setBusy(false)
    }
  }

  const total = plan ? BACKUP_TABLES.reduce((n, t) => n + plan[t].added + plan[t].updated, 0) : 0
  const updated = plan ? BACKUP_TABLES.reduce((n, t) => n + plan[t].updated, 0) : 0
  const skipped = parsed ? Object.values(parsed.skipped).reduce((n, v) => n + (v ?? 0), 0) : 0

  return (
    <div className="page">
      <PageHeader
        title={
          <span className="import-title">
            <IconButton label={step === 'confirm' ? '上一步' : '返回导入中心'} onClick={step === 'confirm' ? () => setStep('upload') : onExit}>
              <ArrowLeft size={22} />
            </IconButton>
            导入 · 备份恢复
          </span>
        }
      />
      {step !== 'done' && <StepBar current={step === 'upload' ? 1 : 2} steps={['选择来源', '上传文件', '确认恢复']} />}
      {step === 'upload' && (
        <UploadStep
          error={error}
          onFile={(f) => void handleFile(f)}
          accept=".json,application/json"
          hint="选择本应用导出的 JSON 备份文件；文件只在本机解析，不会上传"
        />
      )}
      {step === 'confirm' && parsed && plan && (
        <section className="card import-card">
          <header className="file-head">
            <span className="cat-icon tone-gray" style={{ width: 40, height: 40 }} aria-hidden="true">
              <DatabaseBackup size={20} />
            </span>
            <div className="file-meta">
              <h2 className="t-body-m-strong">{fileName}</h2>
              <p className="t-caption text-tertiary">导出于 {formatExportedAt(parsed.backup.exportedAt)} · 共 {total} 条数据</p>
            </div>
          </header>
          <ul className="restore-table" aria-label="恢复内容">
            {BACKUP_TABLES.map((t) => (
              <li key={t} className="restore-row">
                <span className="t-body-m">{BACKUP_TABLE_LABELS[t]}</span>
                <span className="t-body-s text-secondary">
                  新增 {plan[t].added} · 覆盖 {plan[t].updated}
                  {parsed.skipped[t] ? ` · 跳过 ${parsed.skipped[t]}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className={`import-banner t-body-s ${updated > 0 ? 'import-banner-warning' : ''}`}>
            {updated > 0
              ? `本机有 ${updated} 条数据与备份的 ID 相同，将被备份内容覆盖；备份里没有的本地数据会保留。恢复不能撤销。`
              : '备份里的数据都会新增到本机，本地已有数据保留。'}
            {skipped > 0 && ` 另有 ${skipped} 条字段不完整，已跳过。`}
          </p>
          <div className="import-actions">
            <Button onClick={() => setStep('upload')}>上一步</Button>
            <Button variant="primary" onClick={() => void confirm()} disabled={busy || total === 0}>
              确认恢复
            </Button>
          </div>
        </section>
      )}
      {step === 'done' && (
        <section className="card import-card import-result">
          <CircleCheck size={40} aria-hidden="true" className="text-income" />
          <h2 className="t-title-m">已恢复 {total} 条数据</h2>
          <p className="t-body-s text-secondary">新增 {total - updated} 条，覆盖 {updated} 条。</p>
          <div className="import-actions">
            <Button onClick={onExit}>返回导入中心</Button>
            <a className="btn btn-primary btn-md" href={hrefOf('transactions')}>
              查看明细
            </a>
          </div>
        </section>
      )}
    </div>
  )
}
