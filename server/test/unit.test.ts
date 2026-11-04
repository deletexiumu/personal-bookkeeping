import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../src/auth/password.ts'
import { RateLimiter } from '../src/auth/rateLimit.ts'
import { loadConfig } from '../src/config.ts'

describe('密码哈希', () => {
  it('同一密码每次盐不同，都能校验通过', async () => {
    const a = await hashPassword('密码 password')
    const b = await hashPassword('密码 password')
    expect(a).not.toBe(b)
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/)
    expect(await verifyPassword('密码 password', a)).toBe(true)
    expect(await verifyPassword('密码 Password', a)).toBe(false)
    expect(await verifyPassword('x', 'garbage')).toBe(false)
  })
})

describe('限频', () => {
  it('窗口内超过次数后返回等待秒数，窗口过后恢复', () => {
    const limiter = new RateLimiter(2, 60_000)
    expect(limiter.hit('k', 0)).toBeNull()
    expect(limiter.hit('k', 1)).toBeNull()
    expect(limiter.blocked('k', 2)).toBe(60)
    expect(limiter.hit('k', 30_000)).toBe(30)
    expect(limiter.hit('k', 60_000)).toBeNull()
  })
})

describe('配置', () => {
  it('默认值', () => {
    expect(loadConfig({})).toMatchObject({ port: 8787, dataDir: '/data', registration: 'open', cookieSecure: true, trustProxy: true })
    expect(loadConfig({ SESSION_TTL_DAYS: '7', COOKIE_SECURE: 'false', DATABASE_URL: '' })).toMatchObject({
      sessionTtlMs: 7 * 86400_000,
      cookieSecure: false,
      databaseUrl: undefined,
    })
  })

  it('不合法的值直接报错', () => {
    expect(() => loadConfig({ REGISTRATION: 'maybe' })).toThrow('REGISTRATION')
  })
})

describe('内嵌数据库目录锁', () => {
  it('服务持有锁时管理命令拒绝运行，释放后可以运行', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { holdDataDirLock, dataDirInUse } = await import('../src/db/lock.ts')
    const { runAdmin } = await import('../src/admin.ts')
    const dir = mkdtempSync(join(tmpdir(), 'tzb-'))
    const release = holdDataDirLock(dir)
    expect(dataDirInUse(dir)).toBe(true)
    expect(dataDirInUse(dir, Date.now() + 60_000)).toBe(false)
    await expect(runAdmin(['stats'], { DATA_DIR: dir })).rejects.toThrow('docker compose stop api')
    release()
    expect(await runAdmin(['stats'], { DATA_DIR: dir })).toBe('账号数：0\n云端记录数：0')
    expect(await runAdmin(['nope'], { DATA_DIR: dir })).toMatch(/^用法/)
  })
})
