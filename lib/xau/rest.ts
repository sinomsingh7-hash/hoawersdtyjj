import { RATE_LIMITS, REST_BASE, type RateBucket } from './constants'

const WINDOW_MS = 2000
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Independent sliding-window token bucket per OKX endpoint. */
class SlidingWindow {
  private stamps: number[] = []
  constructor(private readonly max: number) {}
  async acquire() {
    for (;;) {
      const now = Date.now()
      while (this.stamps.length && now - this.stamps[0] >= WINDOW_MS) this.stamps.shift()
      if (this.stamps.length < this.max) { this.stamps.push(now); return }
      await sleep(WINDOW_MS - (now - this.stamps[0]) + 5)
    }
  }
}

const buckets = Object.fromEntries(Object.entries(RATE_LIMITS).map(([key, max]) => [key, new SlidingWindow(max)])) as Record<RateBucket, SlidingWindow>
let haltUntil = 0

export class OkxError extends Error {}

/** GET an OKX V5 public endpoint with per-bucket limiting and 429 / 50011 back-off. */
export async function okxGet<T>(path: string, bucket: RateBucket, critical = true): Promise<T[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = haltUntil - Date.now()
    if (wait > 0) {
      if (!critical) throw new OkxError('Rate-limit back-off active; non-critical request skipped')
      await sleep(wait)
    }
    await buckets[bucket].acquire()
    const response = await fetch(`${REST_BASE}/${path}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    let body: { code?: string; msg?: string; data?: T[] } = {}
    try { body = await response.json() } catch { /* handled below */ }
    if (response.status === 429 || body.code === '50011') {
      const retryAfter = Number.parseInt(response.headers.get('Retry-After') ?? '5', 10)
      haltUntil = Date.now() + (Number.isFinite(retryAfter) ? retryAfter : 5) * 1000
      continue
    }
    if (!response.ok) throw new OkxError(`OKX HTTP ${response.status} on ${path.split('?')[0]}`)
    if (body.code !== '0' || !Array.isArray(body.data)) throw new OkxError(body.msg || `OKX error ${body.code} on ${path.split('?')[0]}`)
    return body.data
  }
  throw new OkxError(`OKX rate limit persisted on ${path.split('?')[0]}`)
}

export const isRateHalted = () => Date.now() < haltUntil
