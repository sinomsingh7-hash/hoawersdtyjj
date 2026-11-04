import { NextRequest, NextResponse } from 'next/server'

const UPSTREAMS = [
  'https://www.okx.com/api/v5',
  'https://aws.okx.com/api/v5',
  'https://my.okx.com/api/v5',
] as const

const ALLOWED_PREFIXES = [
  'public/time',
  'public/instruments',
  'public/open-interest',
  'market/trades',
  'market/candles',
  'market/history-candles',
  'market/history-trades',
] as const

function isAllowedPath(path: string) {
  if (!path || path.includes('..') || path.startsWith('/') || path.includes('://')) return false
  return ALLOWED_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}?`))
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'omniscient-xau-terminal/18.0',
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path')?.trim() ?? ''
  if (!isAllowedPath(path)) {
    return NextResponse.json({ code: '400', msg: 'Disallowed OKX endpoint path', data: [] }, { status: 400 })
  }

  let lastStatus = 502
  let lastMessage = 'All OKX upstream mirrors timed out'

  for (const base of UPSTREAMS) {
    try {
      const res = await fetchWithTimeout(`${base}/${path}`, 7000)
      lastStatus = res.status
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After') ?? '5'
        const body = await res.json().catch(() => ({ code: '50011', msg: 'Rate limit reached', data: [] }))
        return NextResponse.json(body, {
          status: 429,
          headers: { 'Retry-After': retryAfter, 'Cache-Control': 'no-store' },
        })
      }
      if (!res.ok) {
        lastMessage = `Upstream ${base} returned HTTP ${res.status}`
        continue
      }
      const data = await res.json()
      return NextResponse.json(data, {
        status: 200,
        headers: { 'Cache-Control': 'no-store', 'X-Okx-Upstream': base },
      })
    } catch (err) {
      lastMessage = err instanceof Error ? err.message : 'Upstream fetch failed'
    }
  }

  return NextResponse.json({ code: '502', msg: lastMessage, data: [] }, { status: lastStatus })
}
