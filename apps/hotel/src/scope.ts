export class HotelScope {
  private value = ''
  private epoch = 0
  update(u: { id: string; role: string }) {
    const v = u.id + ':' + u.role
    const lost = !!this.value && v !== this.value
    if (lost) this.epoch++
    this.value = v
    return lost
  }
  clear() {
    this.value = ''
    this.epoch++
  }
  ticket() {
    return this.epoch
  }
  current(n: number) {
    return n === this.epoch
  }
}
export function freshCaptured<T extends { id: string }>(
  current: T | null,
  captured: T | null,
  fresh: T | null,
  lost = false,
) {
  if (lost) return null
  if (!captured || current?.id !== captured.id) return current
  return fresh
}
