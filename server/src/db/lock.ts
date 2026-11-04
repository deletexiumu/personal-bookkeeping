import { existsSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 内嵌数据库（PGlite）同一时间只能有一个进程打开数据目录，两个进程同时写会损坏数据。
 * 服务运行时在数据目录里放一个锁文件并每 10 秒刷新修改时间；管理命令看到 30 秒内刷新过就拒绝运行。
 * 用修改时间而不是进程号，是因为管理命令可能在另一个容器里执行，看不到服务的进程。
 */
const LOCK_FILE = '.taozhubu-server.lock'
const HEARTBEAT_MS = 10_000
const STALE_MS = 30_000

export function holdDataDirLock(dataDir: string): () => void {
  const file = join(dataDir, LOCK_FILE)
  writeFileSync(file, `${process.pid}\n`)
  const timer = setInterval(() => {
    const now = new Date()
    try {
      utimesSync(file, now, now)
    } catch {
      writeFileSync(file, `${process.pid}\n`)
    }
  }, HEARTBEAT_MS)
  timer.unref()
  return () => {
    clearInterval(timer)
    rmSync(file, { force: true })
  }
}

/** 数据目录是否正被运行中的服务占用 */
export function dataDirInUse(dataDir: string, now = Date.now()): boolean {
  const file = join(dataDir, LOCK_FILE)
  if (!existsSync(file)) return false
  return now - statSync(file).mtimeMs < STALE_MS
}
