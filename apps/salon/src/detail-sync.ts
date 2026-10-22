export function syncDetail<T extends { kind: string; id: string }>(
  current: T | null,
  captured: T | null,
  fresh: T | null,
  scopeLost: boolean,
): T | null {
  if (scopeLost) return null
  if (
    !current ||
    !captured ||
    current.kind !== captured.kind ||
    current.id !== captured.id
  )
    return current
  return fresh
}
