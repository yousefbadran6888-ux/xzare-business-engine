import type { GymState } from '@xzare/engine'
export function visible(s: GymState, type: 'membership' | 'member', id: string) {
  return s[type === 'membership' ? 'memberships' : 'members'].some((x) => x.id === id)
}
export function scopeLost(a: GymState, b: GymState) {
  return (
    a.user.id !== b.user.id || a.user.role !== b.user.role ||
    a.memberships.some((g) => !visible(b, 'membership', g.id)) ||
    a.members.some((s) => !visible(b, 'member', s.id))
  )
}

export class ScopeGate {
  private epoch = 0
  private state: GymState | null = null
  update(next: GymState) {
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
  accept(ticket: number, type: 'membership' | 'member', id: string) {
    return this.current(ticket) && !!this.state && visible(this.state, type, id)
  }
}
