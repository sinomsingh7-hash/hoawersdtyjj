'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, LineStyle, ColorType, CrosshairMode, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import { CandlestickChart, LoaderCircle, Maximize2, Minimize2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel, StatusDot } from './panel'
import { TFS, TF_LABEL, VIEWPORT, type Tf } from '@/lib/xau/constants'
import { emaSeries } from '@/lib/xau/indicators'
import { num, px } from '@/lib/xau/format'
import type { CandleFill, Confluence, LockedSignal, ScalpCard, XBar } from '@/lib/xau/types'
import { cn } from '@/lib/utils'

type Props = { bars: XBar[]; tf: Tf; onTfChange: (tf: Tf) => void; live: boolean; tick: number; confluence: Confluence; locked: LockedSignal | null; trailSl: number; preview?: ScalpCard['preview']; fill?: CandleFill | null }

const t = (ms: number) => (ms / 1000) as UTCTimestamp

export const PriceChart = memo(function PriceChart({ bars, tf, onTfChange, live, tick, confluence, locked, trailSl, preview, fill }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const candles = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const delta = useRef<ISeriesApi<'Histogram'> | null>(null)
  const emas = useRef<ISeriesApi<'Line'>[]>([])
  const shape = useRef({ tf: '', first: 0, length: 0 })
  const [expanded, setExpanded] = useState(false)
  const last = bars.at(-1)

  useEffect(() => {
    if (!container.current) return
    const api = createChart(container.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#0e141e' }, textColor: '#8490a2', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: '#1a223080' }, horzLines: { color: '#1a223080' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#657187', labelBackgroundColor: '#293243' }, horzLine: { color: '#657187', labelBackgroundColor: '#293243' } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.26 }, minimumWidth: 76 },
      timeScale: { borderColor: '#202937', timeVisible: true, secondsVisible: false, rightOffset: 6 },
    })
    chart.current = api
    candles.current = api.addSeries(CandlestickSeries, { upColor: '#36cba2', downColor: '#f27483', borderVisible: false, wickUpColor: '#36cba2', wickDownColor: '#f27483', priceFormat: { type: 'price', precision: 1, minMove: 0.1 } })
    delta.current = api.addSeries(HistogramSeries, { priceScaleId: 'delta', lastValueVisible: false, priceLineVisible: false, priceFormat: { type: 'volume' } })
    delta.current.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, borderVisible: false })
    emas.current = [['#f5d48f', 9], ['#dfbb70', 20], ['#8f9cc7', 50]].map(([color]) => api.addSeries(LineSeries, { color: color as string, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }))
    return () => { api.remove(); chart.current = null; candles.current = null; delta.current = null; emas.current = []; shape.current = { tf: '', first: 0, length: 0 } }
  }, [])

  useEffect(() => {
    if (tick > 0) candles.current?.applyOptions({ priceFormat: { type: 'price', precision: Math.max(0, -Math.floor(Math.log10(tick))), minMove: tick } })
  }, [tick])

  useEffect(() => {
    const series = candles.current
    if (!series || !bars.length) return
    const tail = bars[bars.length - 1]
    const s = shape.current
    const incremental = s.tf === tf && s.first === bars[0].ts && (s.length === bars.length || s.length + 1 === bars.length)
    const toCandle = (b: XBar) => ({ time: t(b.ts), open: b.open, high: b.high, low: b.low, close: b.close })
    const toDelta = (b: XBar) => ({ time: t(b.ts), value: Math.abs(b.delta), color: b.delta >= 0 ? '#36cba260' : '#f2748360' })
    if (incremental) {
      if (s.length + 1 === bars.length && bars.length > 1) { series.update(toCandle(bars[bars.length - 2])); delta.current?.update(toDelta(bars[bars.length - 2])) }
      series.update(toCandle(tail))
      delta.current?.update(toDelta(tail))
    } else {
      series.setData(bars.map(toCandle))
      delta.current?.setData(bars.map(toDelta))
    }
    const closes = bars.map(b => b.close)
    ;[9, 20, 50].forEach((period, i) => {
      const values = emaSeries(closes, period)
      emas.current[i]?.setData(values.map((value, j) => ({ time: t(bars[j].ts), value })).slice(period))
    })
    if (s.tf !== tf) chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - VIEWPORT[tf]), to: bars.length + 4 })
    shape.current = { tf, first: bars[0].ts, length: bars.length }
  }, [bars, tf])

  const levelKey = [confluence.pdh, confluence.pdl, confluence.utc_vwap?.toFixed(1), confluence.vwap_upper_1sd?.toFixed(1), confluence.vwap_lower_1sd?.toFixed(1), confluence.vwap_upper_2sd?.toFixed(1), confluence.vwap_lower_2sd?.toFixed(1), locked?.signal_id, trailSl, locked ? '' : preview?.ideal.toFixed(1), fill?.nearest_bull?.id, fill?.nearest_bull?.top, fill?.nearest_bear?.id, fill?.nearest_bear?.bottom].join('|')
  useEffect(() => {
    const series = candles.current
    if (!series) return
    const lines: IPriceLine[] = []
    const add = (price: number | null | undefined, color: string, title: string, style = LineStyle.Dashed) => { if (price && price > 0) lines.push(series.createPriceLine({ price, color, title, lineWidth: 1, lineStyle: style, axisLabelVisible: true })) }
    add(confluence.pdh, '#c9a2f2', 'PDH', LineStyle.Solid)
    add(confluence.pdl, '#c9a2f2', 'PDL', LineStyle.Solid)
    add(confluence.utc_vwap, '#7fb7f5', 'VWAP', LineStyle.Solid)
    add(confluence.vwap_upper_1sd, '#7fb7f560', '+1SD', LineStyle.Dotted)
    add(confluence.vwap_lower_1sd, '#7fb7f560', '-1SD', LineStyle.Dotted)
    add(confluence.vwap_upper_2sd, '#7fb7f540', '+2SD', LineStyle.Dotted)
    add(confluence.vwap_lower_2sd, '#7fb7f540', '-2SD', LineStyle.Dotted)
    if (locked) {
      add(locked.entry_price, '#dfbb70', 'ENTRY')
      add(locked.ideal_entry, '#dfbb70aa', 'IDEAL', LineStyle.Dotted)
      add(locked.initial_sl, '#f27483', 'SL')
      if (trailSl !== locked.initial_sl) add(trailSl, '#f2748399', 'TRAIL')
      add(locked.tp1_price, '#36cba2', 'TP1')
      add(locked.tp2_price, '#36cba2', 'TP2')
      add(locked.tp3_price, '#36cba2', 'TP3')
    }
    else if (preview) add(preview.ideal, '#dfbb7066', 'IDEAL?', LineStyle.Dotted)
    if (fill?.nearest_bull) { add(fill.nearest_bull.top, '#36cba280', 'FVG+', LineStyle.SparseDotted); add(fill.nearest_bull.bottom, '#36cba250', '', LineStyle.SparseDotted) }
    if (fill?.nearest_bear) { add(fill.nearest_bear.bottom, '#f2748380', 'FVG−', LineStyle.SparseDotted); add(fill.nearest_bear.top, '#f2748350', '', LineStyle.SparseDotted) }
    return () => { if (candles.current === series) lines.forEach(line => series.removePriceLine(line)) }
    // levelKey captures every value used above at display precision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelKey])

  useEffect(() => { if (!expanded) return; const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [expanded])

  return <Panel title="Price action · Solution-A delta" icon={<CandlestickChart className="size-3.5" />} className={cn('chart-panel', expanded && 'chart-expanded')} action={<div className="flex items-center gap-2 text-[10px] font-normal normal-case tracking-normal"><StatusDot live={live} /><span className="text-muted-foreground">XAU-USDT-SWAP</span><Button size="icon-xs" variant="ghost" onClick={() => setExpanded(v => !v)} aria-label={expanded ? 'Collapse chart' : 'Expand chart'}>{expanded ? <Minimize2 /> : <Maximize2 />}</Button></div>}>
    <div className="chart-toolbar">
      <div className="flex items-center gap-1 overflow-x-auto" role="group" aria-label="Chart timeframe">{TFS.map(k => <Button key={k} size="xs" variant="ghost" aria-pressed={tf === k} onClick={() => onTfChange(k)} className={cn('h-7 rounded px-2.5 font-mono text-[11px]', tf === k ? 'bg-primary/12 text-primary hover:bg-primary/20' : 'text-muted-foreground')}>{TF_LABEL[k]}</Button>)}</div>
      <div className="ml-auto flex"><Button size="icon-xs" variant="ghost" aria-label="Reset chart zoom" onClick={() => chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - VIEWPORT[tf]), to: bars.length + 4 })}><RotateCcw /></Button></div>
    </div>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3 font-mono text-[10px]">
      <span className="font-medium text-foreground">XAUUSDT <span className="text-muted-foreground">· {TF_LABEL[tf]} · {bars.length} bars</span></span>
      {(['open', 'high', 'low', 'close'] as const).map(k => <span key={k} className="text-muted-foreground">{k[0].toUpperCase()} <span className={last && last.close >= last.open ? 'text-positive' : 'text-negative'}>{px(last?.[k])}</span></span>)}
      <span className="text-muted-foreground">Δ <span className={last && last.delta >= 0 ? 'text-positive' : 'text-negative'}>{last ? num(last.delta, 2, true) : '—'}</span> XAU</span>
      <span className="text-muted-foreground">Vol <span className="text-foreground">{last ? num(last.volume, 1) : '—'}</span></span>
    </div>
    <div className="relative min-h-0 flex-1">
      <div ref={container} className="absolute inset-0" role="img" aria-label={`Live OKX XAUUSDT ${TF_LABEL[tf]} candlestick chart with order-flow delta, EMA 9/20/50, VWAP bands and PDH/PDL`} />
      {!bars.length && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card"><LoaderCircle className="size-5 animate-spin text-primary" /><span className="text-xs text-muted-foreground">SYNCING... hydrating {TF_LABEL[tf]} candles from OKX</span></div>}
    </div>
    <div className="flex flex-wrap items-center gap-4 border-t border-border px-4 py-2.5 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1.5"><i className="h-px w-3 bg-[#f5d48f]" />EMA 9</span>
      <span className="flex items-center gap-1.5"><i className="h-px w-3 bg-primary" />EMA 20</span>
      <span className="flex items-center gap-1.5"><i className="h-px w-3 bg-chart-3" />EMA 50</span>
      <span className="flex items-center gap-1.5"><i className="h-px w-3 bg-[#7fb7f5]" />00:00 UTC VWAP ±1/2SD</span>
      <span className="flex items-center gap-1.5"><i className="h-px w-3 bg-[#c9a2f2]" />PDH / PDL</span>
      <span className="flex items-center gap-1.5"><i className="h-px w-3 border-t border-dotted border-positive" />Open FVG</span>
      <span className="flex items-center gap-1.5"><i className="size-2 bg-positive/50" />|Δ| buy − sell</span>
    </div>
  </Panel>
})
