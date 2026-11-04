/**
 * 进程内的固定窗口限频。单实例部署够用；以后多实例时再换成数据库或 Redis。
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()
  private readonly limit: number
  private readonly windowMs: number

  constructor(limit: number, windowMs: number) {
    this.limit = limit
    this.windowMs = windowMs
  }

  /** 是否已超限（不计数） */
  blocked(key: string, now = Date.now()): number | null {
    const hit = this.hits.get(key)
    if (!hit || hit.resetAt <= now) return null
    return hit.count >= this.limit ? Math.ceil((hit.resetAt - now) / 1000) : null
  }

  /** 记一次；返回超限时还需等待的秒数，未超限返回 null */
  hit(key: string, now = Date.now()): number | null {
    let hit = this.hits.get(key)
    if (!hit || hit.resetAt <= now) {
      hit = { count: 0, resetAt: now + this.windowMs }
      this.hits.set(key, hit)
    }
    hit.count += 1
    if (this.hits.size > 10_000) this.sweep(now)
    return hit.count > this.limit ? Math.ceil((hit.resetAt - now) / 1000) : null
  }

  reset(key: string): void {
    this.hits.delete(key)
  }

  private sweep(now: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k)
  }
}
