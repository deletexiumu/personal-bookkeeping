import { useState } from 'react'
import { db } from '../../db'
import { revertImport } from '../../db/imports'
import type { ImportBatch } from '../../types'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { useToast } from '../ui/toast-context'

interface Props {
  batch: ImportBatch | null
  onClose: () => void
  onReverted?: () => void
}

/** 整批撤销确认：删除该批次写入的全部流水 */
export function RevertDialog({ batch, onClose, onReverted }: Props) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function confirm() {
    if (batch?.id === undefined) return
    setBusy(true)
    try {
      const removed = await revertImport(db, batch.id)
      toast.show({ message: `已撤销导入，删除 ${removed} 条流水` })
      onReverted?.()
      onClose()
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : '撤销失败' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={batch !== null} title="撤销这次导入？" onClose={onClose}>
      <div className="form">
        <p className="t-body-m text-secondary">
          将删除「{batch?.fileName}」导入的 {batch?.importedCount} 条流水，包括导入后修改过的，以及之后合并进这些流水的其他账单明细。删除后不能恢复，可以重新导入。
        </p>
        <div className="field-row">
          <Button onClick={onClose}>取消</Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={busy} data-autofocus>
            撤销导入
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
