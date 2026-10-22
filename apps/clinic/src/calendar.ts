export function shiftDay(day: string, offset: number): string {
  const date = new Date(day + 'T12:00:00')
  date.setDate(date.getDate() + offset)
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}
export function weekDays(day: string): string[] {
  const date = new Date(day + 'T12:00:00')
  const start = shiftDay(day, -((date.getDay() + 1) % 7))
  return Array.from({ length: 7 }, (_, index) => shiftDay(start, index))
}
