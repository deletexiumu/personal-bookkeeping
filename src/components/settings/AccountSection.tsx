import { ChevronRight, KeyRound, LogOut, MonitorSmartphone, UserX } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { changePassword, deleteAccount, listDevices, revokeDevice, signOut, useAccount } from '../../app/account'
import { hrefOf } from '../../app/router'
import { ApiError, describeDevice, type DeviceSession } from '../../lib/api'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { useToast } from '../ui/toast-context'

type Panel = 'devices' | 'password' | 'delete' | null

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/** 设置页顶部的账号卡片：未登录时引导登录，已登录时管理设备、密码和账号 */
export function AccountSection() {
  const account = useAccount()
  const toast = useToast()
  const [panel, setPanel] = useState<Panel>(null)
  const close = () => setPanel(null)

  if (!account.user) {
    return (
      <section className="card profile">
        <div className="profile-main">
          <h2 className="t-title-s">我的账本</h2>
          <p className="t-caption text-tertiary">数据保存在本机浏览器（IndexedDB）。登录后可以在多台设备间同步（开发中）。</p>
        </div>
        <div className="profile-actions">
          <a className="btn btn-primary btn-sm" href={hrefOf('login')}>
            登录
          </a>
          <a className="btn btn-secondary btn-sm" href={`${hrefOf('login')}?mode=register`}>
            注册
          </a>
        </div>
      </section>
    )
  }

  async function handleSignOut() {
    if (!confirm('退出登录后，这台设备上的账本数据仍然保留。确定退出吗？')) return
    await signOut()
    toast.show({ message: '已退出登录' })
  }

  return (
    <>
      <section className="card profile">
        <div className="profile-main">
          <h2 className="t-title-s">{account.user.email}</h2>
          <p className="t-caption text-tertiary">
            {account.server ? `服务器：${account.server} · ` : ''}云同步开发中，数据目前仍只存在本机
          </p>
        </div>
        <Badge tone="income">已登录</Badge>
      </section>
      <section className="settings-group">
        <h2 className="t-caption text-tertiary settings-group-title">账号</h2>
        <ul className="card settings-list">
          <li>
            <button type="button" className="settings-item" onClick={() => setPanel('devices')}>
              <MonitorSmartphone size={20} aria-hidden="true" className="settings-item-icon" />
              <span className="t-body-m">登录设备</span>
              <ChevronRight size={18} aria-hidden="true" className="text-tertiary" />
            </button>
          </li>
          <li>
            <button type="button" className="settings-item" onClick={() => setPanel('password')}>
              <KeyRound size={20} aria-hidden="true" className="settings-item-icon" />
              <span className="t-body-m">修改密码</span>
              <ChevronRight size={18} aria-hidden="true" className="text-tertiary" />
            </button>
          </li>
          <li>
            <button type="button" className="settings-item" onClick={() => void handleSignOut()}>
              <LogOut size={20} aria-hidden="true" className="settings-item-icon" />
              <span className="t-body-m">退出登录</span>
              <ChevronRight size={18} aria-hidden="true" className="text-tertiary" />
            </button>
          </li>
          <li>
            <button type="button" className="settings-item" onClick={() => setPanel('delete')}>
              <UserX size={20} aria-hidden="true" className="settings-item-icon text-expense" />
              <span className="t-body-m">注销账号</span>
              <ChevronRight size={18} aria-hidden="true" className="text-tertiary" />
            </button>
          </li>
        </ul>
      </section>
      <Dialog open={panel === 'devices'} title="登录设备" onClose={close}>
        <DevicesPanel />
      </Dialog>
      <Dialog open={panel === 'password'} title="修改密码" onClose={close}>
        <PasswordForm onDone={close} />
      </Dialog>
      <Dialog open={panel === 'delete'} title="注销账号" onClose={close}>
        <DeleteAccountForm onDone={close} />
      </Dialog>
    </>
  )
}

function DevicesPanel() {
  const [devices, setDevices] = useState<DeviceSession[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listDevices().then(setDevices, (err: unknown) => setError(errorText(err, '读取设备列表失败')))
  }, [])

  async function handleRevoke(id: string) {
    try {
      await revokeDevice(id)
      setDevices((list) => list?.filter((d) => d.id !== id) ?? null)
    } catch (err) {
      setError(errorText(err, '操作失败'))
    }
  }

  if (error) return <p className="t-body-s form-error" role="alert">{error}</p>
  if (!devices) return <p className="t-body-s text-tertiary">正在读取…</p>
  return (
    <ul className="device-list" aria-label="已登录的设备">
      {devices.map((d) => (
        <li key={d.id} className="device-item">
          <div>
            <span className="t-body-m">
              {describeDevice(d.userAgent)} {d.current && <Badge tone="brand">本机</Badge>}
            </span>
            <span className="t-caption text-tertiary">
              最近使用 {new Date(d.lastUsedAt).toLocaleString('zh-CN', { hour12: false })}
              {d.ip ? ` · ${d.ip}` : ''}
            </span>
          </div>
          {!d.current && (
            <Button size="sm" onClick={() => void handleRevoke(d.id)}>
              下线
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmNext, setConfirmNext] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (next !== confirmNext) {
      setError('两次输入的新密码不一致')
      return
    }
    setBusy(true)
    try {
      await changePassword(current, next)
      toast.show({ message: '密码已修改，其他设备需要重新登录' })
      onDone()
    } catch (err) {
      setError(errorText(err, '修改失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} aria-label="修改密码">
      <label className="field">
        <span className="field-label">当前密码</span>
        <input data-autofocus className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </label>
      <label className="field">
        <span className="field-label">新密码</span>
        <input className="input" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
        <span className="t-caption text-tertiary">至少 8 位。修改后其他设备会退出登录。</span>
      </label>
      <label className="field">
        <span className="field-label">确认新密码</span>
        <input className="input" type="password" autoComplete="new-password" value={confirmNext} onChange={(e) => setConfirmNext(e.target.value)} required />
      </label>
      {error && <p className="t-body-s form-error" role="alert">{error}</p>}
      <Button type="submit" variant="primary" block disabled={busy}>
        修改密码
      </Button>
    </form>
  )
}

function DeleteAccountForm({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await deleteAccount(password)
      toast.show({ message: '账号已注销，本机数据仍然保留' })
      onDone()
    } catch (err) {
      setError(errorText(err, '注销失败'))
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} aria-label="注销账号">
      <p className="t-body-m">注销后账号和云端的全部数据会被永久删除，不能恢复。这台设备上的账本数据不受影响。</p>
      <label className="field">
        <span className="field-label">输入密码确认</span>
        <input data-autofocus className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <p className="t-body-s form-error" role="alert">{error}</p>}
      <Button type="submit" variant="danger" block disabled={busy}>
        永久注销账号
      </Button>
    </form>
  )
}
