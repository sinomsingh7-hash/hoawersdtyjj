'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { acquireEngine, releaseEngine, type EngineSnapshot, type XauEngine } from '@/lib/xau/engine'

const noopSubscribe = () => () => {}
const nullSnapshot = () => null

export function useXauEngine(): EngineSnapshot | null {
  const [engine, setEngine] = useState<XauEngine | null>(null)
  useEffect(() => {
    setEngine(acquireEngine())
    return () => releaseEngine()
  }, [])
  return useSyncExternalStore(engine?.subscribe ?? noopSubscribe, engine?.getSnapshot ?? nullSnapshot, nullSnapshot)
}
