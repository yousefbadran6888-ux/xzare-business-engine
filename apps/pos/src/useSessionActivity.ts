import { useEffect, useRef } from 'react'
import { call } from './bridge'
/** Background polling is not user activity; only real input renews idle time. */
export function useSessionActivity(enabled: boolean, onExpired: () => void) {
  const expired = useRef(onExpired)
  expired.current = onExpired
  useEffect(() => {
    if (!enabled) return
    let dirty = false,
      inFlight = false,
      disposed = false,
      last = 0
    const send = () => {
      if (disposed || !dirty || inFlight || document.visibilityState === 'hidden' || Date.now() - last < 45000)
        return
      dirty = false
      inFlight = true
      last = Date.now()
      void call('session.activity')
        .catch((error) => {
          if (disposed) return
          if (/انتهت الجلسة|سجّل الدخول/.test(error instanceof Error ? error.message : ''))
            expired.current()
          else dirty = true
        })
        .finally(() => {
          inFlight = false
        })
    }
    const activity = (event: Event) => {
      if (!event.isTrusted) return
      dirty = true
      send()
    }
    const timer = setInterval(send, 1000)
    window.addEventListener('pointerdown', activity)
    window.addEventListener('keydown', activity)
    return () => {
      disposed = true
      clearInterval(timer)
      window.removeEventListener('pointerdown', activity)
      window.removeEventListener('keydown', activity)
    }
  }, [enabled])
}
