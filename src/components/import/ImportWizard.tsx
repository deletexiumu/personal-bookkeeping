import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, CircleCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { hrefOf } from '../../app/router'
import { db } from '../../db'
import { commitImport, loadDedupeCandidates, loadMerchantTransactions } from '../../db/imports'
import type { FieldKey } from '../../lib/import/fields'
import { buildMerchantHistory, buildPreview, type PreviewItem } from '../../lib/import/preview'
import { sniffFile, withHeaderRow, type SniffResult } from '../../lib/import/sniff'
import { parseRows, type AmountSign, type ColumnMapping } from '../../lib/import/table'
import type { BuiltinTemplate } from '../../lib/import/templates'
import type { Account, Category, ImportBatch, ImportSource } from '../../types'
import { PageHeader } from '../layout/AppShell'
import { Button, IconButton } from '../ui/Button'
import { useToast } from '../ui/toast-context'
import { MappingStep } from './MappingStep'
import { PreviewStep } from './PreviewStep'
import { RevertDialog } from './RevertDialog'
import { StepBar } from './StepBar'
import { UploadStep } from './UploadStep'
import { sourceOf } from './sources'

type Step = 'upload' | 'mapping' | 'preview' | 'done'

const STEP_INDEX: Record<Step, number> = { upload: 1, mapping: 2, preview: 3, done: 4 }

interface Props {
  source: ImportSource
  categories: Category[]
  accounts: Account[]
  onExit: () => void
}

function readBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer().then((b) => new Uint8Array(b))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

/** 默认入账账户：模板指定的钱包账户；银行卡账单优先储蓄卡 / 信用卡 */
function defaultAccountFor(source: ImportSource, accounts: Account[], template?: BuiltinTemplate): number | undefined {
  if (template) {
    const wallet = accounts.find((a) => a.type === template.accountType)
    if (wallet) return wallet.id
  }
  if (source === 'bank') {
    const card = accounts.find((a) => a.type === 'debit' || a.type === 'credit')
    if (card) return card.id
  }
  return accounts[0]?.id
}

/** 导入向导：上传文件 → 字段映射 → 预览确认 → 结果。确认前不写入账本。 */
export function ImportWizard({ source, categories, accounts, onExit }: Props) {
  const toast = useToast()
  const def = sourceOf(source)
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [sniff, setSniff] = useState<SniffResult | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping[]>([])
  const [amountSign, setAmountSign] = useState<AmountSign>('negative-expense')
  const [accountId, setAccountId] = useState<number | undefined>(() => defaultAccountFor(source, accounts))
  const [items, setItems] = useState<PreviewItem[]>([])
  const [busy, setBusy] = useState(false)
  const [batch, setBatch] = useState<ImportBatch | null>(null)
  const [reverting, setReverting] = useState(false)
  const merchantHistory = useLiveQuery(
    () => loadMerchantTransactions(db).then(buildMerchantHistory),
    [],
    new Map<string, number>(),
  )

  const parsed = useMemo(
    () => (sniff ? parseRows(sniff.table, mapping, amountSign) : { rows: [], errors: [] }),
    [sniff, mapping, amountSign],
  )

  async function handleFile(file: File) {
    setFileError(null)
    if (/\.(xls|pdf|zip|rar)$/i.test(file.name)) {
      setFileError('暂时只支持 CSV / TSV 和 xlsx。旧版 xls 请先另存为 xlsx 或 CSV；压缩包请先解压。')
      return
    }
    let result: SniffResult
    try {
      result = await sniffFile(await readBytes(file))
    } catch (e) {
      setFileError(e instanceof Error ? `文件读取失败：${e.message}` : '文件读取失败，请重新选择。')
      return
    }
    if (result.table.rows.length === 0) {
      setFileError('没有读到数据行，请确认文件是带表头的账单表格。')
      return
    }
    setFileName(file.name)
    setSniff(result)
    setMapping(result.mapping)
    if (result.template) {
      // 命中内置模板：跳过字段映射，直接预览
      const id = defaultAccountFor(result.template.source, accounts, result.template)
      setAccountId(id)
      await toPreview(result, result.mapping, id)
    } else setStep('mapping')
  }

  function changeMapping(col: number, field: FieldKey) {
    setMapping((prev) =>
      prev.map((m, i) => {
        if (i === col) return { field, status: field === 'ignore' ? 'skip' : 'matched' }
        // 同一字段只能映射一列（备注除外），原来那一列改为忽略
        if (field !== 'ignore' && field !== 'note' && m.field === field) return { field: 'ignore', status: 'skip' }
        return m
      }),
    )
  }

  function changeHeaderRow(row: number) {
    if (!sniff) return
    const next = withHeaderRow(sniff, row)
    setSniff(next)
    setMapping(next.mapping)
  }

  async function toPreview(target = sniff, columns = mapping, account = accountId) {
    if (!target) return
    // 直接打开导入页时账户可能稍后才加载完
    const defaultAccountId = account ?? defaultAccountFor(source, accounts, target.template)
    if (defaultAccountId === undefined) {
      toast.show({ message: '请先在「账户」里添加一个账户' })
      setStep('mapping')
      return
    }
    setBusy(true)
    try {
      const rows = parseRows(target.table, columns, amountSign).rows
      const refs = rows.flatMap((r) => (r.ref ? [r.ref] : []))
      const existing = await loadDedupeCandidates(db, rows.map((r) => r.date), refs)
      setItems(buildPreview(rows, { categories, merchantHistory, accounts, defaultAccountId, existing }))
      setStep('preview')
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    setBusy(true)
    try {
      const id = await commitImport(db, { source: sniff?.template?.source ?? source, fileName, rowCount: items.length + parsed.errors.length, items })
      setBatch((await db.importBatches.get(id)) ?? null)
      setStep('done')
    } catch (e) {
      toast.show({ message: e instanceof Error ? `导入失败：${e.message}` : '导入失败' })
    } finally {
      setBusy(false)
    }
  }

  function back() {
    if (step === 'preview') setStep('mapping')
    else if (step === 'mapping') setStep('upload')
    else onExit()
  }

  const title = (
    <span className="import-title">
      <IconButton label={step === 'done' || step === 'upload' ? '返回导入中心' : '上一步'} onClick={step === 'done' ? onExit : back}>
        <ArrowLeft size={22} />
      </IconButton>
      导入 · {def.name}
    </span>
  )

  return (
    <div className={`page ${step === 'mapping' ? 'page-wide' : ''}`}>
      <PageHeader title={title} />
      {step !== 'done' && <StepBar current={STEP_INDEX[step]} />}
      {step === 'upload' && <UploadStep error={fileError} onFile={(f) => void handleFile(f)} />}
      {step === 'mapping' && sniff && (
        <MappingStep
          fileName={fileName}
          sniff={sniff}
          mapping={mapping}
          parsed={parsed}
          amountSign={amountSign}
          accountId={accountId ?? defaultAccountFor(source, accounts)}
          categories={categories}
          accounts={accounts}
          merchantHistory={merchantHistory}
          busy={busy}
          onMappingChange={changeMapping}
          onHeaderRowChange={changeHeaderRow}
          onAmountSignChange={setAmountSign}
          onAccountChange={setAccountId}
          onBack={() => setStep('upload')}
          onNext={() => void toPreview()}
        />
      )}
      {step === 'preview' && (
        <PreviewStep
          fileName={fileName}
          sourceName={sniff?.template ? `识别为「${sniff.template.name}」模板` : def.name}
          items={items}
          errors={parsed.errors}
          categories={categories}
          busy={busy}
          onChange={setItems}
          onBack={() => setStep('mapping')}
          onCommit={() => void commit()}
        />
      )}
      {step === 'done' && batch && (
        <section className="card import-card import-result">
          <CircleCheck size={40} aria-hidden="true" className={batch.status === 'reverted' ? 'text-tertiary' : 'text-income'} />
          {batch.status === 'reverted' ? (
            <h2 className="t-title-m">已撤销本次导入</h2>
          ) : (
            <h2 className="t-title-m">已入账 {batch.importedCount} 条</h2>
          )}
          <p className="t-body-s text-secondary">
            文件共 {batch.rowCount} 条，跳过 {batch.rowCount - batch.importedCount} 条。可以随时在「导入记录」里整批撤销。
          </p>
          <div className="import-actions">
            {batch.status !== 'reverted' && (
              <Button variant="danger" onClick={() => setReverting(true)}>
                撤销本次导入
              </Button>
            )}
            <Button onClick={onExit}>继续导入</Button>
            <a className="btn btn-primary btn-md" href={hrefOf('transactions')}>
              查看明细
            </a>
          </div>
        </section>
      )}
      <RevertDialog
        batch={reverting ? batch : null}
        onClose={() => setReverting(false)}
        onReverted={() => setBatch((b) => (b ? { ...b, status: 'reverted' } : b))}
      />
    </div>
  )
}
