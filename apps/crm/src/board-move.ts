export function canMoveOpportunity(current: string, target: string, manager: boolean): boolean {
  const stages = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost']
  if (!stages.includes(current) || !stages.includes(target) || current === target) return false
  return !['won', 'lost'].includes(current) || (manager && !['won', 'lost'].includes(target))
}
