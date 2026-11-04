import { describe, expect, it, vi } from 'vitest'
import { notifyPwa, subscribePwa } from './pwa'

describe('PWA 更新通知', () => {
  it('订阅前到达的通知在订阅时补发一次', () => {
    const update = vi.fn()
    notifyPwa({ type: 'need-refresh', update })
    const listener = vi.fn()
    const unsubscribe = subscribePwa(listener)
    expect(listener).toHaveBeenCalledWith({ type: 'need-refresh', update })
    notifyPwa({ type: 'offline-ready' })
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    notifyPwa({ type: 'offline-ready' })
    expect(listener).toHaveBeenCalledTimes(2)
    // 没有订阅者时到达的通知留给下一个订阅者，已经送达过的不再补发
    const late = vi.fn()
    subscribePwa(late)()
    expect(late).toHaveBeenCalledTimes(1)
  })
})
