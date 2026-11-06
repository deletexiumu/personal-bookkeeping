import { FileUp } from 'lucide-react'
import { useState, type DragEvent } from 'react'

interface Props {
  error: string | null
  onFile: (file: File) => void
  accept?: string
  hint?: string
}

const DEFAULT_ACCEPT =
  '.csv,.tsv,.txt,.xlsx,.pdf,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf'
const DEFAULT_HINT =
  '支持 CSV / TSV / xlsx / PDF，自动识别微信、支付宝、抖音支付账单和招商、中信银行流水；文件只在本机解析，不会上传'

/** 第 2 步：选择或拖入文件 */
export function UploadStep({ error, onFile, accept = DEFAULT_ACCEPT, hint = DEFAULT_HINT }: Props) {
  const [dragging, setDragging] = useState(false)

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }

  return (
    <section className="card import-card">
      <label
        className="dropzone"
        data-dragging={dragging ? '' : undefined}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <FileUp size={32} aria-hidden="true" />
        <span className="t-title-s">选择账单文件，或拖到这里</span>
        <span className="t-body-s text-tertiary">{hint}</span>
        <input
          type="file"
          className="sr-only"
          aria-label="选择账单文件"
          accept={accept}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
            e.target.value = ''
          }}
        />
      </label>
      {error && (
        <p className="form-error t-body-s" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
