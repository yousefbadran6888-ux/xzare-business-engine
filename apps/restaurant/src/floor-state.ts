type FloorOrder = { tableId: string | null; status: string; updatedAt: number; invoice: unknown }
export function floorState(tableId: string, orderId: string | null, orders: readonly FloorOrder[], now = Date.now()): 'free' | 'occupied' | 'billed' {
  if (orderId) return 'occupied'
  const latest = orders.filter((order) => order.tableId === tableId).reduce<FloorOrder | undefined>((last, order) => !last || order.updatedAt > last.updatedAt ? order : last, undefined)
  return latest?.status === 'completed' && latest.invoice && new Date(latest.updatedAt).toDateString() === new Date(now).toDateString() ? 'billed' : 'free'
}
