export const SYMBOL = 'XAUUSDT'
export const INST_ID = 'XAU-USDT-SWAP'
export const INDEX_ID = 'XAU-USDT'
export const REST_BASE = 'https://www.okx.com/api/v5'

// OKX retires port 8443 in favour of 443; the spec URI stays primary and 443 is the automatic fallback.
export const WS_URLS = {
  business: ['wss://ws.okx.com:8443/ws/v5/business', 'wss://ws.okx.com/ws/v5/business'],
  public: ['wss://ws.okx.com:8443/ws/v5/public', 'wss://ws.okx.com/ws/v5/public'],
} as const

export const TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h'] as const
export type Tf = (typeof TFS)[number]

/** OKX `bar` parameter is case-sensitive: lowercase m, UPPERCASE H. */
export const OKX_BAR: Record<Tf, string> = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '2H', '4h': '4H' }
export const TF_LABEL: Record<Tf, string> = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '2H', '4h': '4H' }
export const TF_MS: Record<Tf, number> = { '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000 }
export const CHANNEL_TO_TF: Record<string, Tf> = Object.fromEntries(TFS.map(tf => [`candle${OKX_BAR[tf]}`, tf]))

export type CandleEndpoint = 'candles' | 'history-candles'
export type FetchStep = { endpoint: CandleEndpoint; limit: number }

const recent = (...limits: number[]): FetchStep[] => limits.map(limit => ({ endpoint: 'candles', limit }))

/**
 * 1m stays under the rolling 1,440-bar boundary of /market/candles: 1,200 bars from the recent
 * cache, the remaining 300 from /market/history-candles.
 */
export const FETCH_PLAN: Record<Tf, FetchStep[]> = {
  '1m': [...recent(300, 300, 300, 300), { endpoint: 'history-candles', limit: 100 }, { endpoint: 'history-candles', limit: 100 }, { endpoint: 'history-candles', limit: 100 }],
  '3m': recent(300, 300, 300, 100),
  '5m': recent(300, 300),
  '15m': recent(300, 200),
  '30m': recent(300, 200),
  '1h': recent(300, 200),
  '2h': recent(300, 200),
  '4h': recent(300, 200),
}
export const MAX_BUFFER: Record<Tf, number> = Object.fromEntries(TFS.map(tf => [tf, FETCH_PLAN[tf].reduce((sum, step) => sum + step.limit, 0)])) as Record<Tf, number>
export const VIEWPORT: Record<Tf, number> = { '1m': 100, '3m': 110, '5m': 110, '15m': 96, '30m': 96, '1h': 96, '2h': 84, '4h': 72 }

export type ScalpCardConfig = { label: string; sl_atr: number; tp1_r: number; tp2_r: number; tp3_r: number; min_agree_pct: number; max_hold_bars: number; max_spread: number }
export const SCALP_CARD_CONFIG: Record<Tf, ScalpCardConfig> = {
  '1m': { label: '1m', sl_atr: 1.2, tp1_r: 1.0, tp2_r: 2.0, tp3_r: 3.2, min_agree_pct: 74.0, max_hold_bars: 15, max_spread: 0.8 },
  '3m': { label: '3m', sl_atr: 1.25, tp1_r: 1.0, tp2_r: 2.0, tp3_r: 3.2, min_agree_pct: 74.0, max_hold_bars: 12, max_spread: 0.9 },
  '5m': { label: '5m', sl_atr: 1.35, tp1_r: 1.0, tp2_r: 2.0, tp3_r: 3.2, min_agree_pct: 72.0, max_hold_bars: 12, max_spread: 1.0 },
  '15m': { label: '15m', sl_atr: 1.45, tp1_r: 1.0, tp2_r: 2.0, tp3_r: 3.2, min_agree_pct: 72.0, max_hold_bars: 10, max_spread: 1.2 },
  '30m': { label: '30m', sl_atr: 1.5, tp1_r: 1.0, tp2_r: 2.0, tp3_r: 3.2, min_agree_pct: 70.0, max_hold_bars: 10, max_spread: 1.5 },
  '1h': { label: '1H', sl_atr: 1.6, tp1_r: 1.0, tp2_r: 2.0, tp3_r: 3.5, min_agree_pct: 70.0, max_hold_bars: 8, max_spread: 1.8 },
  '2h': { label: '2H', sl_atr: 1.7, tp1_r: 1.0, tp2_r: 2.0, tp3_r: 3.5, min_agree_pct: 68.0, max_hold_bars: 8, max_spread: 2.0 },
  '4h': { label: '4H', sl_atr: 1.8, tp1_r: 1.0, tp2_r: 2.0, tp3_r: 3.5, min_agree_pct: 68.0, max_hold_bars: 6, max_spread: 2.5 },
}

/** Client-side caps at 75% of each OKX per-IP endpoint limit (requests per 2s). */
export const RATE_LIMITS = {
  time: 7,
  candles: 30,
  'history-candles': 15,
  'history-trades': 15,
  trades: 75,
  instruments: 15,
  'open-interest': 15,
} as const
export type RateBucket = keyof typeof RATE_LIMITS
