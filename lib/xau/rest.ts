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

/**
 * Multi-route transport order:
 * 0: Same-origin Next.js server proxy (/api/okx) — bypasses browser ISP/DNS/SNI blocks & CORS issues
 * 1: Direct OKX primary REST endpoint (https://www.okx.com/api/v5)
 * 2: Direct OKX AWS mirror (https://aws.okx.com/api/v5)
 */
const ENDPOINTS = [
  (path: string) => `/api/okx?path=${encodeURIComponent(path)}`,
  (path: string) => `${REST_BASE}/${path}`,
  (path: string) => `https://aws.okx.com/api/v5/${path}`,
] as const

let preferredEndpoint = 0

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs)
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export class OkxError extends Error {}

/** GET an OKX V5 public endpoint with per-bucket limiting, multi-endpoint failover, and 429 / 50011 back-off. */
export async function okxGet<T>(path: string, bucket: RateBucket, critical = true): Promise<T[]> {
  const maxAttempts = critical ? 6 : 3
  let lastErr = `OKX request failed on ${path.split('?')[0]}`

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const wait = haltUntil - Date.now()
    if (wait > 0) {
      if (!critical) throw new OkxError('Rate-limit back-off active; non-critical request skipped')
      await sleep(wait)
    }
    await buckets[bucket].acquire()

    const endpointIdx = (preferredEndpoint + attempt) % ENDPOINTS.length
    const url = ENDPOINTS[endpointIdx](path)
    const timeoutMs = critical ? 10_000 : 6_000

    let response: Response
    try {
      response = await fetchWithTimeout(url, timeoutMs)
    } catch (err) {
      lastErr = err instanceof Error ? err.message : 'Network error'
      if (attempt < maxAttempts - 1) await sleep(200 * (attempt + 1))
      continue
    }

    let body: { code?: string; msg?: string; data?: T[] } = {}
    try { body = await response.json() } catch { /* handled below */ }

    if (response.status === 429 || body.code === '50011') {
      const retryAfter = Number.parseInt(response.headers.get('Retry-After') ?? '5', 10)
      haltUntil = Date.now() + (Number.isFinite(retryAfter) ? retryAfter : 5) * 1000
      continue
    }

    if (!response.ok) {
      lastErr = body.msg || `OKX HTTP ${response.status} on ${path.split('?')[0]}`
      if (attempt < maxAttempts - 1) await sleep(200 * (attempt + 1))
      continue
    }

    if (body.code !== '0' || !Array.isArray(body.data)) {
      lastErr = body.msg || `OKX error ${body.code} on ${path.split('?')[0]}`
      if (attempt < maxAttempts - 1) await sleep(200 * (attempt + 1))
      continue
    }

    preferredEndpoint = endpointIdx
    return body.data
  }

  throw new OkxError(lastErr)
}

export const isRateHalted = () => Date.now() < haltUntil
