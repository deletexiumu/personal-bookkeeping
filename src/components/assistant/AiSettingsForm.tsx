import { useEffect, useState, type FormEvent } from 'react'
import { DEFAULT_BASE_URLS, DEFAULT_MODELS, FORMAT_LABEL, type AiFormat } from '../../../server/src/ai/core.ts'
import { useAccount } from '../../app/account'
import { deleteAiSettings, fetchAiConfig, saveAiSettings, testAiSettings, type AiServerConfig, type AiSettingsInput } from '../../app/assistant'
import { hrefOf } from '../../app/router'
import { ask, directTransport, AssistantError } from '../../lib/ai/agent'
import { directProblem, setAiSettings, useAiSettings, type AiMode, type DirectConfig } from '../../lib/ai/settings'
import { ApiError } from '../../lib/api'
import { Button } from '../ui/Button'
import { Segmented } from '../ui/Segmented'
import { useToast } from '../ui/toast-context'

const MODE_OPTIONS: { value: AiMode; label: string }[] = [
  { value: 'server', label: '服务器转发' },
  { value: 'direct', label: '浏览器直连' },
]

const FORMAT_OPTIONS: { value: AiFormat; label: string }[] = [
  { value: 'anthropic', label: FORMAT_LABEL.anthropic },
  { value: 'openai', label: FORMAT_LABEL.openai },
]

type Source = 'default' | 'own'

function errorText(err: unknown): string {
  if (err instanceof ApiError || err instanceof AssistantError) return err.message
  return err instanceof Error ? err.message : '操作失败'
}

interface Fields {
  format: AiFormat
  baseUrl: string
  model: string
  apiKey: string
  proxyUrl: string
}

/** 接口格式、地址、模型、Key 四个输入框，两种连接方式共用 */
function EndpointFields({
  fields,
  onChange,
  keyPlaceholder,
  showProxy,
}: {
  fields: Fields
  onChange: (patch: Partial<Fields>) => void
  keyPlaceholder: string
  showProxy: boolean
}) {
  return (
    <>
      <div className="field">
        <span className="field-label">接口格式</span>
        <Segmented label="接口格式" options={FORMAT_OPTIONS} value={fields.format} onChange={(format) => onChange({ format })} />
        <span className="t-caption text-tertiary">
          {fields.format === 'anthropic'
            ? 'Claude 官方接口，或兼容 Anthropic Messages 格式的中转。'
            : 'OpenAI 及兼容 Chat Completions 格式的服务，如 DeepSeek、通义千问、Kimi、各类中转。'}
        </span>
      </div>
      <label className="field">
        <span className="field-label">接入地址</span>
        <input
          className="input"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={DEFAULT_BASE_URLS[fields.format]}
          value={fields.baseUrl}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
        />
        <span className="t-caption text-tertiary">留空用官方地址；可以填到 /v1，也可以填完整的接口地址。</span>
      </label>
      <label className="field">
        <span className="field-label">模型</span>
        <input
          className="input"
          autoComplete="off"
          spellCheck={false}
          placeholder={DEFAULT_MODELS[fields.format] || '必填，如 deepseek-chat'}
          value={fields.model}
          onChange={(e) => onChange({ model: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field-label">API Key</span>
        <input
          className="input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={keyPlaceholder}
          value={fields.apiKey}
          onChange={(e) => onChange({ apiKey: e.target.value })}
        />
      </label>
      {showProxy && (
        <label className="field">
          <span className="field-label">代理（可选）</span>
          <input
            className="input"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="http://user:pass@host:7890 或 socks5://host:1080"
            value={fields.proxyUrl}
            onChange={(e) => onChange({ proxyUrl: e.target.value })}
          />
          <span className="t-caption text-tertiary">服务器访问 AI 接口时经过这个代理，支持 http、https 和 socks5。留空则直连（或用服务器统一配置的代理）。</span>
        </label>
      )}
    </>
  )
}

/** AI 接入点设置：服务器转发（Key 和代理保存在服务器上）或浏览器直连（Key 只在本机） */
export function AiSettingsForm({ onDone }: { onDone?: () => void }) {
  const settings = useAiSettings()
  const [mode, setMode] = useState<AiMode>(settings.mode)
  return (
    <div className="form ai-settings">
      <div className="field">
        <span className="field-label">连接方式</span>
        <Segmented label="连接方式" options={MODE_OPTIONS} value={mode} onChange={setMode} />
      </div>
      {mode === 'server' ? <ServerForm onDone={onDone} /> : <DirectForm initial={settings.direct} onDone={onDone} />}
      <p className="t-caption text-tertiary">
        提问时，问题和相关的账单数据（汇总和少量明细）会发给你配置的 AI 服务。助手只回答和账单有关的问题。
      </p>
    </div>
  )
}

function ServerForm({ onDone }: { onDone?: () => void }) {
  const account = useAccount()
  const toast = useToast()
  const [config, setConfig] = useState<AiServerConfig | null>(null)
  const [loadError, setLoadError] = useState('')
  const [source, setSource] = useState<Source>('own')
  const [fields, setFields] = useState<Fields>({ format: 'anthropic', baseUrl: '', model: '', apiKey: '', proxyUrl: '' })
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)

  useEffect(() => {
    if (!account.user) return
    fetchAiConfig().then(
      (c) => {
        setConfig(c)
        setSource(c.settings || !c.server.available ? 'own' : 'default')
        if (c.settings) setFields({ ...c.settings, apiKey: '' })
      },
      (err: unknown) => setLoadError(errorText(err)),
    )
  }, [account.user])

  if (!account.user) {
    return (
      <div className="settings-callout">
        <p className="t-body-s">服务器转发需要先登录陶朱簿账号。API Key 和代理保存在服务器上，浏览器拿不到 Key，也能绕开跨域限制。</p>
        <a className="btn btn-primary btn-sm" href={hrefOf('login')}>
          去登录
        </a>
        <p className="t-caption text-tertiary">不想登录也可以选「浏览器直连」。</p>
      </div>
    )
  }
  if (loadError) return <p className="t-body-s form-error" role="alert">{loadError}</p>
  if (!config) return <p className="t-body-s text-tertiary">正在读取…</p>

  const input = (): AiSettingsInput => ({
    format: fields.format,
    baseUrl: fields.baseUrl.trim(),
    model: fields.model.trim(),
    proxyUrl: fields.proxyUrl.trim(),
    // Key 留空表示保留服务器上已保存的
    ...(fields.apiKey.trim() ? { apiKey: fields.apiKey.trim() } : {}),
  })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy('save')
    try {
      if (source === 'default') await deleteAiSettings()
      else await saveAiSettings(input())
      setAiSettings({ mode: 'server' })
      toast.show({ message: 'AI 接入点已保存' })
      onDone?.()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  async function handleTest() {
    setError('')
    setResult('')
    setBusy('test')
    try {
      const res = await testAiSettings(source === 'own' ? input() : undefined)
      setResult(`连接正常（${res.model}，${(res.ms / 1000).toFixed(1)} 秒）：${res.reply}`)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  const saved = config.settings
  return (
    <form className="form" onSubmit={handleSubmit} aria-label="服务器转发设置">
      {config.server.available && (
        <div className="field">
          <span className="field-label">接入点</span>
          <Segmented
            label="接入点"
            options={[
              { value: 'default', label: '服务器默认' },
              { value: 'own', label: '自己配置' },
            ]}
            value={source}
            onChange={setSource}
          />
          {source === 'default' && (
            <span className="t-caption text-tertiary">
              使用服务器管理员配置的 AI（{config.server.format ? FORMAT_LABEL[config.server.format] : ''} · {config.server.model}），不需要填写 Key。
            </span>
          )}
        </div>
      )}
      {source === 'own' && (
        <EndpointFields
          fields={fields}
          onChange={(patch) => setFields((f) => ({ ...f, ...patch }))}
          keyPlaceholder={saved?.hasKey ? `已保存 ${saved.keyHint}，留空不修改` : '加密保存在服务器上'}
          showProxy
        />
      )}
      <p className="t-caption text-tertiary">
        每个账号每分钟最多 {config.limits.perMinute} 次、每天 {config.limits.perDay} 次请求（查数据时一个问题会请求几次）。
      </p>
      {error && <p className="t-body-s form-error" role="alert">{error}</p>}
      {result && <p className="t-body-s text-income" role="status">{result}</p>}
      <div className="form-actions">
        <Button onClick={() => void handleTest()} disabled={busy !== null}>
          {busy === 'test' ? '正在测试…' : '测试连接'}
        </Button>
        <Button type="submit" variant="primary" disabled={busy !== null}>
          保存
        </Button>
      </div>
    </form>
  )
}

function DirectForm({ initial, onDone }: { initial: DirectConfig; onDone?: () => void }) {
  const toast = useToast()
  const [fields, setFields] = useState<Fields>({ ...initial, proxyUrl: '' })
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const direct = (): DirectConfig => ({
    format: fields.format,
    baseUrl: fields.baseUrl.trim(),
    model: fields.model.trim(),
    apiKey: fields.apiKey.trim(),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const problem = directProblem(direct())
    if (problem) {
      setError(problem)
      return
    }
    setAiSettings({ mode: 'direct', direct: direct() })
    toast.show({ message: 'AI 接入点已保存在这台设备上' })
    onDone?.()
  }

  async function handleTest() {
    setError('')
    setResult('')
    const problem = directProblem(direct())
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    const started = Date.now()
    try {
      const items = await ask([], { role: 'user', text: '用一句话介绍你能帮我做什么。' }, {
        transport: directTransport(direct()),
        runTool: async () => '{}',
      })
      const last = items[items.length - 1]
      setResult(`连接正常（${((Date.now() - started) / 1000).toFixed(1)} 秒）：${last.role === 'assistant' ? last.text.slice(0, 200) : ''}`)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} aria-label="浏览器直连设置">
      <EndpointFields
        fields={fields}
        onChange={(patch) => setFields((f) => ({ ...f, ...patch }))}
        keyPlaceholder="只保存在这台设备的浏览器里"
        showProxy={false}
      />
      <p className="t-caption text-tertiary">
        浏览器直接请求 AI 接口：接口需要允许跨域访问（Claude 官方、OpenAI 官方和多数中转都支持），浏览器没法设置 HTTP 代理，需要代理请把接入地址填成你的中转地址，或登录后用服务器转发。Key 存在本机浏览器里，公用电脑上不要使用。
      </p>
      {error && <p className="t-body-s form-error" role="alert">{error}</p>}
      {result && <p className="t-body-s text-income" role="status">{result}</p>}
      <div className="form-actions">
        <Button onClick={() => void handleTest()} disabled={busy}>
          {busy ? '正在测试…' : '测试连接'}
        </Button>
        <Button type="submit" variant="primary">
          保存
        </Button>
      </div>
    </form>
  )
}
