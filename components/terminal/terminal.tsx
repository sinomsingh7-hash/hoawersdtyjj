'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { ArrowDownRight, ArrowUpRight, ChevronRight, CircleHelp, Crosshair, Gauge, Gem, LayoutDashboard, LockKeyhole, ScanLine, ShieldCheck, TriangleAlert, Waves } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useXauEngine } from '@/hooks/use-xau-engine'
import { TFS, TF_LABEL, TF_MS, type Tf } from '@/lib/xau/constants'
import { emptyConfluence } from '@/lib/xau/confluence'
import { emptyCard, type Consensus } from '@/lib/xau/scalp-cards'
import { px, SYNCING, utcTime } from '@/lib/xau/format'
import { cn } from '@/lib/utils'
import { StatusDot } from './panel'
import { ScalpCardView } from './scalp-card'
import { ConsensusBar } from './consensus-bar'
import { LiquidityPanel, MatrixPanel, VwapPanel } from './flow-panels'
import { DiagnosticsPanel, HistoryPanel, TapePanel, TelemetryPanel } from './telemetry-panels'
import { MethodologyDialog } from './methodology-dialog'
import { CandleFillPanel, CloseIntelPanel } from './candle-intel-panel'

const PriceChart = dynamic(() => import('./price-chart').then(m => m.PriceChart), { ssr: false, loading: () => <div className="terminal-panel chart-panel"><div className="panel-heading">PRICE ACTION</div><div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Loading chart engine…</div></div> })

type View = 'terminal' | 'cards' | 'intel' | 'flow' | 'diagnostics'
const views = [
  { id: 'terminal', label: 'Terminal', icon: LayoutDashboard },
  { id: 'cards', label: 'Scalp cards', icon: Crosshair },
  { id: 'intel', label: 'Close intel', icon: ScanLine },
  { id: 'flow', label: 'Order flow', icon: Waves },
  { id: 'diagnostics', label: 'Diagnostics', icon: Gauge },
] as const

const EMPTY_CARDS = Object.fromEntries(TFS.map(tf => [tf, emptyCard(tf)])) as Record<Tf, ReturnType<typeof emptyCard>>
const EMPTY_CONSENSUS: Consensus = { global_aligned_count: 0, global_dir: 'SYNCING', global_signal_agreement_pct: 0, bull_tfs: 0, bear_tfs: 0, ready_tfs: 0 }
const EMPTY_CONFLUENCE = emptyConfluence()

export function Terminal() {
  const [tf, setTf] = useState<Tf>('5m')
  const [view, setView] = useState<View>('terminal')
  const [methodology, setMethodology] = useState(false)
  const s = useXauEngine()

  const cards = s?.cards ?? EMPTY_CARDS
  const consensus = s?.consensus ?? EMPTY_CONSENSUS
  const confluence = s?.confluence ?? EMPTY_CONFLUENCE
  const now = s?.nowSyncedMs ?? 0
  const feed = s?.feedStatus ?? 'SYNCING'
  const live = feed === 'LIVE'
  const price = s?.lastPrice ?? 0
  const sod = s?.index?.sodUtc0 ?? 0
  const change = price > 0 && sod > 0 ? (price / sod - 1) * 100 : null
  const positive = change !== null && change >= 0
  const focus = cards[tf]
  const left = now ? Math.floor((TF_MS[tf] - (now % TF_MS[tf])) / 1000) : null
  const countdown = left === null ? '—' : `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`

  const cardGrid = <section aria-label="8-timeframe scalp trade matrix" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {TFS.map(k => <ScalpCardView key={k} card={cards[k]} nowMs={now} active={k === tf} onSelect={() => setTf(k)} />)}
  </section>

  return <div className="terminal-app">
    <a href="#workspace" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-20 focus:z-50 focus:rounded focus:bg-primary focus:p-3 focus:text-primary-foreground">Skip to terminal workspace</a>
    <header className="app-header">
      <a href="/" className="flex shrink-0 items-center gap-3" aria-label="Omniscient terminal home"><span className="brand-mark"><Gem className="size-5" strokeWidth={1.5} /></span><span><span className="block text-[14px] font-semibold tracking-[0.18em]">OMNISCIENT<span className="text-primary">.</span></span><span className="mt-1 block text-[8px] tracking-[0.22em] text-muted-foreground">PURE OKX ORDER FLOW</span></span></a>
      <span className="ml-5 hidden h-6 border-l border-border lg:block" />
      <div className="ml-5 hidden items-center gap-2 lg:flex"><span className="text-[10px] text-muted-foreground">WORKSPACE</span><ChevronRight className="size-3 text-muted-foreground" /><span className="text-[10px]">XAUUSDT scalp engine</span></div>
      <div className="ml-auto flex items-center gap-3 sm:gap-5">
        <Badge variant="outline" className={cn('h-6 gap-1.5 rounded border-border text-[9px] font-normal', live ? 'bg-positive/5 text-positive' : 'bg-primary/5 text-primary')}><StatusDot live={live} />{feed}</Badge>
        <div className="hidden text-right font-mono md:block"><div className="text-[11px] text-foreground">{utcTime(now)} <span className="text-muted-foreground">UTC</span></div><div className="mt-1 text-[8px] text-muted-foreground">CLOCK-SYNCED · {s ? `${s.clockOffsetMs}ms` : SYNCING}</div></div>
        <span className="hidden h-5 border-l border-border sm:block" />
        <Button size="icon-sm" variant="ghost" onClick={() => setMethodology(true)} aria-label="Read methodology" className="text-muted-foreground"><CircleHelp className="size-4!" /></Button>
      </div>
    </header>
    <div className="app-body">
      <aside className="icon-rail" aria-label="Workspace navigation">
        <div className="flex flex-col gap-3">{views.map(item => <Button key={item.id} variant="ghost" size="icon" onClick={() => setView(item.id)} aria-label={item.label} title={item.label} aria-current={view === item.id ? 'page' : undefined} className={cn('size-9 rounded-md', view === item.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}><item.icon className="size-4!" /></Button>)}</div>
      </aside>
      <div className="workspace-shell">
        <nav className="workspace-nav" aria-label="Terminal sections">
          <div className="flex min-w-0 items-stretch gap-5 overflow-x-auto sm:gap-7">{views.map(item => <button key={item.id} onClick={() => setView(item.id)} aria-current={view === item.id ? 'page' : undefined} className={cn('workspace-tab', view === item.id && 'active')}><item.icon className="size-3" />{item.label}{item.id === 'terminal' && <span className="ml-1 hidden rounded bg-primary/12 px-1.5 py-0.5 font-mono text-[8px] text-primary sm:inline">LIVE</span>}</button>)}</div>
          <div className="ml-auto hidden shrink-0 items-center gap-2 pl-4 text-[9px] text-muted-foreground lg:flex"><LockKeyhole className="size-3 text-primary" />Immutable Close-Candle Signal Lock<Badge variant="outline" className="ml-2 h-4 rounded border-border px-1 text-[8px] text-muted-foreground">v18.0</Badge></div>
        </nav>
        <main id="workspace" className="workspace-content">
          <div className="instrument-strip">
            <div className="flex shrink-0 items-center gap-3"><span className="gold-coin"><span className="text-[19px] leading-none font-semibold">Au</span><span className="mt-1 text-[7px] tracking-[0.15em]">GOLD</span></span><div><div className="flex items-center gap-2"><h1 className="text-lg font-semibold tracking-tight">XAUUSDT</h1><span className="rounded border border-border px-1.5 py-0.5 text-[8px] text-muted-foreground">PERP</span></div><div className="mt-1 text-[9px] text-muted-foreground">OKX · XAU-USDT-SWAP · index XAU-USDT</div></div></div>
            <div className="price-block"><div className="font-mono text-[30px] leading-none font-medium tracking-[-0.05em]">{px(price, 1)}</div><div className={cn('mt-2 flex items-center gap-1 text-[10px]', positive ? 'text-positive' : 'text-negative')}>{change !== null && (positive ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />)}<span className="font-mono">{change === null ? SYNCING : `${positive ? '+' : ''}${change.toFixed(2)}%`}</span><span className="ml-1 text-muted-foreground">vs 00:00 UTC index</span></div></div>
            <div className="ticker-stat"><span>Bid / Ask</span><b>{px(s?.bbo.bid, 1)} <em>/</em> {px(s?.bbo.ask, 1)}</b></div>
            <div className="ticker-stat"><span>Mark</span><b>{px(s?.mark?.markPx, 2)}</b></div>
            <div className="ticker-stat"><span>Index</span><b>{px(s?.index?.idxPx, 2)}</b></div>
            <div className="ticker-stat hidden xl:flex"><span>Funding</span><b>{s?.funding ? `${(s.funding.fundingRate * 100).toFixed(4)}%` : SYNCING}</b></div>
            <div className="ticker-stat hidden xl:flex"><span>OI <small>XAU</small></span><b>{s?.oi ? s.oi.oiCcy.toLocaleString('en-US', { maximumFractionDigits: 0 }) : SYNCING}</b></div>
            <div className="ml-auto shrink-0 text-right"><div className="text-[9px] text-muted-foreground">NEXT {TF_LABEL[tf]} CLOSE</div><div className="mt-1 font-mono text-sm text-primary">{countdown}</div></div>
          </div>

          {s && (s.error || feed === 'STALE_HALT' || feed === 'RECONNECTING') && <Alert className="mb-4 border-primary/20 bg-primary/5 text-primary"><TriangleAlert /><AlertTitle className="text-xs">{feed === 'STALE_HALT' ? 'Feed halted: stale telemetry' : feed === 'RECONNECTING' ? 'Reconnecting to OKX' : 'OKX request issue'}</AlertTitle><AlertDescription className="text-[11px]">{s.error ?? 'New locks are blocked until both sockets are LIVE. Gap healing runs automatically after reconnect.'}</AlertDescription></Alert>}

          <div className="flex flex-col gap-4">
            {(view === 'terminal' || view === 'cards') && <ConsensusBar consensus={consensus} cards={cards} active={tf} onSelect={setTf} />}
            {view === 'terminal' && <>
              <div className="primary-grid">
                <PriceChart bars={s?.bars[tf] ?? []} tf={tf} onTfChange={setTf} live={live} tick={s?.tickSz ?? 0} confluence={confluence} locked={focus.locked_signal} trailSl={focus.dynamic_trail_sl} preview={focus.preview} fill={focus.fill} />
                <div className="flex flex-col gap-2">
                  <div className="eyebrow">ACTIVE TIMEFRAME · {TF_LABEL[tf]}</div>
                  <ScalpCardView card={focus} nowMs={now} active large />
                  {focus.locked_signal && <div className="rounded-md border border-border bg-card p-3">
                    <div className="mb-2 text-[8px] tracking-wider text-muted-foreground">LOCKED TF SNAPSHOT (READ-ONLY)</div>
                    <div className="grid grid-cols-4 gap-1">{focus.locked_signal.locked_tf_snapshot.map(row => <div key={row.tf} className="rounded border border-border px-1 py-1 text-center font-mono text-[9px]"><div className="text-muted-foreground">{TF_LABEL[row.tf]}</div><div className={row.dir === 'LONG' ? 'text-positive' : row.dir === 'SHORT' ? 'text-negative' : 'text-muted-foreground'}>{row.dir === 'NEUTRAL' || row.dir === 'SYNCING' ? '—' : row.dir[0]} {row.intra_pct.toFixed(0)}</div></div>)}</div>
                  </div>}
                </div>
              </div>
              {cardGrid}
              <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"><CloseIntelPanel cards={cards} active={tf} onSelect={setTf} /><CandleFillPanel card={focus} /></div>
              <div className="secondary-grid !my-0"><LiquidityPanel c={confluence} /><VwapPanel c={confluence} /><MatrixPanel c={confluence} /></div>
              {s && <div className="grid gap-4 lg:grid-cols-2"><TelemetryPanel s={s} /><TapePanel s={s} /></div>}
              {s && <HistoryPanel s={s} />}
            </>}
            {view === 'cards' && <>{cardGrid}{s && <HistoryPanel s={s} />}</>}
            {view === 'intel' && <>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"><CloseIntelPanel cards={cards} active={tf} onSelect={setTf} /><CandleFillPanel card={focus} /></div>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><ScalpCardView card={focus} nowMs={now} active large />{s && <HistoryPanel s={s} />}</div>
            </>}
            {view === 'flow' && <>
              <div className="secondary-grid !my-0"><LiquidityPanel c={confluence} /><VwapPanel c={confluence} /><MatrixPanel c={confluence} /></div>
              {s && <div className="grid gap-4 lg:grid-cols-2"><TelemetryPanel s={s} /><TapePanel s={s} /></div>}
            </>}
            {view === 'diagnostics' && s && <div className="grid gap-4 lg:grid-cols-2"><DiagnosticsPanel s={s} /><TelemetryPanel s={s} /></div>}
            {!s && view === 'diagnostics' && <p className="text-xs text-muted-foreground">{SYNCING}</p>}
          </div>

          <div className="workspace-disclaimer"><ShieldCheck className="size-3 shrink-0 text-primary" /><p>Signal Agreement is a rule-based factor count confirmed on candle close, not a probability of profit or a guarantee of accuracy. This terminal does not place trades. Trade only with capital you can afford to lose.</p><button onClick={() => setMethodology(true)} className="ml-auto shrink-0 text-primary hover:underline">Methodology <span aria-hidden="true">↗</span></button></div>
        </main>
        <footer className="status-footer">
          <div className="flex flex-wrap items-center gap-4"><span className="flex items-center gap-1.5"><StatusDot live={live} /><span className={live ? 'text-positive' : 'text-primary'}>{feed}</span></span><span className="hidden sm:inline">OKX V5 · XAU-USDT-SWAP</span><span className="hidden lg:inline">business + public WS · zero polling</span><span className="hidden xl:inline">1m · 3m · 5m · 15m · 30m · 1H · 2H · 4H</span></div>
          <span className="hidden items-center gap-1.5 sm:flex"><ShieldCheck className="size-3" />No API keys · no synthetic data<span className="mx-2 text-border">|</span><span className="text-primary">OMNISCIENT v18</span></span>
        </footer>
      </div>
    </div>
    <MethodologyDialog open={methodology} onOpenChange={setMethodology} />
  </div>
}
