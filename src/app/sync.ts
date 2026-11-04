import { Dexie } from 'dexie'
import { useEffect, useSyncExternalStore } from 'react'
import { db as defaultDb, type BookkeepingDB } from '../db'
import { saveAutoBackup } from '../db/backup'
import {
  applyRemote,
  collectLocalChanges,
  countPending,
  hasLocalData,
  markAllForUpload,
  markPushed,
  resetLocalData,
  type WireChange,
} from '../db/syncData'
import { ApiError } from '../lib/api'
import { call, getAccount, useAccount } from './account'

/**
 * 云同步：拉取云端改动 → 写入本机（后写为准）→ 推送本机改动。
 * 同一时间只跑一轮，跑的过程中又被触发时，结束后再跑一轮。
 */

export interface SyncApi {
  pull(since: number): Promise<{ changes: WireChange[]; cursor: number; more: boolean }>
  push(changes: WireChange[]): Promise<{ accepted: number; conflicts: WireChange[] }>
}

/**
 * - off：未登录
 * - needs-choice：这台设备上有本地数据，第一次和这个账号同步，云端也已有数据，需要用户选择合并还是用云端替换
 */
export type SyncPhase = 'off' | 'idle' | 'syncing' | 'error' | 'needs-choice'

export interface SyncStatus {
  phase: SyncPhase
  /** 本机待推送的改动条数 */
  pending: number
  lastSyncedAt?: number
  error?: string
  /** needs-choice 时用户点了「暂不同步」 */
  choiceDismissed?: boolean
}

/** 记在本机的同步进度：这份本地数据属于哪个账号、拉取到云端哪个位置 */
export interface SyncCursor {
  userId?: string
  cursor: number
  lastSyncedAt?: number
}

export interface SyncEngineOptions {
  db: BookkeepingDB
  api: SyncApi
  userId: () => string | undefined
  loadCursor: () => SyncCursor
  saveCursor: (cursor: SyncCursor) => void
  now?: () => number
}

/** 一次推送的条数（服务端上限 500） */
const PUSH_BATCH = 200

const keyOf = (c: Pick<WireChange, 'table' | 'uid'>) => `${c.table}\u0000${c.uid}`

export class SyncEngine {
  status: SyncStatus = { phase: 'off', pending: 0 }
  private listeners = new Set<() => void>()
  private running?: Promise<void>
  private again = false
  private readonly opts: SyncEngineOptions

  constructor(opts: SyncEngineOptions) {
    this.opts = opts
    const cursor = opts.loadCursor()
    if (cursor.lastSyncedAt) this.status = { ...this.status, lastSyncedAt: cursor.lastSyncedAt }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getStatus = () => this.status

  private set(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch }
    for (const l of this.listeners) l()
  }

  setPending(pending: number) {
    if (pending !== this.status.pending) this.set({ pending })
  }

  /** 退出登录后 */
  stop() {
    this.set({ phase: 'off', error: undefined, choiceDismissed: undefined })
  }

  dismissChoice() {
    this.set({ choiceDismissed: true })
  }

  reopenChoice() {
    this.set({ choiceDismissed: false })
  }

  /** 立即同步一轮；正在同步时等这一轮结束后再跑一轮 */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = this.run().finally(() => {
      this.running = undefined
      if (this.again) {
        this.again = false
        void this.sync()
      }
    })
    return this.running
  }

  /** 距离上次同步超过 ms 才同步（切回页面时用） */
  syncIfStale(ms: number): Promise<void> | undefined {
    const last = this.status.lastSyncedAt ?? 0
    if ((this.opts.now ?? Date.now)() - last < ms) return undefined
    return this.sync()
  }

  /**
   * 第一次和这个账号同步时的选择：
   * - merge：本机数据和云端合并，同一条记录以最后修改的为准
   * - replace：先自动备份本机数据，清空后下载云端数据
   */
  async resolveChoice(choice: 'merge' | 'replace'): Promise<void> {
    const userId = this.opts.userId()
    if (!userId) return
    await this.running
    const { db } = this.opts
    if (choice === 'replace') {
      await saveAutoBackup(db, 'replace')
      await resetLocalData(db)
    } else {
      await markAllForUpload(db)
    }
    this.opts.saveCursor({ userId, cursor: 0 })
    this.set({ phase: 'syncing', choiceDismissed: undefined })
    await this.sync()
  }

  private async run(): Promise<void> {
    const { db, api } = this.opts
    const now = this.opts.now ?? Date.now
    const userId = this.opts.userId()
    if (!userId) return this.stop()
    let cursor = this.opts.loadCursor()
    this.set({ phase: 'syncing', error: undefined })
    try {
      if (cursor.userId !== userId) {
        // 本机有数据、云端也有数据时才需要用户选择；云端是空的（新账号）直接把本机数据传上去
        if (await hasLocalData(db)) {
          const probe = await api.pull(0)
          if (probe.changes.length > 0) {
            this.set({ phase: 'needs-choice', pending: await countPending(db) })
            return
          }
          await markAllForUpload(db)
        }
        cursor = { userId, cursor: 0 }
        this.opts.saveCursor(cursor)
      }
      // 1. 拉取：先把云端改动全部拉下来再写入，外键引用的记录可能在后面几页
      const pulled: WireChange[] = []
      let since = cursor.cursor
      for (;;) {
        const page = await api.pull(since)
        pulled.push(...page.changes)
        since = page.cursor
        if (!page.more) break
      }
      await applyRemote(db, pulled)
      cursor = { ...cursor, cursor: since }
      this.opts.saveCursor(cursor)

      // 2. 推送：云端更新的（conflicts）直接写回本机
      const local = await collectLocalChanges(db)
      for (let i = 0; i < local.length; i += PUSH_BATCH) {
        const batch = local.slice(i, i + PUSH_BATCH)
        const res = await api.push(batch)
        const rejected = new Set(res.conflicts.map(keyOf))
        await markPushed(db, batch.filter((c) => !rejected.has(keyOf(c))))
        await applyRemote(db, res.conflicts)
      }

      const lastSyncedAt = now()
      this.opts.saveCursor({ ...cursor, lastSyncedAt })
      this.set({ phase: 'idle', lastSyncedAt, pending: await countPending(db) })
    } catch (err) {
      if (!this.opts.userId()) return this.stop()
      const error = err instanceof ApiError ? err.message : err instanceof Error ? err.message : '同步失败'
      this.set({ phase: 'error', error, pending: await countPending(db).catch(() => this.status.pending) })
    }
  }
}

const CURSOR_KEY = 'taozhubu:sync'

function loadCursor(): SyncCursor {
  try {
    const raw = JSON.parse(localStorage.getItem(CURSOR_KEY) ?? '{}') as Partial<SyncCursor>
    return {
      userId: typeof raw.userId === 'string' ? raw.userId : undefined,
      cursor: Number.isSafeInteger(raw.cursor) ? raw.cursor! : 0,
      lastSyncedAt: typeof raw.lastSyncedAt === 'number' ? raw.lastSyncedAt : undefined,
    }
  } catch {
    return { cursor: 0 }
  }
}

function saveCursor(cursor: SyncCursor) {
  try {
    localStorage.setItem(CURSOR_KEY, JSON.stringify(cursor))
  } catch {
    // 存不下时下次从头拉取，结果一样，只是慢一些
  }
}

/** 清除本机数据时一并忘掉同步进度 */
export function forgetSyncCursor() {
  try {
    localStorage.removeItem(CURSOR_KEY)
  } catch {
    // 忽略
  }
}

const httpApi: SyncApi = {
  pull: (since) => call(`/sync/pull?since=${since}`),
  push: (changes) => call('/sync/push', { body: { changes } }),
}

export const syncEngine = new SyncEngine({
  db: defaultDb,
  api: httpApi,
  userId: () => getAccount().user?.id,
  loadCursor,
  saveCursor,
})

/** 云端各表的记录数，用于合并前提示 */
export async function fetchCloudCounts(): Promise<Record<string, number>> {
  const res = await call<{ tables: Record<string, { records: number }> }>('/sync/status')
  return Object.fromEntries(Object.entries(res.tables).map(([t, v]) => [t, v.records]))
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(syncEngine.subscribe, syncEngine.getStatus, syncEngine.getStatus)
}

/** 自动同步的时机：登录后、每分钟、联网时、切回页面时（距上次超过 1 分钟）、本机有改动 2 秒后 */
export function useAutoSync(engine: SyncEngine = syncEngine, database: BookkeepingDB = defaultDb) {
  const userId = useAccount().user?.id
  useEffect(() => {
    if (!userId) {
      engine.stop()
      return
    }
    void engine.sync()
    const timer = setInterval(() => void engine.sync(), 60 * 1000)
    const onOnline = () => void engine.sync()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void engine.syncIfStale(60 * 1000)
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    // 本机有写入就重新数待推送条数。不用 liveQuery 盯 dirty 索引：dirty 是同步中间件在更底层加的，
    // Dexie 的变更追踪看不到它，盯着它的查询不会刷新。
    const pending = { alive: true, timer: undefined as ReturnType<typeof setTimeout> | undefined }
    const recount = async () => {
      const n = await countPending(database).catch(() => engine.status.pending)
      if (!pending.alive) return
      engine.setPending(n)
      // 出错（如离线）时不在这里重试，等联网或定时
      if (n > 0 && engine.status.phase === 'idle') {
        clearTimeout(pending.timer)
        pending.timer = setTimeout(() => void engine.sync(), 2000)
      }
    }
    const prefix = `idb://${database.name}/`
    const onMutated = (parts: Record<string, unknown>) => {
      if (Object.keys(parts).some((k) => k.startsWith(prefix))) void recount()
    }
    Dexie.on('storagemutated', onMutated)
    void recount()
    return () => {
      clearInterval(timer)
      clearTimeout(pending.timer)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      pending.alive = false
      Dexie.on('storagemutated').unsubscribe(onMutated)
    }
  }, [userId, engine, database])
}

/** 同步状态的简短描述，用于侧边栏和设置页 */
export function describeSync(status: SyncStatus, now = Date.now()): string {
  switch (status.phase) {
    case 'off':
      return '未登录'
    case 'syncing':
      return '正在同步…'
    case 'needs-choice':
      return '等待选择如何同步'
    case 'error':
      return status.pending > 0 ? `同步失败，${status.pending} 条待同步` : '同步失败'
    case 'idle': {
      if (status.pending > 0) return `${status.pending} 条待同步`
      if (!status.lastSyncedAt) return '已同步'
      const minutes = Math.floor((now - status.lastSyncedAt) / 60000)
      if (minutes < 1) return '已同步 · 刚刚'
      if (minutes < 60) return `已同步 · ${minutes} 分钟前`
      return `已同步 · ${new Date(status.lastSyncedAt).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    }
  }
}
