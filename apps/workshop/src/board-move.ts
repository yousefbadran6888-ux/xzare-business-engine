export function workshopDropAction(current: string, target: string, paid: number, total: number): string | null {
  const next: Record<string, [string, string]> = {
    received: ['estimated', 'estimate'],
    estimated: ['approved', 'approve'],
    approved: ['in_progress', 'start'],
    in_progress: ['ready', 'ready'],
    ready: ['delivered', 'deliver'],
  }
  const move = next[current]
  if (!move || move[0] !== target || (target === 'delivered' && paid !== total)) return null
  return move[1]
}
