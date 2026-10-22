export function clinicToday() {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}
export function clinicDayBounds(from: string, to: string) {
  const a = from.split('-').map(Number),
    b = to.split('-').map(Number)
  return {
    lo: new Date(a[0]!, a[1]! - 1, a[2]!).getTime(),
    hi: new Date(b[0]!, b[1]! - 1, b[2]! + 1).getTime(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}
