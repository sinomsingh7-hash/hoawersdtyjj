import { CHANNEL_TO_TF, FETCH_PLAN, INDEX_ID, INST_ID, MAX_BUFFER, OKX_BAR, TFS, TF_MS, WS_URLS, type Tf } from './constants'
import { classifyOi, computeConfluence, emptyConfluence, type OiSample } from './confluence'
import { commitClosedBar, emptyIndicators, initIndicators, projectLive } from './indicators'
import { addFlow, applyEstimatedFlow, compute1mHistoricalOrderflow, mergeBatches, parseRow, rollup1mDeltaToHtf, type CandleRow } from './orderflow'
import { okxGet } from './rest'
import { loadTodayFlow, persistClosed1m, pruneOldFlow } from './ring-buffer'
import { emptyCard, onCardBarClose, updateAll8ScalpTradeCards, type Bbo, type Consensus } from './scalp-cards'
import { loadLocks, saveLocks, type PersistedCard } from './seal'
import { OkxSocket } from './socket'
import { emptyFlow, type Confluence, type FeedStatus, type Flow, type IndicatorState, type Liquidation, type OkxTrade, type ResolvedSignal, type ScalpCard, type TapePrint, type XBar } from './types'

type Msg = { arg?: { channel?: string; instId?: string; instType?: string }; data?: unknown[]; event?: string; msg?: string; code?: string }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const perTf = <T,>(make: (tf: Tf) => T) => Object.fromEntries(TFS.map(tf => [tf, make(tf)])) as Record<Tf, T>

export type BootStep = { label: string; status: 'pending' | 'running' | 'done' | 'error'; detail?: string }

export type EngineSnapshot = {
  version: number
  hydrated: boolean
  feedStatus: FeedStatus
  boot: BootStep[]
  error: string | null
  ctVal: number
  tickSz: number
  clockOffsetMs: number
  nowSyncedMs: number
  lastPrice: number
  bbo: Bbo
  mark: { markPx: number; ts: number } | null
  index: { idxPx: number; open24h: number; high24h: number; low24h: number; sodUtc0: number; ts: number } | null
  funding: { fundingRate: number; nextFundingRate: number | null; fundingTime: number; ts: number } | null
  oi: { oiCcy: number; oiUsd: number; ts: number; source: 'ws' | 'rest' } | null
  telemetry: {
    exchange_latency_ms: number | null
    sockets: Record<'business' | 'public', { state: string; ms_since_last_ws_frame: number; reconnects: number; url: string }>
    last_seen_trade_id: number
    tick_backfill_trades: number
    ring_buffer_bars: number
    tick_exact_1m_bars: number
    rest_calls: number
  }
  confluence: Confluence
  consensus: Consensus
  cards: Record<Tf, ScalpCard>
  history: ResolvedSignal[]
  tape: TapePrint[]
  liquidations: Liquidation[]
  bars: Record<Tf, XBar[]>
  indicators: Record<Tf, IndicatorState>
}

const EMPTY_CONSENSUS: Consensus = { global_aligned_count: 0, global_dir: 'SYNCING', global_signal_agreement_pct: 0, bull_tfs: 0, bear_tfs: 0, ready_tfs: 0 }

export class XauEngine {
  private bars = perTf<XBar[]>(() => [])
  private liveFlow = perTf(() => new Map<number, Flow>())
  private preBoot = perTf<Flow>(emptyFlow)
  private bootBarTs = perTf(() => -1)
  private ind = perTf<IndicatorState>(emptyIndicators)
  private cards = perTf<ScalpCard>(emptyCard)
  private history: ResolvedSignal[] = []
  private bbo: Bbo = { bid: 0, ask: 0, bid_qty: 0, ask_qty: 0, spread: 0, ts: 0 }
  private ctVal = 0
  private tickSz = 0
  private clockOffsetMs = 0
  private lastSeenTradeId = 0
  private tickCoverageFrom = Number.POSITIVE_INFINITY
  private nonExact1m = new Set<number>()
  private mark: EngineSnapshot['mark'] = null
  private index: EngineSnapshot['index'] = null
  private funding: EngineSnapshot['funding'] = null
  private oi: EngineSnapshot['oi'] = null
  private oiSamples: OiSample[] = []
  private tape: TapePrint[] = []
  private liquidations: Liquidation[] = []
  private confluence: Confluence = emptyConfluence()
  private consensus: Consensus = EMPTY_CONSENSUS
  private confluenceAt = 0
  private hydrated = false
  private queue: string[] = []
  private healing = perTf(() => false)
  private pendingCandles = perTf<CandleRow[]>(() => [])
  private staleHalt = false
  private latencyStrikes = 0
  private exchangeLatency: number | null = null
  private publicDownAt = 0
  private boot: BootStep[] = [
    { label: 'Step 0 · Open business + public WebSockets (buffering)', status: 'pending' },
    { label: 'Step 1 · Server time, ctVal, OI snapshot, 500 tick trades', status: 'pending' },
    { label: 'Step 2 · 8-TF candle pagination + history-trades backfill', status: 'pending' },
    { label: 'Step 3 · Solution A (M1 → M4 → M3 → M2)', status: 'pending' },
    { label: 'Step 4 · Indicators, close-candle intel + sealed lock restore', status: 'pending' },
    { label: 'Step 5 · Drain buffered WebSocket queue', status: 'pending' },
  ]
  private stats = { tickBackfill: 0, ringBars: 0, tickExact: 0, restCalls: 0 }
  private error: string | null = null
  private version = 0
  private snapshot: EngineSnapshot
  private listeners = new Set<() => void>()
  private emitTimer: ReturnType<typeof setTimeout> | undefined
  private intervals: ReturnType<typeof setInterval>[] = []
  private stopped = false
  private business: OkxSocket
  private public: OkxSocket

  constructor() {
    this.business = new OkxSocket({
      name: 'business',
      urls: WS_URLS.business,
      subscribe: { op: 'subscribe', args: TFS.map(tf => ({ channel: `candle${OKX_BAR[tf]}`, instId: INST_ID })) },
      onMessage: data => this.onFrame(data),
      onOpen: reconnect => { this.staleHalt = false; if (reconnect && this.hydrated) for (const tf of TFS) this.healFromLast(tf) },
      onClose: () => this.scheduleEmit(),
    })
    this.public = new OkxSocket({
      name: 'public',
      urls: WS_URLS.public,
      subscribe: {
        op: 'subscribe',
        args: [
          { channel: 'bbo-tbt', instId: INST_ID },
          { channel: 'trades', instId: INST_ID },
          { channel: 'liquidation-orders', instType: 'SWAP' },
          { channel: 'mark-price', instId: INST_ID },
          { channel: 'index-tickers', instId: INDEX_ID },
          { channel: 'funding-rate', instId: INST_ID },
          { channel: 'open-interest', instId: INST_ID },
        ],
      },
      onMessage: data => this.onFrame(data),
      onOpen: reconnect => { this.staleHalt = false; this.latencyStrikes = 0; if (reconnect && this.hydrated) void this.backfillTradesAfterReconnect() },
      onClose: () => { if (!this.publicDownAt) this.publicDownAt = Date.now(); this.scheduleEmit() },
    })
    this.snapshot = this.buildSnapshot()
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.snapshot

  start() {
    this.stopped = false
    void this.runBoot()
  }

  stop() {
    this.stopped = true
    this.business.stop()
    this.public.stop()
    this.intervals.forEach(clearInterval)
    this.intervals = []
    clearTimeout(this.emitTimer)
  }

  private setStep(i: number, status: BootStep['status'], detail?: string) {
    this.boot[i] = { ...this.boot[i], status, detail }
    this.scheduleEmit()
  }

  private nowSynced() { return Date.now() + this.clockOffsetMs }

  private async get<T>(path: string, bucket: Parameters<typeof okxGet>[1], critical = true) {
    this.stats.restCalls++
    return okxGet<T>(path, bucket, critical)
  }

  // ───────────────────────────── boot sequence ─────────────────────────────

  private async runBoot() {
    const t0 = Date.now()
    try {
      // Step 0: sockets first; frames are queued until hydration finishes.
      this.setStep(0, 'running')
      if (this.business.state === 'idle' || this.business.state === 'closed') this.business.start()
      if (this.public.state === 'idle' || this.public.state === 'closed') this.public.start()
      this.setStep(0, 'done', 'Buffering frames in async queue')

      // Step 1 (t = 50ms)
      await sleep(Math.max(0, 50 - (Date.now() - t0)))
      this.setStep(1, 'running')
      const sent = Date.now()
      const [timeRes, instRes, oiRes, tradesRes] = await Promise.allSettled([
        this.get<{ ts: string }>('public/time', 'time'),
        this.get<{ instId: string; ctVal: string; tickSz: string; state: string; ctValCcy: string }>(`public/instruments?instType=SWAP&instId=${INST_ID}`, 'instruments'),
        this.get<{ oiCcy: string; oiUsd: string; ts: string }>(`public/open-interest?instType=SWAP&instId=${INST_ID}`, 'open-interest', false),
        this.get<OkxTrade>(`market/trades?instId=${INST_ID}&limit=500`, 'trades', false),
      ])
      const rtt = Date.now() - sent
      if (timeRes.status === 'fulfilled' && timeRes.value[0]?.ts) {
        this.clockOffsetMs = Number.parseInt(timeRes.value[0].ts, 10) - Math.round(sent + rtt / 2)
      } else {
        this.clockOffsetMs = 0
      }
      const inst = instRes.status === 'fulfilled' ? instRes.value.find(i => i.instId === INST_ID) : undefined
      this.ctVal = inst && Number.parseFloat(inst.ctVal) > 0 ? Number.parseFloat(inst.ctVal) : 0.001
      this.tickSz = inst && Number.parseFloat(inst.tickSz) > 0 ? Number.parseFloat(inst.tickSz) : 0.1
      if (oiRes.status === 'fulfilled' && oiRes.value[0]) this.applyOi(oiRes.value[0], 'rest')
      const recentTrades = tradesRes.status === 'fulfilled' ? tradesRes.value : []
      this.setStep(1, 'done', `ctVal ${this.ctVal} XAU · clock offset ${this.clockOffsetMs}ms`)

      // Step 2 (t = 300ms)
      await sleep(Math.max(0, 300 - (Date.now() - t0)))
      this.setStep(2, 'running')
      const [candleSets, historyTrades] = await Promise.all([
        Promise.all(TFS.map(tf => this.fetchCandles(tf))),
        this.fetchHistoryTrades(recentTrades),
      ])
      TFS.forEach((tf, i) => { this.bars[tf] = candleSets[i] })
      this.setStep(2, 'done', TFS.map(tf => `${tf}:${this.bars[tf].length}`).join(' · '))

      // Step 3: Solution A
      this.setStep(3, 'running')
      this.hydrateSolutionA([...recentTrades, ...historyTrades])
      this.setStep(3, 'done', `${this.stats.tickBackfill} ticks · ${this.stats.tickExact} tick-exact 1m · ${this.stats.ringBars} cached 1m`)

      // Step 4
      this.setStep(4, 'running')
      for (const tf of TFS) this.ind[tf] = initIndicators(this.bars[tf])
      const restored = this.restoreLocks()
      this.setStep(4, 'done', `${restored} sealed lock${restored === 1 ? '' : 's'} restored · ${this.history.length} resolved`)

      // Step 5
      this.setStep(5, 'running')
      this.hydrated = true
      const queued = this.queue
      this.queue = []
      for (const frame of queued) this.dispatch(frame)
      this.setStep(5, 'done', `${queued.length} buffered frames drained`)
      this.recompute(true)
      this.startTimers()
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Startup failed'
      const running = this.boot.findIndex(s => s.status === 'running')
      if (running >= 0) this.setStep(running, 'error', this.error)
      if (!this.stopped) setTimeout(() => { if (!this.stopped && !this.hydrated) { this.error = null; this.boot.forEach((_, i) => { if (i > 0) this.boot[i] = { ...this.boot[i], status: 'pending', detail: undefined } }); void this.retryBoot() } }, 3000)
    }
    this.scheduleEmit()
  }

  private async retryBoot() {
    // Keep healthy sockets open and buffering; rerun REST hydration only.
    if (this.queue.length > 4000) this.queue = this.queue.slice(-4000)
    await this.runBoot()
  }

  /** Deterministic `after=` cursor pagination: /market/candles first, /market/history-candles beyond. */
  private async fetchCandles(tf: Tf) {
    const batches: XBar[][] = []
    let after = ''
    for (let i = 0; i < FETCH_PLAN[tf].length; i++) {
      const step = FETCH_PLAN[tf][i]
      const path = `market/${step.endpoint}?instId=${INST_ID}&bar=${OKX_BAR[tf]}&limit=${step.limit}${after ? `&after=${after}` : ''}`
      try {
        const rows = await this.get<CandleRow>(path, step.endpoint, i === 0)
        if (!rows.length) break
        const batch = rows.slice().reverse().map(r => parseRow(r, TF_MS[tf])).filter((b): b is XBar => b !== null)
        if (!batch.length) break
        batches.push(batch)
        after = String(batch[0].ts)
      } catch (err) {
        // First page of candles is required; deeper historical pagination is best-effort.
        if (batches.length === 0) throw err
        break
      }
    }
    return mergeBatches(batches.reverse()).slice(-MAX_BUFFER[tf])
  }

  /** Paginate /market/history-trades (type=1, 100 per call) backward to ~1,000 total trades. */
  private async fetchHistoryTrades(recent: OkxTrade[]) {
    const out: OkxTrade[] = []
    let oldest = recent.reduce((min, t) => Math.min(min, Number.parseInt(t.tradeId, 10)), Number.POSITIVE_INFINITY)
    for (let page = 0; page < 5 && Number.isFinite(oldest); page++) {
      try {
        const rows = await this.get<OkxTrade>(`market/history-trades?instId=${INST_ID}&type=1&after=${oldest}&limit=100`, 'history-trades', false)
        if (!rows.length) break
        out.push(...rows)
        oldest = rows.reduce((min, t) => Math.min(min, Number.parseInt(t.tradeId, 10)), oldest)
      } catch {
        break
      }
    }
    return out
  }

  private hydrateSolutionA(rawTrades: OkxTrade[]) {
    const b1m = this.bars['1m']
    if (!b1m.length) throw new Error('No 1m candles returned by OKX')

    // Mechanism 1: CLV + tick-rule estimate (all 1m bars, and base layer for 3m..4h)
    for (const tf of TFS) applyEstimatedFlow(this.bars[tf])

    // Mechanism 4: overlay today's persisted tick-exact 1m flow
    const nowMs = this.nowSynced()
    pruneOldFlow(nowMs)
    const cache = loadTodayFlow(nowMs)
    for (const bar of b1m) {
      const entry = cache.get(bar.ts)
      if (!entry || !bar.is_closed) continue
      ;[bar.buy_vol, bar.sell_vol, bar.delta, bar.trades] = entry
      this.stats.ringBars++
    }

    // Mechanism 3: tick-exact backfill from ~1,000 real trades
    const byId = new Map<number, OkxTrade>()
    for (const t of rawTrades) if (t.instId === INST_ID || !t.instId) byId.set(Number.parseInt(t.tradeId, 10), t)
    const trades = [...byId.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t)
    this.stats.tickBackfill = trades.length
    this.lastSeenTradeId = byId.size ? Math.max(...byId.keys()) : 0
    const forming1mTs = b1m[b1m.length - 1].ts
    const buckets = new Map<number, Flow>()
    const formingFlow = emptyFlow()
    let oldestTradeTs = Number.POSITIVE_INFINITY
    for (const t of trades) {
      const ts = Number.parseInt(t.ts, 10)
      oldestTradeTs = Math.min(oldestTradeTs, ts)
      const qty = Number.parseFloat(t.sz) * this.ctVal
      const flow: Flow = { buy_vol: t.side === 'buy' ? qty : 0, sell_vol: t.side === 'sell' ? qty : 0, delta: 0, trades: 1 }
      flow.delta = flow.buy_vol - flow.sell_vol
      if (ts >= forming1mTs) addFlow(formingFlow, flow)
      const bucketTs = Math.floor(ts / 60000) * 60000
      const bucket = buckets.get(bucketTs) ?? emptyFlow()
      addFlow(bucket, flow)
      buckets.set(bucketTs, bucket)
    }
    const oldestBucket = Number.isFinite(oldestTradeTs) ? Math.floor(oldestTradeTs / 60000) * 60000 : Number.POSITIVE_INFINITY
    for (const bar of b1m) {
      if (!bar.is_closed || bar.ts <= oldestBucket || bar.ts >= forming1mTs) continue
      const flow = buckets.get(bar.ts)
      if (!flow) continue
      Object.assign(bar, { buy_vol: flow.buy_vol, sell_vol: flow.sell_vol, delta: flow.delta, trades: flow.trades })
      persistClosed1m(bar)
      this.stats.tickExact++
    }
    this.tickCoverageFrom = oldestTradeTs <= forming1mTs ? forming1mTs : forming1mTs + 60000

    // Mechanism 2: 1m → HTF delta rollup (inherits M3 / M4 overrides)
    for (const tf of TFS) if (tf !== '1m') rollup1mDeltaToHtf(b1m, this.bars[tf], TF_MS[tf])

    // Seed forming bars: closed 1m flow inside [htf_open, forming_1m) + live ticks from the forming 1m.
    for (const tf of TFS) {
      const last = this.bars[tf].at(-1)
      if (!last) continue
      const pre = emptyFlow()
      for (const bar of b1m) if (bar.is_closed && bar.ts >= last.ts && bar.ts < forming1mTs) addFlow(pre, bar)
      this.preBoot[tf] = tf === '1m' ? emptyFlow() : pre
      this.liveFlow[tf].clear()
      this.liveFlow[tf].set(last.ts, { ...formingFlow })
      this.bootBarTs[tf] = last.ts
      this.syncFlow(tf, last, true)
    }
  }

  // ───────────────────────────── order-flow sync ─────────────────────────────

  private syncFlow(tf: Tf, bar: XBar, scaleToVolume: boolean) {
    const flow = { ...(this.liveFlow[tf].get(bar.ts) ?? emptyFlow()) }
    if (bar.ts === this.bootBarTs[tf]) addFlow(flow, this.preBoot[tf])
    const total = flow.buy_vol + flow.sell_vol
    if (scaleToVolume && bar.volume > 0) {
      if (total > 0) {
        const k = bar.volume / total
        flow.buy_vol *= k
        flow.sell_vol *= k
      } else {
        const list = this.bars[tf]
        const prev = list.at(-1) === bar ? list.at(-2) : list.at(-1)
        const est = compute1mHistoricalOrderflow(bar, prev?.close ?? bar.open)
        flow.buy_vol = est.buy_vol
        flow.sell_vol = est.sell_vol
      }
    } else if (total === 0) return
    bar.buy_vol = flow.buy_vol
    bar.sell_vol = flow.sell_vol
    bar.delta = flow.buy_vol - flow.sell_vol
    if (flow.trades > 0) bar.trades = flow.trades
  }

  // ───────────────────────────── frame routing ─────────────────────────────

  private onFrame(data: string) {
    if (!this.hydrated) {
      if (this.queue.length >= 4000) this.queue.shift()
      this.queue.push(data)
      return
    }
    this.dispatch(data)
  }

  private dispatch(raw: string) {
    let msg: Msg
    try { msg = JSON.parse(raw) } catch { return }
    if (msg.event) { if (msg.event === 'error') this.error = `WS ${msg.code}: ${msg.msg}`; return }
    const channel = msg.arg?.channel
    if (!channel || !Array.isArray(msg.data) || !msg.data.length) return
    const tf = CHANNEL_TO_TF[channel]
    if (tf) {
      if (msg.arg?.instId !== INST_ID) return
      for (const row of msg.data as CandleRow[]) this.handleCandle(tf, row)
      this.recompute(false)
      return
    }
    switch (channel) {
      case 'trades': this.handleTrades(msg.data as OkxTrade[]); break
      case 'bbo-tbt': this.handleBbo(msg.data[0] as { bids?: string[][]; asks?: string[][]; ts: string }); break
      case 'liquidation-orders': this.handleLiquidations(msg.data as { instId: string; details: { side: string; posSide: string; sz: string; bkPx: string; ts: string }[] }[]); return
      case 'mark-price': { const d = msg.data[0] as { markPx: string; ts: string }; this.mark = { markPx: Number.parseFloat(d.markPx), ts: Number.parseInt(d.ts, 10) }; break }
      case 'index-tickers': { const d = msg.data[0] as Record<string, string>; this.index = { idxPx: Number.parseFloat(d.idxPx), open24h: Number.parseFloat(d.open24h), high24h: Number.parseFloat(d.high24h), low24h: Number.parseFloat(d.low24h), sodUtc0: Number.parseFloat(d.sodUtc0), ts: Number.parseInt(d.ts, 10) }; break }
      case 'funding-rate': { const d = msg.data[0] as Record<string, string>; this.funding = { fundingRate: Number.parseFloat(d.fundingRate), nextFundingRate: d.nextFundingRate ? Number.parseFloat(d.nextFundingRate) : null, fundingTime: Number.parseInt(d.fundingTime, 10), ts: Number.parseInt(d.ts, 10) }; break }
      case 'open-interest': this.applyOi(msg.data[0] as { oiCcy: string; oiUsd: string; ts: string }, 'ws'); break
      default: return
    }
    this.recompute(false)
  }

  private trackLatency(ts: number) {
    if (!Number.isFinite(ts)) return
    const latency = Math.max(0, this.nowSynced() - ts)
    this.exchangeLatency = latency
    this.latencyStrikes = latency > 1500 ? this.latencyStrikes + 1 : 0
    if (this.latencyStrikes >= 3) {
      this.latencyStrikes = 0
      this.staleHalt = true
      this.public.forceReconnect()
    }
  }

  private handleTrades(data: OkxTrade[]) {
    if (!(this.ctVal > 0)) return
    const sorted = data.slice().sort((a, b) => Number.parseInt(a.tradeId, 10) - Number.parseInt(b.tradeId, 10))
    for (const t of sorted) {
      const tradeId = Number.parseInt(t.tradeId, 10)
      if (!(tradeId > this.lastSeenTradeId)) continue
      this.lastSeenTradeId = tradeId
      const qty = Number.parseFloat(t.sz) * this.ctVal
      const ts = Number.parseInt(t.ts, 10)
      const count = Number.parseInt(t.count ?? '1', 10) || 1
      for (const tf of TFS) {
        const target = Math.floor(ts / TF_MS[tf]) * TF_MS[tf]
        let bucket = this.liveFlow[tf].get(target)
        if (!bucket) { bucket = emptyFlow(); this.liveFlow[tf].set(target, bucket) }
        bucket.trades += count
        if (t.side === 'buy') bucket.buy_vol += qty
        else bucket.sell_vol += qty
        bucket.delta = bucket.buy_vol - bucket.sell_vol
        const last = this.bars[tf].at(-1)
        if (last && last.ts === target) this.syncFlow(tf, last, false)
      }
      this.tape.unshift({ id: tradeId, ts, px: Number.parseFloat(t.px), qty_xau: qty, side: t.side })
    }
    if (this.tape.length > 80) this.tape.length = 80
    if (sorted.length) this.trackLatency(Number.parseInt(sorted[sorted.length - 1].ts, 10))
  }

  private handleBbo(d: { bids?: string[][]; asks?: string[][]; ts: string }) {
    if (!(this.ctVal > 0) || !d) return
    if (d.bids?.length) { this.bbo.bid = Number.parseFloat(d.bids[0][0]); this.bbo.bid_qty = Number.parseFloat(d.bids[0][1]) * this.ctVal }
    if (d.asks?.length) { this.bbo.ask = Number.parseFloat(d.asks[0][0]); this.bbo.ask_qty = Number.parseFloat(d.asks[0][1]) * this.ctVal }
    this.bbo.ts = Number.parseInt(d.ts, 10)
    if (this.bbo.bid > 0 && this.bbo.ask > 0) this.bbo.spread = this.bbo.ask - this.bbo.bid
    this.trackLatency(this.bbo.ts)
  }

  private handleLiquidations(items: { instId: string; details: { side: string; posSide: string; sz: string; bkPx: string; ts: string }[] }[]) {
    if (!(this.ctVal > 0)) return
    let added = false
    for (const item of items) {
      if (item.instId !== INST_ID) continue
      for (const d of item.details ?? []) {
        this.liquidations.unshift({ ts: Number.parseInt(d.ts, 10), side: d.side, posSide: d.posSide, qty_xau: Number.parseFloat(d.sz) * this.ctVal, bkPx: Number.parseFloat(d.bkPx) })
        added = true
      }
    }
    if (this.liquidations.length > 40) this.liquidations.length = 40
    if (added) this.scheduleEmit()
  }

  private applyOi(d: { oiCcy: string; oiUsd: string; ts: string }, source: 'ws' | 'rest') {
    const oiCcy = Number.parseFloat(d.oiCcy)
    const ts = Number.parseInt(d.ts, 10)
    if (!Number.isFinite(oiCcy)) return
    this.oi = { oiCcy, oiUsd: Number.parseFloat(d.oiUsd), ts, source }
    const px = this.bars['1m'].at(-1)?.close ?? this.mark?.markPx ?? 0
    if (px > 0) {
      this.oiSamples.push({ ts, oi: oiCcy, px })
      const cutoff = ts - 600_000
      while (this.oiSamples.length && this.oiSamples[0].ts < cutoff) this.oiSamples.shift()
    }
  }

  // ───────────────────────────── candle state machine ─────────────────────────────

  private handleCandle(tf: Tf, row: CandleRow, allowGap = false) {
    if (this.healing[tf]) { this.pendingCandles[tf].push(row); return }
    const incoming = parseRow(row, TF_MS[tf])
    if (!incoming) return
    const list = this.bars[tf]
    const last = list.at(-1)
    if (!last) { list.push(incoming); return }
    if (incoming.ts < last.ts) return

    // Case A — update current bar in place
    if (incoming.ts === last.ts) {
      if (last.is_closed && !incoming.is_closed) return
      const wasClosed = last.is_closed
      last.open = incoming.open; last.high = incoming.high; last.low = incoming.low; last.close = incoming.close
      last.volume = incoming.volume; last.quote_vol = incoming.quote_vol; last.is_closed = incoming.is_closed
      this.syncFlow(tf, last, true)
      if (incoming.is_closed && !wasClosed) this.onBarClosed(tf, last)
      projectLive(this.ind[tf], last)
      return
    }

    // Case B — rollover
    if (!allowGap && incoming.ts - last.ts > TF_MS[tf]) {
      this.pendingCandles[tf].push(row)
      void this.healGap(tf, last.ts)
      return
    }
    if (!last.is_closed) {
      last.is_closed = true
      this.syncFlow(tf, last, true)
      this.onBarClosed(tf, last)
    }
    this.liveFlow[tf].delete(last.ts)
    if (this.bootBarTs[tf] === last.ts) { this.preBoot[tf] = emptyFlow(); this.bootBarTs[tf] = -1 }
    this.syncFlow(tf, incoming, true)
    list.push(incoming)
    if (list.length > MAX_BUFFER[tf]) list.shift()
    for (const key of this.liveFlow[tf].keys()) if (key < incoming.ts) this.liveFlow[tf].delete(key)
    if (incoming.is_closed) this.onBarClosed(tf, incoming)
    projectLive(this.ind[tf], incoming)
  }

  private onBarClosed(tf: Tf, bar: XBar) {
    commitClosedBar(this.ind[tf], bar)
    onCardBarClose(this.cards[tf])
    if (tf === '1m' && bar.ts >= this.tickCoverageFrom && !this.nonExact1m.has(bar.ts)) {
      persistClosed1m(bar)
      this.stats.tickExact++
    }
  }

  /** Bridge missing bars with before=<last_bar_ts>, paginating with after= when the outage exceeds 300 bars. */
  private async healGap(tf: Tf, lastTs: number) {
    if (this.healing[tf]) return
    this.healing[tf] = true
    let rows: CandleRow[] = []
    let ok = true
    try {
      let after = ''
      for (let page = 0; page < 10; page++) {
        const batch = await this.get<CandleRow>(`market/candles?instId=${INST_ID}&bar=${OKX_BAR[tf]}&before=${lastTs}&limit=300${after ? `&after=${after}` : ''}`, 'candles')
        rows.push(...batch)
        if (batch.length < 300) break
        const oldest = Number.parseInt(batch[batch.length - 1][0], 10)
        if (oldest <= lastTs + TF_MS[tf]) break
        after = String(oldest)
      }
      const seen = new Set<number>()
      rows = rows.filter(r => { const ts = Number.parseInt(r[0], 10); if (ts <= lastTs || seen.has(ts)) return false; seen.add(ts); return true })
        .sort((a, b) => Number.parseInt(a[0], 10) - Number.parseInt(b[0], 10))
    } catch {
      ok = false
    }
    this.healing[tf] = false
    for (const r of rows) this.handleCandle(tf, r, true)
    const pending = this.pendingCandles[tf]
    this.pendingCandles[tf] = []
    for (const r of pending) this.handleCandle(tf, r, !ok)
    this.recompute(true)
  }

  private healFromLast(tf: Tf) {
    const last = this.bars[tf].at(-1)
    if (last) void this.healGap(tf, last.ts - 1)
  }

  private async backfillTradesAfterReconnect() {
    const downAt = this.publicDownAt
    this.publicDownAt = 0
    try {
      const trades = await this.get<OkxTrade>(`market/trades?instId=${INST_ID}&limit=500`, 'trades', false)
      const oldest = trades.reduce((min, t) => Math.min(min, Number.parseInt(t.ts, 10)), Number.POSITIVE_INFINITY)
      if (downAt && oldest > downAt) this.markNonExact(downAt, oldest)
      this.handleTrades(trades)
      this.recompute(true)
    } catch {
      if (downAt) this.markNonExact(downAt, Date.now() + this.clockOffsetMs)
    }
  }

  private markNonExact(fromMs: number, toMs: number) {
    for (let ts = Math.floor(fromMs / 60000) * 60000; ts <= toMs; ts += 60000) this.nonExact1m.add(ts)
  }

  // ───────────────────────────── watchdog / timers ─────────────────────────────

  private startTimers() {
    this.intervals.push(setInterval(() => this.watchdog(), 500))
    this.intervals.push(setInterval(() => {
      if (!this.oi || this.nowSynced() - this.oi.ts > 10_000) {
        void this.get<{ oiCcy: string; oiUsd: string; ts: string }>(`public/open-interest?instType=SWAP&instId=${INST_ID}`, 'open-interest', false)
          .then(d => { if (d[0]) { this.applyOi(d[0], 'rest'); this.recompute(false) } }).catch(() => {})
      }
    }, 10_000))
    this.intervals.push(setInterval(() => this.scheduleEmit(), 1000))
  }

  private watchdog() {
    const now = Date.now()
    for (const socket of [this.business, this.public]) {
      if (socket.state !== 'open') continue
      const idle = now - socket.lastFrameAt
      if (socket.pingSentAt) {
        if (now - socket.pingSentAt > socket.pingDeadlineMs) {
          this.staleHalt = true
          socket.forceReconnect()
        }
      } else if (idle >= 20_000) socket.sendPing(5000)
      else if (idle > 5000) socket.sendPing(3000)
    }
  }

  private feedStatus(): FeedStatus {
    if (!this.hydrated) return 'SYNCING'
    if (this.staleHalt) return 'STALE_HALT'
    if (this.business.state !== 'open' || this.public.state !== 'open') return 'RECONNECTING'
    return 'LIVE'
  }

  // ───────────────────────────── recompute & emit ─────────────────────────────

  /** Re-apply sealed locks from the previous session; tampered or expired locks are discarded by loadLocks. */
  private restoreLocks() {
    const stored = loadLocks(this.nowSynced())
    this.history = stored.history
    let n = 0
    for (const tf of TFS) {
      const p = stored.cards[tf]
      if (!p) continue
      const state = p.tp2_hit ? 'TP2_PARTIAL' : p.tp1_hit ? 'TP1_PARTIAL' : 'LOCKED_ACTIVE'
      Object.assign(this.cards[tf], { is_locked: true, locked_signal: p.locked_signal, tp1_hit: p.tp1_hit, tp2_hit: p.tp2_hit, dynamic_trail_sl: p.dynamic_trail_sl, ideal_state: p.ideal_state, lock_state: state, status: state, last_eval_bar_ts: p.locked_signal.signal_bar_ts, last_eval_note: 'Sealed lock restored from previous session' })
      n++
    }
    this.lockKey = this.computeLockKey()
    return n
  }

  private lockKey = ''
  private computeLockKey() {
    return TFS.map(tf => { const c = this.cards[tf]; return `${c.locked_signal?.seal ?? '-'}:${+c.tp1_hit}${+c.tp2_hit}:${c.ideal_state}` }).join('|') + `#${this.history[0]?.resolved_at_ms ?? 0}`
  }

  private persistLocksIfChanged() {
    const key = this.computeLockKey()
    if (key === this.lockKey) return
    this.lockKey = key
    const cards: Partial<Record<Tf, PersistedCard>> = {}
    for (const tf of TFS) {
      const c = this.cards[tf]
      if (c.locked_signal) cards[tf] = { locked_signal: c.locked_signal, tp1_hit: c.tp1_hit, tp2_hit: c.tp2_hit, dynamic_trail_sl: c.dynamic_trail_sl, ideal_state: c.ideal_state }
    }
    saveLocks({ cards, history: this.history })
  }

  private recompute(forceConfluence: boolean) {
    if (!this.hydrated) return
    const now = this.nowSynced()
    for (const tf of TFS) projectLive(this.ind[tf], this.bars[tf].at(-1))
    if (forceConfluence || now - this.confluenceAt > 250) {
      const price = this.bars['1m'].at(-1)?.close ?? 0
      this.confluence = computeConfluence(this.bars, this.ind, price, now, classifyOi(this.oiSamples, now))
      this.confluenceAt = now
    }
    this.consensus = updateAll8ScalpTradeCards({ bars: this.bars, ind: this.ind, bbo: this.bbo, confluence: this.confluence, feedStatus: this.feedStatus(), cards: this.cards, history: this.history, nowMs: now })
    this.persistLocksIfChanged()
    this.scheduleEmit()
  }

  private scheduleEmit() {
    if (this.emitTimer || this.stopped) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined
      this.snapshot = this.buildSnapshot()
      for (const listener of this.listeners) listener()
    }, 200)
  }

  private buildSnapshot(): EngineSnapshot {
    const now = Date.now()
    const sock = (s: OkxSocket) => ({ state: s.state, ms_since_last_ws_frame: s.lastFrameAt ? now - s.lastFrameAt : 0, reconnects: s.reconnects, url: s.url })
    return {
      version: ++this.version,
      hydrated: this.hydrated,
      feedStatus: this.feedStatus(),
      boot: this.boot.map(s => ({ ...s })),
      error: this.error,
      ctVal: this.ctVal,
      tickSz: this.tickSz,
      clockOffsetMs: this.clockOffsetMs,
      nowSyncedMs: now + this.clockOffsetMs,
      lastPrice: this.bars['1m'].at(-1)?.close ?? 0,
      bbo: { ...this.bbo },
      mark: this.mark,
      index: this.index,
      funding: this.funding,
      oi: this.oi,
      telemetry: {
        exchange_latency_ms: this.exchangeLatency,
        sockets: { business: sock(this.business), public: sock(this.public) },
        last_seen_trade_id: this.lastSeenTradeId,
        tick_backfill_trades: this.stats.tickBackfill,
        ring_buffer_bars: this.stats.ringBars,
        tick_exact_1m_bars: this.stats.tickExact,
        rest_calls: this.stats.restCalls,
      },
      confluence: this.confluence,
      consensus: this.consensus,
      cards: perTf(tf => ({ ...this.cards[tf] })),
      history: [...this.history],
      tape: [...this.tape],
      liquidations: [...this.liquidations],
      bars: perTf(tf => { const list = this.bars[tf]; return list.length ? [...list.slice(0, -1), { ...list[list.length - 1] }] : [] }),
      indicators: perTf(tf => ({ ...this.ind[tf] })),
    }
  }
}

let shared: XauEngine | null = null
let refs = 0
let stopTimer: ReturnType<typeof setTimeout> | undefined

export function acquireEngine() {
  clearTimeout(stopTimer)
  if (!shared) { shared = new XauEngine(); shared.start() }
  refs++
  return shared
}

export function releaseEngine() {
  refs = Math.max(0, refs - 1)
  if (refs === 0) stopTimer = setTimeout(() => { if (refs === 0) { shared?.stop(); shared = null } }, 1500)
}
