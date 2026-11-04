import { useSyncExternalStore } from 'react'
import {
  apiRequest,
  normalizeServerUrl,
  tokenMode,
  type AccountUser,
  type ApiTarget,
  type DeviceSession,
  type RegistrationMode,
} from '../lib/api'

/**
 * 登录状态。存在 localStorage，只在这台设备上：
 * - server：服务器地址，空字符串表示与页面同源（Web 端默认）
 * - token：跨域（桌面端、自填服务器）时的 Bearer 令牌；同源时令牌在 HttpOnly Cookie 里，这里不存
 * - user：最近一次拿到的账号信息，用于离线时显示
 */
export interface AccountState {
  server: string
  token?: string
  user?: AccountUser
}

const KEY = 'taozhubu:account'
const listeners = new Set<() => void>()
let cached: AccountState | undefined

function read(): AccountState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AccountState>
    return {
      server: typeof raw.server === 'string' ? raw.server : defaultServer(),
      token: typeof raw.token === 'string' ? raw.token : undefined,
      user: raw.user && typeof raw.user.email === 'string' ? raw.user : undefined,
    }
  } catch {
    return { server: defaultServer() }
  }
}

/** 桌面端（Tauri）没有同源的后端，需要用户填服务器地址 */
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function defaultServer(): string {
  return ''
}

export function getAccount(): AccountState {
  cached ??= read()
  return cached
}

function write(next: AccountState) {
  cached = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 写不进去时只在本次会话有效
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    cached = read()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useAccount(): AccountState {
  return useSyncExternalStore(subscribe, getAccount, getAccount)
}

/** 测试用：丢掉内存里的缓存，下次从 localStorage 重新读 */
export function resetAccountCache() {
  cached = undefined
}

function target(state: AccountState = getAccount()): ApiTarget {
  return { baseUrl: state.server, token: state.token }
}

/** 退出或令牌失效时清掉登录信息，保留服务器地址 */
function signOutLocally() {
  write({ server: getAccount().server })
}

/** 401 表示会话已失效（在别处退出、改了密码、过期），本机也改成未登录 */
export async function call<T>(path: string, init?: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown }): Promise<T> {
  try {
    return await apiRequest<T>(target(), path, init)
  } catch (err) {
    if (err instanceof Error && 'status' in err && err.status === 401 && getAccount().user) signOutLocally()
    throw err
  }
}

export async function fetchRegistrationMode(server: string): Promise<RegistrationMode> {
  const res = await apiRequest<{ registration: RegistrationMode }>({ baseUrl: normalizeServerUrl(server) }, '/auth/config')
  return res.registration
}

interface SignInResponse {
  user: AccountUser
  token?: string
}

export async function signIn(
  kind: 'login' | 'register',
  input: { server: string; email: string; password: string; inviteCode?: string },
): Promise<AccountUser> {
  const server = normalizeServerUrl(input.server)
  const t: ApiTarget = { baseUrl: server }
  const res = await apiRequest<SignInResponse>(t, `/auth/${kind}`, {
    body: {
      email: input.email,
      password: input.password,
      inviteCode: input.inviteCode || undefined,
      tokenMode: tokenMode(t),
    },
  })
  write({ server, token: res.token, user: res.user })
  return res.user
}

/** 启动时确认会话仍有效，并刷新账号信息；离线时保持原样 */
export async function refreshAccount(): Promise<void> {
  if (!getAccount().user) return
  try {
    const { user } = await call<{ user: AccountUser }>('/auth/me')
    write({ ...getAccount(), user })
  } catch {
    // 401 已在 call 里处理；网络问题时保留离线状态
  }
}

export async function signOut(): Promise<void> {
  try {
    await call('/auth/logout', { body: {} })
  } catch {
    // 服务器连不上也要在本机退出
  }
  signOutLocally()
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await call('/auth/password', { body: { currentPassword, newPassword } })
}

export async function listDevices(): Promise<DeviceSession[]> {
  return (await call<{ sessions: DeviceSession[] }>('/auth/sessions')).sessions
}

export async function revokeDevice(id: string): Promise<void> {
  await call(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} })
}

export async function deleteAccount(password: string): Promise<void> {
  await call('/auth/account', { method: 'DELETE', body: { password } })
  signOutLocally()
}

/** 只改服务器地址（未登录时） */
export function setServer(server: string) {
  write({ server: normalizeServerUrl(server) })
}
