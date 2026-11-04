import { useEffect, useState, type FormEvent } from 'react'
import { fetchRegistrationMode, getAccount, isDesktopApp, signIn } from '../app/account'
import { hrefOf } from '../app/router'
import { PageHeader } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/toast-context'
import { ApiError, type RegistrationMode } from '../lib/api'

type Mode = 'login' | 'register'

function initialMode(): Mode {
  return window.location.hash.includes('mode=register') ? 'register' : 'login'
}

/**
 * 登录 / 注册（#/login，#/login?mode=register）。
 * Web 端默认连同一域名下的服务；桌面端或想连别的服务器时填服务器地址。
 */
export function LoginPage() {
  const toast = useToast()
  const desktop = isDesktopApp()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [server, setServer] = useState(() => getAccount().server)
  const [showServer, setShowServer] = useState(() => desktop || getAccount().server !== '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [registration, setRegistration] = useState<RegistrationMode | 'unknown'>('unknown')
  const [error, setError] = useState<{ message: string; field?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // 查询注册开关；服务器地址改动后稍等再查
  useEffect(() => {
    if (desktop && !server.trim()) return
    let cancelled = false
    const timer = setTimeout(() => {
      fetchRegistrationMode(server).then(
        (r) => !cancelled && setRegistration(r),
        () => !cancelled && setRegistration('unknown'),
      )
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [server, desktop])

  const registerClosed = mode === 'register' && registration === 'closed'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (desktop && !server.trim()) {
      setError({ message: '请填写服务器地址', field: 'server' })
      return
    }
    if (mode === 'register' && password !== confirm) {
      setError({ message: '两次输入的密码不一致', field: 'confirm' })
      return
    }
    setBusy(true)
    try {
      const user = await signIn(mode, { server, email, password, inviteCode })
      toast.show({ message: mode === 'register' ? `注册成功，已登录 ${user.email}` : `已登录 ${user.email}` })
      window.location.hash = hrefOf('settings')
    } catch (err) {
      if (err instanceof ApiError) setError({ message: err.message, field: err.field })
      else setError({ message: '登录失败，请稍后再试' })
    } finally {
      setBusy(false)
    }
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
  }

  const invalid = (field: string) => (error?.field === field ? true : undefined)

  return (
    <div className="page page-narrow">
      <PageHeader title={mode === 'login' ? '登录' : '注册'} />
      <section className="card auth-card">
        <div className="segmented" role="radiogroup" aria-label="登录或注册">
          <button type="button" role="radio" aria-checked={mode === 'login'} className="segmented-item" onClick={() => switchMode('login')}>
            登录
          </button>
          <button type="button" role="radio" aria-checked={mode === 'register'} className="segmented-item" onClick={() => switchMode('register')}>
            注册
          </button>
        </div>
        <p className="t-body-s text-secondary">
          登录后账本会保存到云端，在多台设备间同步。不登录也能照常使用，数据只存在这台设备上。
        </p>
        {registerClosed ? (
          <p className="t-body-m">这个服务暂不开放注册，请联系管理员。</p>
        ) : (
          <form className="form" onSubmit={handleSubmit} aria-label={mode === 'login' ? '登录' : '注册'} noValidate>
            {showServer ? (
              <label className="field">
                <span className="field-label">服务器地址</span>
                <input
                  className="input"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="https://example.com"
                  value={server}
                  aria-invalid={invalid('server')}
                  onChange={(e) => setServer(e.target.value)}
                />
                <span className="t-caption text-tertiary">
                  {desktop ? '填部署了陶朱簿服务的网址。' : '留空表示使用当前网站的服务。'}
                </span>
              </label>
            ) : null}
            <label className="field">
              <span className="field-label">邮箱</span>
              <input
                data-autofocus
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                aria-invalid={invalid('email')}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span className="field-label">密码</span>
              <input
                className="input"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'register' ? 8 : undefined}
                value={password}
                aria-invalid={invalid('password')}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {mode === 'register' && <span className="t-caption text-tertiary">至少 8 位</span>}
            </label>
            {mode === 'register' && (
              <label className="field">
                <span className="field-label">确认密码</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  aria-invalid={invalid('confirm')}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </label>
            )}
            {mode === 'register' && registration === 'invite' && (
              <label className="field">
                <span className="field-label">邀请码</span>
                <input
                  className="input"
                  autoComplete="off"
                  value={inviteCode}
                  aria-invalid={invalid('inviteCode')}
                  onChange={(e) => setInviteCode(e.target.value)}
                  required
                />
              </label>
            )}
            {error && (
              <p className="t-body-s form-error" role="alert">
                {error.message}
              </p>
            )}
            <Button type="submit" variant="primary" block disabled={busy}>
              {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
            </Button>
            <div className="auth-links t-body-s">
              {mode === 'login' && <span className="text-tertiary">忘记密码？请联系服务管理员重置（邮件找回稍后支持）</span>}
              {!desktop && !showServer && (
                <button type="button" className="link-btn" onClick={() => setShowServer(true)}>
                  使用其他服务器
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
