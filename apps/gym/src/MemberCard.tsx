import { useEffect, useRef, useState } from 'react'
import type { GymMember } from '@xzare/engine'
export function MemberCard({
  member,
  business,
}: {
  member: GymMember
  business: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [error, setError] = useState(''),
    [ready, setReady] = useState(false)
  useEffect(() => {
    let live = true
    setReady(false)
    setError('')
    import('bwip-js/browser')
      .then((m) => {
        if (live && canvas.current) {
          m.default.toCanvas(canvas.current, {
            bcid: 'code128',
            text: member.code,
            scale: 3,
            height: 15,
            includetext: true,
            textxalign: 'center',
            paddingwidth: 12,
            paddingheight: 4,
          })
          setReady(true)
        }
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [member.code])
  return (
    <>
      <div className="gym-member-card print-area">
        <header>
          <img src="./icon.svg" alt="" />
          <div>
            {business}
            <small>بطاقة عضوية</small>
          </div>
        </header>
        <strong>{member.name}</strong>
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <canvas ref={canvas} aria-label={'باركود عضوية ' + member.code} />
        )}
        <bdi>{member.code}</bdi>
      </div>
      <p className="muted">
        الباركود للتعرف على ملف العضو، ولا يثبت هوية حامل البطاقة. قارئ USB يكتب
        الكود ثم Enter في شاشة الاستقبال.
      </p>
      <button onClick={() => window.print()} disabled={!ready || !!error}>
        طباعة بطاقة العضو
      </button>
    </>
  )
}
