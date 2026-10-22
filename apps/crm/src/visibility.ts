import type { CrmEntity } from '@xzare/engine'
type Scope = {
  leads: { id: string }[]
  contacts: { id: string }[]
  opportunities: { id: string }[]
}
export function hasRecord(s: Scope, type: CrmEntity, id: string) {
  return (type === 'lead' ? s.leads : type === 'contact' ? s.contacts : s.opportunities).some(
    (x) => x.id === id,
  )
}
export function scopeRevoked(before: Scope, after: Scope) {
  return (
    before.leads.some((x) => !hasRecord(after, 'lead', x.id)) ||
    before.contacts.some((x) => !hasRecord(after, 'contact', x.id)) ||
    before.opportunities.some((x) => !hasRecord(after, 'opportunity', x.id))
  )
}
