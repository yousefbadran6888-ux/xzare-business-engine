import type { EduState } from '@xzare/engine'
export function visible(s: EduState, type: 'group' | 'student', id: string) {
  return s[type === 'group' ? 'groups' : 'students'].some((x) => x.id === id)
}
export function scopeLost(a: EduState, b: EduState) {
  return (
    a.user.role !== b.user.role ||
    a.groups.some((g) => !visible(b, 'group', g.id)) ||
    a.students.some((s) => !visible(b, 'student', s.id))
  )
}

export class ScopeGate {
  private epoch = 0
  private state: EduState | null = null
  update(next: EduState) {
    const lost = !!this.state && scopeLost(this.state, next)
    if (lost) this.epoch++
    this.state = next
    return lost
  }
  clear() {
    this.epoch++
    this.state = null
  }
  ticket() {
    return this.epoch
  }
  current(ticket: number) {
    return ticket === this.epoch && this.state !== null
  }
  accept(ticket: number, type: 'group' | 'student', id: string) {
    return this.current(ticket) && !!this.state && visible(this.state, type, id)
  }
}
