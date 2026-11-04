import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { purgeExpiredSessions } from './auth/sessions.ts'
import { loadConfig } from './config.ts'
import { openDatabase } from './db/client.ts'
import { dataDirInUse, holdDataDirLock } from './db/lock.ts'

const config = loadConfig()
if (!config.databaseUrl && dataDirInUse(config.dataDir)) {
  console.error(`数据目录 ${config.dataDir} 正被另一个服务进程使用，退出`)
  process.exit(1)
}
const database = await openDatabase(config)
const releaseLock = database.kind === 'pglite' ? holdDataDirLock(config.dataDir) : () => {}
console.log(`数据库：${database.kind === 'postgres' ? 'PostgreSQL' : `PGlite（${config.dataDir}）`}，注册：${config.registration}`)

const app = createApp({ db: database.db, config })
const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`陶朱簿 API 已启动，端口 ${info.port}`)
})

// 每小时清理一次过期会话
const timer = setInterval(() => {
  purgeExpiredSessions(database.db).catch((err) => console.error('清理过期会话失败', err))
}, 60 * 60 * 1000)
timer.unref()

let closing = false
async function shutdown(signal: string) {
  if (closing) return
  closing = true
  console.log(`收到 ${signal}，正在退出`)
  server.close()
  await database.close()
  releaseLock()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
