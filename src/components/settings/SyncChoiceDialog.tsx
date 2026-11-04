import { useEffect, useState } from 'react'
import { useAccount } from '../../app/account'
import { fetchCloudCounts, syncEngine, useSyncStatus } from '../../app/sync'
import { db } from '../../db'
import { ApiError } from '../../lib/api'
import { Dialog } from '../ui/Dialog'
import { useToast } from '../ui/toast-context'

/**
 * 第一次和账号同步、这台设备上已有账本数据时弹出：合并到云端，还是用云端数据替换本机。
 * 点「暂不同步」后可在设置页的账号区域重新选择。
 */
export function SyncChoiceDialog() {
  const status = useSyncStatus()
  const { user } = useAccount()
  const toast = useToast()
  const open = status.phase === 'needs-choice' && !status.choiceDismissed
  const [counts, setCounts] = useState<{ local: number; cloud?: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let alive = true
    void (async () => {
      const local = await db.transactions.count()
      if (alive) setCounts({ local })
      try {
        const cloud = (await fetchCloudCounts()).transactions ?? 0
        if (alive) setCounts({ local, cloud })
      } catch {
        // 读不到云端数量不影响选择
      }
    })()
    return () => {
      alive = false
    }
  }, [open])

  async function choose(choice: 'merge' | 'replace') {
    if (choice === 'replace' && !confirm('本机的账本数据会先自动备份，然后清空并下载云端数据。确定吗？')) return
    setBusy(true)
    setError('')
    try {
      await syncEngine.resolveChoice(choice)
      const { phase, error: syncError } = syncEngine.status
      if (phase === 'error') setError(syncError ?? '同步失败')
      else toast.show({ message: choice === 'merge' ? '已合并，正在同步' : '已换成云端数据' })
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} title="同步这台设备的数据" onClose={() => syncEngine.dismissChoice()}>
      <div className="form">
        <p className="t-body-m">
          这台设备上已经有账本数据{counts ? `（${counts.local} 笔流水）` : ''}，
          {counts?.cloud !== undefined ? `云端账号 ${user?.email ?? ''} 里有 ${counts.cloud} 笔。` : '要怎么和云端账号里的数据合在一起？'}
        </p>
        <div className="choice-list">
          <button type="button" className="choice-card" disabled={busy} onClick={() => void choose('merge')} data-autofocus>
            <span className="t-body-m">合并到云端（推荐）</span>
            <span className="t-caption text-tertiary">本机和云端的数据合在一起；同一条记录两边都改过的，以最后修改的为准。</span>
          </button>
          <button type="button" className="choice-card" disabled={busy} onClick={() => void choose('replace')}>
            <span className="t-body-m">用云端数据替换本机</span>
            <span className="t-caption text-tertiary">本机数据先自动备份（可在设置里下载），然后清空，换成云端的数据。</span>
          </button>
          <button type="button" className="choice-card" disabled={busy} onClick={() => syncEngine.dismissChoice()}>
            <span className="t-body-m">暂不同步</span>
            <span className="t-caption text-tertiary">这台设备先不同步，之后可以在设置里再选。</span>
          </button>
        </div>
        {busy && <p className="t-body-s text-tertiary">正在同步…</p>}
        {error && (
          <p className="t-body-s form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
