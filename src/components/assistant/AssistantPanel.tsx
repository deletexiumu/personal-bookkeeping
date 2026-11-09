import { ArrowUp, CalendarRange, FileText, Search, Settings2, Sparkles, Square, SquarePen, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { LIMITS, type ChatItem } from '../../../server/src/ai/core.ts'
import { useAccount } from '../../app/account'
import { fetchAiConfig, serverChat } from '../../app/assistant'
import { hrefOf } from '../../app/router'
import { db } from '../../db'
import { ledgerSource } from '../../db/aiSource'
import { ask, AssistantError, directTransport, type Transport } from '../../lib/ai/agent'
import { buildContext, presetRange, RANGE_LABELS, useCurrentPage, type RangePreset } from '../../lib/ai/context'
import { directModel, directProblem, useAiSettings } from '../../lib/ai/settings'
import { describeToolCall, runTool } from '../../lib/ai/tools'
import { ApiError } from '../../lib/api'
import { today } from '../../lib/date'
import { Button, IconButton } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { AiSettingsForm } from './AiSettingsForm'
import { MessageText } from './MessageText'

const SUGGESTIONS = ['这个月的钱主要花在哪了？', '和上个月比，支出有什么变化？', '最近三个月有哪些大额支出？', '帮我找找每月固定扣费的订阅']

/** 界面上显示的一条：问题、回答，或「查询了什么」 */
type Row =
  | { kind: 'user'; text: string; attached: string[] }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; text: string }

function rowsOf(items: ChatItem[], attachments: Map<number, string[]>): Row[] {
  const rows: Row[] = []
  items.forEach((item, index) => {
    if (item.role === 'user') rows.push({ kind: 'user', text: item.text, attached: attachments.get(index) ?? [] })
    else if (item.role === 'assistant') {
      if (item.text) rows.push({ kind: 'assistant', text: item.text })
      for (const call of item.toolCalls ?? []) rows.push({ kind: 'tool', text: describeToolCall(call) })
    }
  })
  return rows
}

function errorText(err: unknown): string {
  if (err instanceof ApiError || err instanceof AssistantError) return err.message
  return err instanceof Error ? err.message : '出错了，请稍后再试'
}

type Readiness = { ok: true; label: string } | { ok: false; reason: string; action: 'login' | 'settings' } | null

/** 当前的连接方式能不能用 */
function useReadiness(open: boolean, refreshKey: number): Readiness {
  const settings = useAiSettings()
  const account = useAccount()
  const [server, setServer] = useState<Readiness>(null)

  useEffect(() => {
    if (!open || settings.mode !== 'server' || !account.user) return
    let cancelled = false
    fetchAiConfig().then(
      (c) => {
        if (cancelled) return
        if (c.settings) setServer({ ok: true, label: `服务器转发 · ${c.settings.model || '默认模型'}` })
        else if (c.server.available) setServer({ ok: true, label: `服务器转发 · ${c.server.model}` })
        else setServer({ ok: false, reason: '还没有配置 AI 接入点。', action: 'settings' })
      },
      (err: unknown) => !cancelled && setServer({ ok: false, reason: errorText(err), action: 'settings' }),
    )
    return () => {
      cancelled = true
    }
  }, [open, settings.mode, account.user, refreshKey])

  if (settings.mode === 'direct') {
    const problem = directProblem(settings.direct)
    return problem ? { ok: false, reason: `浏览器直连${problem}。`, action: 'settings' } : { ok: true, label: `浏览器直连 · ${directModel(settings.direct)}` }
  }
  if (!account.user) return { ok: false, reason: '服务器转发需要先登录；也可以在设置里改用浏览器直连。', action: 'login' }
  return server
}

/**
 * AI 助手面板：宽屏是右侧不遮挡页面的侧栏（可以一边切换页面一边问），窄屏是全屏。
 * 对话保存在内存里，关掉面板不丢，刷新页面后清空。
 */
export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useAiSettings()
  const page = useCurrentPage()
  const [items, setItems] = useState<ChatItem[]>([])
  // 每个问题附带了哪些数据（显示用），键是问题在 items 里的下标
  const [attachments, setAttachments] = useState(() => new Map<number, string[]>())
  const [draft, setDraft] = useState('')
  const [usePage, setUsePage] = useState(true)
  const [preset, setPreset] = useState<RangePreset>('none')
  const [custom, setCustom] = useState(() => presetRange('this-month'))
  const [pending, setPending] = useState<ChatItem[] | null>(null)
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const readiness = useReadiness(open, refreshKey)
  const source = useMemo(() => ledgerSource(db), [])
  const busy = pending !== null
  const shown = pending ?? items
  const rows = rowsOf(shown, attachments)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [rows.length, busy, error])

  function transport(): Transport {
    return settings.mode === 'direct' ? directTransport(settings.direct) : (list) => serverChat(list)
  }

  async function send(text: string) {
    const question = text.trim()
    if (!question || busy || !readiness?.ok) return
    setError('')
    const controller = new AbortController()
    abortRef.current = controller
    const range = preset === 'none' ? null : preset === 'custom' ? custom : presetRange(preset)
    const attached = [
      ...(usePage && page ? [page.label] : []),
      ...(range ? [preset === 'custom' ? `${range.start} 至 ${range.end}` : RANGE_LABELS[preset]] : []),
    ]
    const base = items
    setPending([...base, { role: 'user', text: question }])
    setDraft('')
    try {
      const context = await buildContext({ source, page: usePage ? page : null, range, date: today() })
      const next = await ask(base, { role: 'user', text: question, context }, {
        transport: transport(),
        runTool: (call) => runTool(source, call),
        onProgress: (list) => !controller.signal.aborted && setPending(list),
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setAttachments((m) => new Map(m).set(base.length, attached))
      setItems(next)
      setPreset('none')
    } catch (err) {
      if (controller.signal.aborted) return
      // 出错时这个问题不进对话（对话只追加完整的一问一答），问题放回输入框方便重试
      setError(errorText(err))
      setDraft(question)
    } finally {
      // 停止或开始新对话后，旧请求的收尾不再改界面
      if (abortRef.current === controller) {
        abortRef.current = null
        setPending(null)
      }
    }
  }

  function stop() {
    const controller = abortRef.current
    if (!controller) return
    controller.abort()
    abortRef.current = null
    const question = pending?.find((item, i) => i >= items.length && item.role === 'user')
    if (question?.role === 'user') setDraft(question.text)
    setPending(null)
  }

  function reset() {
    abortRef.current?.abort()
    abortRef.current = null
    setItems([])
    setAttachments(new Map())
    setPending(null)
    setError('')
    inputRef.current?.focus()
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void send(draft)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(draft)
    }
    if (e.key === 'Escape') onClose()
  }

  const questions = items.filter((i) => i.role === 'user').length
  const full = questions >= LIMITS.questions || items.length >= LIMITS.items - LIMITS.steps * 2

  return (
    <aside className={`assistant-panel ${open ? 'is-open' : ''}`} aria-label="AI 助手" aria-hidden={!open} inert={!open}>
      <header className="assistant-header">
        <Sparkles size={20} aria-hidden="true" className="assistant-logo" />
        <div className="assistant-title">
          <h2 className="t-title-s">AI 助手</h2>
          <p className="t-caption text-tertiary">{readiness?.ok ? readiness.label : '只回答和账单有关的问题'}</p>
        </div>
        <IconButton label="新对话" onClick={reset} disabled={items.length === 0 && !busy}>
          <SquarePen size={18} />
        </IconButton>
        <IconButton label="AI 接入点设置" onClick={() => setSettingsOpen(true)}>
          <Settings2 size={18} />
        </IconButton>
        <IconButton label="关闭" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </header>

      <div className="assistant-body" ref={listRef} aria-live="polite">
        {rows.length === 0 && (
          <div className="assistant-empty">
            <p className="t-body-m">可以结合当前页面的数据，或者任意时间段的账单来提问。</p>
            {readiness?.ok && (
              <div className="assistant-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="assistant-suggestion t-body-s" onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {rows.map((row, i) =>
          row.kind === 'user' ? (
            <div key={i} className="assistant-msg is-user">
              <p className="t-body-m">{row.text}</p>
              {row.attached.length > 0 && <p className="t-caption assistant-attached">附带：{row.attached.join('、')}</p>}
            </div>
          ) : row.kind === 'tool' ? (
            <p key={i} className="assistant-step t-caption text-tertiary">
              <Search size={14} aria-hidden="true" />
              {row.text}
            </p>
          ) : (
            <div key={i} className="assistant-msg is-assistant t-body-m">
              <MessageText text={row.text} />
            </div>
          ),
        )}
        {busy && (
          <p className="assistant-step t-caption text-tertiary" role="status">
            <span className="assistant-dots" aria-hidden="true" />
            正在分析…
          </p>
        )}
        {error && (
          <p className="assistant-error t-body-s form-error" role="alert">
            {error}
          </p>
        )}
        {readiness && !readiness.ok && (
          <div className="settings-callout">
            <p className="t-body-s">{readiness.reason}</p>
            {readiness.action === 'login' ? (
              <a className="btn btn-primary btn-sm" href={hrefOf('login')} onClick={onClose}>
                去登录
              </a>
            ) : null}
            <Button size="sm" variant={readiness.action === 'login' ? 'secondary' : 'primary'} onClick={() => setSettingsOpen(true)}>
              设置 AI 接入点
            </Button>
          </div>
        )}
      </div>

      <form className="assistant-composer" onSubmit={handleSubmit}>
        <div className="assistant-context">
          {page && (
            <button
              type="button"
              className="assistant-chip t-caption"
              aria-pressed={usePage}
              title={usePage ? '提问时附带当前页面的数据，点击取消' : '点击附带当前页面的数据'}
              onClick={() => setUsePage((v) => !v)}
            >
              <FileText size={14} aria-hidden="true" />
              {page.label}
            </button>
          )}
          <label className="assistant-chip assistant-range t-caption" aria-pressed={preset !== 'none'}>
            <CalendarRange size={14} aria-hidden="true" />
            <select aria-label="附加时间段的汇总" value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)}>
              {(Object.keys(RANGE_LABELS) as RangePreset[]).map((p) => (
                <option key={p} value={p}>
                  {p === 'none' ? '附加时间段' : RANGE_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          {preset === 'custom' && (
            <span className="assistant-custom-range t-caption">
              <input
                type="date"
                aria-label="开始日期"
                className="input"
                value={custom.start}
                max={custom.end}
                onChange={(e) => e.target.value && setCustom((r) => ({ ...r, start: e.target.value }))}
              />
              至
              <input
                type="date"
                aria-label="结束日期"
                className="input"
                value={custom.end}
                min={custom.start}
                onChange={(e) => e.target.value && setCustom((r) => ({ ...r, end: e.target.value }))}
              />
            </span>
          )}
        </div>
        <div className="assistant-input">
          <textarea
            ref={inputRef}
            className="input"
            rows={2}
            maxLength={LIMITS.question}
            placeholder={full ? '这次对话已经很长了，请点右上角开始新对话' : '问问你的账本，例如：上个月餐饮花了多少？'}
            value={draft}
            disabled={full}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="问题"
          />
          {busy ? (
            <IconButton label="停止" className="assistant-send" onClick={stop}>
              <Square size={16} />
            </IconButton>
          ) : (
            <IconButton label="发送" type="submit" className="assistant-send is-primary" disabled={!draft.trim() || !readiness?.ok || full}>
              <ArrowUp size={18} />
            </IconButton>
          )}
        </div>
      </form>

      <Dialog open={settingsOpen} title="AI 接入点" onClose={() => setSettingsOpen(false)}>
        <AiSettingsForm
          onDone={() => {
            setSettingsOpen(false)
            setRefreshKey((k) => k + 1)
          }}
        />
      </Dialog>
    </aside>
  )
}

/** 打开 AI 助手的悬浮按钮 */
export function AssistantButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="assistant-fab" onClick={onClick} aria-label="打开 AI 助手" title="AI 助手（A）">
      <Sparkles size={20} aria-hidden="true" />
      <span className="assistant-fab-label t-body-s">AI 助手</span>
    </button>
  )
}
