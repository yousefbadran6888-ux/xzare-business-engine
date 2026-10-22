import type { Invoice, User } from './types.js'
export type OrderStatus =
  | 'open'
  | 'queued'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'out'
  | 'completed'
  | 'cancelled'
  | 'refunded'
export type LineStatus = 'draft' | 'queued' | 'preparing' | 'ready' | 'served' | 'cancelled'
export type RecipeComponent = { variantId: string; qty: number; name?: string; unit?: string }
export type MenuItem = {
  id: string
  name: string
  category: string
  price: number
  station: 'kitchen' | 'bar'
  kind: 'prepared' | 'stocked' | 'service'
  active: number
  components: RecipeComponent[]
}
export type RestaurantTable = {
  id: string
  name: string
  zone: string
  seats: number
  active: number
  orderId: string | null
  orderNumber: string | null
  status: OrderStatus | null
}
export type OrderLine = {
  id: string
  menuId: string
  name: string
  qty: number
  price: number
  station: 'kitchen' | 'bar'
  components: RecipeComponent[]
  note: string
  status: LineStatus
  cost: number
  preparedAt: number | null
  readyAt: number | null
}
export type RestaurantOrder = {
  id: string
  number: string
  kind: 'dinein' | 'takeaway' | 'delivery'
  tableId: string | null
  tableName: string | null
  status: OrderStatus
  version: number
  customerName: string
  phone: string
  address: string
  note: string
  deliveryFee: number
  taxBps: number
  driverId: string | null
  driverName: string | null
  createdAt: number
  updatedAt: number
  subtotal: number
  lines: OrderLine[]
  invoice: Invoice | null
}
export type Driver = { id: string; name: string; phone: string; active: number; trips: number }
export type Reservation = {
  id: string
  tableId: string
  tableName: string
  name: string
  phone: string
  guests: number
  startsAt: number
  endsAt: number
  status: 'booked' | 'seated' | 'cancelled'
  orderId: string | null
}
export type RestaurantState = {
  user: User
  businessName: string
  tables: RestaurantTable[]
  menu: MenuItem[]
  orders: RestaurantOrder[]
  drivers: Driver[]
  reservations: Reservation[]
  waste: {
    id: string
    orderId: string
    lineId: string
    name: string
    qty: number
    cost: number
    reason: string
    at: number
  }[]
  config: { deliveryFee: number }
}
