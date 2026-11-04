import { randomBytes } from 'node:crypto'
import { count, eq } from 'drizzle-orm'
import { hashPassword } from './auth/password.ts'
import { revokeOtherSessions } from './auth/sessions.ts'
import { loadConfig } from './config.ts'
import { openDatabase } from './db/client.ts'
import { dataDirInUse } from './db/lock.ts'
import { invites, syncRecords, users } from './db/schema.ts'

/**
 * 服务器上的管理命令，见 docs/server.md：
 *   node dist/admin.js invite [有效天数]
 *   node dist/admin.js reset-password <邮箱>
 *   node dist/admin.js stats
 * 用内嵌数据库时要先停掉服务（同一时间只能有一个进程打开数据目录）。
 */
const USAGE = `用法：
  invite [有效天数]          生成一个邀请码（默认 7 天有效）
  reset-password <邮箱>      重置密码为随机密码，并让该账号所有设备下线
  stats                      账号数、云端记录数`

export async function runAdmin(args: string[], env: Record<string, string | undefined> = process.env): Promise<string> {
  const [command, arg] = args
  if (!command || !['invite', 'reset-password', 'stats'].includes(command)) return USAGE
  const config = loadConfig(env)
  if (!config.databaseUrl && dataDirInUse(config.dataDir)) {
    throw new Error(
      '服务正在使用内嵌数据库，同时打开会损坏数据。请先停止服务：\n' +
        '  docker compose stop api && docker compose run --rm api node dist/admin.js ' + args.join(' ') + ' && docker compose start api',
    )
  }
  const { db, close } = await openDatabase(config)
  try {
    if (command === 'invite') {
      const days = arg ? Number(arg) : 7
      if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('有效天数应为 1–365 的整数')
      const code = randomBytes(6).toString('base64url')
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      await db.insert(invites).values({ code, expiresAt })
      return `邀请码：${code}（${expiresAt.toISOString().slice(0, 10)} 前有效，用一次即失效）`
    }
    if (command === 'reset-password') {
      const email = arg?.trim().toLowerCase()
      if (!email) throw new Error('请提供邮箱')
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
      if (!user) throw new Error(`没有这个账号：${email}`)
      const password = randomBytes(9).toString('base64url')
      await db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(users.id, user.id))
      await revokeOtherSessions(db, user.id)
      return `已重置 ${email} 的密码为：${password}\n请登录后在设置里改成自己的密码。`
    }
    const [{ n }] = await db.select({ n: count() }).from(users)
    const [{ r }] = await db.select({ r: count() }).from(syncRecords)
    return `账号数：${n}\n云端记录数：${r}`
  } finally {
    await close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAdmin(process.argv.slice(2)).then(
    (out) => console.log(out),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    },
  )
}
