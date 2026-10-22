import { useEffect, useState } from 'react'
export function WorkspaceClock({ english }: { english: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const locale = english ? 'en-EG' : 'ar-EG'
  return (
    <div className="workspace-clock">
      <span>
        {now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
      </span>
      <time dateTime={now.toISOString()}>
        {now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
      </time>
    </div>
  )
}
