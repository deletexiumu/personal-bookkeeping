import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * 账号。邮箱统一存小写；以后接入微信登录时再加登录方式表，一个账号可绑定多种方式。
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** 邮箱验证时间；没配 SMTP 时为空，不影响使用 */
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * 登录会话。令牌本身只交给客户端，库里只存 SHA-256 哈希，数据库泄露也拿不到可用令牌。
 * id 是对外展示用的会话编号（设备列表、踢下线）。
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    /** 登录时的 User-Agent，用于设备列表 */
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
)

/** 邀请码（REGISTRATION=invite 时注册需要），一次性使用 */
export const invites = pgTable('invites', {
  code: text('code').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
  usedAt: timestamp('used_at', { withTimezone: true }),
})
