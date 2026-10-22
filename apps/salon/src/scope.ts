import type { SalonState } from '@xzare/engine'
export const visible = (
  s: SalonState,
  type: 'booking' | 'customer',
  id: string,
) => s[type === 'booking' ? 'bookings' : 'customers'].some((x) => x.id === id)
export function scopeLost(a: SalonState, b: SalonState) {
  return (
    a.user.id !== b.user.id ||
    a.user.role !== b.user.role ||
    a.bookings.some((x) => !visible(b, 'booking', x.id)) ||
    a.customers.some((x) => !visible(b, 'customer', x.id)) ||
    (a.staff ?? []).some((x) => !(b.staff ?? []).some((y) => y.id === x.id))
  )
}
export class ScopeGate {
  private epoch = 0
  private state: SalonState | null = null
  update(next: SalonState) {
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
  current(t: number) {
    return t === this.epoch && this.state !== null
  }
  accept(t: number, type: 'booking' | 'customer', id: string) {
    return this.current(t) && !!this.state && visible(this.state, type, id)
  }
}
