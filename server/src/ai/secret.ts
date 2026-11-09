import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PREFIX = 'v1:'

/**
 * 加密保存 API Key 用的 32 字节密钥：
 * - 配了 AI_SECRET：由它派生，换机器、换数据库时只要带上这个值
 * - 没配：第一次用时随机生成，存在数据目录的 ai-secret.key（权限 600）；内存数据库（测试）只放在内存里
 */
export function loadSecretKey(opts: { secret?: string; dataDir: string }): Buffer {
  if (opts.secret) return createHash('sha256').update(opts.secret).digest()
  if (opts.dataDir.startsWith('memory://')) return randomBytes(32)
  const file = join(opts.dataDir, 'ai-secret.key')
  if (existsSync(file)) {
    const key = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64')
    if (key.length !== 32) throw new Error(`${file} 内容不正确`)
    return key
  }
  mkdirSync(opts.dataDir, { recursive: true })
  const key = randomBytes(32)
  writeFileSync(file, key.toString('base64'), { mode: 0o600, flag: 'wx' })
  return key
}

/** AES-256-GCM 加密，结果为 v1:base64(iv | tag | 密文) */
export function encryptSecret(key: Buffer, plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
}

/** 解密失败（换了密钥、数据被改）时返回 null */
export function decryptSecret(key: Buffer, stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return null
  try {
    const buf = Buffer.from(stored.slice(PREFIX.length), 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
    decipher.setAuthTag(buf.subarray(12, 28))
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** 给用户看的密钥提示：只露出前 3 位和后 4 位 */
export function keyHint(key: string): string {
  if (key.length <= 10) return '••••'
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}
